#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {fileHash} from './workspace.mjs';
import {
  assertNotFilesystemRoot,
  assertRegularFile,
  CliError,
  findExecutable,
  formatJson,
  parseArgs,
  parseFiniteNumber,
  printCliError,
  readJsonFile,
  refuseSymlink,
  rejectPositionals,
  requireOption,
  resolveUserPath,
  runCommand,
} from './_shared.mjs';

const HELP = `\
Usage: node extract-review-frames.mjs --input <video> --output-dir <dir> [options]

Extract deterministic review frames at regular intervals and around every edit
or graphics boundary. Boundary samples include before, exact, and after frames.

Options:
  --input <file>              Source video (required).
  --output-dir <dir>          Frame destination directory (required).
  --interval <seconds>        Regular sample interval (default: 30).
  --boundary <seconds>        Boundary time; repeat or use comma-separated values.
  --boundaries-file <json>    JSON array, {boundaries: []}, or graphics plan;
                              repeatable.
  --graphics-plan <json>      Alias for --boundaries-file; uses item starts/ends.
  --neighbor-offset <seconds> Before/after distance (default: 0.25).
  --duration <seconds>        Known duration; otherwise read with ffprobe.
  --ffmpeg <path>             ffmpeg executable (default: ffmpeg).
  --ffprobe <path>            ffprobe executable (default: ffprobe).
  --format <jpg|png>          Frame format (default: jpg).
  --quality <1-31>            JPEG q:v value (default: 2; lower is better).
  --overwrite                 Replace frame files with the same timestamps.
  --dry-run                   Report the extraction plan without writing files.
  --json                      Emit JSON instead of a readable summary.
  -h, --help                  Show this help.

ffmpeg uses -nostdin. ffprobe runs with stdin disconnected because ffprobe does
not support ffmpeg's -nostdin flag. Neither command is run through a shell.
`;

function splitNumbers(values = [], label = 'boundary') {
  return values.flatMap((value) => value.split(',')).filter((value) => value.trim() !== '').map((value) => (
    parseFiniteNumber(value.trim(), label, {minimum: 0})
  ));
}

function boundariesFromDocument(document, filePath) {
  if (Array.isArray(document)) {
    return document.map((value, index) => ({time: parseFiniteNumber(value, `${filePath}[${index}]`, {minimum: 0}), reason: `${path.basename(filePath)}[${index}]`}));
  }
  if (!document || typeof document !== 'object') {
    throw new CliError(`Boundary file must contain an array or object: ${filePath}`);
  }
  if (Array.isArray(document.boundaries)) {
    return document.boundaries.map((value, index) => ({time: parseFiniteNumber(value, `${filePath}.boundaries[${index}]`, {minimum: 0}), reason: `${path.basename(filePath)}:boundary-${index}`}));
  }
  if (Array.isArray(document.items)) {
    const result = [];
    document.items.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new CliError(`Invalid graphics item at ${filePath}.items[${index}]`);
      }
      const label = typeof item.id === 'string' && item.id ? item.id : `item-${index}`;
      result.push({time: parseFiniteNumber(item.start, `${filePath}.items[${index}].start`, {minimum: 0}), reason: `${label}:start`});
      result.push({time: parseFiniteNumber(item.end, `${filePath}.items[${index}].end`, {minimum: 0}), reason: `${label}:end`});
    });
    return result;
  }
  throw new CliError(`Boundary file has no boundaries or items array: ${filePath}`);
}

function readDuration(ffprobe, inputPath) {
  const result = runCommand(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ], {label: 'ffprobe duration check'});
  return parseFiniteNumber(result.stdout.trim(), 'media duration', {minimum: 0, exclusiveMinimum: true});
}

function timestampKey(seconds) {
  return Math.round(seconds * 1_000_000);
}

function filenameFor(seconds, format) {
  const microseconds = String(timestampKey(seconds)).padStart(12, '0');
  return `frame-${microseconds}us.${format}`;
}

