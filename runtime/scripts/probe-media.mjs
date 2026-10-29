#!/usr/bin/env node

import {createHash, randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertDirectory,
  assertInside,
  assertRegularFile,
  CliError,
  findExecutable,
  formatJson,
  parseArgs,
  pathsReferToSameFile,
  printCliError,
  refuseSymlink,
  refuseSymlinkChain,
  rejectPositionals,
  resolveUserPath,
  runCommand,
} from './_shared.mjs';

const HELP = `\
Usage:
  node probe-media.mjs --input <media-file> [options]
  node probe-media.mjs --project <project-dir> [options]

Run ffprobe safely and emit a canonical, versioned JSON inventory. File mode
probes one input. Project mode recursively inventories only declared source
areas and never scans outputs, proxies, renderer caches, reviews, manifests,
timelines, transcripts, or Resolve-owned files.

Options:
  --input <file>          Inspect one media file. Mutually exclusive with project.
  --project <dir>         Inventory media under raw/video, raw/audio, broll,
                          audio/music, audio/sfx, assets/references, and
                          assets/generated. Mutually exclusive with input.
  --ffprobe <path>        ffprobe executable or command name (default: ffprobe).
  --hash                  Calculate SHA-256 for every successfully probed source.
                          Hashing is opt-in because it can be expensive.
  --output <file>         Atomically write the versioned inventory. In project
                          mode the path must stay inside the project and outside
                          immutable/derived/Resolve-owned trees.
  --relink-output <file>  Project mode only. Atomically write the canonical
                          relink map; requires --hash. A typical path is
                          timeline/relink-map.json.
  --write-relink          Shortcut for --relink-output
                          <project>/timeline/relink-map.json; requires --hash.
  --overwrite             Explicitly replace safe JSON artifacts. Existing source
                          files, symlinks, hard links to sources, and protected
                          project trees are still refused.
  --compact               Emit compact JSON instead of pretty JSON.
  -h, --help              Show this help.

Nothing is written unless --output, --relink-output, or --write-relink is given.
If both inventory and relink outputs are requested they are staged before either
is committed, and each file is replaced atomically. Any scan/probe/hash failure
is reported and prevents durable writes. Project paths in durable JSON are
project-relative with forward slashes; absolute project paths are never stored.
Relink missingMedia entries use the strict shape {"path":"...","reason":"..."};
reason is one of not-found, unreadable, hash-mismatch, not-in-inventory, or
unsupported-media. A successful re-probe removes a missing entry for that source.
ffprobe runs without a shell and with stdin disconnected (ffprobe does not
support ffmpeg's -nostdin flag).
`;

const INVENTORY_SCHEMA_VERSION = 2;
const RELINK_SCHEMA_VERSION = 1;
const RELINK_SCHEMA_REFERENCE = 'relink-map.schema.json';
const MISSING_MEDIA_REASONS = new Set([
  'not-found',
  'unreadable',
  'hash-mismatch',
  'not-in-inventory',
  'unsupported-media',
]);
const SOURCE_AREAS = [
  'raw/video',
  'raw/audio',
  'broll',
  'audio/music',
  'audio/sfx',
  'assets/references',
  'assets/generated',
];
const PROTECTED_WRITE_ROOTS = [
  'raw',
  'broll',
  'audio',
  'assets',
  'proxies',
  'graphics-build',
  'outputs',
  'resolve',
];
const MEDIA_EXTENSIONS = new Set([
  '.3gp', '.aac', '.ac3', '.aif', '.aiff', '.amr', '.ari', '.avi', '.braw',
  '.caf', '.cine', '.crm', '.dng', '.dpx', '.exr', '.flac', '.flv', '.gif',
  '.heic', '.heif', '.insv', '.jpeg', '.jpg', '.lrv', '.m2ts', '.m2v', '.m4a',
  '.m4v', '.mkv', '.mov', '.mp3', '.mp4', '.mpeg', '.mpg', '.mts', '.mxf',
  '.oga', '.ogg', '.ogv', '.opus', '.png', '.r3d', '.tif', '.tiff', '.ts',
  '.vob', '.wav', '.wave', '.webm', '.webp', '.wma',
]);
const EXCLUDED_DIRECTORY_NAMES = new Set(['cache', '.cache', 'node_modules', 'outputs', 'proxies']);

