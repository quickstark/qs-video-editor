#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  CliError,
  parseArgs,
  rejectPositionals,
  readJsonFile,
  printCliError,
  formatJson,
  findExecutable,
  runCommand,
  refuseSymlink,
  assertRegularFile,
} from "./_shared.mjs";
import {
  destination,
  localPath,
  digest,
  fileHash,
  atomicJson,
} from "./workspace.mjs";

export function operationArgs(op, input, output) {
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-n"];
  if (op.type === "trim") {
    if (
      !Number.isFinite(op.start) ||
      !Number.isFinite(op.end) ||
      op.start < 0 ||
      op.end <= op.start
    )
      throw new CliError(
        "Trim requires finite start/end seconds and end > start",
      );
    if (!["exact", "copy"].includes(op.policy ?? "exact"))
      throw new CliError("Trim policy must be exact or copy");
    if (op.policy === "copy") args.push("-ss", String(op.start));
  }
  args.push("-i", input);
  if (op.type === "trim") {
    if (op.policy !== "copy") args.push("-ss", String(op.start));
    args.push("-t", String(op.end - op.start));
  }
  const ext = path.extname(output).toLowerCase();
  if (op.type === "extract-audio") {
    if (![".wav", ".flac", ".m4a", ".mp3"].includes(ext))
      throw new CliError("Audio output must be wav, flac, m4a or mp3");
    args.push(
      "-vn",
      "-c:a",
      {
        ".wav": "pcm_s16le",
        ".flac": "flac",
        ".m4a": "aac",
        ".mp3": "libmp3lame",
      }[ext],
    );
  } else {
    if (![".mp4", ".mov", ".mkv", ".webm"].includes(ext))
      throw new CliError("Video output must be mp4, mov, mkv or webm");
    if (op.type === "resize") {
      if (
        !Number.isInteger(op.width) ||
        op.width < 2 ||
        op.width > 16384 ||
        op.width % 2
      )
        throw new CliError(
          "Resize width must be an even integer from 2 to 16384",
        );
      args.push("-vf", `scale=${op.width}:-2`);
    }
    if (op.type === "trim" && op.policy === "copy")
      args.push("-map", "0", "-c", "copy");
    else if (ext === ".webm")
      args.push(
        "-c:v",
        "libvpx-vp9",
        "-crf",
        "32",
        "-b:v",
        "0",
        "-c:a",
        "libopus",
      );
    else
      args.push(
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
      );
    if (ext === ".mp4" || ext === ".mov") args.push("-movflags", "+faststart");
  }
  return [...args, output];
}
function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ["help", "apply", "json"],
    values: ["workspace", "plan", "ffmpeg", "ffprobe"],
  });
  rejectPositionals(args);
  if (args.help) {
    process.stdout.write(
      "Usage: quick.mjs --workspace <dir> --plan <operations.json> [--apply] [--json] [--ffmpeg <executable>] [--ffprobe <executable>]\nPlan: {schemaVersion:1,operations:[{id,input,output,type:convert|trim|resize|extract-audio,inputSha256?,start?,end?,policy:exact|copy,width?}]}. Relative paths use the workspace. Plan mode is read-only and returns a resolvedPlan containing hashes; save and apply that exact plan. Apply requires hashes and executes sequentially. Existing outputs require matching completed receipts. Sources never change.\n",
    );
    return 0;
  }
  const root = destination(
    args.workspace ?? process.env.VIDEO_EDITOR_WORKSPACE,
  );
  const plan = readJsonFile(args.plan);
  if (
    plan.schemaVersion !== 1 ||
    !Array.isArray(plan.operations) ||
    plan.operations.length === 0 ||
    plan.operations.length > 1000
  )
    throw new CliError("Expected 1–1000 operations and schemaVersion 1");
  const ffmpeg = findExecutable(args.ffmpeg ?? "ffmpeg"),
    ffprobe = findExecutable(args.ffprobe ?? "ffprobe");
  if (!ffmpeg || !ffprobe)
    throw new CliError("FFmpeg and ffprobe are required");
  const operations = [],
    outputs = new Set(),
    ids = new Set(),
    inputPaths = new Set();
  for (const op of plan.operations) {
    if (
      typeof op.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(op.id) ||
      ids.has(op.id)
    )
      throw new CliError("Each operation needs a unique simple id");
    ids.add(op.id);
    if (!["convert", "trim", "resize", "extract-audio"].includes(op.type))
      throw new CliError("Unsupported quick operation");
    if (typeof op.input !== "string" || typeof op.output !== "string")
      throw new CliError("Input/output paths required");
    const input = path.resolve(root, op.input),
      output = localPath(root, op.output);
    if (
      path
        .relative(root, output)
        .split(path.sep)
        .some((p) => ["raw", ".video-editor"].includes(p))
    )
      throw new CliError(
        "Outputs may not target raw or runtime-control directories",
      );
    refuseSymlink(input, "source");
    assertRegularFile(input, "source");
    const canonical = fs.realpathSync(input);
    inputPaths.add(canonical);
    const key =
      process.platform === "darwin" || process.platform === "win32"
        ? output.toLowerCase()
        : output;
    if (outputs.has(key))
      throw new CliError("Two operations target the same output");
    outputs.add(key);
    const inputSha256 = fileHash(input);
    if (op.inputSha256 && op.inputSha256 !== inputSha256)
      throw new CliError(`Source changed: ${op.id}`);
    if (args.apply && !op.inputSha256)
      throw new CliError(
        "Apply requires inputSha256; save the resolvedPlan from the dry run first",
      );
    const metadata = JSON.parse(
      runCommand(
        ffprobe,
        ["-v", "error", "-show_format", "-show_streams", "-of", "json", input],
        { label: "source probe" },
      ).stdout,
    );
    if (!metadata.streams?.length)
      throw new CliError(`No media streams: ${op.id}`);
    if (
      op.type === "trim" &&
      Number.isFinite(Number(metadata.format?.duration)) &&
      op.end > Number(metadata.format.duration) + 0.05
    )
      throw new CliError(`Trim exceeds source duration: ${op.id}`);
    const commandArgs = operationArgs(op, input, output);
    operations.push({
      ...op,
      input,
      output,
      inputSha256,
      commandArgs,
      trimAccuracy:
        op.type === "trim"
          ? op.policy === "copy"
            ? "keyframe-dependent; verify realized boundaries"
            : "re-encoded frame-boundary trim"
          : null,
    });
  }
  for (const op of operations)
    if (
      inputPaths.has(op.output) ||
      (fs.existsSync(op.output) && inputPaths.has(fs.realpathSync(op.output)))
    )
      throw new CliError("An output aliases an input");
  const resolvedPlan = {
    schemaVersion: 1,
    operations: operations.map(({ commandArgs, trimAccuracy, ...op }) => op),
  };
  const planDigest = digest(JSON.stringify(resolvedPlan));
  const reportPath = `.video-editor/runs/${planDigest}.json`;
  const previous = fs.existsSync(localPath(root, reportPath))
    ? readJsonFile(localPath(root, reportPath))
    : null;
  const version = runCommand(ffmpeg, ["-version"]).stdout.split(/\r?\n/)[0];
  for (const op of operations)
    if (fs.existsSync(op.output)) {
      const done = previous?.operations?.find(
        (item) => item.id === op.id && item.status === "complete",
      );
      if (
        !done ||
        previous.planDigest !== planDigest ||
        previous.ffmpegVersion !== version ||
        done.outputSha256 !== fileHash(op.output)
      )
        throw new CliError(
          `Output exists without a matching current receipt: ${op.id}`,
        );
    }
  if (!args.apply) {
    process.stdout.write(
      formatJson({
        ok: true,
        action: "dry-run",
        resolvedPlan,
        ffmpegVersion: version,
        operations,
      }),
    );
    return 0;
  }
  fs.mkdirSync(localPath(root, ".video-editor/runs"), { recursive: true });
  const lock = localPath(root, ".video-editor/quick.lock");
  let lockFd;
  try {
    lockFd = fs.openSync(lock, "wx");
  } catch {
    throw new CliError(
      "A quick operation owns this workspace lock; inspect before retrying",
    );
  }
  const result = {
    schemaVersion: 1,
    ok: true,
    planDigest,
    ffmpegVersion: version,
    operations: [],
  };
  try {
    for (const op of operations) {
      if (fileHash(op.input) !== op.inputSha256)
        throw new CliError(`Source changed before execution: ${op.id}`);
      if (fs.existsSync(op.output)) {
        const prior = previous?.operations?.find(
          (item) => item.id === op.id && item.status === "complete",
        );
        if (!prior || fileHash(op.output) !== prior.outputSha256)
          throw new CliError(`Output changed during planning: ${op.id}`);
        result.operations.push({ ...prior, reused: true });
        continue;
      }
      const target = localPath(root, op.output);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const stage = path.join(
        path.dirname(target),
        `.${path.basename(target, path.extname(target))}.partial-${randomUUID()}${path.extname(target)}`,
      );
      try {
        runCommand(ffmpeg, operationArgs(op, op.input, stage), {
          label: `quick ${op.id}`,
        });
        const metadata = JSON.parse(
          runCommand(ffprobe, [
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            stage,
          ]).stdout,
        );
        if (!metadata.streams?.length || fs.statSync(stage).size === 0)
          throw new CliError("Rendered output has no streams");
        if (fileHash(op.input) !== op.inputSha256)
          throw new CliError(`Source changed while rendering: ${op.id}`);
        fs.linkSync(stage, target); // Exclusive final name, even if another process wrote meanwhile.
        result.operations.push({
          id: op.id,
          status: "complete",
          inputSha256: op.inputSha256,
          output: op.output,
          outputSha256: fileHash(target),
          duration: metadata.format?.duration ?? null,
          streams: metadata.streams.map((s) => ({
            type: s.codec_type,
            frameRate: s.avg_frame_rate ?? null,
            width: s.width ?? null,
            height: s.height ?? null,
          })),
          trimAccuracy: op.trimAccuracy,
        });
      } catch (e) {
        result.ok = false;
        result.operations.push({
          id: op.id,
          status: "failed",
          error: e.message,
        });
        atomicJson(root, reportPath, result);
        throw e;
      } finally {
        fs.rmSync(stage, { force: true });
      }
      atomicJson(root, reportPath, result);
    }
  } finally {
    fs.closeSync(lockFd);
    fs.rmSync(lock, { force: true });
  }
  atomicJson(root, reportPath, result);
  process.stdout.write(formatJson(result));
  return 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  try {
    process.exitCode = main();
  } catch (e) {
    process.exitCode = printCliError(e, {
      json: process.argv.includes("--json"),
    });
  }
