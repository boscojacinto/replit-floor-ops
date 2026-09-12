import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, eventSettingsTable } from "@workspace/db";
import {
  GetEventSettingsResponse,
  UpdateEventSettingsBody,
  UpdateEventSettingsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getOrCreateSettings() {
  const [existing] = await db
    .select()
    .from(eventSettingsTable)
    .where(eq(eventSettingsTable.id, 1));
  if (existing) return existing;

  const [created] = await db
    .insert(eventSettingsTable)
    .values({ id: 1, endsAt: null })
    .returning();
  return created!;
}

router.get("/event", async (_req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json(GetEventSettingsResponse.parse(settings));
});

router.patch("/event", async (req, res): Promise<void> => {
  const parsed = UpdateEventSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [settings] = await db
    .insert(eventSettingsTable)
    .values({ id: 1, endsAt: parsed.data.endsAt })
    .onConflictDoUpdate({
      target: eventSettingsTable.id,
      set: { endsAt: parsed.data.endsAt },
    })
    .returning();

  res.json(UpdateEventSettingsResponse.parse(settings));
});

export default router;