function scalarOrNull(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === '' || normalized.toUpperCase() === 'N/A' ? null : normalized;
}

function numberOrNull(value) {
  const normalized = scalarOrNull(value);
  if (normalized === null) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function rationalOrNull(value) {
  const normalized = scalarOrNull(value);
  if (normalized === null) return null;
  const match = /^(-?\d+)\/(\d+)$/u.exec(normalized);
  if (!match || BigInt(match[2]) === 0n) return null;
  return `${BigInt(match[1])}/${BigInt(match[2])}`;
}

function aspectRatioOrNull(value) {
  const normalized = scalarOrNull(value);
  if (normalized === null) return null;
  return /^\d+:\d+$/u.test(normalized) ? normalized : null;
}

function exactTimecode(tags) {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return null;
  const entries = Object.entries(tags);
  for (const requested of ['timecode', 'com.apple.quicktime.timecode']) {
    const match = entries.find(([key]) => key.toLowerCase() === requested);
    const value = scalarOrNull(match?.[1]);
    if (value !== null) return value;
  }
  return null;
}

function rotationOrNull(stream) {
  const tagRotation = numberOrNull(stream.tags?.rotate);
  if (tagRotation !== null) return tagRotation;
  const sideData = Array.isArray(stream.side_data_list)
    ? stream.side_data_list.find((entry) => numberOrNull(entry?.rotation) !== null)
    : null;
  return numberOrNull(sideData?.rotation);
}

function normalizeStream(stream) {
  const common = {
    index: integerOrNull(stream.index),
    type: scalarOrNull(stream.codec_type),
    codec: scalarOrNull(stream.codec_name),
    codecLongName: scalarOrNull(stream.codec_long_name),
    profile: scalarOrNull(stream.profile),
    timeBase: rationalOrNull(stream.time_base),
    durationSeconds: numberOrNull(stream.duration),
    timecode: exactTimecode(stream.tags),
  };
  if (stream.codec_type === 'video') {
    return {
      ...common,
      width: integerOrNull(stream.width),
      height: integerOrNull(stream.height),
      pixelFormat: scalarOrNull(stream.pix_fmt),
      rFrameRate: rationalOrNull(stream.r_frame_rate),
      avgFrameRate: rationalOrNull(stream.avg_frame_rate),
      frameCount: integerOrNull(stream.nb_frames),
      fieldOrder: scalarOrNull(stream.field_order),
      sampleAspectRatio: aspectRatioOrNull(stream.sample_aspect_ratio),
      displayAspectRatio: aspectRatioOrNull(stream.display_aspect_ratio),
      colorRange: scalarOrNull(stream.color_range),
      colorSpace: scalarOrNull(stream.color_space),
      colorTransfer: scalarOrNull(stream.color_transfer),
      colorPrimaries: scalarOrNull(stream.color_primaries),
      rotation: rotationOrNull(stream),
    };
  }
  if (stream.codec_type === 'audio') {
    return {
      ...common,
      sampleRate: integerOrNull(stream.sample_rate),
      channels: integerOrNull(stream.channels),
      channelLayout: scalarOrNull(stream.channel_layout),
    };
  }
  return common;
}

function normalizeChapter(chapter) {
  return {
    id: integerOrNull(chapter.id),
    startSeconds: numberOrNull(chapter.start_time),
    endSeconds: numberOrNull(chapter.end_time),
  };
}

function sha256File(target) {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(target, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function mediaId(relativePath) {
  return `media-${createHash('sha256').update(relativePath, 'utf8').digest('hex').slice(0, 16)}`;
}

function sourceFacts(stat, hashRequested, sha256) {
  return {
    sizeBytes: stat.size,
    modifiedTimeUtc: stat.mtime.toISOString(),
    modifiedTimeUnixMs: stat.mtimeMs,
    hashAlgorithm: hashRequested ? 'sha256' : null,
    sha256: hashRequested ? sha256 : null,
  };
}

function normalizeProbe(raw, displayPath, id, stat, hashRequested, sha256) {
  const format = raw.format ?? {};
  return {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    id,
    input: displayPath,
    filename: path.posix.basename(displayPath.split(path.sep).join('/')),
    source: sourceFacts(stat, hashRequested, sha256),
    container: {
      formatNames: scalarOrNull(format.format_name)?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [],
      formatLongName: scalarOrNull(format.format_long_name),
      durationSeconds: numberOrNull(format.duration),
      startSeconds: numberOrNull(format.start_time),
      bitRate: integerOrNull(format.bit_rate),
      timecode: exactTimecode(format.tags),
    },
    streams: Array.isArray(raw.streams) ? raw.streams.map(normalizeStream) : [],
    chapters: Array.isArray(raw.chapters) ? raw.chapters.map(normalizeChapter) : [],
  };
}

function probeOne(ffprobe, inputPath, displayPath, {hashRequested = false} = {}) {
  const before = assertRegularFile(inputPath, 'input media');
  const result = runCommand(ffprobe, [
    '-v', 'error',
    '-show_format',
    '-show_streams',
    '-show_chapters',
    '-of', 'json',
    inputPath,
  ], {label: `ffprobe ${displayPath}`});

  let raw;
  try {
    raw = JSON.parse(result.stdout);
  } catch (error) {
    throw new CliError(`ffprobe returned invalid JSON for ${displayPath}: ${error.message}`, 1);
  }
  const sha256 = hashRequested ? sha256File(inputPath) : null;
  const after = assertRegularFile(inputPath, 'input media');
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new CliError(`Source changed while it was being probed or hashed: ${displayPath}`, 1);
  }
  return normalizeProbe(raw, displayPath, mediaId(displayPath), after, hashRequested, sha256);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toProjectPath(projectPath, target) {
  return path.relative(projectPath, target).split(path.sep).join('/');
}

function safeProjectError(error, projectPath) {
  return String(error?.message ?? error).split(projectPath).join('.');
}

function scanDirectory(projectPath, sourceArea, directory, candidates, skipped, failures) {
  let entries;
  try {
    entries = fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => compareText(left.name, right.name));
  } catch (error) {
    failures.push({phase: 'scan', path: toProjectPath(projectPath, directory), sourceArea, error: safeProjectError(error, projectPath)});
    return;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    const relativePath = toProjectPath(projectPath, target);
    if (entry.isSymbolicLink()) {
      skipped.push({path: relativePath, sourceArea, reason: 'symbolic-link-not-followed'});
    } else if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
        skipped.push({path: relativePath, sourceArea, reason: 'excluded-derived-or-cache-directory'});
      } else {
        scanDirectory(projectPath, sourceArea, target, candidates, skipped, failures);
      }
    } else if (entry.isFile()) {
      const extension = path.extname(entry.name).toLowerCase();
      if (MEDIA_EXTENSIONS.has(extension)) candidates.push({absolutePath: target, path: relativePath, sourceArea});
      else skipped.push({path: relativePath, sourceArea, reason: extension ? `non-media-extension:${extension}` : 'no-media-extension'});
    } else {
      skipped.push({path: relativePath, sourceArea, reason: 'not-a-regular-file'});
    }
  }
}

