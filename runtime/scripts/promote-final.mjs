#!/usr/bin/env node

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertDirectory,
  assertInside,
  assertNotFilesystemRoot,
  assertRegularFile,
  CliError,
  findExecutable,
  formatJson,
  parseArgs,
  printCliError,
  refuseSymlink,
  refuseSymlinkChain,
  rejectPositionals,
  requireOption,
  resolveUserPath,
  runCommand,
} from './_shared.mjs';

const HELP = `\
Usage: node promote-final.mjs --project <dir> --input <file> [options]

Validate and plan or copy one completed video render into outputs/delivery. The
default is a read-only dry run. --apply copies only after ffprobe proves a
non-empty video stream and the project records both passing QA and explicit
export approval.

Options:
  --project <dir>       Scaffolded video project root (required).
  --input <file>        Completed video render to promote (required).
  --name <filename>     Destination filename (default: input basename).
  --ffprobe <path>      ffprobe executable or command name (default: ffprobe).
  --expected-sha256 <h> Refuse a candidate changed since the reviewed plan.
  --apply               Perform the copy when every gate passes. Without this
                        flag, report the plan and any unmet gates only.
  --json                Emit JSON instead of a readable summary.
  -h, --help            Show this help.

Required apply gates:
  - manifests/export.json is the export stage, has approved/complete status,
    and has approval.status=approved;
  - reviews/qa-report.json is passed/approved/complete, its named passes (when
    present) pass, and it has no open issues;
  - reviews/approval-log.json contains an approved export/final-delivery record;
  - QA and approval bind renderSha256 and the current timelineSha256.

Safety policy: promotion is copy-only. It never moves or deletes the input,
never deletes raw or outputs, never overwrites a different final, and never
prunes any file (including files newer than the deliverable).
`;

const PASSING_STATUSES = new Set(['pass', 'passed', 'approved', 'complete']);
const EXPORT_STATUSES = new Set(['approved', 'complete']);

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

function validateFilename(value) {
  if (typeof value !== 'string' || value.trim() === '' || value === '.' || value === '..') {
    throw new CliError('Destination name must be a non-empty filename');
  }
  if (value !== path.basename(value) || value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw new CliError('Destination name must not contain a path');
  }
  return value;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function verifyVideo(ffprobe, target) {
  const result = runCommand(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v',
    '-show_entries', 'stream=index,codec_type,width,height,duration,nb_frames:format=duration',
    '-of', 'json',
    target,
  ], {label: `ffprobe promotion candidate ${path.basename(target)}`});
  let raw;
  try {
    raw = JSON.parse(result.stdout);
  } catch (error) {
    throw new CliError(`ffprobe returned invalid JSON for the promotion candidate: ${error.message}`, 1);
  }
  const formatDuration = positiveNumber(raw.format?.duration);
  const videoStreams = (Array.isArray(raw.streams) ? raw.streams : [])
    .filter((stream) => stream?.codec_type === 'video')
    .map((stream) => ({
      index: Number.isInteger(Number(stream.index)) ? Number(stream.index) : null,
      width: positiveInteger(stream.width),
      height: positiveInteger(stream.height),
      durationSeconds: positiveNumber(stream.duration),
      frameCount: positiveInteger(stream.nb_frames),
    }));
  const verifiedStreams = videoStreams.filter((stream) => (
    stream.width !== null
    && stream.height !== null
    && (stream.frameCount !== null || stream.durationSeconds !== null || formatDuration !== null)
  ));
  if (verifiedStreams.length === 0) {
    throw new CliError('Promotion input is not a verifiable non-empty video: ffprobe found no video stream with dimensions and positive duration/frame evidence', 1);
  }
  return {formatDurationSeconds: formatDuration, videoStreams, verifiedVideoStreamCount: verifiedStreams.length};
}

function readGateJson(projectPath, relativePath) {
  const target = path.resolve(projectPath, relativePath);
  assertInside(projectPath, target, 'gate record');
  try {
    refuseSymlinkChain(projectPath, target, 'gate record');
    assertRegularFile(target, 'gate record');
    return {path: relativePath, value: JSON.parse(fs.readFileSync(target, 'utf8')), error: null};
  } catch (error) {
    const message = error instanceof SyntaxError ? `invalid JSON: ${error.message}` : error.message;
    return {path: relativePath, value: null, error: message};
  }
}

