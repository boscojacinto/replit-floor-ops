import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Team } from "@workspace/db";
import { logger } from "./logger";

/**
 * Turns a raw voice-note transcript into a short, moderator-facing summary
 * for the team's ping timeline -- a plain-English gist, on the same footing
 * as a typed moderator note. Never files a ticket itself.
 */
export async function summarizeVoiceNote(params: {
  team: Team;
  transcript: string;
}): Promise<string> {
  const { team, transcript } = params;

  const prompt = `A hackathon team just left a short voice note on their pager for the floor moderator. Summarize it in one or two plain-English sentences, third person, for a timeline the moderator will skim later. Do not add information the team didn't say.

Team: ${team.name} (table ${team.tableLabel}), building: ${team.building}

Voice note transcript:
"""
${transcript}
"""

Reply with only the summary sentence(s), no preamble.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find(
    (block: (typeof response.content)[number]): block is Extract<
      (typeof response.content)[number],
      { type: "text" }
    > => block.type === "text",
  );

  if (!textBlock || textBlock.text.trim().length === 0) {
    logger.error(
      { response },
      "Anthropic response had no usable text block for voice note summary",
    );
    return transcript.length > 200 ? `${transcript.slice(0, 200)}...` : transcript;
  }

  return textBlock.text.trim();
}
