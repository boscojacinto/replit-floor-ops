import express, { Router, type IRouter } from "express";
import { asc, desc, eq } from "drizzle-orm";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { db, teamsTable, pingsTable, ticketsTable } from "@workspace/db";
import {
  CreateTeamBody,
  CreateTeamResponse,
  GetTeamParams,
  GetTeamResponse,
  UpdateTeamParams,
  UpdateTeamBody,
  UpdateTeamResponse,
  CreateTeamPingParams,
  CreateTeamPingBody,
  CreateTeamPingResponse,
  CreateTeamAudioPingParams,
  CreateTeamAudioPingResponse,
  ListTeamsResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { transcribeAudioFile } from "../lib/voice-transcriber";
import { summarizeVoiceNote } from "../lib/voice-summarizer";

const router: IRouter = Router();

router.get("/teams", async (_req, res): Promise<void> => {
  const teams = await db
    .select()
    .from(teamsTable)
    .orderBy(asc(teamsTable.createdAt));
  res.json(ListTeamsResponse.parse(teams));
});

router.post("/teams", async (req, res): Promise<void> => {
  const parsed = CreateTeamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [team] = await db
    .insert(teamsTable)
    .values(parsed.data)
    .returning();

  if (!team) {
    res.status(500).json({ error: "Failed to create team" });
    return;
  }

  // Seed the dossier timeline with the check-in itself.
  await db.insert(pingsTable).values({
    teamId: team.id,
    source: "team_checkin",
    helpType: null,
    note: `${team.name} checked in at table ${team.tableLabel}.`,
  });

  const [updated] = await db
    .update(teamsTable)
    .set({ lastPingAt: new Date() })
    .where(eq(teamsTable.id, team.id))
    .returning();

  res.status(201).json(CreateTeamResponse.parse(updated ?? team));
});

router.get("/teams/:teamId", async (req, res): Promise<void> => {
  const params = GetTeamParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

  const pings = await db
    .select()
    .from(pingsTable)
    .where(eq(pingsTable.teamId, team.id))
    .orderBy(asc(pingsTable.createdAt));

  const tickets = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.teamId, team.id))
    .orderBy(desc(ticketsTable.createdAt));

  res.json(GetTeamResponse.parse({ team, pings, tickets }));
});

router.patch("/teams/:teamId", async (req, res): Promise<void> => {
  const params = UpdateTeamParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTeamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [team] = await db
    .update(teamsTable)
    .set(parsed.data)
    .where(eq(teamsTable.id, params.data.teamId))
    .returning();

  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  res.json(UpdateTeamResponse.parse(team));
});

router.post("/teams/:teamId/pings", async (req, res): Promise<void> => {
  const params = CreateTeamPingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateTeamPingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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

  const [ping] = await db
    .insert(pingsTable)
    .values({
      teamId: team.id,
      source: parsed.data.source,
      note: parsed.data.note,
      helpType: parsed.data.helpType ?? null,
    })
    .returning();

  await db
    .update(teamsTable)
    .set({
      lastPingAt: new Date(),
      ...(parsed.data.helpType ? { helpType: parsed.data.helpType } : {}),
    })
    .where(eq(teamsTable.id, team.id));

  res.status(201).json(CreateTeamPingResponse.parse(ping));
});

router.post(
  "/teams/:teamId/pings/audio",
  express.raw({ type: ["audio/wav", "audio/x-wav"], limit: "20mb" }),
  async (req, res): Promise<void> => {
    const params = CreateTeamAudioPingParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Request body must be a non-empty audio/wav payload" });
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

    // Voice notes are short push-to-talk clips, transcribed locally
    // (whisper.cpp, no external STT key) and summarized by Claude before
    // landing on the team's timeline as a normal ping.
    const tempPath = path.join(os.tmpdir(), `pager-voice-${team.id}-${randomUUID()}.wav`);
    await fs.writeFile(tempPath, req.body);

    let note: string;
    try {
      const transcript = await transcribeAudioFile(tempPath);
      note =
        transcript.length > 0
          ? await summarizeVoiceNote({ team, transcript })
          : "Voice note received, but no speech was detected.";
    } catch (err) {
      logger.error({ err, teamId: team.id }, "Voice note transcription/summarization failed");
      note = "Voice note received, but it could not be processed.";
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }

    const [ping] = await db
      .insert(pingsTable)
      .values({
        teamId: team.id,
        source: "team_audio",
        note,
        helpType: null,
      })
      .returning();

    await db
      .update(teamsTable)
      .set({ lastPingAt: new Date() })
      .where(eq(teamsTable.id, team.id));

    res.status(201).json(CreateTeamAudioPingResponse.parse(ping));
  },
);

export default router;
