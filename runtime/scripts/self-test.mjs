#!/usr/bin/env node

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HELP = `\
Usage: node self-test.mjs

Run isolated tests for the core Node safety helpers. The WhisperX launcher uses
the locked-environment smoke checks, and the Resolve bridge has its own Python
test suite. All fixtures, fake media tools, generated frames, and project files
live under one mkdtemp directory and are removed at the end. No network access
or third-party package is used.

Options:
  -h, --help  Show this help.
`;

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const TEST_PREFIX = path.join(os.tmpdir(), 'qs-video-self-test-');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function runCli(name, args, {cwd, env = process.env, expect = 0, input} = {}) {
  const result = spawnSync(process.execPath, [path.join(SCRIPT_DIRECTORY, name), ...args], {
    cwd,
    env,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== expect) {
    throw new Error([
      `${name} exited ${result.status}; expected ${expect}`,
      result.stdout ? `stdout:\n${result.stdout}` : '',
      result.stderr ? `stderr:\n${result.stderr}` : '',
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function runCliFailure(name, args, options = {}) {
  const result = runCliUnchecked(name, args, options);
  if (result.status === 0) {
    throw new Error(`${name} unexpectedly succeeded\nstdout:\n${result.stdout}`);
  }
  return result;
}

function runCliUnchecked(name, args, {cwd, env = process.env, input} = {}) {
  const result = spawnSync(process.execPath, [path.join(SCRIPT_DIRECTORY, name), ...args], {
    cwd,
    env,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not emit valid JSON: ${error.message}\n${result.stdout}`);
  }
}

function writeExecutable(target, source) {
  fs.writeFileSync(target, source, {encoding: 'utf8', flag: 'wx'});
  fs.chmodSync(target, 0o755);
}

function installFakeMediaTools(binDirectory) {
  fs.mkdirSync(binDirectory, {recursive: true});
  writeExecutable(path.join(binDirectory, 'ffprobe'), `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('-nostdin')) {
  process.stderr.write('fake ffprobe rejects unsupported -nostdin\\n');
  process.exit(91);
}
if (args.includes('-version')) {
  process.stdout.write('ffprobe version fake-1.0\\n');
} else if (args.includes('-select_streams')) {
  if (args.at(-1).includes('not-video')) {
    process.stdout.write(JSON.stringify({format: {duration: '10'}, streams: []}));
  } else {
    process.stdout.write(JSON.stringify({
      format: {duration: '10.000000'},
      streams: [{index: 0, codec_type: 'video', width: 1920, height: 1080, duration: '10.000000', nb_frames: '300'}]
    }));
  }
} else if (args.includes('-show_entries')) {
  process.stdout.write('10.000000\\n');
} else if (args.includes('-show_format') && args.includes('-show_streams')) {
  if (args.at(-1).includes('corrupt')) {
    process.stderr.write('fixture media is corrupt\\n');
    process.exit(98);
  }
  process.stdout.write(JSON.stringify({
    format: {
      filename: args.at(-1),
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      format_long_name: 'Fake QuickTime / MOV',
      duration: '10.000000',
      start_time: '0.000000',
      size: '1234',
      bit_rate: '9872',
      tags: {timecode: '01:00:00:00', creation_time: 'private-arbitrary-tag'}
    },
    streams: [
      {
        index: 0, codec_type: 'video', codec_name: 'h264', codec_long_name: 'Fake H.264', profile: 'High',
        width: 1920, height: 1080, pix_fmt: 'yuv420p', r_frame_rate: '30000/1001',
        avg_frame_rate: '30000/1001', time_base: '1/30000', nb_frames: '300', field_order: 'progressive',
        sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', color_range: 'tv', color_space: 'bt709',
        color_transfer: 'bt709', color_primaries: 'bt709', duration: '10',
        tags: {timecode: '01:00:00:00', language: 'eng', title: 'must-not-persist'}
      },
      {
        index: 1, codec_type: 'audio', codec_name: 'aac', codec_long_name: 'Fake AAC', profile: 'LC',
        sample_rate: '48000', channels: 2, channel_layout: 'stereo', time_base: '1/48000', duration: '10',
        tags: {language: 'eng', title: 'must-not-persist'}
      }
    ],
    chapters: []
  }));
} else {
  process.stderr.write('unexpected fake ffprobe args: ' + JSON.stringify(args) + '\\n');
  process.exit(92);
}
`);

  writeExecutable(path.join(binDirectory, 'ffmpeg'), `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (!args.includes('-nostdin')) {
  process.stderr.write('fake ffmpeg requires -nostdin\\n');
  process.exit(93);
}
if (args.includes('-version')) {
  process.stdout.write('ffmpeg version fake-1.0\\n');
  process.exit(0);
}
if (args.includes('-hwaccels')) {
  process.stdout.write('Hardware acceleration methods:\\nvideotoolbox\\n');
  process.exit(0);
}
if (args.includes('-encoders')) {
  process.stdout.write('Encoders:\\n V....D libx264 Fake H.264\\n A..... aac Fake AAC\\n');
  process.exit(0);
}
if (args.includes('-filters')) {
  process.stdout.write('Filters:\\n .. drawtext V->V Fake drawtext\\n .. loudnorm A->A Fake loudnorm\\n');
  process.exit(0);
}
const output = args.at(-1);
if (!output || output.startsWith('-')) {
  process.stderr.write('fake ffmpeg did not receive an output path\\n');
  process.exit(94);
}
if (args.includes('-n') && fs.existsSync(output)) {
  process.stderr.write('output exists\\n');
  process.exit(95);
}
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, 'fake frame at ' + args[args.indexOf('-ss') + 1] + '\\n');
`);
}

function installFakeRemotion(projectDirectory) {
  const executable = path.join(projectDirectory, 'renderers', 'remotion', 'node_modules', '.bin', 'remotion');
  fs.mkdirSync(path.dirname(executable), {recursive: true});
  writeExecutable(executable, `#!${process.execPath}
const args = process.argv.slice(2);
if (process.cwd() !== process.env.EXPECTED_REMOTION_CWD) {
  process.stderr.write('unexpected Remotion cwd: ' + process.cwd() + '\\n');
  process.exit(96);
}
if (args.length !== 1 || args[0] !== '--help') {
  process.stderr.write('expected read-only Remotion --help probe, received: ' + JSON.stringify(args) + '\\n');
  process.exit(97);
}
process.stdout.write('Remotion 4.0.512\\nUsage: remotion <command>\\n');
`);
}

function installFakeHyperframes(projectDirectory) {
  fs.writeFileSync(path.join(projectDirectory, 'package.json'), JSON.stringify({devDependencies: {hyperframes: '0.7.109'}}));
  fs.writeFileSync(path.join(projectDirectory, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {'node_modules/hyperframes': {version: '0.7.109'}},
  }));
  const packageDirectory = path.join(projectDirectory, 'node_modules', 'hyperframes');
  fs.mkdirSync(packageDirectory, {recursive: true});
  fs.writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({name: 'hyperframes', version: '0.7.109'}));
  const executable = path.join(projectDirectory, 'node_modules', '.bin', 'hyperframes');
  fs.mkdirSync(path.dirname(executable), {recursive: true});
  writeExecutable(executable, `#!${process.execPath}
const args = process.argv.slice(2);
if (process.cwd() !== process.env.EXPECTED_REMOTION_CWD) {
  process.stderr.write('unexpected HyperFrames cwd: ' + process.cwd() + '\\n');
  process.exit(98);
}
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('0.7.109\\n');
} else if (args.length === 2 && args[0] === 'doctor' && args[1] === '--help') {
  process.stdout.write('Check system dependencies (hyperframes doctor v0.7.109)\\n');
} else {
  process.stderr.write('unexpected HyperFrames args: ' + JSON.stringify(args) + '\\n');
  process.exit(99);
}
`);
}

function installFakeWhisperx(projectDirectory) {
  const executable = path.join(projectDirectory, '.venv', 'bin', 'whisperx');
  fs.mkdirSync(path.dirname(executable), {recursive: true});
  writeExecutable(executable, `#!${process.execPath}
const args = process.argv.slice(2);
if (process.cwd() !== process.env.EXPECTED_REMOTION_CWD) {
  process.stderr.write('unexpected WhisperX cwd: ' + process.cwd() + '\\n');
  process.exit(96);
}
if (args.length !== 1 || args[0] !== '--version') {
  process.stderr.write('expected read-only WhisperX --version probe, received: ' + JSON.stringify(args) + '\\n');
  process.exit(97);
}
process.stdout.write('whisperx 3.8.6\\n');
`);
}

function testHelp(tempRoot) {
  const scripts = [
    'check-environment.mjs',
    'scaffold-project.mjs',
    'probe-media.mjs',
    'register-derivative.mjs',
    'extract-review-frames.mjs',
    'validate-graphics-plan.mjs',
    'promote-final.mjs',
  ];
  for (const script of scripts) {
    const result = runCli(script, ['--help'], {cwd: tempRoot});
    assert(result.stdout.startsWith('Usage:'), `${script} help must begin with Usage:`);
    assert(result.stdout.length > 200, `${script} help should explain its interface`);
  }
}

function testEnvironment(tempRoot, fakeBin) {
  installFakeRemotion(tempRoot);
  installFakeHyperframes(tempRoot);
  installFakeWhisperx(tempRoot);
  const env = {...process.env, PATH: fakeBin, EXPECTED_REMOTION_CWD: fs.realpathSync(tempRoot)};
  const result = runCli('check-environment.mjs', ['--project', tempRoot, '--json'], {cwd: tempRoot, env});
  const report = parseJsonOutput(result, 'check-environment');
  assertEqual(report.ok, true, 'fake environment should be ready');
  assertEqual(report.tools.find((tool) => tool.name === 'ffmpeg').version, 'ffmpeg version fake-1.0', 'ffmpeg version');
  assertEqual(report.tools.find((tool) => tool.name === 'ffprobe').version, 'ffprobe version fake-1.0', 'ffprobe version');
  assertEqual(report.tools.find((tool) => tool.name === 'hyperframes').version, '0.7.109', 'local HyperFrames version');
  const whisperx = report.tools.find((tool) => tool.name === 'whisperx');
  assert(whisperx.available, `project-local WhisperX should be available: ${JSON.stringify(whisperx)}`);
  assertEqual(whisperx.version, 'whisperx 3.8.6', 'WhisperX read-only version probe');
  const remotion = report.tools.find((tool) => tool.name === 'remotion');
  assert(remotion.available, `local Remotion should be available: ${JSON.stringify(remotion)}`);
  assertEqual(remotion.version, 'Remotion 4.0.512', 'Remotion read-only probe');
  assertEqual(report.hyperframesPackage.exactPin, true, 'HyperFrames must be exactly pinned');
  assertEqual(report.hyperframesPackage.consistent, true, 'HyperFrames declaration, lock, and install should match');
  assertEqual(report.hyperframesPackage.doctorCommandAvailable, true, 'HyperFrames doctor command should be discoverable read-only');
  assertEqual(report.ffmpegCapabilities.hardwareAcceleration[0], 'videotoolbox', 'FFmpeg hardware acceleration report');
  assertEqual(report.ffmpegCapabilities.selectedEncoders.libx264, true, 'FFmpeg encoder report');
  assertEqual(report.ffmpegCapabilities.selectedFilters.drawtext, true, 'FFmpeg filter report');
  assert(typeof report.disk.freeGiB === 'number', 'free disk space should be reported');
  assert(report.applications.some((application) => application.id === 'davinci-resolve'), 'Resolve application status should be reported');
  assert(report.applications.some((application) => application.id === 'capcut'), 'CapCut application status should be reported');
}

function testScaffold(tempRoot) {
  const repository = path.join(tempRoot, 'video-workspace');
  const skillMarker = path.join(repository, '.agents', 'skills', 'edit-video', 'SKILL.md');
  fs.mkdirSync(path.dirname(skillMarker), {recursive: true});
  fs.writeFileSync(skillMarker, '---\nname: edit-video\n---\n');
  const project = path.join(fs.realpathSync(repository), 'projects', 'sample-wedding');
  const first = parseJsonOutput(runCli('scaffold-project.mjs', [
    '--name', 'Sample Wedding',
    '--kind', 'wedding',
    '--json',
  ], {cwd: repository}), 'documented scaffold-project form');
  assertEqual(first.project, project, 'documented form should default to repository projects/<kebab-name>');
  assertEqual(first.id, 'sample-wedding', 'project ID should be kebab case');
  assertEqual(first.kind, 'wedding', 'project kind');
  assertEqual(first.createdDirectories.length, 23, 'folder contract directory count');
  for (const relative of [
    'raw/video', 'raw/audio', 'broll',
    'audio/music', 'audio/sfx', 'audio/licenses',
    'assets/references', 'assets/generated', 'proxies', 'sync',
    'transcript', 'timeline', 'graphics-build', 'graphics-build/compositions',
    'reviews', 'reviews/frames', 'manifests',
    'outputs/interchange', 'outputs/review', 'outputs/delivery',
    'outputs/stems', 'outputs/graphics', 'outputs/captions',
  ]) {
    assert(fs.statSync(path.join(project, relative)).isDirectory(), `missing scaffold directory ${relative}`);
  }
  assert(!fs.existsSync(path.join(project, 'resolve')), 'scaffold must leave a Resolve-owned subtree untouched');
  assert(!fs.existsSync(path.join(project, 'outputs', 'final')), 'scaffold must not recreate obsolete outputs/final');
  const projectManifest = JSON.parse(fs.readFileSync(path.join(project, 'project.json'), 'utf8'));
  assertEqual(projectManifest.id, 'sample-wedding', 'project manifest ID');
  assertEqual(projectManifest.title, 'Sample Wedding', 'project manifest title');
  assertEqual(projectManifest.kind, 'wedding', 'project manifest kind');
  assertEqual(projectManifest.brand, 'brand.md', 'project manifest should prefer the project-local brand');
  assertEqual(projectManifest.graphicsBackend, 'hyperframes', 'project graphics backend');
  assert(Array.isArray(projectManifest.deliverables), 'project deliverables must be explicit array');
  const projectReadme = fs.readFileSync(path.join(project, 'README.md'), 'utf8');
  assert(projectReadme.includes('Status: setup required'), 'project README should declare inactive setup state');
  assert(projectReadme.includes('--verify-source-hashes'), 'project README should document checksum-verified portable handoff');
  assert(fs.readFileSync(path.join(project, 'brand.md'), 'utf8').includes('Status: incomplete'), 'project-local brand placeholder');
  assert(fs.statSync(path.join(project, 'audio', 'licenses', 'licenses.json')).isFile(), 'durable audio license manifest');
  const hyperframesConfig = JSON.parse(fs.readFileSync(path.join(project, 'graphics-build', 'hyperframes.json'), 'utf8'));
  assertEqual(hyperframesConfig.paths.blocks, 'compositions', 'starter HyperFrames composition path');
  assert(fs.readFileSync(path.join(project, 'graphics-build', 'index.html'), 'utf8').includes('data-no-timeline'), 'blank HyperFrames workspace should skip timeline polling');
  assert(fs.readFileSync(path.join(project, 'graphics-build', 'README.md'), 'utf8').includes('not an approved composition'), 'graphics README should keep the starter non-deliverable');
  const timeline = JSON.parse(fs.readFileSync(path.join(project, 'timeline', 'timeline.json'), 'utf8'));
  assertEqual(timeline.videoTracks.length, 4, 'starter timeline video track count');
  assertEqual(timeline.audioTracks.length, 5, 'starter timeline audio track count');
  assertEqual(timeline.captionTracks.length, 1, 'starter timeline caption track count');
  const starterRelink = JSON.parse(fs.readFileSync(path.join(project, 'timeline', 'relink-map.json'), 'utf8'));
  assertEqual(starterRelink.$schema, 'relink-map.schema.json', 'starter relink map schema reference');
  assertEqual(starterRelink.status, 'awaiting-ingest', 'starter relink status');
  assertEqual(starterRelink.missingMedia.length, 0, 'starter missing-media record');
  const relinkSchema = JSON.parse(fs.readFileSync(path.join(project, 'timeline', 'relink-map.schema.json'), 'utf8'));
  assertEqual(relinkSchema.additionalProperties, false, 'relink map root must reject unknown fields');
  assert(relinkSchema.required.includes('$schema') && relinkSchema.required.includes('missingMedia'), 'relink schema required fields');
  assertEqual(relinkSchema.properties.status.enum.join(','), 'awaiting-ingest,ready,stale,error', 'relink status vocabulary');
  for (const collection of ['sources', 'derivatives']) {
    const entrySchema = relinkSchema.properties[collection].items;
    assertEqual(entrySchema.additionalProperties, false, `${collection} entries must be exact`);
    assertEqual(entrySchema.required.sort().join(','), 'path,sha256', `${collection} required fields`);
  }
  const missingSchema = relinkSchema.properties.missingMedia.items;
  assertEqual(missingSchema.additionalProperties, false, 'missingMedia entries must be exact');
  assertEqual(missingSchema.required.sort().join(','), 'path,reason', 'missingMedia required fields');
  assert(missingSchema.properties.reason.enum.includes('hash-mismatch'), 'missingMedia reason vocabulary');
  const relinkPathPattern = new RegExp(relinkSchema.properties.sources.items.properties.path.pattern, 'u');
  assert(relinkPathPattern.test('raw/video/A001.MOV'), 'relink schema should accept a safe project-relative path');
  for (const unsafe of ['/absolute.mov', '../escape.mov', 'raw//double.mov', 'C:/drive.mov', 'raw\\windows.mov']) {
    assert(!relinkPathPattern.test(unsafe), `relink schema should reject unsafe path ${unsafe}`);
  }
  for (const stage of ['ingest', 'sync', 'transcription', 'story-edit', 'graphics', 'generated-assets', 'finishing', 'qa', 'export']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'manifests', `${stage}.json`), 'utf8'));
    assertEqual(manifest.stage, stage, `starter ${stage} manifest stage`);
    assertEqual(manifest.projectId, 'sample-wedding', `starter ${stage} manifest project ID`);
  }

  const brief = path.join(project, 'creative-brief.md');
  fs.writeFileSync(brief, 'user-owned edit\n');
  const second = parseJsonOutput(runCli('scaffold-project.mjs', [
    '--name', 'Sample Wedding',
    '--kind', 'wedding',
    '--json',
  ], {cwd: repository}), 'idempotent scaffold-project');
  assert(second.preservedFiles.includes('creative-brief.md'), 'existing starter file should be reported as preserved');
  assertEqual(fs.readFileSync(brief, 'utf8'), 'user-owned edit\n', 'default scaffold must not overwrite');

  const third = parseJsonOutput(runCli('scaffold-project.mjs', [
    '--name', 'Sample Wedding',
    '--kind', 'wedding',
    '--overwrite',
    '--json',
  ], {cwd: repository}), 'overwrite scaffold-project');
  assert(third.overwrittenFiles.includes('creative-brief.md'), 'explicit overwrite should be reported');
  assert(!fs.readFileSync(brief, 'utf8').includes('user-owned edit'), 'explicit overwrite should replace starter');

  const explicitProject = path.join(tempRoot, 'explicit-documentary');
  const explicit = parseJsonOutput(runCli('scaffold-project.mjs', [
    '--project', explicitProject,
    '--name', 'A Documentary',
    '--kind', 'documentary',
    '--json',
  ], {cwd: tempRoot}), 'explicit scaffold project');
  assertEqual(explicit.project, explicitProject, 'explicit --project must be preserved');
  assertEqual(JSON.parse(fs.readFileSync(path.join(explicitProject, 'project.json'), 'utf8')).kind, 'documentary', 'explicit project kind');

  const backwardCompatibleProject = path.join(tempRoot, 'legacy-explicit');
  const backwardCompatible = parseJsonOutput(runCli('scaffold-project.mjs', [
    '--project', backwardCompatibleProject,
    '--json',
  ], {cwd: tempRoot}), 'backward-compatible explicit project');
  assertEqual(backwardCompatible.kind, 'wedding', 'legacy explicit --project should retain safe wedding default');
  runCliFailure('scaffold-project.mjs', ['--name', 'Bad Kind', '--kind', 'commercial', '--json'], {cwd: repository});

  const unsafeRepository = path.join(tempRoot, 'unsafe-repository');
  const unsafeMarker = path.join(unsafeRepository, '.agents', 'skills', 'edit-video', 'SKILL.md');
  const outsideProjects = path.join(tempRoot, 'outside-projects');
  fs.mkdirSync(path.dirname(unsafeMarker), {recursive: true});
  fs.writeFileSync(unsafeMarker, '---\nname: edit-video\n---\n');
  fs.mkdirSync(outsideProjects);
  fs.symlinkSync(outsideProjects, path.join(unsafeRepository, 'projects'), 'dir');
  runCliFailure('scaffold-project.mjs', ['--name', 'Escaped Project', '--kind', 'documentary', '--json'], {cwd: unsafeRepository});
  assertEqual(fs.readdirSync(outsideProjects).length, 0, 'automatic scaffold must not traverse a symlinked projects root');

  const linkedProject = path.join(tempRoot, 'linked-project');
  fs.symlinkSync(project, linkedProject, 'dir');
  runCliFailure('scaffold-project.mjs', ['--project', linkedProject, '--kind', 'wedding', '--json'], {cwd: tempRoot});

  const unsafeProject = path.join(tempRoot, 'unsafe-project');
  const outsideRaw = path.join(tempRoot, 'outside-raw');
  fs.mkdirSync(unsafeProject);
  fs.mkdirSync(outsideRaw);
  fs.symlinkSync(outsideRaw, path.join(unsafeProject, 'raw'), 'dir');
  runCliFailure('scaffold-project.mjs', ['--project', unsafeProject, '--kind', 'wedding', '--json'], {cwd: tempRoot});
  assertEqual(fs.readdirSync(outsideRaw).length, 0, 'scaffold must not traverse a symlinked contract directory');
  return project;
}

function testProbe(tempRoot, fakeBin, project) {
  const media = path.join(tempRoot, 'source video.mp4');
  const inventory = path.join(tempRoot, 'inventory', 'source.json');
  fs.writeFileSync(media, 'fake media bytes');
  const result = runCli('probe-media.mjs', [
    '--input', media,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--output', inventory,
  ], {cwd: tempRoot});
  const report = parseJsonOutput(result, 'probe-media');
  assertEqual(report.schemaVersion, 2, 'versioned inventory schema');
  assertEqual(report.container.durationSeconds, 10, 'normalized duration');
  assertEqual(report.container.timecode, '01:00:00:00', 'container timecode');
  assertEqual(report.source.sizeBytes, Buffer.byteLength('fake media bytes'), 'source stat size');
  assert(typeof report.source.modifiedTimeUtc === 'string', 'source mtime should be durable UTC text');
  assertEqual(report.source.sha256, null, 'hashing should be opt-in');
  assertEqual(report.streams.length, 2, 'normalized stream count');
  assertEqual(report.streams[0].rFrameRate, '30000/1001', 'exact r_frame_rate');
  assertEqual(report.streams[0].avgFrameRate, '30000/1001', 'exact avg_frame_rate');
  assertEqual(report.streams[0].timeBase, '1/30000', 'exact video timebase');
  assertEqual(report.streams[0].frameCount, 300, 'video frame count');
  assertEqual(report.streams[0].fieldOrder, 'progressive', 'video field order');
  assertEqual(report.streams[0].sampleAspectRatio, '1:1', 'video SAR');
  assertEqual(report.streams[0].displayAspectRatio, '16:9', 'video DAR');
  assertEqual(report.streams[0].colorPrimaries, 'bt709', 'video color primaries');
  assertEqual(report.streams[1].sampleRate, 48000, 'audio sample rate');
  assertEqual(report.streams[1].channelLayout, 'stereo', 'audio channel layout');
  assert(!JSON.stringify(report).includes('must-not-persist'), 'arbitrary stream tags must not persist');
  assert(!JSON.stringify(report).includes('private-arbitrary-tag'), 'arbitrary container tags must not persist');
  assert(fs.statSync(inventory).isFile(), 'probe output file should be written');
  runCliFailure('probe-media.mjs', [
    '--input', media,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--output', inventory,
  ], {cwd: tempRoot});
  const hardLinkOutput = path.join(tempRoot, 'input-hard-link.json');
  fs.linkSync(media, hardLinkOutput);
  runCliFailure('probe-media.mjs', [
    '--input', media,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--output', hardLinkOutput,
    '--overwrite',
  ], {cwd: tempRoot});
  assertEqual(fs.readFileSync(media, 'utf8'), 'fake media bytes', 'probe output must not overwrite a hard link to input');

  const projectMedia = [
    ['raw/video/A001.MOV', 'camera'],
    ['raw/video/corrupt.mp4', 'broken camera file'],
    ['raw/audio/recorder.wav', 'recorder'],
    ['broll/nested/clip.mp4', 'broll'],
    ['audio/music/song.mp3', 'music'],
    ['audio/sfx/hit.wav', 'sfx'],
    ['assets/references/photo.jpg', 'reference'],
    ['assets/generated/texture.mp4', 'generated'],
  ];
  for (const [relative, contents] of projectMedia) {
    const target = path.join(project, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, contents);
  }
  fs.writeFileSync(path.join(project, 'raw', 'video', 'notes.txt'), 'not media');
  const nestedCacheMedia = path.join(project, 'broll', 'cache', 'excluded-cache.mp4');
  fs.mkdirSync(path.dirname(nestedCacheMedia), {recursive: true});
  fs.writeFileSync(nestedCacheMedia, 'excluded cache');
  const outsideSymlinkTarget = path.join(tempRoot, 'outside-symlink-target.mp4');
  fs.writeFileSync(outsideSymlinkTarget, 'must not be followed');
  fs.symlinkSync(outsideSymlinkTarget, path.join(project, 'raw', 'video', 'linked.mp4'));
  for (const relative of [
    'outputs/review/excluded.mp4',
    'proxies/excluded.mp4',
    'graphics-build/compositions/excluded.mp4',
  ]) {
    fs.writeFileSync(path.join(project, relative), 'excluded derivative');
  }

  const durableInventory = path.join(project, 'manifests', 'media-inventory.v2.json');
  const projectResult = runCliUnchecked('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--output', durableInventory,
  ], {cwd: tempRoot});
  assertEqual(projectResult.status, 1, 'project inventory should fail when one media file cannot be probed');
  const projectReport = parseJsonOutput(projectResult, 'project media inventory');
  assertEqual(projectReport.mediaFileCount, 8, 'project media candidate count');
  assertEqual(projectReport.probeSucceeded, 7, 'project successful probe count');
  assertEqual(projectReport.probeFailed, 1, 'project failed probe count');
  assert(projectReport.failures.some((failure) => failure.path === 'raw/video/corrupt.mp4' && failure.phase === 'probe'), 'per-file probe failure must be explicit');
  assert(projectReport.skipped.some((entry) => entry.path === 'raw/video/notes.txt'), 'non-media file must be reported as skipped');
  assert(projectReport.skipped.some((entry) => entry.path === 'raw/video/linked.mp4' && entry.reason === 'symbolic-link-not-followed'), 'media symlink must be reported and not followed');
  assert(projectReport.skipped.some((entry) => entry.path === 'broll/cache' && entry.reason === 'excluded-derived-or-cache-directory'), 'nested caches must be reported and not scanned');
  for (const excluded of ['outputs/review/excluded.mp4', 'proxies/excluded.mp4', 'graphics-build/compositions/excluded.mp4']) {
    assert(!projectReport.files.some((entry) => entry.input === excluded), `excluded derivative must not be probed: ${excluded}`);
  }
  assert(projectReport.files.every((entry) => !path.isAbsolute(entry.input)), 'durable project inventory inputs must be project-relative');
  assert(!JSON.stringify(projectReport).includes(project), 'durable project JSON must not contain an absolute project path');
  assert(!fs.existsSync(durableInventory), 'failed project inventory must not persist a partial artifact');
  const forbiddenInventory = path.join(project, 'raw', 'video', 'inventory.json');
  runCliFailure('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--output', forbiddenInventory,
  ], {cwd: tempRoot});
  assert(!fs.existsSync(forbiddenInventory), 'project inventory must not be written into immutable source areas');

  fs.unlinkSync(path.join(project, 'raw', 'video', 'corrupt.mp4'));
  const manifestsBeforeNoOutput = fs.readdirSync(path.join(project, 'manifests')).sort();
  const successfulProject = parseJsonOutput(runCli('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
  ], {cwd: tempRoot}), 'successful project media inventory');
  assertEqual(successfulProject.ok, true, 'project inventory should pass after removing corrupt fixture');
  assertEqual(successfulProject.complete, true, 'all scaffolded source areas should be scanned');
  assertEqual(successfulProject.probeSucceeded, 7, 'successful project probe count');
  assertEqual(JSON.stringify(fs.readdirSync(path.join(project, 'manifests')).sort()), JSON.stringify(manifestsBeforeNoOutput), 'project mode without --output must not write a default inventory');

  runCliFailure('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--write-relink',
  ], {cwd: tempRoot});

  const originalRelink = fs.readFileSync(path.join(project, 'timeline', 'relink-map.json'), 'utf8');
  runCliFailure('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--hash',
    '--output', durableInventory,
    '--write-relink',
  ], {cwd: tempRoot});
  assert(!fs.existsSync(durableInventory), 'multi-artifact preflight must prevent a partial inventory write');
  assertEqual(fs.readFileSync(path.join(project, 'timeline', 'relink-map.json'), 'utf8'), originalRelink, 'failed multi-artifact write must preserve relink map');

  const hashed = parseJsonOutput(runCli('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--hash',
    '--output', durableInventory,
    '--write-relink',
    '--overwrite',
  ], {cwd: tempRoot}), 'hashed project inventory and relink');
  assertEqual(hashed.hashAlgorithm, 'sha256', 'project hash algorithm');
  assert(hashed.files.every((entry) => /^[a-f0-9]{64}$/u.test(entry.source.sha256)), 'every source should have an explicit SHA-256');
  const persistedInventory = JSON.parse(fs.readFileSync(durableInventory, 'utf8'));
  assertEqual(persistedInventory.schemaVersion, 2, 'persisted inventory schema version');
  assert(!JSON.stringify(persistedInventory).includes(project), 'persisted inventory must not include absolute project paths');
  const relink = JSON.parse(fs.readFileSync(path.join(project, 'timeline', 'relink-map.json'), 'utf8'));
  assertEqual(relink.$schema, 'relink-map.schema.json', 'written relink map should retain the local schema reference');
  assertEqual(relink.hashAlgorithm, 'sha256', 'canonical relink algorithm');
  assertEqual(relink.sources.length, 7, 'canonical relink source count');
  assert(relink.sources.every((entry) => Object.keys(entry).sort().join(',') === 'path,sha256'), 'relink entries should use only canonical path and sha256 fields');
  assert(relink.sources.every((entry) => !path.isAbsolute(entry.path) && /^[a-f0-9]{64}$/u.test(entry.sha256)), 'relink entries should be project-relative and hashed');
  const cameraRelink = relink.sources.find((entry) => entry.path === 'raw/video/A001.MOV');
  assertEqual(cameraRelink.sha256, createHash('sha256').update('camera').digest('hex'), 'relink SHA-256 should match source bytes');

  const staleRelinkPath = path.join(project, 'timeline', 'relink-stale.json');
  fs.writeFileSync(staleRelinkPath, JSON.stringify({
    $schema: 'relink-map.schema.json',
    schemaVersion: 1,
    projectId: 'sample-wedding',
    status: 'stale',
    hashAlgorithm: 'sha256',
    pathPolicy: 'project-relative-forward-slashes',
    sources: [],
    derivatives: [],
    missingMedia: [{path: 'raw/video/absent-camera.mov', reason: 'not-found'}],
  }));
  runCli('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--hash',
    '--relink-output', staleRelinkPath,
    '--overwrite',
  ], {cwd: tempRoot});
  const staleRelink = JSON.parse(fs.readFileSync(staleRelinkPath, 'utf8'));
  assertEqual(staleRelink.status, 'stale', 'unresolved strict missingMedia entries should keep the relink map stale');
  assertEqual(JSON.stringify(staleRelink.missingMedia), JSON.stringify([{path: 'raw/video/absent-camera.mov', reason: 'not-found'}]), 'strict missingMedia shape should be preserved');

  const resolvedRelinkPath = path.join(project, 'timeline', 'relink-resolved.json');
  fs.writeFileSync(resolvedRelinkPath, JSON.stringify({
    $schema: 'relink-map.schema.json',
    schemaVersion: 1,
    projectId: 'sample-wedding',
    status: 'stale',
    hashAlgorithm: 'sha256',
    pathPolicy: 'project-relative-forward-slashes',
    sources: [],
    derivatives: [],
    missingMedia: [{path: 'raw/video/A001.MOV', reason: 'not-found'}],
  }));
  runCli('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--hash',
    '--relink-output', resolvedRelinkPath,
    '--overwrite',
  ], {cwd: tempRoot});
  const resolvedRelink = JSON.parse(fs.readFileSync(resolvedRelinkPath, 'utf8'));
  assertEqual(resolvedRelink.status, 'ready', 'a successfully re-probed missing source should restore ready status');
  assertEqual(resolvedRelink.missingMedia.length, 0, 'a successfully re-probed source should clear missingMedia');

  const invalidRelinkPath = path.join(project, 'timeline', 'relink-invalid.json');
  const invalidRelinkText = JSON.stringify({
    $schema: 'relink-map.schema.json',
    schemaVersion: 1,
    projectId: 'sample-wedding',
    status: 'stale',
    hashAlgorithm: 'sha256',
    pathPolicy: 'project-relative-forward-slashes',
    sources: [],
    derivatives: [],
    missingMedia: [{path: '../escape.mov', reason: 'not-found'}],
  });
  fs.writeFileSync(invalidRelinkPath, invalidRelinkText);
  runCliFailure('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--hash',
    '--relink-output', invalidRelinkPath,
    '--overwrite',
  ], {cwd: tempRoot});
  assertEqual(fs.readFileSync(invalidRelinkPath, 'utf8'), invalidRelinkText, 'invalid missingMedia path must fail without replacing the map');

  const conflictRelinkPath = path.join(project, 'timeline', 'relink-conflict.json');
  const conflictRelinkText = JSON.stringify({
    $schema: 'relink-map.schema.json',
    schemaVersion: 1,
    projectId: 'sample-wedding',
    status: 'stale',
    hashAlgorithm: 'sha256',
    pathPolicy: 'project-relative-forward-slashes',
    sources: [
      {path: 'raw/video/duplicate.mov', sha256: '0'.repeat(64)},
      {path: 'raw/video/duplicate.mov', sha256: '1'.repeat(64)},
    ],
    derivatives: [],
    missingMedia: [],
  });
  fs.writeFileSync(conflictRelinkPath, conflictRelinkText);
  runCliFailure('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--hash',
    '--relink-output', conflictRelinkPath,
    '--overwrite',
  ], {cwd: tempRoot});
  assertEqual(fs.readFileSync(conflictRelinkPath, 'utf8'), conflictRelinkText, 'conflicting duplicate relink paths must fail without replacement');

  runCliFailure('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--hash',
    '--output', durableInventory,
    '--write-relink',
  ], {cwd: tempRoot});

  const outsideArtifact = path.join(tempRoot, 'outside-inventory.json');
  runCliFailure('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--output', outsideArtifact,
  ], {cwd: tempRoot});
  assert(!fs.existsSync(outsideArtifact), 'project artifacts must remain inside the project');

  const linkedArtifactTarget = path.join(tempRoot, 'linked-artifact-target.json');
  fs.writeFileSync(linkedArtifactTarget, 'outside artifact sentinel');
  const linkedArtifact = path.join(project, 'manifests', 'linked-inventory.json');
  fs.symlinkSync(linkedArtifactTarget, linkedArtifact);
  runCliFailure('probe-media.mjs', [
    '--project', project,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--output', linkedArtifact,
    '--overwrite',
  ], {cwd: tempRoot});
  assertEqual(fs.readFileSync(linkedArtifactTarget, 'utf8'), 'outside artifact sentinel', 'artifact writes must not follow symlinks');
  return media;
}

function testDerivativeRegistration(tempRoot, fakeBin, scaffoldProject) {
  const repository = path.dirname(path.dirname(scaffoldProject));
  const project = path.join(repository, 'projects', 'derivative-fixture');
  const scaffold = parseJsonOutput(runCli('scaffold-project.mjs', [
    '--project', project,
    '--name', 'Derivative Fixture',
    '--kind', 'documentary',
    '--json',
  ], {cwd: repository}), 'derivative fixture scaffold');
  assertEqual(scaffold.id, 'derivative-fixture', 'derivative fixture project ID');

  const sourcePath = path.join(project, 'raw', 'video', 'camera-a.mov');
  const derivativePath = path.join(project, 'proxies', 'camera-a-proxy.mp4');
  fs.writeFileSync(sourcePath, 'immutable source bytes');
  fs.writeFileSync(derivativePath, 'proxy revision one');
  const sourceEntry = {
    path: 'raw/video/camera-a.mov',
    sha256: createHash('sha256').update('immutable source bytes').digest('hex'),
  };
  const unresolvedEntry = {path: 'raw/video/missing-camera.mov', reason: 'not-found'};
  const relinkPath = path.join(project, 'timeline', 'relink-map.json');
  const starter = JSON.parse(fs.readFileSync(relinkPath, 'utf8'));
  const seeded = {
    ...starter,
    status: 'stale',
    sources: [sourceEntry],
    missingMedia: [unresolvedEntry],
  };
  fs.writeFileSync(relinkPath, `${JSON.stringify(seeded, null, 2)}\n`);

  const added = parseJsonOutput(runCli('register-derivative.mjs', [
    '--project', project,
    '--input', 'proxies/camera-a-proxy.mp4',
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
  ], {cwd: repository}), 'register derivative add');
  const firstHash = createHash('sha256').update('proxy revision one').digest('hex');
  assertEqual(added.action, 'added', 'new derivative action');
  assertEqual(added.written, true, 'new derivative should write the map');
  assertEqual(added.derivative.path, 'proxies/camera-a-proxy.mp4', 'derivative path should be project-relative');
  assertEqual(added.derivative.sha256, firstHash, 'derivative hash should match current bytes');
  assertEqual(added.media.streamCount, 2, 'derivative must be ffprobed before registration');
  const afterAdd = JSON.parse(fs.readFileSync(relinkPath, 'utf8'));
  assertEqual(afterAdd.status, 'stale', 'derivative registration must preserve relink status');
  assertEqual(JSON.stringify(afterAdd.sources), JSON.stringify([sourceEntry]), 'derivative registration must preserve sources');
  assertEqual(JSON.stringify(afterAdd.missingMedia), JSON.stringify([unresolvedEntry]), 'derivative registration must preserve unresolved media');
  assertEqual(JSON.stringify(afterAdd.derivatives), JSON.stringify([{path: 'proxies/camera-a-proxy.mp4', sha256: firstHash}]), 'canonical derivative entry');

  const beforeDuplicate = fs.readFileSync(relinkPath, 'utf8');
  runCliFailure('register-derivative.mjs', [
    '--project', project,
    '--input', derivativePath,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
  ], {cwd: repository});
  assertEqual(fs.readFileSync(relinkPath, 'utf8'), beforeDuplicate, 'duplicate registration without overwrite must preserve map bytes');

  fs.writeFileSync(derivativePath, 'proxy revision two');
  runCliFailure('register-derivative.mjs', [
    '--project', project,
    '--input', derivativePath,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
  ], {cwd: repository});
  assertEqual(fs.readFileSync(relinkPath, 'utf8'), beforeDuplicate, 'changed derivative without overwrite must preserve map bytes');
  const updated = parseJsonOutput(runCli('register-derivative.mjs', [
    '--project', project,
    '--input', derivativePath,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--overwrite',
  ], {cwd: repository}), 'register derivative overwrite');
  const secondHash = createHash('sha256').update('proxy revision two').digest('hex');
  assertEqual(updated.action, 'updated', 'explicit overwrite should update the same derivative path');
  assertEqual(updated.previousSha256, firstHash, 'overwrite should report prior hash');
  assertEqual(updated.derivative.sha256, secondHash, 'overwrite should record current hash');
  const afterUpdate = JSON.parse(fs.readFileSync(relinkPath, 'utf8'));
  assertEqual(JSON.stringify(afterUpdate.sources), JSON.stringify([sourceEntry]), 'overwrite must preserve sources');
  assertEqual(JSON.stringify(afterUpdate.missingMedia), JSON.stringify([unresolvedEntry]), 'overwrite must preserve missingMedia');

  const beforeNoop = fs.readFileSync(relinkPath, 'utf8');
  const unchanged = parseJsonOutput(runCli('register-derivative.mjs', [
    '--project', project,
    '--input', derivativePath,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--overwrite',
  ], {cwd: repository}), 'register derivative no-op');
  assertEqual(unchanged.action, 'unchanged', 'matching explicit overwrite should be an idempotent no-op');
  assertEqual(unchanged.written, false, 'matching explicit overwrite should not rewrite the map');
  assertEqual(fs.readFileSync(relinkPath, 'utf8'), beforeNoop, 'no-op overwrite must preserve map bytes');

  for (const unsafeInput of [sourcePath, path.join(tempRoot, 'outside-derivative.mp4')]) {
    if (!fs.existsSync(unsafeInput)) fs.writeFileSync(unsafeInput, 'outside bytes');
    runCliFailure('register-derivative.mjs', [
      '--project', project,
      '--input', unsafeInput,
      '--ffprobe', path.join(fakeBin, 'ffprobe'),
    ], {cwd: repository});
    assertEqual(fs.readFileSync(relinkPath, 'utf8'), beforeNoop, 'source-area or escaped input must not change relink map');
  }

  const outsideTarget = path.join(tempRoot, 'outside-symlink-target.mp4');
  fs.writeFileSync(outsideTarget, 'outside target');
  const linkedInput = path.join(project, 'proxies', 'linked-proxy.mp4');
  fs.symlinkSync(outsideTarget, linkedInput);
  runCliFailure('register-derivative.mjs', [
    '--project', project,
    '--input', linkedInput,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
  ], {cwd: repository});

  const hardLinkedSource = path.join(project, 'proxies', 'source-hard-link.mov');
  fs.linkSync(sourcePath, hardLinkedSource);
  runCliFailure('register-derivative.mjs', [
    '--project', project,
    '--input', hardLinkedSource,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
  ], {cwd: repository});
  assertEqual(fs.readFileSync(relinkPath, 'utf8'), beforeNoop, 'symlink and source hard-link failures must preserve map bytes');

  const linkedProject = path.join(tempRoot, 'linked-derivative-project');
  fs.symlinkSync(project, linkedProject, 'dir');
  runCliFailure('register-derivative.mjs', [
    '--project', linkedProject,
    '--input', derivativePath,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--overwrite',
  ], {cwd: repository});

  const invalidMap = {
    ...afterUpdate,
    sources: [sourceEntry, {...sourceEntry, sha256: 'f'.repeat(64)}],
  };
  const invalidText = `${JSON.stringify(invalidMap, null, 2)}\n`;
  fs.writeFileSync(relinkPath, invalidText);
  runCliFailure('register-derivative.mjs', [
    '--project', project,
    '--input', derivativePath,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--overwrite',
  ], {cwd: repository});
  assertEqual(fs.readFileSync(relinkPath, 'utf8'), invalidText, 'invalid source validation state must fail without rewriting the map');
  assert(!fs.readdirSync(path.dirname(relinkPath)).some((entry) => entry.includes('.tmp-')), 'failed derivative operations must not leave staging files');
}

function testGraphicsValidation(tempRoot) {
  const kinds = ['stat', 'card', 'screenshot', 'takeover', 'zoom', 'diagram', 'b-roll-slot', 'lower-third', 'title', 'end-card'];
  const items = kinds.map((kind, index) => ({
    id: `graphic-${index}`,
    start: index,
    end: index + 1,
    kind,
    direction: `Show ${kind}`,
    ...(index === 0 ? {notes: '', renderer: 'remotion', assetRefs: ['assets/references/example.png']} : {}),
  }));
  items.push({id: 'after-long-gap', start: 11.1, end: 12, kind: 'title', direction: 'Allowed gap over one second'});
  const validPath = path.join(tempRoot, 'valid-graphics-plan.json');
  fs.writeFileSync(validPath, JSON.stringify({schemaVersion: 1, timebase: 'seconds', items}));
  const valid = parseJsonOutput(runCli('validate-graphics-plan.mjs', ['--input', validPath, '--json'], {cwd: tempRoot}), 'valid graphics plan');
  assertEqual(valid.ok, true, 'all kinds, exact abutment, and >1 second gap should validate');

  const shortGapPath = path.join(tempRoot, 'short-gap-plan.json');
  fs.writeFileSync(shortGapPath, JSON.stringify({items: [
    {id: 'one', start: 0, end: 1, kind: 'title', direction: 'First'},
    {id: 'two', start: 1.5, end: 2, kind: 'card', direction: 'Second'},
  ]}));
  const invalidResult = runCliUnchecked('validate-graphics-plan.mjs', ['--input', shortGapPath, '--json'], {cwd: tempRoot});
  assertEqual(invalidResult.status, 1, 'short gap should be a validation failure');
  const invalid = parseJsonOutput(invalidResult, 'invalid graphics plan');
  assert(invalid.errors.some((error) => error.code === 'short-gap'), 'short gap error should be explicit');

  const badPlan = {items: [
    {id: 'same', start: 2, end: 4, kind: 'unknown', direction: ''},
    {id: 'same', start: 1, end: 3, kind: 'card', direction: 'Overlap', extra: true},
  ]};
  const badResult = runCliUnchecked('validate-graphics-plan.mjs', ['--input', '-', '--json'], {cwd: tempRoot, input: JSON.stringify(badPlan)});
  assertEqual(badResult.status, 1, 'invalid stdin plan should fail');
  const bad = parseJsonOutput(badResult, 'bad stdin graphics plan');
  for (const code of ['invalid-kind', 'duplicate-id', 'unsorted', 'overlap', 'unknown-field']) {
    assert(bad.errors.some((error) => error.code === code), `expected ${code} error`);
  }
  return validPath;
}

function testFrameExtraction(tempRoot, fakeBin, media) {
  const frameDirectory = path.join(tempRoot, 'review frames');
  const framePlan = path.join(tempRoot, 'frame-boundaries.json');
  fs.writeFileSync(framePlan, JSON.stringify({items: [
    {id: 'opening-title', start: 2, end: 4},
    {id: 'lower-third', start: 6, end: 8},
  ]}));
  const result = runCli('extract-review-frames.mjs', [
    '--input', media,
    '--output-dir', frameDirectory,
    '--interval', '4',
    '--graphics-plan', framePlan,
    '--neighbor-offset', '0.25',
    '--ffmpeg', path.join(fakeBin, 'ffmpeg'),
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--json',
  ], {cwd: tempRoot});
  const report = parseJsonOutput(result, 'extract-review-frames');
  assertEqual(report.boundaryCount, 4, 'graphics-plan starts and ends should become boundaries');
  assert(report.frameCount > 3, 'boundary-neighbor samples should augment interval samples');
  assert(report.frames.some((frame) => frame.reasons.some((reason) => reason.endsWith(':before'))), 'before-boundary frame missing');
  assert(report.frames.some((frame) => frame.reasons.some((reason) => reason.endsWith(':exact'))), 'exact-boundary frame missing');
  assert(report.frames.some((frame) => frame.reasons.some((reason) => reason.endsWith(':after'))), 'after-boundary frame missing');
  for (const frame of report.frames) {
    assert(fs.statSync(frame.file).isFile(), `missing extracted frame ${frame.file}`);
  }
  runCliFailure('extract-review-frames.mjs', [
    '--input', media,
    '--output-dir', frameDirectory,
    '--duration', '10',
    '--ffmpeg', path.join(fakeBin, 'ffmpeg'),
    '--json',
  ], {cwd: tempRoot});
}

function testPromotion(tempRoot, fakeBin, project) {
  const notVideo = path.join(project, 'graphics-build', 'compositions', 'not-video.mp4');
  fs.writeFileSync(notVideo, 'plain text is not a video');
  runCliFailure('promote-final.mjs', [
    '--project', project,
    '--input', notVideo,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--json',
  ], {cwd: tempRoot});

  const candidate = path.join(project, 'graphics-build', 'compositions', 'wedding-film.mp4');
  fs.writeFileSync(candidate, 'fake fixture bytes accepted only by the isolated ffprobe test double');
  const rawSentinel = path.join(project, 'raw', 'video', 'A001.mp4');
  fs.writeFileSync(rawSentinel, 'irreplaceable raw');

  const dryRun = parseJsonOutput(runCli('promote-final.mjs', [
    '--project', project,
    '--input', candidate,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--json',
  ], {cwd: tempRoot}), 'promote dry run');
  assertEqual(dryRun.dryRun, true, 'promotion should default to dry run');
  assertEqual(dryRun.action, 'blocked', 'dry run should report unmet gates without copying');
  assertEqual(dryRun.ok, false, 'unapproved dry run should be marked not ready');
  assertEqual(dryRun.media.verifiedVideoStreamCount, 1, 'ffprobe should prove a non-empty video stream');
  assertEqual(dryRun.approvalGates.gates.filter((gate) => !gate.passed).length, 3, 'all initial approval gates should be unmet');
  assert(!fs.existsSync(dryRun.destination), 'dry run must not create final');

  const blockedApply = runCliUnchecked('promote-final.mjs', [
    '--project', project,
    '--input', candidate,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--apply',
    '--json',
  ], {cwd: tempRoot});
  assertEqual(blockedApply.status, 1, 'apply must fail closed when approval gates are unmet');
  assert(!fs.existsSync(dryRun.destination), 'blocked apply must not create final');

  const exportManifestPath = path.join(project, 'manifests', 'export.json');
  const exportManifest = JSON.parse(fs.readFileSync(exportManifestPath, 'utf8'));
  exportManifest.status = 'approved';
  exportManifest.approval.status = 'approved';
  fs.writeFileSync(exportManifestPath, JSON.stringify(exportManifest));
  const qaPath = path.join(project, 'reviews', 'qa-report.json');
  const renderSha256 = createHash('sha256').update(fs.readFileSync(candidate)).digest('hex');
  const timelineSha256 = createHash('sha256').update(fs.readFileSync(path.join(project, 'timeline', 'timeline.json'))).digest('hex');
  fs.writeFileSync(qaPath, JSON.stringify({
    schemaVersion: 1,
    projectId: 'sample-wedding',
    status: 'passed',
    renderSha256,
    timelineSha256,
    earlySpotReview: {status: 'pass', findings: []},
    technicalPass: {status: 'pass', findings: []},
    editorialCompositionPass: {status: 'approved', findings: []},
    openIssues: [],
  }));
  const approvalsPath = path.join(project, 'reviews', 'approval-log.json');
  fs.writeFileSync(approvalsPath, JSON.stringify({
    schemaVersion: 1,
    projectId: 'sample-wedding',
    approvals: [{id: 'final-export-approval', scope: 'final-delivery', status: 'approved', renderSha256, timelineSha256, approver: 'self-test', timestamp: '2026-08-16T00:00:00.000Z'}],
  }));

  const readyDryRun = parseJsonOutput(runCli('promote-final.mjs', [
    '--project', project,
    '--input', candidate,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--json',
  ], {cwd: tempRoot}), 'approved promote dry run');
  assertEqual(readyDryRun.action, 'would-copy', 'approved dry run should plan a copy');
  assertEqual(readyDryRun.ok, true, 'approved dry run should be ready');

  const correctQa = fs.readFileSync(qaPath, 'utf8');
  const staleQa = JSON.parse(correctQa);
  staleQa.renderSha256 = '0'.repeat(64);
  fs.writeFileSync(qaPath, JSON.stringify(staleQa));
  const stale = parseJsonOutput(runCli('promote-final.mjs', [
    '--project', project, '--input', candidate,
    '--ffprobe', path.join(fakeBin, 'ffprobe'), '--json',
  ], {cwd: tempRoot}), 'stale render approval');
  assertEqual(stale.ok, false, 'QA for another render cannot authorize this delivery');
  fs.writeFileSync(qaPath, correctQa);

  const applied = parseJsonOutput(runCli('promote-final.mjs', [
    '--project', project,
    '--input', candidate,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--apply',
    '--json',
  ], {cwd: tempRoot}), 'promote apply');
  assertEqual(applied.action, 'copied', 'apply should copy candidate');
  assertEqual(fs.readFileSync(applied.destination, 'utf8'), 'fake fixture bytes accepted only by the isolated ffprobe test double', 'promoted contents');
  assert(fs.existsSync(candidate), 'promotion must preserve source render');
  assertEqual(fs.readFileSync(rawSentinel, 'utf8'), 'irreplaceable raw', 'promotion must preserve raw');

  const newerDraft = path.join(project, 'outputs', 'review', 'newer-review.mp4');
  const newerFinal = path.join(project, 'outputs', 'delivery', 'newer-sibling.mp4');
  fs.writeFileSync(newerDraft, 'newer draft');
  fs.writeFileSync(newerFinal, 'newer final');
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(newerDraft, future, future);
  fs.utimesSync(newerFinal, future, future);
  const again = parseJsonOutput(runCli('promote-final.mjs', [
    '--project', project,
    '--input', candidate,
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--apply',
    '--json',
  ], {cwd: tempRoot}), 'repeat promotion');
  assertEqual(again.action, 'already-promoted', 'identical destination should be safe no-op');
  assert(fs.existsSync(newerDraft) && fs.existsSync(newerFinal), 'promotion must preserve newer outputs');

  const linkedFinal = path.join(project, 'outputs', 'delivery', 'linked-final.mp4');
  fs.symlinkSync(newerFinal, linkedFinal);
  runCliFailure('promote-final.mjs', [
    '--project', project,
    '--input', candidate,
    '--name', 'linked-final.mp4',
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--json',
  ], {cwd: tempRoot});

  const conflicting = path.join(project, 'graphics-build', 'compositions', 'different.mp4');
  fs.writeFileSync(conflicting, 'different render');
  runCliFailure('promote-final.mjs', [
    '--project', project,
    '--input', conflicting,
    '--name', 'wedding-film.mp4',
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--apply',
    '--json',
  ], {cwd: tempRoot});
  assertEqual(fs.readFileSync(applied.destination, 'utf8'), 'fake fixture bytes accepted only by the isolated ffprobe test double', 'conflicting final must not be overwritten');
  runCliFailure('promote-final.mjs', [
    '--project', project,
    '--input', conflicting,
    '--name', '../escape.mp4',
    '--ffprobe', path.join(fakeBin, 'ffprobe'),
    '--apply',
    '--json',
  ], {cwd: tempRoot});
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (process.argv.length > 2) {
    process.stderr.write(`Error: unknown argument ${process.argv[2]}\n`);
    return 2;
  }

  const tempRoot = fs.mkdtempSync(TEST_PREFIX);
  let failure = null;
  let completed = 0;
  try {
    const fakeBin = path.join(tempRoot, 'bin');
    installFakeMediaTools(fakeBin);
    const tests = [
      ['help surfaces', () => testHelp(tempRoot)],
      ['environment check', () => testEnvironment(tempRoot, fakeBin)],
      ['project scaffold', () => {}],
    ];

    for (const [name, test] of tests.slice(0, 2)) {
      test();
      completed += 1;
      process.stdout.write(`ok ${completed} - ${name}\n`);
    }

    const project = testScaffold(tempRoot);
    completed += 1;
    process.stdout.write(`ok ${completed} - project scaffold\n`);
    const media = testProbe(tempRoot, fakeBin, project);
    completed += 1;
    process.stdout.write(`ok ${completed} - media probe\n`);
    testDerivativeRegistration(tempRoot, fakeBin, project);
    completed += 1;
    process.stdout.write(`ok ${completed} - derivative registration safety\n`);
    testGraphicsValidation(tempRoot);
    completed += 1;
    process.stdout.write(`ok ${completed} - graphics validation\n`);
    testFrameExtraction(tempRoot, fakeBin, media);
    completed += 1;
    process.stdout.write(`ok ${completed} - review frame extraction\n`);
    testPromotion(tempRoot, fakeBin, project);
    completed += 1;
    process.stdout.write(`ok ${completed} - final promotion safety\n`);
  } catch (error) {
    failure = error;
  } finally {
    const normalizedTemp = path.resolve(tempRoot);
    const normalizedOsTemp = path.resolve(os.tmpdir());
    if (!normalizedTemp.startsWith(`${normalizedOsTemp}${path.sep}`) || !path.basename(normalizedTemp).startsWith('qs-video-self-test-')) {
      process.stderr.write(`Refusing unsafe self-test cleanup path: ${normalizedTemp}\n`);
      return 2;
    }
    fs.rmSync(normalizedTemp, {recursive: true, force: true});
  }

  if (failure) {
    process.stderr.write(`not ok ${completed + 1} - ${failure.stack ?? failure.message}\n`);
    return 1;
  }
  process.stdout.write(`1..${completed}\n`);
  process.stdout.write(`All ${completed} QS Video Editor helper tests passed; temporary fixtures were removed.\n`);
  return 0;
}

process.exitCode = main();
