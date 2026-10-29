#!/usr/bin/env node

import fs from 'node:fs';
import {
  CliError,
  formatJson,
  parseArgs,
  printCliError,
  rejectPositionals,
  requireOption,
  resolveUserPath,
} from './_shared.mjs';

const HELP = `\
Usage: node validate-graphics-plan.mjs --input <graphics-plan.json> [options]

Validate the deterministic graphics-plan schema and timeline invariants.

Options:
  --input <file|->      Plan JSON file, or - for stdin (required).
  --json                Emit a machine-readable validation report.
  -h, --help            Show this help.

Each item requires: id, start, end, kind, direction.
Optional fields: notes, renderer, assetRefs.
Allowed kinds: stat, card, screenshot, takeover, zoom, diagram, b-roll-slot,
lower-third, title, end-card.

Items must be sorted by start time and must not overlap. Consecutive items may
abut exactly (within 0.000001 seconds) or have a gap greater than 1 second;
positive gaps of 1 second or less are invalid.
`;

const ALLOWED_KINDS = [
  'stat',
  'card',
  'screenshot',
  'takeover',
  'zoom',
  'diagram',
  'b-roll-slot',
  'lower-third',
  'title',
  'end-card',
];
const ALLOWED_KIND_SET = new Set(ALLOWED_KINDS);
const REQUIRED_FIELDS = ['id', 'start', 'end', 'kind', 'direction'];
const OPTIONAL_FIELDS = ['notes', 'renderer', 'assetRefs'];
const ALLOWED_FIELDS = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
const ABUT_EPSILON_SECONDS = 1e-6;

function issue(code, path, message) {
  return {code, path, message};
}

function validateString(value, fieldPath, errors, {allowEmpty = false} = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    errors.push(issue('invalid-string', fieldPath, 'must be a non-empty string'));
    return false;
  }
  return true;
}

