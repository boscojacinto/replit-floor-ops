import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";

export const pingsTable = pgTable("pings", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id")
    .notNull()
    .references(() => teamsTable.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  helpType: text("help_type"),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertPingSchema = createInsertSchema(pingsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPing = z.infer<typeof insertPingSchema>;
export type Ping = typeof pingsTable.$inferSelect;
