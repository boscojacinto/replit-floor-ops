import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, teamsTable, pingsTable, ticketsTable } from "@workspace/db";
import {
  DraftTicketParams,
  DraftTicketBody,
  DraftTicketResponse,
  ListTicketsQueryParams,
  ListTicketsResponse,
  UpdateTicketParams,
  UpdateTicketBody,
  UpdateTicketResponse,
  FileTicketParams,
  FileTicketResponse,
  DiscardTicketParams,
  DiscardTicketResponse,
  ResolveTicketParams,
  ResolveTicketResponse,
} from "@workspace/api-zod";
import { draftTicketFromSignals } from "../lib/ticket-drafter";
import { fileGithubIssue, closeGithubIssue, GithubIssueError } from "../lib/github";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/teams/:teamId/tickets/draft", async (req, res): Promise<void> => {
  const params = DraftTicketParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = DraftTicketBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [team] = await db
    .select()
    .from(teamsTable)
    .where(eq(teamsTable.id, params.data.teamId));

  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  if (body.data.moderatorNote) {
    await db.insert(pingsTable).values({
      teamId: team.id,
      source: "moderator_note",
      helpType: null,
      note: body.data.moderatorNote,
    });
    await db
      .update(teamsTable)
      .set({ lastPingAt: new Date() })
      .where(eq(teamsTable.id, team.id));
  }

  const recentPings = await db
    .select()
    .from(pingsTable)
    .where(eq(pingsTable.teamId, team.id))
    .orderBy(desc(pingsTable.createdAt))
    .limit(15);
  recentPings.reverse();

  const draft = await draftTicketFromSignals({
    team,
    recentPings,
    moderatorNote: body.data.moderatorNote,
  });

  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      teamId: team.id,
      status: "draft",
      phase: draft.phase,
      blockerType: draft.blockerType,
      helpType: draft.helpType,
      skill: draft.skill,
      summary: draft.summary,
      etaMinutes: draft.etaMinutes,
      risk: draft.risk,
      issueTitle: draft.issueTitle,
      issueBody: draft.issueBody,
      issueLabels: draft.issueLabels,
    })
    .returning();

  if (!ticket) {
    res.status(500).json({ error: "Failed to draft ticket" });
    return;
  }

  res.status(201).json(DraftTicketResponse.parse(ticket));
});

router.get("/tickets", async (req, res): Promise<void> => {
  const query = ListTicketsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const tickets = await db
    .select()
    .from(ticketsTable)
    .where(
      query.data.status
        ? eq(ticketsTable.status, query.data.status)
        : undefined,
    )
    .orderBy(desc(ticketsTable.createdAt));

  res.json(ListTicketsResponse.parse(tickets));
});

router.patch("/tickets/:ticketId", async (req, res): Promise<void> => {
  const params = UpdateTicketParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateTicketBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [ticket] = await db
    .update(ticketsTable)
    .set(body.data)
    .where(eq(ticketsTable.id, params.data.ticketId))
    .returning();

  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  res.json(UpdateTicketResponse.parse(ticket));
});

router.post("/tickets/:ticketId/file", async (req, res): Promise<void> => {
  const params = FileTicketParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.id, params.data.ticketId));

  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  if (ticket.status !== "draft") {
    res.status(409).json({ error: `Ticket is already ${ticket.status}` });
    return;
  }

  const [team] = await db
    .select()
    .from(teamsTable)
    .where(eq(teamsTable.id, ticket.teamId));

  let sink: "github_repo" | "marshal_only" = "marshal_only";
  let issueUrl: string | null = null;
  let issueNumber: number | null = null;
  let pingNote = `Ticket filed Marshal-only: ${ticket.issueTitle}`;

  if (team?.githubUrl) {
    try {
      const filed = await fileGithubIssue({
        githubUrl: team.githubUrl,
        title: ticket.issueTitle,
        body: ticket.issueBody,
        labels: ticket.issueLabels,
      });
      sink = "github_repo";
      issueUrl = filed.issueUrl;
      issueNumber = filed.issueNumber;
      pingNote = `Filed GitHub issue #${filed.issueNumber}: ${ticket.issueTitle}`;
    } catch (err) {
      if (err instanceof GithubIssueError) {
        logger.warn(
          { err: err.message, ticketId: ticket.id },
          "Falling back to Marshal-only, GitHub filing failed",
        );
      } else {
        logger.error({ err, ticketId: ticket.id }, "Unexpected GitHub error");
      }
      pingNote = `Ticket filed Marshal-only (GitHub filing failed): ${ticket.issueTitle}`;
    }
  }

  const [updated] = await db
    .update(ticketsTable)
    .set({ status: "filed", sink, issueUrl, issueNumber, filedAt: new Date() })
    .where(eq(ticketsTable.id, ticket.id))
    .returning();

  await db.insert(pingsTable).values({
    teamId: ticket.teamId,
    source: "system",
    helpType: null,
    note: pingNote,
  });

  res.json(FileTicketResponse.parse(updated ?? ticket));
});

router.post("/tickets/:ticketId/discard", async (req, res): Promise<void> => {
  const params = DiscardTicketParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.id, params.data.ticketId));

  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  if (ticket.status !== "draft") {
    res.status(409).json({ error: `Ticket is already ${ticket.status}` });
    return;
  }

  const [updated] = await db
    .update(ticketsTable)
    .set({ status: "discarded" })
    .where(eq(ticketsTable.id, ticket.id))
    .returning();

  res.json(DiscardTicketResponse.parse(updated ?? ticket));
});

router.post("/tickets/:ticketId/resolve", async (req, res): Promise<void> => {
  const params = ResolveTicketParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.id, params.data.ticketId));

  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  if (ticket.status === "resolved" || ticket.status === "discarded") {
    res.status(409).json({ error: `Ticket is already ${ticket.status}` });
    return;
  }

  const [team] = await db
    .select()
    .from(teamsTable)
    .where(eq(teamsTable.id, ticket.teamId));

  if (
    ticket.status === "filed" &&
    ticket.sink === "github_repo" &&
    team?.githubUrl &&
    ticket.issueNumber
  ) {
    await closeGithubIssue({
      githubUrl: team.githubUrl,
      issueNumber: ticket.issueNumber,
      comment: "Resolved from the Floor Ops console — closing this out.",
    });
  }

  const [updated] = await db
    .update(ticketsTable)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(eq(ticketsTable.id, ticket.id))
    .returning();

  if (team) {
    await db
      .update(teamsTable)
      .set({ helpType: "fine", moderatorEnRoute: false })
      .where(eq(teamsTable.id, team.id));

    await db.insert(pingsTable).values({
      teamId: team.id,
      source: "system",
      helpType: "fine",
      note: `Ticket resolved: ${ticket.issueTitle}`,
    });
  }

  res.json(ResolveTicketResponse.parse(updated ?? ticket));
});

export default router;