function readProjectId(projectPath) {
  const manifestPath = path.join(projectPath, 'project.json');
  try {
    refuseSymlink(manifestPath, 'project manifest');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return typeof manifest.id === 'string' && manifest.id.trim() !== '' ? manifest.id : null;
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function inventoryProject(ffprobe, projectPath, {hashRequested = false} = {}) {
  const candidates = [];
  const skipped = [];
  const failures = [];
  const sourceAreas = [];
  for (const relative of SOURCE_AREAS) {
    const sourceRoot = path.resolve(projectPath, relative);
    assertInside(projectPath, sourceRoot, 'source area');
    refuseSymlinkChain(projectPath, sourceRoot, 'source area');
    let stat;
    try {
      stat = fs.statSync(sourceRoot);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        sourceAreas.push({path: relative, status: 'missing', mediaFileCount: 0});
        continue;
      }
      failures.push({phase: 'scan', path: relative, sourceArea: relative, error: safeProjectError(error, projectPath)});
      sourceAreas.push({path: relative, status: 'error', mediaFileCount: 0});
      continue;
    }
    if (!stat.isDirectory()) {
      failures.push({phase: 'scan', path: relative, sourceArea: relative, error: 'source area is not a directory'});
      sourceAreas.push({path: relative, status: 'error', mediaFileCount: 0});
      continue;
    }
    const before = candidates.length;
    scanDirectory(projectPath, relative, sourceRoot, candidates, skipped, failures);
    sourceAreas.push({path: relative, status: 'scanned', mediaFileCount: candidates.length - before});
  }
  candidates.sort((left, right) => compareText(left.path, right.path));
  skipped.sort((left, right) => compareText(left.path, right.path));
  const files = [];
  for (const candidate of candidates) {
    try {
      const normalized = probeOne(ffprobe, candidate.absolutePath, candidate.path, {hashRequested});
      files.push({...normalized, sourceArea: candidate.sourceArea});
    } catch (error) {
      failures.push({phase: 'probe', path: candidate.path, sourceArea: candidate.sourceArea, error: safeProjectError(error, projectPath)});
    }
  }
  failures.sort((left, right) => compareText(`${left.path}:${left.phase}`, `${right.path}:${right.phase}`));
  return {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    mode: 'project',
    projectId: readProjectId(projectPath),
    projectRoot: '.',
    hashRequested,
    hashAlgorithm: hashRequested ? 'sha256' : null,
    ok: failures.length === 0,
    complete: failures.length === 0 && sourceAreas.every((area) => area.status === 'scanned'),
    sourceAreas,
    mediaFileCount: candidates.length,
    probeSucceeded: files.length,
    probeFailed: failures.filter((failure) => failure.phase === 'probe').length,
    skippedCount: skipped.length,
    files,
    failures,
    skipped,
    excludedRoots: ['outputs', 'proxies', 'graphics-build', 'reviews', 'manifests', 'timeline', 'transcript', 'resolve', '**/cache', '**/.cache'],
  };
}

function pathIsWithin(root, target) {
  const relation = path.relative(root, target);
  return relation === '' || (!relation.startsWith(`..${path.sep}`) && relation !== '..' && !path.isAbsolute(relation));
}

function protectProjectArtifact(projectPath, target, sourceInputs) {
  assertInside(projectPath, target, 'artifact output');
  if (target === projectPath) throw new CliError('Artifact output must be a file below the project root');
  refuseSymlinkChain(projectPath, target, 'artifact output');
  for (const relative of PROTECTED_WRITE_ROOTS) {
    if (pathIsWithin(path.resolve(projectPath, relative), target)) {
      throw new CliError(`Refusing artifact output inside protected project tree ${relative}: ${target}`);
    }
  }
  for (const source of sourceInputs) {
    if (target === source || pathsReferToSameFile(target, source)) {
      throw new CliError(`Refusing an artifact output that refers to source media: ${target}`);
    }
  }
}

function stageArtifactWrites(entries, {projectPath, overwrite, sourceInputs}) {
  const staged = [];
  const seenTargets = new Set();
  try {
    for (const entry of entries) {
      protectProjectArtifact(projectPath, entry.target, sourceInputs);
      if (seenTargets.has(entry.target)) throw new CliError(`Artifact outputs must be distinct: ${entry.target}`);
      seenTargets.add(entry.target);
      const parent = path.dirname(entry.target);
      refuseSymlinkChain(projectPath, parent, 'artifact output directory');
      fs.mkdirSync(parent, {recursive: true});
      refuseSymlinkChain(projectPath, entry.target, 'artifact output');
      let existed = false;
      let original = null;
      let originalMode = 0o600;
      try {
        const stat = fs.lstatSync(entry.target);
        if (stat.isSymbolicLink()) throw new CliError(`Refusing symbolic-link artifact output: ${entry.target}`);
        if (!stat.isFile()) throw new CliError(`Artifact output exists but is not a regular file: ${entry.target}`);
        existed = true;
        if (!overwrite) throw new CliError(`Artifact output already exists; pass --overwrite explicitly or choose a versioned path: ${entry.target}`);
        original = fs.readFileSync(entry.target);
        originalMode = stat.mode & 0o777;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const temporary = path.join(parent, `.${path.basename(entry.target)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`);
      fs.writeFileSync(temporary, entry.content, {encoding: 'utf8', flag: 'wx', mode: 0o600});
      const descriptor = fs.openSync(temporary, 'r');
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      staged.push({...entry, temporary, existed, original, originalMode});
    }
  } catch (error) {
    for (const entry of staged) {
      try { fs.unlinkSync(entry.temporary); } catch (cleanupError) { if (cleanupError?.code !== 'ENOENT') throw cleanupError; }
    }
    throw error;
  }
  return staged;
}

function restoreArtifact(entry) {
  if (!entry.existed) {
    try { fs.unlinkSync(entry.target); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    return;
  }
  const restorePath = `${entry.temporary}.restore`;
  fs.writeFileSync(restorePath, entry.original, {flag: 'wx', mode: entry.originalMode});
  fs.renameSync(restorePath, entry.target);
}

function commitArtifactWrites(staged) {
  const committed = [];
  try {
    for (const entry of staged) {
      if (entry.existed) fs.renameSync(entry.temporary, entry.target);
      else {
        fs.linkSync(entry.temporary, entry.target);
        fs.unlinkSync(entry.temporary);
      }
      committed.push(entry);
    }
  } catch (error) {
    for (const entry of [...committed].reverse()) restoreArtifact(entry);
    throw error;
  } finally {
    for (const entry of staged) {
      try { fs.unlinkSync(entry.temporary); } catch (cleanupError) { if (cleanupError?.code !== 'ENOENT') throw cleanupError; }
    }
  }
}

function validateRelinkPath(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0') || value.includes('\\')) {
    throw new CliError(`${label} must be a non-empty project-relative path using forward slashes`);
  }
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:\//u.test(value)) {
    throw new CliError(`${label} must not be absolute or drive-prefixed`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..') || path.posix.normalize(value) !== value) {
    throw new CliError(`${label} must not contain empty, dot, or parent segments`);
  }
  return value;
}

function validateRelinkEntry(entry, group) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new CliError(`Existing relink ${group} entry must be an object`);
  if (Object.keys(entry).sort().join(',') !== 'path,sha256') {
    throw new CliError(`Existing relink ${group} entry must contain exactly path and sha256`);
  }
  const pathValue = validateRelinkPath(entry.path, `Existing relink ${group} entry path`);
  if (!/^[A-Fa-f0-9]{64}$/u.test(entry.sha256 ?? '')) throw new CliError(`Existing relink ${group} entry for ${pathValue} has an invalid SHA-256`);
  return {path: pathValue, sha256: entry.sha256.toLowerCase()};
}

function mergeRelinkEntries(existing, additions, group) {
  const merged = new Map();
  for (const raw of [...existing, ...additions]) {
    const entry = validateRelinkEntry(raw, group);
    const prior = merged.get(entry.path);
    if (prior && prior.sha256 !== entry.sha256) throw new CliError(`Conflicting duplicate relink ${group} path: ${entry.path}`);
    merged.set(entry.path, entry);
  }
  return [...merged.values()].sort((left, right) => compareText(left.path, right.path));
}

function validateMissingMediaEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new CliError('Existing relink missingMedia entry must be an object');
  if (Object.keys(entry).sort().join(',') !== 'path,reason') {
    throw new CliError('Existing relink missingMedia entry must contain exactly path and reason');
  }
  const pathValue = validateRelinkPath(entry.path, 'Existing relink missingMedia entry path');
  if (!MISSING_MEDIA_REASONS.has(entry.reason)) {
    throw new CliError(`Existing relink missingMedia reason for ${pathValue} must be one of: ${[...MISSING_MEDIA_REASONS].join(', ')}`);
  }
  return {path: pathValue, reason: entry.reason};
}

