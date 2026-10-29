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
  requireOption,
  resolveUserPath,
  runCommand,
} from './_shared.mjs';

const HELP = `\
Usage:
  node register-derivative.mjs --project <project-dir> --input <media-file> [options]

Probe and hash one project-contained derived media file, then atomically add its
canonical {path,sha256} entry to timeline/relink-map.json. The input may be
project-relative (for example proxies/A001-proxy.mov) or relative to the current
working directory when that path is already inside the selected project.

Options:
  --project <dir>    Project root containing project.json and timeline/relink-map.json.
  --input <file>     Existing derived media file inside the project.
  --ffprobe <path>   ffprobe executable or command name (default: ffprobe).
  --overwrite        Replace only an existing derivatives entry at the same path
                     after re-probing and re-hashing the current file. This never
                     changes or removes a sources or missingMedia entry.
  --compact          Emit compact JSON instead of pretty JSON.
  -h, --help         Show this help.

The helper refuses project or input symlinks, path escapes, declared source
inventory areas (raw, broll, licensed audio/SFX, references, and generated
assets), hard links to registered sources, malformed relink maps, and duplicate
or cross-collection paths. A duplicate derivative path is rejected unless
--overwrite is explicit. If the existing hash already matches, --overwrite is a
safe no-op. The relink map is never created implicitly and its project identity,
status, sources, and missingMedia records remain authoritative.
`;

const RELINK_SCHEMA_REFERENCE = 'relink-map.schema.json';
const RELINK_STATUSES = new Set(['awaiting-ingest', 'ready', 'stale', 'error']);
const MISSING_MEDIA_REASONS = new Set([
  'not-found',
  'unreadable',
  'hash-mismatch',
  'not-in-inventory',
  'unsupported-media',
]);
const RELINK_KEYS = [
  '$schema',
  'schemaVersion',
  'projectId',
  'status',
  'hashAlgorithm',
  'pathPolicy',
  'sources',
  'derivatives',
  'missingMedia',
];
const SOURCE_INVENTORY_ROOTS = [
  'raw',
  'broll',
  'audio/music',
  'audio/sfx',
  'assets/references',
  'assets/generated',
];

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new CliError(`${label} must contain exactly: ${wanted.join(', ')}`);
  }
}

