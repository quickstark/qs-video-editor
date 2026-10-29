#!/usr/bin/env node

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {resolveUserPath} from './_shared.mjs';

// The installed skill may live outside the workspace. Never derive a virtual
// environment or cache location from the skill's installation depth.
const forwarded = process.argv.slice(2);
let requestedWorkspace = process.env.EDIT_VIDEO_WORKSPACE;
if (forwarded[0] === '--workspace') {
  forwarded.shift();
  requestedWorkspace = forwarded.shift();
  if (!requestedWorkspace || requestedWorkspace.startsWith('--')) {
    process.stderr.write('Missing directory after --workspace\n');
    process.exit(2);
  }
  if (forwarded[0] === '--') forwarded.shift();
}
let repositoryRoot = requestedWorkspace ? resolveUserPath(requestedWorkspace) : process.cwd();
if (!requestedWorkspace) {
  while (!(fs.existsSync(path.join(repositoryRoot, 'pyproject.toml'))
      && fs.existsSync(path.join(repositoryRoot, 'package.json')))) {
    const parent = path.dirname(repositoryRoot);
    if (parent === repositoryRoot) {
      process.stderr.write('No video workspace found. Pass --workspace <directory> or set EDIT_VIDEO_WORKSPACE.\n');
      process.exit(2);
    }
    repositoryRoot = parent;
  }
}
if (!fs.existsSync(path.join(repositoryRoot, 'pyproject.toml'))) {
  process.stderr.write('Workspace is missing pyproject.toml; bootstrap it before transcription.\n');
  process.exit(2);
}

function executableFile(target) {
  try {
    fs.accessSync(target, fs.constants.X_OK);
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

const executableCandidates = process.platform === 'win32'
  ? [path.join(repositoryRoot, '.venv', 'Scripts', 'whisperx.exe')]
  : [path.join(repositoryRoot, '.venv', 'bin', 'whisperx')];
const executable = executableCandidates.find(executableFile);

if (!executable) {
  process.stderr.write(`WhisperX is not installed in ${repositoryRoot}. From that workspace run: npm run video:python:sync\n`);
  process.exitCode = 1;
} else {
  const env = {...process.env};
  // Keep the locked virtual environment isolated from user-site packages.
  env.PYTHONNOUSERSITE = '1';
  const cacheRoot = path.join(repositoryRoot, '.cache', 'whisperx');
  const cachePaths = {
    HF_HOME: path.join(cacheRoot, 'huggingface'),
    TORCH_HOME: path.join(cacheRoot, 'torch'),
    MPLCONFIGDIR: path.join(cacheRoot, 'matplotlib'),
    XDG_CACHE_HOME: path.join(cacheRoot, 'xdg'),
    NLTK_DATA: path.join(cacheRoot, 'nltk'),
  };
  for (const [name, target] of Object.entries(cachePaths)) {
    env[name] ??= target;
    fs.mkdirSync(env[name], {recursive: true});
  }

  // Do not inject keg-only FFmpeg libraries into this process. PyAV bundles
  // its own FFmpeg build, while WhisperX preloads audio into memory before
  // pyannote VAD/diarization. Mixing both dylib families can crash macOS.
  const result = spawnSync(executable, forwarded, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    process.stderr.write(`Unable to start WhisperX: ${result.error.message}\n`);
    process.exitCode = 1;
  } else if (result.signal) {
    process.stderr.write(`WhisperX stopped by signal ${result.signal}\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
