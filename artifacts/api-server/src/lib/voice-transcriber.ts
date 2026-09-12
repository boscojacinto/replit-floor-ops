import { nodewhisper } from "nodejs-whisper";
import path from "node:path";
import { logger } from "./logger";

const MODEL_NAME = "base.en";

// nodejs-whisper throws this exact message when whisper.cpp produced no
// text -- it's the only signal it exposes for "no speech in this clip"
// vs. a real failure (bad model, corrupt file, etc).
const NO_SPEECH_ERROR_MARKER = "Transcription failed or produced no output";

/**
 * Transcribes a short audio clip to plain text using a locally-run
 * whisper.cpp (via nodejs-whisper) -- no external STT API or key needed.
 * The first call in a fresh environment compiles whisper.cpp and downloads
 * the model (~140MB), which can take a couple of minutes; later calls are
 * fast (a few seconds for a short clip).
 *
 * Returns "" when no speech was detected in the clip; throws for real
 * failures.
 */
export async function transcribeAudioFile(filePath: string): Promise<string> {
  // nodejs-whisper `cd`s into its own whisper.cpp checkout before invoking
  // the CLI, so a relative path silently resolves against the wrong
  // directory -- always pass it an absolute path.
  const absolutePath = path.resolve(filePath);

  let raw: string;
  try {
    raw = await nodewhisper(absolutePath, {
      modelName: MODEL_NAME,
      autoDownloadModelName: MODEL_NAME,
      removeWavFileAfterTranscription: false,
      whisperOptions: { language: "en" },
      logger: {
        debug: () => {},
        log: () => {},
        error: (...args: unknown[]) => logger.warn({ args }, "whisper.cpp"),
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes(NO_SPEECH_ERROR_MARKER)) {
      return "";
    }
    throw err;
  }

  // Strip whisper.cpp's "[00:00:00.000 --> 00:00:05.680]" segment markers
  // and collapse to plain prose.
  return raw
    .split("\n")
    .map((line) =>
      line.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]/g, "").trim(),
    )
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
}