function buildSamples(duration, interval, boundaries, neighborOffset) {
  const maximumTimestamp = Math.max(0, duration - Math.min(0.001, duration / 2));
  const samples = new Map();
  const add = (rawTime, reason) => {
    const time = Math.min(maximumTimestamp, Math.max(0, rawTime));
    const key = timestampKey(time);
    const existing = samples.get(key);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    } else {
      samples.set(key, {time: key / 1_000_000, reasons: [reason]});
    }
  };

  for (let time = 0, index = 0; time < duration; time = (++index) * interval) {
    add(time, `interval:${index}`);
  }
  for (const boundary of boundaries) {
    if (boundary.time > duration + 1e-6) {
      throw new CliError(`Boundary ${boundary.time} exceeds media duration ${duration}: ${boundary.reason}`);
    }
    add(boundary.time - neighborOffset, `${boundary.reason}:before`);
    add(boundary.time, `${boundary.reason}:exact`);
    add(boundary.time + neighborOffset, `${boundary.reason}:after`);
  }
  return [...samples.values()].sort((left, right) => left.time - right.time);
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ['help', 'overwrite', 'dry-run', 'json'],
    values: ['input', 'output-dir', 'interval', 'neighbor-offset', 'duration', 'ffmpeg', 'ffprobe', 'format', 'quality'],
    repeatable: ['boundary', 'boundaries-file', 'graphics-plan'],
  });
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  rejectPositionals(args);

  const inputPath = resolveUserPath(requireOption(args, 'input'), {label: 'input path'});
  assertRegularFile(inputPath, 'input video');
  const outputDirectory = resolveUserPath(requireOption(args, 'output-dir'), {label: 'output directory'});
  assertNotFilesystemRoot(outputDirectory, 'output directory');
  if (outputDirectory === inputPath) {
    throw new CliError('Output directory cannot be the input video');
  }
  refuseSymlink(outputDirectory, 'output directory');

  const interval = parseFiniteNumber(args.interval ?? '30', 'interval', {minimum: 0, exclusiveMinimum: true});
  const neighborOffset = parseFiniteNumber(args['neighbor-offset'] ?? '0.25', 'neighbor offset', {minimum: 0, exclusiveMinimum: true});
  const format = args.format ?? 'jpg';
  if (!['jpg', 'png'].includes(format)) {
    throw new CliError('format must be jpg or png');
  }
  const quality = parseFiniteNumber(args.quality ?? '2', 'quality', {minimum: 1});
  if (!Number.isInteger(quality) || quality > 31) {
    throw new CliError('quality must be an integer from 1 through 31');
  }

  const ffmpeg = findExecutable(args.ffmpeg ?? 'ffmpeg');
  if (!ffmpeg) throw new CliError(`ffmpeg executable not found: ${args.ffmpeg ?? 'ffmpeg'}`);
  let ffprobe = null;
  if (!args.duration) {
    ffprobe = findExecutable(args.ffprobe ?? 'ffprobe');
    if (!ffprobe) throw new CliError(`ffprobe executable not found: ${args.ffprobe ?? 'ffprobe'}`);
  }
  const duration = args.duration
    ? parseFiniteNumber(args.duration, 'duration', {minimum: 0, exclusiveMinimum: true})
    : readDuration(ffprobe, inputPath);

  const boundaries = splitNumbers(args.boundary).map((time, index) => ({time, reason: `cli-boundary:${index}`}));
  const boundaryFiles = [...(args['boundaries-file'] ?? []), ...(args['graphics-plan'] ?? [])];
  for (const requestedFile of boundaryFiles) {
    const boundaryPath = resolveUserPath(requestedFile, {label: 'boundary file'});
    boundaries.push(...boundariesFromDocument(readJsonFile(boundaryPath, 'boundary file'), boundaryPath));
  }

  const samples = buildSamples(duration, interval, boundaries, neighborOffset).map((sample) => ({
    ...sample,
    file: path.join(outputDirectory, filenameFor(sample.time, format)),
  }));

  if (!args['dry-run']) {
    fs.mkdirSync(outputDirectory, {recursive: true});
    for (const sample of samples) {
      refuseSymlink(sample.file, 'review frame');
      if (!args.overwrite && fs.existsSync(sample.file)) {
        throw new CliError(`Review frame already exists; rerun with --overwrite or use another output directory: ${sample.file}`);
      }
    }
    for (const sample of samples) {
      const codecOptions = format === 'jpg' ? ['-q:v', String(quality)] : ['-compression_level', '4'];
      runCommand(ffmpeg, [
        '-nostdin',
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', sample.time.toFixed(6),
        '-i', inputPath,
        '-map', '0:v:0',
        '-frames:v', '1',
        ...codecOptions,
        args.overwrite ? '-y' : '-n',
        sample.file,
      ], {label: `ffmpeg review-frame extraction at ${sample.time.toFixed(6)}s`});
    }
  }

  const report = {
    ok: true,
    dryRun: Boolean(args['dry-run']),
    input: inputPath,
    inputSha256: fileHash(inputPath),
    outputDirectory,
    durationSeconds: duration,
    intervalSeconds: interval,
    neighborOffsetSeconds: neighborOffset,
    boundaryCount: boundaries.length,
    frameCount: samples.length,
    frames: samples,
    coverage: {
      evidence: args['dry-run'] ? 'planned-stills-only' : 'extracted-stills-only',
      motion: 'not-run', listening: 'not-run', editorImport: 'not-run',
      limitation: 'Sampled frames do not establish motion, audio, or unsampled visual correctness.',
    },
  };
  if (args.json) {
    process.stdout.write(formatJson(report));
  } else {
    process.stdout.write(`${report.dryRun ? 'Planned' : 'Extracted'} ${samples.length} review frames in ${outputDirectory}\n`);
    process.stdout.write(`  interval: ${interval}s; boundaries: ${boundaries.length}; neighbor offset: ${neighborOffset}s\n`);
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.exitCode = printCliError(error, {json: process.argv.includes('--json')});
}
