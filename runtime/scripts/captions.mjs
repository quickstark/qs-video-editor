#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CliError,
  parseArgs,
  rejectPositionals,
  readJsonFile,
  writeTextFile,
  printCliError,
  formatJson,
} from "./_shared.mjs";

export function mapCaptions(input) {
  if (
    input.schemaVersion !== 1 ||
    !Array.isArray(input.words) ||
    !Array.isArray(input.clips)
  )
    throw new CliError("Expected schemaVersion 1, words and clips");
  const n = input.frameRateNumerator,
    d = input.frameRateDenominator;
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || n <= 0 || d <= 0)
    throw new CliError("Exact positive rational frame rate required");
  const cues = [],
    warnings = [];
  for (const [index, clip] of input.clips.entries()) {
    const {
      sourceId,
      sourceInFrame: a,
      sourceOutFrame: b,
      timelineStartFrame: t,
    } = clip;
    if (
      !sourceId ||
      ![a, b, t].every(Number.isSafeInteger) ||
      a < 0 ||
      b <= a ||
      t < 0
    )
      throw new CliError(`Invalid clip ${index}`);
    const start = (a * d) / n,
      end = (b * d) / n;
    for (const [wi, word] of input.words.entries()) {
      if (word.sourceId !== sourceId) continue;
      if (typeof word.text !== "string")
        throw new CliError("Word text must be a string");
      if (
        !Number.isFinite(word.start) ||
        !Number.isFinite(word.end) ||
        word.end <= word.start ||
        word.start < 0
      ) {
        warnings.push({ clip: index, word: wi, reason: "unaligned-word" });
        continue;
      }
      if (word.end <= start || word.start >= end) continue;
      if (word.start < start || word.end > end)
        warnings.push({ clip: index, word: wi, reason: "cut-intersects-word" });
      cues.push({
        clip: index,
        word: wi,
        sourceId,
        text: word.text,
        start: (t * d) / n + Math.max(word.start, start) - start,
        end: (t * d) / n + Math.min(word.end, end) - start,
      });
    }
  }
  cues.sort((a, b) => a.start - b.start || a.clip - b.clip || a.word - b.word);
  for (let i = 1; i < cues.length; i++)
    if (cues[i].start < cues[i - 1].end - 0.001)
      warnings.push({ cue: i, reason: "overlapping-speech-or-clips" });
  return { schemaVersion: 1, cues, warnings };
}
function time(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
export function srt(result) {
  return result.cues
    .map(
      (c, i) =>
        `${i + 1}\n${time(c.start)} --> ${time(c.end)}\n${c.text.replace(/[\r\n]+/g, " ")}\n`,
    )
    .join("\n");
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  try {
    const args = parseArgs(process.argv.slice(2), {
      booleans: ["help", "json"],
      values: ["input", "output"],
    });
    rejectPositionals(args);
    if (args.help)
      process.stdout.write(
        "Usage: captions.mjs --input <mapping.json> [--output <new.srt>] [--json]\nMaps corrected source words through exact frame ranges. One cue per word; review/group for final caption style. Input words use sourceId, text, start/end seconds; clips use sourceId, sourceInFrame, sourceOutFrame, timelineStartFrame. No text is invented for unaligned words.\n",
      );
    else {
      const result = mapCaptions(readJsonFile(args.input));
      if (args.output) {
        if (result.warnings.length && !args.json)
          process.stderr.write(
            `${result.warnings.length} timing warnings; review JSON before final use.\n`,
          );
        writeTextFile(args.output, srt(result), { makeParents: false });
      }
      process.stdout.write(formatJson(result));
    }
  } catch (e) {
    process.exitCode = printCliError(e, {
      json: process.argv.includes("--json"),
    });
  }
