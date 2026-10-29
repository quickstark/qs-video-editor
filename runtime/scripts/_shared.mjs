import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

export class CliError extends Error {
  constructor(message, exitCode = 2, details = undefined) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function parseArgs(argv, {booleans = [], values = [], repeatable = []} = {}) {
  const booleanSet = new Set(booleans);
  const valueSet = new Set(values);
  const repeatableSet = new Set(repeatable);
  const allowed = new Set([...booleanSet, ...valueSet, ...repeatableSet]);
  const result = {_: []};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      result._.push(...argv.slice(index + 1));
      break;
    }
    if (token === '-h') {
      result.help = true;
      continue;
    }
    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }

    const equalsIndex = token.indexOf('=');
    const key = token.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
    if (!allowed.has(key)) {
      throw new CliError(`Unknown option: --${key}`);
    }

    if (booleanSet.has(key)) {
      if (equalsIndex !== -1) {
        throw new CliError(`Option --${key} does not take a value`);
      }
      result[key] = true;
      continue;
    }

    let value;
    if (equalsIndex !== -1) {
      value = token.slice(equalsIndex + 1);
    } else {
      index += 1;
      value = argv[index];
    }
    if (value === undefined || value === '') {
      throw new CliError(`Option --${key} requires a value`);
    }

    if (repeatableSet.has(key)) {
      result[key] ??= [];
      result[key].push(value);
    } else {
      if (Object.hasOwn(result, key)) {
        throw new CliError(`Option --${key} may only be provided once`);
      }
      result[key] = value;
    }
  }

  return result;
}

export function rejectPositionals(args) {
  if (args._.length > 0) {
    throw new CliError(`Unexpected positional argument: ${args._[0]}`);
  }
}

export function requireOption(args, key) {
  if (!Object.hasOwn(args, key)) {
    throw new CliError(`Missing required option: --${key}`);
  }
  return args[key];
}

export function resolveUserPath(value, {base = process.cwd(), label = 'path'} = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CliError(`${label} must be a non-empty path`);
  }
  if (value.includes('\0')) {
    throw new CliError(`${label} contains a NUL byte`);
  }

  let expanded = value;
  if (value === '~') {
    expanded = os.homedir();
  } else if (value.startsWith(`~${path.sep}`)) {
    expanded = path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(base, expanded);
}

export function assertNotFilesystemRoot(target, label = 'path') {
  const parsed = path.parse(target);
  if (path.normalize(target) === path.normalize(parsed.root)) {
    throw new CliError(`Refusing to use the filesystem root as ${label}: ${target}`);
  }
}

export function assertInside(parent, child, label = 'path') {
  const relative = path.relative(parent, child);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return;
  }
  throw new CliError(`${label} escapes the allowed root: ${child}`);
}

export function assertRegularFile(target, label = 'file') {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new CliError(`${label} does not exist: ${target}`);
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new CliError(`${label} is not a regular file: ${target}`);
  }
  return stat;
}

export function assertDirectory(target, label = 'directory') {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new CliError(`${label} does not exist: ${target}`);
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    throw new CliError(`${label} is not a directory: ${target}`);
  }
  return stat;
}

export function refuseSymlink(target, label = 'path') {
  try {
    if (fs.lstatSync(target).isSymbolicLink()) {
      throw new CliError(`Refusing symbolic-link ${label}: ${target}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

export function refuseSymlinkChain(root, target, label = 'path') {
  assertInside(root, target, label);
  refuseSymlink(root, label);
  const relative = path.relative(root, target);
  if (!relative) return;
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new CliError(`Refusing symbolic-link component in ${label}: ${current}`);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

export function pathsReferToSameFile(left, right) {
  try {
    const leftStat = fs.statSync(left);
    const rightStat = fs.statSync(right);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export function parseFiniteNumber(value, label, {minimum = -Infinity, exclusiveMinimum = false} = {}) {
  if (!((typeof value === 'number') || (typeof value === 'string' && value.trim() !== ''))) {
    throw new CliError(`${label} must be a finite number`);
  }
  const number = Number(value);
  const tooSmall = exclusiveMinimum ? number <= minimum : number < minimum;
  if (!Number.isFinite(number) || tooSmall) {
    const relation = exclusiveMinimum ? 'greater than' : 'at least';
    throw new CliError(`${label} must be a finite number ${relation} ${minimum}`);
  }
  return number;
}

export function findExecutable(command, {base = process.cwd(), env = process.env} = {}) {
  if (typeof command !== 'string' || command.trim() === '') {
    return null;
  }

  if (command.includes(path.sep) || (path.sep === '\\' && command.includes('/'))) {
    const candidate = resolveUserPath(command, {base, label: 'executable'});
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      return null;
    }
    return null;
  }

  const extensions = process.platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return null;
}

export function runCommand(command, commandArgs, {
  cwd = process.cwd(),
  env = process.env,
  label = command,
  maxBuffer = 16 * 1024 * 1024,
} = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    maxBuffer,
  });
  if (result.error) {
    throw new CliError(`Could not run ${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    const stdout = (result.stdout ?? '').trim();
    const detail = stderr || stdout || `exit status ${result.status}`;
    throw new CliError(`${label} failed: ${detail}`, 1);
  }
  return result;
}

export function readJsonFile(target, label = 'JSON file') {
  assertRegularFile(target, label);
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CliError(`${label} is not valid JSON: ${error.message}`);
    }
    throw error;
  }
}

export function writeTextFile(target, content, {overwrite = false, makeParents = true} = {}) {
  const parent = path.dirname(target);
  if (makeParents) {
    fs.mkdirSync(parent, {recursive: true});
  }
  refuseSymlink(target, 'output file');
  try {
    fs.writeFileSync(target, content, {encoding: 'utf8', flag: overwrite ? 'w' : 'wx'});
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new CliError(`Output already exists (use an explicit overwrite option if supported): ${target}`);
    }
    throw error;
  }
}

export function formatJson(value, pretty = true) {
  return `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`;
}

export function firstLine(value) {
  return String(value ?? '').split(/\r?\n/u).find((line) => line.trim() !== '')?.trim() ?? '';
}

export function printCliError(error, {json = false} = {}) {
  const normalized = error instanceof CliError
    ? error
    : new CliError(error?.message ?? String(error), 1);
  if (json) {
    process.stderr.write(formatJson({
      ok: false,
      error: normalized.message,
      ...(normalized.details === undefined ? {} : {details: normalized.details}),
    }));
  } else {
    process.stderr.write(`Error: ${normalized.message}\n`);
  }
  return normalized.exitCode;
}