function validateProjectRelativePath(value, label) {
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

function validateChecksumEntries(entries, group) {
  if (!Array.isArray(entries)) throw new CliError(`Existing relink map ${group} must be an array`);
  const seen = new Map();
  return entries.map((entry, index) => {
    if (!isPlainObject(entry)) throw new CliError(`Existing relink ${group}[${index}] must be an object`);
    assertExactKeys(entry, ['path', 'sha256'], `Existing relink ${group}[${index}]`);
    const entryPath = validateProjectRelativePath(entry.path, `Existing relink ${group}[${index}].path`);
    if (!/^[A-Fa-f0-9]{64}$/u.test(entry.sha256 ?? '')) {
      throw new CliError(`Existing relink ${group} entry for ${entryPath} has an invalid SHA-256`);
    }
    const sha256 = entry.sha256.toLowerCase();
    if (seen.has(entryPath)) {
      const qualifier = seen.get(entryPath) === sha256 ? 'Duplicate' : 'Conflicting duplicate';
      throw new CliError(`${qualifier} relink ${group} path: ${entryPath}`);
    }
    seen.set(entryPath, sha256);
    return {path: entryPath, sha256};
  });
}

function validateMissingMedia(entries) {
  if (!Array.isArray(entries)) throw new CliError('Existing relink map missingMedia must be an array');
  const seen = new Set();
  return entries.map((entry, index) => {
    if (!isPlainObject(entry)) throw new CliError(`Existing relink missingMedia[${index}] must be an object`);
    assertExactKeys(entry, ['path', 'reason'], `Existing relink missingMedia[${index}]`);
    const entryPath = validateProjectRelativePath(entry.path, `Existing relink missingMedia[${index}].path`);
    if (!MISSING_MEDIA_REASONS.has(entry.reason)) {
      throw new CliError(`Existing relink missingMedia reason for ${entryPath} is invalid`);
    }
    if (seen.has(entryPath)) throw new CliError(`Duplicate relink missingMedia path: ${entryPath}`);
    seen.add(entryPath);
    return {path: entryPath, reason: entry.reason};
  });
}

function validateRelinkMap(value, projectId) {
  if (!isPlainObject(value)) throw new CliError('Existing relink map root must be an object');
  assertExactKeys(value, RELINK_KEYS, 'Existing relink map');
  if (value.$schema !== RELINK_SCHEMA_REFERENCE) {
    throw new CliError(`Existing relink map $schema must equal ${RELINK_SCHEMA_REFERENCE}`);
  }
  if (value.schemaVersion !== 1) throw new CliError('Existing relink map schemaVersion must equal 1');
  if (value.projectId !== projectId) throw new CliError(`Existing relink map projectId must equal ${projectId}`);
  if (!RELINK_STATUSES.has(value.status)) throw new CliError('Existing relink map status is invalid');
  if (value.hashAlgorithm !== 'sha256') throw new CliError("Existing relink map hashAlgorithm must equal 'sha256'");
  if (value.pathPolicy !== 'project-relative-forward-slashes') {
    throw new CliError("Existing relink map pathPolicy must equal 'project-relative-forward-slashes'");
  }

  const sources = validateChecksumEntries(value.sources, 'sources');
  const derivatives = validateChecksumEntries(value.derivatives, 'derivatives');
  const missingMedia = validateMissingMedia(value.missingMedia);
  const checksumPaths = new Map();
  for (const [group, entries] of [['sources', sources], ['derivatives', derivatives]]) {
    for (const entry of entries) {
      if (checksumPaths.has(entry.path)) {
        throw new CliError(`Duplicate relink path across ${checksumPaths.get(entry.path)} and ${group}: ${entry.path}`);
      }
      checksumPaths.set(entry.path, group);
    }
  }
  for (const entry of missingMedia) {
    if (checksumPaths.has(entry.path)) {
      throw new CliError(`Relink path appears in both ${checksumPaths.get(entry.path)} and missingMedia: ${entry.path}`);
    }
  }
  return {sources, derivatives, missingMedia};
}

function pathIsInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveInputPath(value, projectPath) {
  const cwdCandidate = resolveUserPath(value, {label: 'input path'});
  if (path.isAbsolute(value) || pathIsInside(projectPath, cwdCandidate)) return cwdCandidate;
  return resolveUserPath(value, {base: projectPath, label: 'input path'});
}

function toProjectPath(projectPath, target) {
  return path.relative(projectPath, target).split(path.sep).join('/');
}

function pathIsInSourceArea(relativePath) {
  return SOURCE_INVENTORY_ROOTS.find((root) => relativePath === root || relativePath.startsWith(`${root}/`)) ?? null;
}

function readProjectId(projectPath) {
  const manifestPath = path.join(projectPath, 'project.json');
  refuseSymlinkChain(projectPath, manifestPath, 'project manifest');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw new CliError(`Project manifest does not exist: ${manifestPath}`);
    if (error instanceof SyntaxError) throw new CliError(`Project manifest is not valid JSON: ${error.message}`);
    throw error;
  }
  if (!isPlainObject(manifest) || typeof manifest.id !== 'string' || manifest.id.trim() === '') {
    throw new CliError('Project manifest must contain a non-empty id');
  }
  return manifest.id;
}

