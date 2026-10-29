#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  assertDirectory,
  CliError,
  findExecutable,
  firstLine,
  formatJson,
  parseArgs,
  printCliError,
  rejectPositionals,
  resolveUserPath,
} from './_shared.mjs';

const HELP = `\
Usage: node check-environment.mjs [options]

Read-only preflight for the local video workspace. Reports tools, pinned renderer
packages, FFmpeg capabilities, OS/architecture/free disk, and fixed-path macOS
editor installations. It never installs, launches, authenticates, or invokes npx.

Options:
  --project <dir>       Project/repository root used for local package discovery
                        and subprocess cwd (default: current directory).
  --require <tools>     Add required tools (repeatable or comma-separated).
                        Known names: node, ffmpeg, ffprobe, npm, python3.11, uv,
                        git-lfs, whisperx, hyperframes, remotion. ffmpeg and
                        ffprobe are required by default.
  --ffmpeg <path>       Explicit ffmpeg executable.
  --ffprobe <path>      Explicit ffprobe executable.
  --json                Emit JSON instead of a readable summary.
  -h, --help            Show this help.

Browser, Computer Use, image generation, installed plugins, source-backup
confirmation, and license completeness require session or human verification.
`;

const TOOL_DEFINITIONS = {
  node: {command: process.execPath, args: ['--version']},
  ffmpeg: {command: 'ffmpeg', args: ['-nostdin', '-version']},
  // ffprobe has no -nostdin option. Every child receives a disconnected stdin.
  ffprobe: {command: 'ffprobe', args: ['-version']},
  npm: {command: 'npm', args: ['--version']},
  'python3.11': {command: 'python3.11', args: ['--version']},
  uv: {command: 'uv', args: ['--version']},
  'git-lfs': {command: 'git-lfs', args: ['version']},
  whisperx: {command: 'whisperx', args: ['--version']},
  hyperframes: {command: 'hyperframes', args: ['--version']},
  // Remotion 4 exits nonzero for --version; --help is read-only and reports it.
  remotion: {command: 'remotion', args: ['--help']},
};

const MAC_APPLICATIONS = [
  {
    id: 'davinci-resolve',
    name: 'DaVinci Resolve',
    bundlePath: '/Applications/DaVinci Resolve/DaVinci Resolve.app',
  },
  {
    id: 'capcut',
    name: 'CapCut',
    bundlePath: '/Applications/CapCut.app',
  },
];

function splitTools(values = []) {
  return values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
}

function localExecutable(projectPath, relativeCandidates) {
  for (const relative of relativeCandidates) {
    const candidate = path.join(projectPath, ...relative);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Keep searching deterministic local paths.
    }
  }
  return null;
}

function candidateFor(tool, args, projectPath) {
  if (tool === 'ffmpeg' && args.ffmpeg) return args.ffmpeg;
  if (tool === 'ffprobe' && args.ffprobe) return args.ffprobe;
  const packageRoot = findPackageRoot(projectPath);
  const searchRoots = [...new Set([projectPath, packageRoot].filter(Boolean))];
  if (tool === 'hyperframes') {
    const local = searchRoots.map((root) => localExecutable(root, [
      ['node_modules', '.bin', 'hyperframes'],
    ])).find(Boolean);
    if (local) return local;
  }
  if (tool === 'whisperx') {
    const local = searchRoots.map((root) => localExecutable(root, [
      ['.venv', 'bin', 'whisperx'],
      ['.venv', 'Scripts', 'whisperx.exe'],
    ])).find(Boolean);
    if (local) return local;
  }
  if (tool === 'remotion') {
    const local = searchRoots.map((root) => localExecutable(root, [
      ['node_modules', '.bin', 'remotion'],
      ['renderers', 'remotion', 'node_modules', '.bin', 'remotion'],
    ])).find(Boolean);
    if (local) return local;
  }
  return TOOL_DEFINITIONS[tool].command;
}

function spawnReadOnly(executable, commandArgs, cwd, maxBuffer = 8 * 1024 * 1024) {
  return spawnSync(executable, commandArgs, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    maxBuffer,
  });
}

function inspectTool(tool, required, args, projectPath) {
  const definition = TOOL_DEFINITIONS[tool];
  const requested = candidateFor(tool, args, projectPath);
  const executable = tool === 'node' ? process.execPath : findExecutable(requested);
  if (!executable) {
    return {name: tool, required, available: false, requested};
  }

  const result = spawnReadOnly(executable, definition.args, projectPath, 4 * 1024 * 1024);
  if (result.error || result.status !== 0) {
    return {
      name: tool,
      required,
      available: false,
      executable,
      error: result.error?.message ?? (firstLine(result.stderr || result.stdout) || `exit status ${result.status}`),
    };
  }
  return {
    name: tool,
    required,
    available: true,
    executable,
    version: firstLine(result.stdout || result.stderr),
  };
}

