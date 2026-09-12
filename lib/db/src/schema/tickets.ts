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

export const ticketsTable = pgTable("tickets", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id")
    .notNull()
    .references(() => teamsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("draft"),
  phase: text("phase"),
  blockerType: text("blocker_type"),
  helpType: text("help_type").notNull(),
  skill: text("skill"),
  summary: text("summary").notNull(),
  etaMinutes: integer("eta_minutes"),
  risk: text("risk"),
  issueTitle: text("issue_title").notNull(),
  issueBody: text("issue_body").notNull(),
  issueLabels: text("issue_labels").array().notNull().default([]),
  sink: text("sink"),
  issueUrl: text("issue_url"),
  issueNumber: integer("issue_number"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  filedAt: timestamp("filed_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