function readRelinkMap(projectPath, projectId) {
  const target = path.join(projectPath, 'timeline', 'relink-map.json');
  refuseSymlinkChain(projectPath, target, 'relink map');
  let stat;
  let text;
  try {
    stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new CliError(`Refusing symbolic-link relink map: ${target}`);
    if (!stat.isFile()) throw new CliError(`Relink map is not a regular file: ${target}`);
    text = fs.readFileSync(target, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new CliError(`Relink map does not exist; create it during hashed ingest first: ${target}`);
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CliError(`Existing relink map is not valid JSON: ${error.message}`);
  }
  const validated = validateRelinkMap(value, projectId);
  return {target, stat, text, value, ...validated};
}

function sameSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function sha256FileStable(target, expectedStat) {
  const descriptor = fs.openSync(target, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    const before = fs.fstatSync(descriptor);
    if (!sameSnapshot(before, expectedStat)) throw new CliError('Input changed before hashing began', 1);
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    const after = fs.fstatSync(descriptor);
    if (!sameSnapshot(before, after)) throw new CliError('Input changed while it was being hashed', 1);
  } finally {
    fs.closeSync(descriptor);
  }
  const pathStat = assertRegularFile(target, 'input media');
  if (!sameSnapshot(pathStat, expectedStat)) throw new CliError('Input changed while it was being probed or hashed', 1);
  return hash.digest('hex');
}

function probeAndHash(ffprobe, inputPath, relativePath) {
  refuseSymlink(inputPath, 'input media');
  const before = assertRegularFile(inputPath, 'input media');
  const result = runCommand(ffprobe, [
    '-v', 'error',
    '-show_format',
    '-show_streams',
    '-show_chapters',
    '-of', 'json',
    inputPath,
  ], {label: `ffprobe ${relativePath}`});
  let raw;
  try {
    raw = JSON.parse(result.stdout);
  } catch (error) {
    throw new CliError(`ffprobe returned invalid JSON for ${relativePath}: ${error.message}`, 1);
  }
  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const mediaStreams = streams.filter((stream) => stream?.codec_type === 'video' || stream?.codec_type === 'audio');
  if (mediaStreams.length === 0) throw new CliError(`ffprobe found no audio or video streams in ${relativePath}`, 1);
  const afterProbe = assertRegularFile(inputPath, 'input media');
  if (!sameSnapshot(before, afterProbe)) throw new CliError(`Input changed while it was being probed: ${relativePath}`, 1);
  const sha256 = sha256FileStable(inputPath, afterProbe);
  return {
    sha256,
    media: {
      formatNames: typeof raw.format?.format_name === 'string'
        ? raw.format.format_name.split(',').map((entry) => entry.trim()).filter(Boolean)
        : [],
      durationSeconds: Number.isFinite(Number(raw.format?.duration)) ? Number(raw.format.duration) : null,
      streamCount: mediaStreams.length,
      streamTypes: [...new Set(mediaStreams.map((stream) => stream.codec_type))].sort(compareText),
    },
  };
}

function assertNotSourceAlias(projectPath, inputPath, sources) {
  for (const source of sources) {
    const sourcePath = path.resolve(projectPath, ...source.path.split('/'));
    assertInside(projectPath, sourcePath, 'registered source path');
    refuseSymlinkChain(projectPath, sourcePath, 'registered source path');
    if (pathsReferToSameFile(inputPath, sourcePath)) {
      throw new CliError(`Input refers to registered source media and cannot be registered as a derivative: ${source.path}`);
    }
  }
}

function atomicReplaceJson(projectPath, target, expectedText, expectedStat, value) {
  const parent = path.dirname(target);
  refuseSymlinkChain(projectPath, parent, 'relink map directory');
  refuseSymlinkChain(projectPath, target, 'relink map');
  const temporary = path.join(parent, `.${path.basename(target)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`);
  let temporaryCreated = false;
  try {
    fs.writeFileSync(temporary, formatJson(value), {encoding: 'utf8', flag: 'wx', mode: 0o600});
    temporaryCreated = true;
    const descriptor = fs.openSync(temporary, 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    const currentStat = fs.lstatSync(target);
    if (currentStat.isSymbolicLink() || !currentStat.isFile()) {
      throw new CliError('Relink map changed to an unsafe file type before commit', 1);
    }
    if (!sameSnapshot(currentStat, expectedStat) || fs.readFileSync(target, 'utf8') !== expectedText) {
      throw new CliError('Relink map changed after it was read; no update was committed', 1);
    }
    refuseSymlinkChain(projectPath, target, 'relink map');
    fs.chmodSync(temporary, expectedStat.mode & 0o777);
    fs.renameSync(temporary, target);
    temporaryCreated = false;
  } finally {
    if (temporaryCreated) {
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ['help', 'overwrite', 'compact'],
    values: ['project', 'input', 'ffprobe'],
  });
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  rejectPositionals(args);

  const projectArgument = resolveUserPath(requireOption(args, 'project'), {label: 'project path'});
  refuseSymlink(projectArgument, 'project root');
  assertDirectory(projectArgument, 'project root');
  const projectPath = fs.realpathSync(projectArgument);
  refuseSymlink(projectPath, 'project root');

  const inputPath = resolveInputPath(requireOption(args, 'input'), projectPath);
  assertInside(projectPath, inputPath, 'input media');
  if (inputPath === projectPath) throw new CliError('Input media must be a file below the project root');
  refuseSymlinkChain(projectPath, inputPath, 'input media');
  assertRegularFile(inputPath, 'input media');
  const relativePath = validateProjectRelativePath(toProjectPath(projectPath, inputPath), 'Input media path');
  const sourceArea = pathIsInSourceArea(relativePath);
  if (sourceArea) {
    throw new CliError(`Refusing derivative registration from declared source inventory area ${sourceArea}: ${relativePath}`);
  }

  const projectId = readProjectId(projectPath);
  const relink = readRelinkMap(projectPath, projectId);
  assertNotSourceAlias(projectPath, inputPath, relink.sources);
  if (relink.sources.some((entry) => entry.path === relativePath)) {
    throw new CliError(`Input path is already registered as a source and cannot become a derivative: ${relativePath}`);
  }
  if (relink.missingMedia.some((entry) => entry.path === relativePath)) {
    throw new CliError(`Input path is still listed in missingMedia; resolve that record before derivative registration: ${relativePath}`);
  }

  const existingIndex = relink.derivatives.findIndex((entry) => entry.path === relativePath);
  if (existingIndex !== -1 && !args.overwrite) {
    throw new CliError(`Derivative path is already registered; pass --overwrite to re-probe and replace only that entry: ${relativePath}`);
  }

  const ffprobe = findExecutable(args.ffprobe ?? 'ffprobe');
  if (!ffprobe) throw new CliError(`ffprobe executable not found: ${args.ffprobe ?? 'ffprobe'}`);
  const {sha256, media} = probeAndHash(ffprobe, inputPath, relativePath);
  const priorHash = existingIndex === -1 ? null : relink.derivatives[existingIndex].sha256;
  const action = existingIndex === -1 ? 'added' : priorHash === sha256 ? 'unchanged' : 'updated';
  let written = false;
  if (action !== 'unchanged') {
    const derivatives = relink.derivatives.filter((entry) => entry.path !== relativePath);
    derivatives.push({path: relativePath, sha256});
    derivatives.sort((left, right) => compareText(left.path, right.path));
    atomicReplaceJson(projectPath, relink.target, relink.text, relink.stat, {
      ...relink.value,
      derivatives,
    });
    written = true;
  }

  process.stdout.write(formatJson({
    ok: true,
    action,
    written,
    projectId,
    relinkMap: 'timeline/relink-map.json',
    derivative: {path: relativePath, sha256},
    previousSha256: priorHash,
    media,
    preserved: {
      status: relink.value.status,
      sourceCount: relink.sources.length,
      missingMediaCount: relink.missingMedia.length,
    },
  }, !args.compact));
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.exitCode = printCliError(error, {json: true});
}
