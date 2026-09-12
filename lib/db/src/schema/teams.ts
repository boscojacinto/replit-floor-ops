import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teamsTable = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tableLabel: text("table_label").notNull(),
  building: text("building").notNull(),
  ownerUsername: text("owner_username"),
  workspaceUrl: text("workspace_url"),
  previewUrl: text("preview_url"),
  publishUrl: text("publish_url"),
  githubUrl: text("github_url"),
  accessState: text("access_state").notNull().default("submitted"),
  helpType: text("help_type").notNull().default("fine"),
  phase: text("phase").notNull().default("idea"),
  moderatorEnRoute: boolean("moderator_en_route").notNull().default(false),
  lastPingAt: timestamp("last_ping_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertTeamSchema = createInsertSchema(teamsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teamsTable.$inferSelect;