function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return [issue('invalid-plan', '$', 'must be a JSON object')];
  }
  if (plan.schemaVersion !== undefined && plan.schemaVersion !== 1) {
    errors.push(issue('unsupported-schema-version', '$.schemaVersion', 'must equal 1 when present'));
  }
  if (plan.timebase !== undefined && plan.timebase !== 'seconds') {
    errors.push(issue('invalid-timebase', '$.timebase', 'must equal "seconds" when present'));
  }
  if (!Array.isArray(plan.items)) {
    errors.push(issue('missing-items', '$.items', 'must be an array'));
    return errors;
  }

  const seenIds = new Map();
  let previous = null;
  for (let index = 0; index < plan.items.length; index += 1) {
    const item = plan.items[index];
    const itemPath = `$.items[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(issue('invalid-item', itemPath, 'must be an object'));
      previous = null;
      continue;
    }

    for (const field of REQUIRED_FIELDS) {
      if (!Object.hasOwn(item, field)) {
        errors.push(issue('missing-field', `${itemPath}.${field}`, 'is required'));
      }
    }
    for (const field of Object.keys(item)) {
      if (!ALLOWED_FIELDS.has(field)) {
        errors.push(issue('unknown-field', `${itemPath}.${field}`, 'is not an allowed graphics item field'));
      }
    }

    if (Object.hasOwn(item, 'id') && validateString(item.id, `${itemPath}.id`, errors)) {
      if (seenIds.has(item.id)) {
        errors.push(issue('duplicate-id', `${itemPath}.id`, `duplicates ${seenIds.get(item.id)}`));
      } else {
        seenIds.set(item.id, `${itemPath}.id`);
      }
    }

    const startValid = typeof item.start === 'number' && Number.isFinite(item.start);
    const endValid = typeof item.end === 'number' && Number.isFinite(item.end);
    if (Object.hasOwn(item, 'start') && !startValid) {
      errors.push(issue('invalid-start', `${itemPath}.start`, 'must be a finite number of seconds'));
    } else if (startValid && item.start < 0) {
      errors.push(issue('negative-start', `${itemPath}.start`, 'must be at least 0'));
    }
    if (Object.hasOwn(item, 'end') && !endValid) {
      errors.push(issue('invalid-end', `${itemPath}.end`, 'must be a finite number of seconds'));
    }
    if (startValid && endValid && item.end <= item.start) {
      errors.push(issue('invalid-range', `${itemPath}.end`, 'must be greater than start'));
    }

    if (Object.hasOwn(item, 'kind')) {
      if (!validateString(item.kind, `${itemPath}.kind`, errors) || !ALLOWED_KIND_SET.has(item.kind)) {
        if (typeof item.kind === 'string' && item.kind.trim() !== '' && !ALLOWED_KIND_SET.has(item.kind)) {
          errors.push(issue('invalid-kind', `${itemPath}.kind`, `must be one of: ${ALLOWED_KINDS.join(', ')}`));
        }
      }
    }
    if (Object.hasOwn(item, 'direction')) {
      validateString(item.direction, `${itemPath}.direction`, errors);
    }
    if (Object.hasOwn(item, 'notes')) {
      validateString(item.notes, `${itemPath}.notes`, errors, {allowEmpty: true});
    }
    if (Object.hasOwn(item, 'renderer')) {
      validateString(item.renderer, `${itemPath}.renderer`, errors);
    }
    if (Object.hasOwn(item, 'assetRefs')) {
      if (!Array.isArray(item.assetRefs)) {
        errors.push(issue('invalid-asset-refs', `${itemPath}.assetRefs`, 'must be an array of non-empty strings'));
      } else {
        item.assetRefs.forEach((assetRef, assetIndex) => {
          validateString(assetRef, `${itemPath}.assetRefs[${assetIndex}]`, errors);
        });
      }
    }

    const timingValid = startValid && endValid && item.start >= 0 && item.end > item.start;
    if (timingValid && previous) {
      if (item.start < previous.start - ABUT_EPSILON_SECONDS) {
        errors.push(issue('unsorted', `${itemPath}.start`, `must not be earlier than ${previous.path}.start`));
      }
      const gap = item.start - previous.end;
      if (gap < -ABUT_EPSILON_SECONDS) {
        errors.push(issue('overlap', `${itemPath}.start`, `overlaps ${previous.path} by ${Math.abs(gap)} seconds`));
      } else if (gap > ABUT_EPSILON_SECONDS && gap <= 1) {
        errors.push(issue('short-gap', `${itemPath}.start`, `gap after ${previous.path} is ${gap} seconds; it must abut or exceed 1 second`));
      }
    }
    previous = timingValid ? {start: item.start, end: item.end, path: itemPath} : null;
  }
  return errors;
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ['help', 'json'],
    values: ['input'],
  });
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  rejectPositionals(args);

  const requestedInput = requireOption(args, 'input');
  let source;
  let inputLabel;
  if (requestedInput === '-') {
    source = fs.readFileSync(0, 'utf8');
    inputLabel = '<stdin>';
  } else {
    const inputPath = resolveUserPath(requestedInput, {label: 'graphics plan path'});
    inputLabel = inputPath;
    try {
      source = fs.readFileSync(inputPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new CliError(`Graphics plan does not exist: ${inputPath}`);
      }
      throw error;
    }
  }

  let plan;
  try {
    plan = JSON.parse(source);
  } catch (error) {
    throw new CliError(`Graphics plan is not valid JSON: ${error.message}`);
  }
  const errors = validatePlan(plan);
  const report = {
    ok: errors.length === 0,
    input: inputLabel,
    itemCount: Array.isArray(plan?.items) ? plan.items.length : 0,
    allowedKinds: ALLOWED_KINDS,
    timing: {
      abutToleranceSeconds: ABUT_EPSILON_SECONDS,
      allowedPositiveGapSeconds: '> 1',
    },
    errors,
  };

  if (args.json) {
    process.stdout.write(formatJson(report));
  } else if (report.ok) {
    process.stdout.write(`Valid graphics plan: ${report.itemCount} item${report.itemCount === 1 ? '' : 's'}\n`);
  } else {
    process.stdout.write(`Invalid graphics plan: ${errors.length} error${errors.length === 1 ? '' : 's'}\n`);
    for (const error of errors) {
      process.stdout.write(`  ${error.path}: ${error.message} [${error.code}]\n`);
    }
  }
  return report.ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.exitCode = printCliError(error, {json: process.argv.includes('--json')});
}