function normalizedStatus(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function approvalScopeMatches(entry) {
  const values = [entry?.stage, entry?.scope, entry?.action, entry?.type, entry?.gate]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => typeof value === 'string')
    .map((value) => value.toLowerCase());
  return values.some((value) => (
    value === 'export'
    || value.includes('final-export')
    || value.includes('final export')
    || value.includes('final-delivery')
    || value.includes('final delivery')
    || value.includes('delivery-promotion')
    || value.includes('delivery promotion')
    || value.includes('review-render-and-export')
  ));
}

function evaluateGates(projectPath, renderSha256) {
  const exportRecord = readGateJson(projectPath, 'manifests/export.json');
  const qaRecord = readGateJson(projectPath, 'reviews/qa-report.json');
  const approvalRecord = readGateJson(projectPath, 'reviews/approval-log.json');

  const exportManifest = exportRecord.value;
  const exportApproved = !exportRecord.error
    && exportManifest?.stage === 'export'
    && EXPORT_STATUSES.has(normalizedStatus(exportManifest.status))
    && normalizedStatus(exportManifest.approval?.status) === 'approved';

  const qa = qaRecord.value;
  const timelinePath = path.join(projectPath, 'timeline', 'timeline.json');
  refuseSymlinkChain(projectPath, timelinePath, 'timeline');
  const timelineSha256 = fs.existsSync(timelinePath) ? sha256File(timelinePath) : null;
  const renderHash = (record) => record?.renderSha256 ?? record?.render?.sha256 ?? record?.reviewRender?.sha256;
  const coversRevision = (record) => renderHash(record) === renderSha256
    && (timelineSha256 === null || record?.timelineSha256 === timelineSha256);
  const namedPasses = ['earlySpotReview', 'technicalPass', 'editorialCompositionPass']
    .filter((key) => qa?.[key] && typeof qa[key] === 'object')
    .map((key) => ({key, status: normalizedStatus(qa[key].status)}));
  const namedPassesApproved = namedPasses.every((entry) => PASSING_STATUSES.has(entry.status));
  const noOpenIssues = Array.isArray(qa?.openIssues) && qa.openIssues.length === 0;
  const qaApproved = !qaRecord.error
    && PASSING_STATUSES.has(normalizedStatus(qa?.status ?? qa?.overallStatus))
    && namedPassesApproved
    && noOpenIssues
    && coversRevision(qa);

  const approvals = Array.isArray(approvalRecord.value?.approvals) ? approvalRecord.value.approvals : [];
  const latest = new Map(approvals.map((entry, index) => [entry?.id ?? `entry-${index}`, entry]));
  const matchingApprovals = [...latest.values()].filter((entry) => normalizedStatus(entry?.status) === 'approved' && approvalScopeMatches(entry) && coversRevision(entry));
  const loggedApproval = !approvalRecord.error && matchingApprovals.length > 0;

  const gates = [
    {
      id: 'export-stage-approved',
      passed: exportApproved,
      record: exportRecord.path,
      detail: exportRecord.error ?? (exportApproved ? 'export manifest and approval are approved' : 'requires stage=export, status approved/complete, and approval.status=approved'),
    },
    {
      id: 'qa-passed',
      passed: qaApproved,
      record: qaRecord.path,
      detail: qaRecord.error ?? (qaApproved ? 'QA covers this exact render/timeline and has no open issues' : 'requires passing QA with no open issues, matching renderSha256 and current timelineSha256'),
    },
    {
      id: 'export-approval-logged',
      passed: loggedApproval,
      record: approvalRecord.path,
      detail: approvalRecord.error ?? (loggedApproval ? 'approved record covers this exact render/timeline' : 'requires current export/final-delivery approval with matching renderSha256 and timelineSha256; legacy records are preserved, not broadened'),
    },
  ];
  return {ready: gates.every((gate) => gate.passed), gates};
}

