import { Router, type IRouter } from "express";
import { db, teamsTable, ticketsTable } from "@workspace/db";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// A team counts as "silent" when it has never pinged, or hasn't pinged in
// a while, and isn't already flagged do-not-disturb or marked demo ready.
const SILENT_THRESHOLD_MS = 20 * 60 * 1000;

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [teams, tickets] = await Promise.all([
    db.select().from(teamsTable),
    db.select().from(ticketsTable),
  ]);

  const now = Date.now();
  let pageNowCount = 0;
  let stuckCount = 0;
  let silentCount = 0;
  let doNotDisturbCount = 0;

  for (const team of teams) {
    if (team.helpType === "page_now") pageNowCount++;
    if (team.helpType === "stuck") stuckCount++;
    if (team.helpType === "do_not_disturb") doNotDisturbCount++;

    const lastActivity = team.lastPingAt ?? team.createdAt;
    const isSilent =
      team.helpType === "fine" &&
      team.phase !== "demo_ready" &&
      now - lastActivity.getTime() > SILENT_THRESHOLD_MS;
    if (isSilent) silentCount++;
  }

  const draftTicketsCount = tickets.filter((t) => t.status === "draft").length;
  const filedTicketsCount = tickets.filter((t) => t.status === "filed").length;
  const resolvedTicketsCount = tickets.filter(
    (t) => t.status === "resolved",
  ).length;

  res.json(
    GetDashboardSummaryResponse.parse({
      totalTeams: teams.length,
      pageNowCount,
      stuckCount,
      silentCount,
      doNotDisturbCount,
      draftTicketsCount,
      filedTicketsCount,
      resolvedTicketsCount,
    }),
  );
});

export default router;
