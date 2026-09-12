import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Ping, Team } from "@workspace/db";
import { logger } from "./logger";

const PHASE_VALUES = [
  "idea",
  "ui",
  "logic",
  "hardware",
  "stuck",
  "demo_ready",
] as const;
const BLOCKER_TYPE_VALUES = [
  "code",
  "bug",
  "design",
  "ui",
  "wifi",
  "flash",
  "auth",
  "scope",
  "team",
] as const;
const HELP_TYPE_VALUES = ["fine", "stuck", "page_now", "do_not_disturb"] as const;

export interface DraftedTicket {
  phase: (typeof PHASE_VALUES)[number] | null;
  blockerType: (typeof BLOCKER_TYPE_VALUES)[number] | null;
  helpType: (typeof HELP_TYPE_VALUES)[number];
  skill: string | null;
  summary: string;
  etaMinutes: number | null;
  risk: string | null;
  issueTitle: string;
  issueBody: string;
  issueLabels: string[];
}

function coerceEnum<T extends readonly string[]>(
  values: T,
  candidate: unknown,
): T[number] | null {
  return typeof candidate === "string" &&
    (values as readonly string[]).includes(candidate)
    ? (candidate as T[number])
    : null;
}

/**
 * Asks the model to turn a team's current state, recent pings, and an
 * optional moderator note into a structured triage card + a draft GitHub
 * issue. Never files anything itself -- the caller always persists the
 * result as a `draft` ticket for the moderator to review, edit, or discard.
 */
export async function draftTicketFromSignals(params: {
  team: Team;
  recentPings: Ping[];
  moderatorNote?: string;
}): Promise<DraftedTicket> {
  const { team, recentPings, moderatorNote } = params;

  const timelineText =
    recentPings.length > 0
      ? recentPings
          .map(
            (p) =>
              `- [${p.createdAt.toISOString()}] (${p.source}${p.helpType ? `, help=${p.helpType}` : ""}) ${p.note}`,
          )
          .join("\n")
      : "(no pings logged yet)";

  const prompt = `You are the triage clerk for a hackathon floor-ops console. A moderator is walking the room and wants you to turn one team's current signals into a structured help ticket and a draft GitHub issue. Never invent facts the team didn't report -- if information is missing, leave the field null or say so plainly in the summary.

Team: ${team.name} (table ${team.tableLabel})
What they're building: ${team.building}
Current phase: ${team.phase}
Current help status: ${team.helpType}
Has a GitHub repo: ${team.githubUrl ? "yes" : "no"}

Recent timeline (oldest first):
${timelineText}
${moderatorNote ? `\nModerator's note just now: ${moderatorNote}` : ""}

Fill in the draft_ticket tool with your best reading of the situation.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
    tools: [
      {
        name: "draft_ticket",
        description:
          "Records a structured triage card and draft GitHub issue for a hackathon team.",
        input_schema: {
          type: "object",
          properties: {
            phase: {
              type: ["string", "null"],
              enum: [...PHASE_VALUES, null],
            },
            blockerType: {
              type: ["string", "null"],
              enum: [...BLOCKER_TYPE_VALUES, null],
              description: "null if not stuck on a technical blocker",
            },
            helpType: {
              type: "string",
              enum: [...HELP_TYPE_VALUES],
              description: "best current read of urgency",
            },
            skill: {
              type: ["string", "null"],
              description:
                'short string naming the skill/role that would help (e.g. "React", "ESP32 firmware", "Figma")',
            },
            summary: {
              type: "string",
              description:
                "one or two sentence plain-English summary of where the team is and what they need",
            },
            etaMinutes: {
              type: ["integer", "null"],
              description:
                "best-guess integer minutes until a helper could unblock them, or null if unknown",
            },
            risk: {
              type: ["string", "null"],
              description: "one short sentence on what happens if this waits, or null if low risk",
            },
            issueTitle: {
              type: "string",
              description: "a concise GitHub issue title (no team name prefix needed)",
            },
            issueBody: {
              type: "string",
              description:
                "a GitHub-flavored markdown issue body with what's blocking them, what's been tried, and what a helper needs to know",
            },
            issueLabels: {
              type: "array",
              items: { type: "string" },
              description: '1-4 short lowercase-hyphen label strings (e.g. "blocked", "wifi", "needs-review")',
            },
          },
          required: [
            "phase",
            "blockerType",
            "helpType",
            "skill",
            "summary",
            "etaMinutes",
            "risk",
            "issueTitle",
            "issueBody",
            "issueLabels",
          ],
        },
      },
    ],
    tool_choice: { type: "tool", name: "draft_ticket" },
  });

  const toolUse = response.content.find(
    (block: (typeof response.content)[number]): block is Extract<
      (typeof response.content)[number],
      { type: "tool_use" }
    > => block.type === "tool_use",
  );
  let parsed: Record<string, unknown>;
  if (toolUse && typeof toolUse.input === "object" && toolUse.input !== null) {
    parsed = toolUse.input as Record<string, unknown>;
  } else {
    logger.error({ response }, "Anthropic response had no usable tool_use block for ticket draft");
    parsed = {};
  }

  const issueLabels = Array.isArray(parsed.issueLabels)
    ? parsed.issueLabels.filter((l): l is string => typeof l === "string").slice(0, 4)
    : [];

  return {
    phase: coerceEnum(PHASE_VALUES, parsed.phase),
    blockerType: coerceEnum(BLOCKER_TYPE_VALUES, parsed.blockerType),
    helpType: coerceEnum(HELP_TYPE_VALUES, parsed.helpType) ?? team.helpType as DraftedTicket["helpType"],
    skill: typeof parsed.skill === "string" ? parsed.skill : null,
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary
        : `${team.name} needs help but the model could not produce a summary -- check in manually.`,
    etaMinutes:
      typeof parsed.etaMinutes === "number" && Number.isFinite(parsed.etaMinutes)
        ? Math.round(parsed.etaMinutes)
        : null,
    risk: typeof parsed.risk === "string" ? parsed.risk : null,
    issueTitle:
      typeof parsed.issueTitle === "string" && parsed.issueTitle.trim().length > 0
        ? parsed.issueTitle
        : `${team.name}: needs help`,
    issueBody:
      typeof parsed.issueBody === "string" && parsed.issueBody.trim().length > 0
        ? parsed.issueBody
        : `Drafted from table ${team.tableLabel}. ${moderatorNote ?? ""}`.trim(),
    issueLabels,
  };
}
