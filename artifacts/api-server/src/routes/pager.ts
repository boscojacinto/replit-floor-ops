import { Router, type IRouter } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import {
  db,
  teamsTable,
  ticketsTable,
  pingsTable,
  eventSettingsTable,
} from "@workspace/db";
import {
  GetPagerStateResponse,
  AckPagerBody,
  AckPagerResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function ageMinutes(from: Date | null, fallback: Date): number {
  const since = from ?? fallback;
  return Math.max(0, Math.round((Date.now() - since.getTime()) / 60000));
}

router.get("/pager/state", async (_req, res): Promise<void> => {
  const teams = await db.select().from(teamsTable);

  const openTickets = await db
    .select()
    .from(ticketsTable)
    .where(inArray(ticketsTable.status, ["draft", "filed"]))
    .orderBy(desc(ticketsTable.createdAt));

  const latestOpenTicketByTeam = new Map<number, (typeof openTickets)[number]>();
  for (const ticket of openTickets) {
    if (!latestOpenTicketByTeam.has(ticket.teamId)) {
      latestOpenTicketByTeam.set(ticket.teamId, ticket);
    }
  }

  const [settingsRow] = await db
    .select()
    .from(eventSettingsTable)
    .where(eq(eventSettingsTable.id, 1));
  const eventEndsAt = settingsRow?.endsAt ?? null;
  const minutesLeft = eventEndsAt
    ? Math.max(0, Math.round((eventEndsAt.getTime() - Date.now()) / 60000))
    : null;

  const toQueueItem = (team: (typeof teams)[number]) => {
    const ticket = latestOpenTicketByTeam.get(team.id) ?? null;
    return {
      ticketId: ticket?.id ?? null,
      teamId: team.id,
      teamName: team.name,
      tableLabel: team.tableLabel,
      blocker: ticket?.summary ?? team.building,
      helpType: team.helpType,
      ageMinutes: ageMinutes(team.lastPingAt, team.createdAt),
      moderatorEnRoute: team.moderatorEnRoute,
    };
  };

  const priority: Record<string, number> = {
    page_now: 0,
    stuck: 1,
    fine: 2,
    do_not_disturb: 3,
  };
  const queue = teams
    .filter((t) => t.helpType === "page_now" || t.helpType === "stuck")
    .sort((a, b) => priority[a.helpType]! - priority[b.helpType]!)
    .map(toQueueItem);

  const doNotDisturb = teams
    .filter((t) => t.helpType === "do_not_disturb")
    .map(toQueueItem);

  const openSosCount = teams.filter((t) => t.helpType === "page_now").length;

  res.json(
    GetPagerStateResponse.parse({
      minutesLeft,
      openSosCount,
      queue,
      doNotDisturb,
    }),
  );
});

router.post("/pager/ack", async (req, res): Promise<void> => {
  const parsed = AckPagerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [team] = await db
    .select()
    .from(teamsTable)
    .where(eq(teamsTable.id, parsed.data.teamId));

  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const [updated] = await db
    .update(teamsTable)
    .set({ moderatorEnRoute: true })
    .where(eq(teamsTable.id, team.id))
    .returning();

  await db.insert(pingsTable).values({
    teamId: team.id,
    source: "system",
    helpType: null,
    note: "Moderator acknowledged from the pager — on the way.",
  });

  res.json(AckPagerResponse.parse(updated ?? team));
});

export default router;