function inspectFfmpegCapabilities(ffmpegTool, projectPath) {
  if (!ffmpegTool?.available) return {available: false};
  const queries = {
    hardwareAcceleration: ['-nostdin', '-hide_banner', '-hwaccels'],
    encoders: ['-nostdin', '-hide_banner', '-encoders'],
    filters: ['-nostdin', '-hide_banner', '-filters'],
  };
  const output = {};
  const errors = [];
  for (const [key, queryArgs] of Object.entries(queries)) {
    const result = spawnReadOnly(ffmpegTool.executable, queryArgs, projectPath, 16 * 1024 * 1024);
    if (result.error || result.status !== 0) {
      errors.push({probe: key, error: result.error?.message ?? (firstLine(result.stderr || result.stdout) || `exit status ${result.status}`)});
    } else {
      output[key] = result.stdout || result.stderr || '';
    }
  }

  const acceleration = (output.hardwareAcceleration ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.endsWith(':'));
  const encoders = output.encoders ?? '';
  const filters = output.filters ?? '';
  const encoderNames = ['libx264', 'libx265', 'prores_ks', 'aac', 'h264_videotoolbox', 'hevc_videotoolbox'];
  const filterNames = ['drawtext', 'ass', 'subtitles', 'zscale', 'vidstabdetect', 'vidstabtransform', 'loudnorm'];
  const hasListedName = (text, name) => new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(\\s|$)`, 'mu').test(text);
  return {
    available: true,
    probesOk: errors.length === 0,
    hardwareAcceleration: acceleration,
    encoderCount: encoders.split(/\r?\n/u).filter((line) => /^\s*[A-Z.]{6}\s+\S+/u.test(line)).length,
    selectedEncoders: Object.fromEntries(encoderNames.map((name) => [name, hasListedName(encoders, name)])),
    filterCount: filters.split(/\r?\n/u).filter((line) => /^\s*[TSC.]{2,3}\s+\S+/u.test(line)).length,
    selectedFilters: Object.fromEntries(filterNames.map((name) => [name, hasListedName(filters, name)])),
    errors,
  };
}

function jsonFileOrNull(target) {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

function findPackageRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function inspectHyperframesPackage(projectPath, hyperframesTool) {
  const packageRoot = findPackageRoot(projectPath);
  if (!packageRoot) {
    return {packageRoot: null, declared: null, locked: null, installed: null, exactPin: false, consistent: false, doctorCommandAvailable: false};
  }
  const packageManifest = jsonFileOrNull(path.join(packageRoot, 'package.json')) ?? {};
  const lockManifest = jsonFileOrNull(path.join(packageRoot, 'package-lock.json')) ?? {};
  const installedManifest = jsonFileOrNull(path.join(packageRoot, 'node_modules', 'hyperframes', 'package.json')) ?? {};
  const declared = packageManifest.devDependencies?.hyperframes
    ?? packageManifest.dependencies?.hyperframes
    ?? packageManifest.optionalDependencies?.hyperframes
    ?? null;
  const locked = lockManifest.packages?.['node_modules/hyperframes']?.version ?? null;
  const installed = installedManifest.version ?? null;
  const exactPin = typeof declared === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(declared);
  let doctorCommandAvailable = false;
  let doctorProbeError = null;
  if (hyperframesTool?.available) {
    const result = spawnReadOnly(hyperframesTool.executable, ['doctor', '--help'], packageRoot, 4 * 1024 * 1024);
    doctorCommandAvailable = !result.error && result.status === 0;
    if (!doctorCommandAvailable) {
      doctorProbeError = result.error?.message ?? (firstLine(result.stderr || result.stdout) || `exit status ${result.status}`);
    }
  }
  return {
    packageRoot,
    declared,
    locked,
    installed,
    exactPin,
    consistent: Boolean(exactPin && locked && installed && declared === locked && locked === installed),
    doctorCommandAvailable,
    ...(doctorProbeError ? {doctorProbeError} : {}),
  };
}

function plistString(infoPlist, key) {
  const plutil = '/usr/bin/plutil';
  if (fs.existsSync(plutil)) {
    const result = spawnReadOnly(plutil, ['-extract', key, 'raw', '-o', '-', infoPlist], path.dirname(infoPlist), 1024 * 1024);
    if (!result.error && result.status === 0) return (result.stdout ?? '').trim() || null;
  }
  try {
    const xml = fs.readFileSync(infoPlist, 'utf8');
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return xml.match(new RegExp(`<key>\\s*${escapedKey}\\s*</key>\\s*<string>([^<]+)</string>`, 'u'))?.[1] ?? null;
  } catch {
    return null;
  }
}

function inspectApplications() {
  if (process.platform !== 'darwin') {
    return MAC_APPLICATIONS.map((application) => ({
      ...application,
      platform: 'darwin',
      status: 'not-applicable',
      installed: false,
      version: null,
    }));
  }
  return MAC_APPLICATIONS.map((application) => {
    const infoPlist = path.join(application.bundlePath, 'Contents', 'Info.plist');
    let installed = false;
    try {
      installed = fs.statSync(application.bundlePath).isDirectory() && fs.statSync(infoPlist).isFile();
    } catch {
      installed = false;
    }
    return {
      ...application,
      platform: 'darwin',
      infoPlist,
      status: installed ? 'installed' : 'not-installed',
      installed,
      version: installed
        ? (plistString(infoPlist, 'CFBundleShortVersionString') ?? plistString(infoPlist, 'CFBundleVersion'))
        : null,
      inspection: 'fixed-bundle-path-info-plist-read-only',
    };
  });
}

function bytesValue(value) {
  const bigint = typeof value === 'bigint' ? value : BigInt(value);
  return bigint <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bigint) : bigint.toString();
}

function inspectSystem(projectPath) {
  const system = {
    platform: os.platform(),
    release: os.release(),
    version: os.version(),
    architecture: os.arch(),
    cpuCount: os.cpus().length,
    memoryTotalBytes: bytesValue(os.totalmem()),
    memoryFreeBytes: bytesValue(os.freemem()),
  };
  let disk;
  try {
    const stat = fs.statfsSync(projectPath);
    const blockSize = BigInt(stat.bsize);
    const freeBytes = BigInt(stat.bavail) * blockSize;
    const totalBytes = BigInt(stat.blocks) * blockSize;
    disk = {
      path: projectPath,
      freeBytes: bytesValue(freeBytes),
      freeGiB: Math.round((Number(freeBytes) / (1024 ** 3)) * 100) / 100,
      totalBytes: bytesValue(totalBytes),
      totalGiB: Math.round((Number(totalBytes) / (1024 ** 3)) * 100) / 100,
    };
  } catch (error) {
    disk = {path: projectPath, error: error.message};
  }
  return {system, disk};
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ['help', 'json'],
    values: ['project', 'ffmpeg', 'ffprobe'],
    repeatable: ['require'],
  });
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  rejectPositionals(args);

  const projectPath = resolveUserPath(args.project ?? process.cwd(), {label: 'project path'});
  assertDirectory(projectPath, 'project path');
  const requestedRequired = splitTools(args.require);
  const unknown = requestedRequired.filter((tool) => !Object.hasOwn(TOOL_DEFINITIONS, tool));
  if (unknown.length > 0) {
    throw new CliError(`Unknown required tool${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`);
  }

  const required = new Set(['ffmpeg', 'ffprobe', ...requestedRequired]);
  const tools = Object.keys(TOOL_DEFINITIONS).map((tool) => inspectTool(tool, required.has(tool), args, projectPath));
  const toolByName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  const missingRequired = tools.filter((tool) => tool.required && !tool.available).map((tool) => tool.name);
  const {system, disk} = inspectSystem(projectPath);
  const report = {
    schemaVersion: 1,
    ok: missingRequired.length === 0,
    project: projectPath,
    system,
    disk,
    tools,
    ffmpegCapabilities: inspectFfmpegCapabilities(toolByName.ffmpeg, projectPath),
    hyperframesPackage: inspectHyperframesPackage(projectPath, toolByName.hyperframes),
    applications: inspectApplications(),
    humanChecks: [
      {name: 'independent-source-backup', status: 'confirm-before-editing'},
      {name: 'font-availability-and-rights', status: 'verify-for-selected-style'},
      {name: 'music-and-asset-licenses', status: 'verify-in-project-manifests'},
    ],
    codexRuntimeCapabilities: [
      {name: 'in-app-browser', status: 'verify-in-current-session'},
      {name: 'computer-use', status: 'verify-in-current-session'},
      {name: 'image-generation', status: 'verify-in-current-session'},
      {name: 'installed-skills-and-plugins', status: 'verify-in-current-session'},
    ],
    missingRequired,
  };

  if (args.json) {
    process.stdout.write(formatJson(report));
  } else {
    process.stdout.write(`Video editing environment: ${report.ok ? 'ready' : 'missing requirements'}\n`);
    process.stdout.write(`  system    ${system.platform} ${system.architecture} ${system.release}\n`);
    if (disk.freeGiB !== undefined) process.stdout.write(`  disk      ${disk.freeGiB} GiB free of ${disk.totalGiB} GiB at ${disk.path}\n`);
    for (const tool of tools) {
      const marker = tool.available ? 'ok' : (tool.required ? 'MISSING' : 'optional');
      const detail = tool.available ? ` — ${tool.version || tool.executable}` : '';
      process.stdout.write(`  ${marker.padEnd(8)} ${tool.name}${detail}\n`);
    }
    for (const application of report.applications) {
      const detail = application.installed ? `installed — ${application.version ?? 'version unavailable'}` : application.status;
      process.stdout.write(`  app       ${application.name}: ${detail}\n`);
    }
    const pin = report.hyperframesPackage;
    process.stdout.write(`  package   HyperFrames declared=${pin.declared ?? 'none'} locked=${pin.locked ?? 'none'} installed=${pin.installed ?? 'none'} exact=${pin.exactPin}\n`);
    process.stdout.write('  session   Browser, Computer Use, image generation, plugins, backup, fonts, and licenses need session/human checks.\n');
  }
  return report.ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.exitCode = printCliError(error, {json: process.argv.includes('--json')});
}