function emit(report, json) {
  if (json) {
    process.stdout.write(formatJson(report));
    return;
  }
  process.stdout.write(`${report.action}: ${report.input} -> ${report.destination}\n`);
  process.stdout.write(`  media: ${report.media.verifiedVideoStreamCount} verified non-empty video stream(s)\n`);
  for (const gate of report.approvalGates.gates) {
    process.stdout.write(`  ${gate.passed ? 'pass' : 'BLOCK'} ${gate.id}: ${gate.detail}\n`);
  }
  process.stdout.write(`  ${report.dryRun ? 'dry run; rerun with --apply only after all gates pass' : 'apply enabled'}\n`);
  process.stdout.write('  source, raw media, drafts, finals, and all newer files were preserved\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ['help', 'apply', 'json'],
    values: ['project', 'input', 'name', 'ffprobe', 'expected-sha256'],
  });
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  rejectPositionals(args);
  const projectPath = resolveUserPath(requireOption(args, 'project'), {label: 'project path'});
  assertNotFilesystemRoot(projectPath, 'project path');
  refuseSymlink(projectPath, 'project root');
  assertDirectory(projectPath, 'project root');

  const requestedInput = resolveUserPath(requireOption(args, 'input'), {label: 'input path'});
  refuseSymlink(requestedInput, 'promotion input');
  const inputPath = fs.realpathSync(requestedInput);
  const inputStat = assertRegularFile(inputPath, 'promotion input');
  if (inputStat.size === 0) throw new CliError(`Promotion input is empty: ${inputPath}`);
  const ffprobe = findExecutable(args.ffprobe ?? 'ffprobe');
  if (!ffprobe) throw new CliError(`ffprobe executable not found: ${args.ffprobe ?? 'ffprobe'}`);
  const media = verifyVideo(ffprobe, inputPath);

  const finalDirectory = path.resolve(projectPath, 'outputs', 'delivery');
  assertInside(projectPath, finalDirectory, 'final directory');
  refuseSymlink(path.resolve(projectPath, 'outputs'), 'outputs directory');
  refuseSymlink(finalDirectory, 'final directory');
  const name = validateFilename(args.name ?? path.basename(inputPath));
  const destination = path.resolve(finalDirectory, name);
  assertInside(finalDirectory, destination, 'final destination');
  refuseSymlinkChain(projectPath, destination, 'final destination');

  const sourceHash = sha256File(inputPath);
  if (args['expected-sha256'] && args['expected-sha256'] !== sourceHash) throw new CliError('Render changed since planning');
  let destinationStatus = 'absent';
  let destinationHash = null;
  try {
    const destinationStat = fs.lstatSync(destination);
    if (destinationStat.isSymbolicLink()) throw new CliError(`Refusing symbolic-link final destination: ${destination}`);
    if (!destinationStat.isFile()) throw new CliError(`Final destination exists but is not a regular file: ${destination}`);
    destinationHash = sha256File(destination);
    destinationStatus = destinationHash === sourceHash ? 'identical' : 'conflict';
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (destinationStatus === 'conflict') throw new CliError(`A different final already exists at ${destination}; choose another --name. No file was changed.`);

  const approvalGates = evaluateGates(projectPath, sourceHash);
  let action = approvalGates.ready
    ? (destinationStatus === 'identical' ? 'already-promoted' : 'would-copy')
    : 'blocked';
  let copied = false;
  if (args.apply && approvalGates.ready && destinationStatus === 'absent') {
    if (sha256File(inputPath) !== sourceHash || !evaluateGates(projectPath, sourceHash).ready) throw new CliError('Render, timeline, or approval changed during promotion');
    fs.mkdirSync(finalDirectory, {recursive: true});
    refuseSymlink(finalDirectory, 'final directory');
    try {
      fs.copyFileSync(inputPath, destination, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error?.code === 'EEXIST') throw new CliError(`Final destination appeared during promotion and was not overwritten: ${destination}`);
      throw error;
    }
    destinationHash = sha256File(destination);
    if (destinationHash !== sourceHash) throw new CliError(`Copied final failed checksum verification: ${destination}`, 1);
    action = 'copied';
    copied = true;
  }

  const report = {
    ok: approvalGates.ready,
    dryRun: !args.apply,
    action,
    project: projectPath,
    input: inputPath,
    destination,
    destinationStatus,
    sizeBytes: inputStat.size,
    sha256: sourceHash,
    media,
    approvalGates,
    safety: {
      inputPreserved: true,
      rawPreserved: true,
      outputsPreserved: true,
      newerFilesPreserved: true,
      removed: [],
      overwritten: [],
      created: copied ? [destination] : [],
    },
  };
  emit(report, Boolean(args.json));
  return args.apply && !approvalGates.ready ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.exitCode = printCliError(error, {json: process.argv.includes('--json')});
}