function normalizeMissingMedia(entries, resolvedPaths) {
  const normalized = new Map();
  for (const raw of entries) {
    const entry = validateMissingMediaEntry(raw);
    if (resolvedPaths.has(entry.path)) continue;
    const prior = normalized.get(entry.path);
    if (prior && prior.reason !== entry.reason) throw new CliError(`Conflicting duplicate relink missingMedia path: ${entry.path}`);
    normalized.set(entry.path, entry);
  }
  return [...normalized.values()].sort((left, right) => compareText(left.path, right.path));
}

function existingRelinkArray(existing, key) {
  if (!existing) return [];
  if (!Array.isArray(existing[key])) throw new CliError(`Existing relink map ${key} must be an array`);
  return existing[key];
}

function buildRelinkMap(report, relinkOutput, overwrite) {
  if (!report.projectId) throw new CliError('A project.json with a non-empty id is required to write a relink map');
  let existing = null;
  if (overwrite) {
    try {
      refuseSymlink(relinkOutput, 'relink output');
      existing = JSON.parse(fs.readFileSync(relinkOutput, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        if (error instanceof SyntaxError) throw new CliError(`Existing relink map is not valid JSON: ${error.message}`);
        throw error;
      }
    }
  }
  if (existing !== null && (typeof existing !== 'object' || Array.isArray(existing))) {
    throw new CliError('Existing relink map root must be an object');
  }
  if (existing?.$schema !== undefined && existing.$schema !== RELINK_SCHEMA_REFERENCE) {
    throw new CliError(`Existing relink map $schema must equal ${RELINK_SCHEMA_REFERENCE}`);
  }
  if (existing?.projectId !== undefined && existing.projectId !== report.projectId) {
    throw new CliError(`Existing relink map projectId does not match ${report.projectId}`);
  }
  if (existing?.hashAlgorithm !== undefined && existing.hashAlgorithm !== 'sha256') {
    throw new CliError("Existing relink map hashAlgorithm must equal 'sha256'");
  }
  if (existing?.pathPolicy !== undefined && existing.pathPolicy !== 'project-relative-forward-slashes') {
    throw new CliError("Existing relink map pathPolicy must equal 'project-relative-forward-slashes'");
  }

  const currentSources = report.files.map((file) => ({path: file.input, sha256: file.source.sha256}));
  const sources = mergeRelinkEntries(existingRelinkArray(existing, 'sources'), currentSources, 'sources');
  const derivatives = mergeRelinkEntries(existingRelinkArray(existing, 'derivatives'), [], 'derivatives');
  const allChecksums = new Map();
  for (const entry of [...sources, ...derivatives]) {
    const prior = allChecksums.get(entry.path);
    if (prior && prior !== entry.sha256) throw new CliError(`Conflicting duplicate relink path across sources and derivatives: ${entry.path}`);
    allChecksums.set(entry.path, entry.sha256);
  }
  const missingMedia = normalizeMissingMedia(existingRelinkArray(existing, 'missingMedia'), new Set(allChecksums.keys()));
  return {
    $schema: RELINK_SCHEMA_REFERENCE,
    schemaVersion: RELINK_SCHEMA_VERSION,
    projectId: report.projectId,
    status: missingMedia.length === 0 ? 'ready' : 'stale',
    hashAlgorithm: 'sha256',
    pathPolicy: 'project-relative-forward-slashes',
    sources,
    derivatives,
    missingMedia,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ['help', 'hash', 'write-relink', 'overwrite', 'compact'],
    values: ['input', 'project', 'ffprobe', 'output', 'relink-output'],
  });
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  rejectPositionals(args);
  if (Boolean(args.input) === Boolean(args.project)) throw new CliError('Provide exactly one of --input or --project');
  if (args.input && (args['relink-output'] || args['write-relink'])) throw new CliError('Relink output options require --project');
  if (args['write-relink'] && args['relink-output']) throw new CliError('Use either --write-relink or --relink-output, not both');
  if ((args['write-relink'] || args['relink-output']) && !args.hash) throw new CliError('Relink output requires --hash');
  const ffprobe = findExecutable(args.ffprobe ?? 'ffprobe');
  if (!ffprobe) throw new CliError(`ffprobe executable not found: ${args.ffprobe ?? 'ffprobe'}`);

  if (args.input) {
    const inputPath = resolveUserPath(args.input, {label: 'input path'});
    refuseSymlink(inputPath, 'input media');
    const report = probeOne(ffprobe, inputPath, inputPath, {hashRequested: Boolean(args.hash)});
    const output = formatJson(report, !args.compact);
    if (args.output) {
      const outputPath = resolveUserPath(args.output, {label: 'output path'});
      if (outputPath === inputPath || pathsReferToSameFile(outputPath, inputPath)) throw new CliError(`Refusing an output path that refers to source media: ${outputPath}`);
      refuseSymlink(outputPath, 'output file');
      fs.mkdirSync(path.dirname(outputPath), {recursive: true});
      try {
        fs.writeFileSync(outputPath, output, {encoding: 'utf8', flag: args.overwrite ? 'w' : 'wx'});
      } catch (error) {
        if (error?.code === 'EEXIST') throw new CliError(`Output already exists: ${outputPath}`);
        throw error;
      }
    }
    process.stdout.write(output);
    return 0;
  }

  const projectPath = resolveUserPath(args.project, {label: 'project path'});
  refuseSymlink(projectPath, 'project root');
  assertDirectory(projectPath, 'project root');
  const report = inventoryProject(ffprobe, projectPath, {hashRequested: Boolean(args.hash)});
  const output = formatJson(report, !args.compact);
  if (!report.ok) {
    process.stdout.write(output);
    return 1;
  }
  const sourceInputs = report.files.map((file) => path.resolve(projectPath, file.input));
  const writes = [];
  if (args.output) writes.push({target: resolveUserPath(args.output, {label: 'inventory output'}), content: output, kind: 'inventory'});
  let relinkOutput = null;
  if (args['write-relink']) relinkOutput = path.resolve(projectPath, 'timeline', 'relink-map.json');
  else if (args['relink-output']) relinkOutput = resolveUserPath(args['relink-output'], {label: 'relink output'});
  if (relinkOutput) {
    protectProjectArtifact(projectPath, relinkOutput, sourceInputs);
    writes.push({target: relinkOutput, content: formatJson(buildRelinkMap(report, relinkOutput, Boolean(args.overwrite)), !args.compact), kind: 'relink'});
  }
  if (writes.length > 0) {
    const staged = stageArtifactWrites(writes, {projectPath, overwrite: Boolean(args.overwrite), sourceInputs});
    commitArtifactWrites(staged);
  }
  process.stdout.write(output);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.exitCode = printCliError(error, {json: true});
}
