import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Singleton row (id always 1) so the moderator can set one event end time.
export const eventSettingsTable = pgTable("event_settings", {
  id: integer("id").primaryKey().default(1),
  endsAt: timestamp("ends_at", { withTimezone: true }),
});

export const insertEventSettingsSchema = createInsertSchema(
  eventSettingsTable,
).omit({ id: true });
export type InsertEventSettings = z.infer<typeof insertEventSettingsSchema>;
export type EventSettings = typeof eventSettingsTable.$inferSelect;
