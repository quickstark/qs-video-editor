#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  assertInside,
  assertNotFilesystemRoot,
  CliError,
  formatJson,
  parseArgs,
  printCliError,
  refuseSymlink,
  refuseSymlinkChain,
  rejectPositionals,
  resolveUserPath,
} from './_shared.mjs';

const HELP = `\
Usage:
  node scaffold-project.mjs --name <content-name> --kind <kind> [options]
  node scaffold-project.mjs --project <dir> [--name <name>] [--kind <kind>]

Create the durable edit-video project contract. With no --project, locate the
video repository from the current directory and create projects/<kebab-name>.

Options:
  --name <name>         Content name or project title. Required when --project
                        is omitted; converted safely to a kebab-case folder ID.
  --kind <kind>         wedding, documentary, or talking-head. Required for the
                        documented --name form; defaults to wedding only for
                        backward-compatible explicit --project calls.
  --project <dir>       Explicit project directory; disables automatic path.
  --overwrite           Replace only scaffold-owned starter files. Never delete
                        directories or unrecognized files.
  --json                Emit a JSON report.
  -h, --help            Show this help.

The scaffold preserves raw video/audio, separates B-roll, music/SFX/licenses, assets,
proxies, synchronization, transcript, timeline, graphics, review, manifests,
and interchange/review/delivery/stem/graphic/caption outputs. It does not create
or modify a Resolve-owned subtree.
`;

const ALLOWED_KINDS = new Set(['wedding', 'documentary', 'talking-head']);

const DIRECTORIES = [
  'raw/video',
  'raw/audio',
  'broll',
  'audio/music',
  'audio/sfx',
  'audio/licenses',
  'assets/references',
  'assets/generated',
  'proxies',
  'sync',
  'transcript',
  'timeline',
  'graphics-build',
  'graphics-build/compositions',
  'reviews',
  'reviews/frames',
  'manifests',
  'outputs/interchange',
  'outputs/review',
  'outputs/delivery',
  'outputs/stems',
  'outputs/graphics',
  'outputs/captions',
];

const STAGE_NAMES = [
  'ingest',
  'sync',
  'transcription',
  'story-edit',
  'graphics',
  'generated-assets',
  'finishing',
  'qa',
  'export',
];

const RESOLVE_AUDIO_TYPES = [
  'mono', 'stereo', 'lrc', 'lcr', 'lrcs', 'lcrs', 'quad',
  '5.0', '5.0film', '5.1', '5.1film', '7.0', '7.0film', '7.1', '7.1film',
  ...Array.from({length: 36}, (_, index) => `adaptive${index + 1}`),
];

function toKebabCase(value) {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/&/gu, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-');
  if (!slug) {
    throw new CliError('Project name must contain at least one letter or number');
  }
  if (slug.length > 80) {
    throw new CliError('Kebab-case project name must be 80 characters or fewer');
  }
  return slug;
}

function displayTitle(value, slug) {
  const trimmed = value?.trim();
  if (trimmed && !/^[a-z0-9-]+$/u.test(trimmed)) return trimmed;
  return slug.split('-').map((word, index) => {
    if (index > 0 && ['and', 'of', 'the', 'a', 'an'].includes(word)) return word;
    return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
  }).join(' ');
}

function findRepositoryRoot(start) {
  let current = path.resolve(start);
  while (true) {
    const localSkill = path.join(current, '.agents', 'skills', 'edit-video', 'SKILL.md');
    const workspaceContract = path.join(current, 'AGENTS.md');
    const packageManifest = path.join(current, 'package.json');
    if (fs.existsSync(localSkill) || (fs.existsSync(workspaceContract) && fs.existsSync(packageManifest))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new CliError('Could not locate the video repository from the current directory; pass --project explicitly');
}

function pathEntry(pathValue, role, required = true) {
  return {path: pathValue, role, required, status: 'pending'};
}

function stageManifest(projectId, stage) {
  const contracts = {
    ingest: {
      inputs: [pathEntry('raw/video', 'untouched-camera-originals'), pathEntry('raw/audio', 'untouched-recorder-originals', false)],
      outputs: [pathEntry('timeline/relink-map.json', 'checksum-and-relink-inventory'), pathEntry('proxies', 'regenerable-edit-proxies', false)],
    },
    sync: {
      inputs: [pathEntry('timeline/relink-map.json', 'ingested-source-inventory'), pathEntry('raw/audio', 'dedicated-audio-sources', false)],
      outputs: [pathEntry('sync/sync-map.json', 'multicamera-and-audio-sync-map'), pathEntry('timeline/timeline.json', 'source-referenced-track-layout')],
    },
    transcription: {
      inputs: [pathEntry('sync/sync-map.json', 'verified-synchronized-source-map')],
      outputs: [pathEntry('transcript/transcript.json', 'word-timed-source-transcript'), pathEntry('transcript/edited-transcript.json', 'cut-aligned-transcript')],
    },
    'story-edit': {
      inputs: [pathEntry('transcript/transcript.json', 'verified-source-transcript'), pathEntry('creative-brief.md', 'approved-story-and-privacy-direction')],
      outputs: [pathEntry('transcript/cutsheet.json', 'source-referenced-paper-edit'), pathEntry('timeline/timeline.json', 'editable-story-timeline')],
    },
    graphics: {
      inputs: [pathEntry('timeline/timeline.json', 'approved-story-timeline'), pathEntry('graphics-build/graphics-plan.json', 'validated-graphics-plan')],
      outputs: [pathEntry('graphics-build', 'durable-renderer-source'), pathEntry('outputs/graphics', 'separate-editor-friendly-graphics')],
    },
    'generated-assets': {
      inputs: [pathEntry('graphics-build/graphics-plan.json', 'approved-decorative-generation-slots', false)],
      outputs: [pathEntry('assets/generated', 'approved-decorative-assets-with-provenance', false)],
    },
    finishing: {
      inputs: [pathEntry('timeline/timeline.json', 'approved-edit-and-graphics-tracks'), pathEntry('audio/music', 'licensed-music', false), pathEntry('audio/sfx', 'sound-effects', false), pathEntry('audio/licenses', 'music-and-sfx-license-evidence', false)],
      outputs: [pathEntry('outputs/stems', 'separate-audio-stems'), pathEntry('outputs/captions', 'caption-sidecars', false)],
    },
    qa: {
      inputs: [pathEntry('timeline/timeline.json', 'current-editable-timeline'), pathEntry(`outputs/review/${projectId}-review.mp4`, 'timecoded-review-render')],
      outputs: [pathEntry('reviews/qa-report.json', 'timestamped-review-findings'), pathEntry('reviews/frames', 'targeted-local-review-frames')],
    },
    export: {
      inputs: [pathEntry('timeline/timeline.json', 'approved-editable-timeline'), pathEntry('reviews/qa-report.json', 'passing-qa-record'), pathEntry('reviews/approval-log.json', 'export-approval')],
      outputs: [
        pathEntry(`outputs/interchange/${projectId}-primary.drp`, 'primary-resolve-project'),
        pathEntry(`outputs/interchange/${projectId}-primary.drt`, 'primary-resolve-timeline'),
        pathEntry(`outputs/interchange/${projectId}-primary.otio`, 'portable-otio-interchange', false),
        pathEntry(`outputs/interchange/${projectId}.fcpxml`, 'portable-fcpxml-interchange', false),
        pathEntry('outputs/delivery', 'approved-deliverables'),
        pathEntry('outputs/stems', 'separate-audio-stems'),
      ],
    },
  };
  const skippedByDefault = stage === 'generated-assets';
  const requiresApproval = !skippedByDefault && ['story-edit', 'finishing', 'export'].includes(stage);
  return {
    $schema: 'stage-manifest.schema.json',
    schemaVersion: 1,
    projectId,
    stage,
    status: skippedByDefault ? 'skipped' : 'pending',
    updatedAt: null,
    requiresApproval,
    approval: {
      status: requiresApproval ? 'pending' : 'not-required',
      recordPath: 'reviews/approval-log.json',
    },
    ...contracts[stage],
    checks: [],
    decisions: [],
    data: skippedByDefault ? {enabled: false, items: [], enablementRequiresItemLevelApproval: true} : {},
    notes: skippedByDefault ? ['No generation is authorized. Enabling any item requires a new explicit approval record.'] : [],
  };
}

function timelineTemplate(projectId, title) {
  const track = (id, name, role) => ({id, name, role, enabled: true, locked: false, items: []});
  return {
    $schema: 'timeline.schema.json',
    schemaVersion: 1,
    projectId,
    timelineId: `${projectId}-primary`,
    name: `${title} — Primary Edit`,
    status: 'template',
    format: {
      width: null,
      height: null,
      pixelAspectRatio: null,
      frameRateNumerator: null,
      frameRateDenominator: null,
      dropFrame: null,
      selectionRule: 'probe-primary-camera-and-use-exact-rational-timebase',
    },
    startTimecode: '01:00:00:00',
    videoTracks: [
      track('V1', 'Primary Picture', 'primary-picture'),
      track('V2', 'Alternate Angle', 'alternate-angle'),
      track('V3', 'B-roll', 'broll'),
      track('V4', 'Graphics', 'graphics-with-alpha'),
    ],
    audioTracks: [
      track('A1', 'Dialogue Primary', 'dialogue-primary'),
      track('A2', 'Dialogue Backup', 'dialogue-backup'),
      track('A3', 'Ambience', 'ambience-and-room-tone'),
      track('A4', 'Music', 'licensed-music'),
      track('A5', 'Sound Effects', 'real-sfx'),
    ],
    captionTracks: [
      {...track('C1', 'Accessibility Captions', 'captions-optional'), enabled: false},
    ],
    graphicsItems: [],
    musicItems: [],
    captionItems: [],
    markers: [],
    reviewRender: {
      path: `outputs/review/${projectId}-review.mp4`,
      status: 'pending',
      burnInTimecode: true,
      sourceTimelineRevision: null,
    },
    interchange: {
      primaryFormat: 'DRP_DRT',
      primaryPath: `outputs/interchange/${projectId}.fcpxml`,
      fallbackFormat: 'EDL',
      fallbackPath: `outputs/interchange/${projectId}.edl`,
      nativeProjectPath: `outputs/interchange/${projectId}-primary.drp`,
      nativeTimelinePath: `outputs/interchange/${projectId}-primary.drt`,
      otioPath: `outputs/interchange/${projectId}-primary.otio`,
      resolveInstallStatus: 'unknown',
      resolveVersion: null,
      resolveScriptingStatus: 'unknown',
      validatedInResolve: false,
    },
  };
}

function creativeBrief(title, kind) {
  const weddingQuestions = kind === 'wedding'
    ? '\n- Couple names and exact on-screen styling:\n- Wedding date and venue:\n- Essential vows, readings, toasts, traditions, and relationships:\n'
    : '';
  return `# ${title} — Creative Brief\n\n> Status: incomplete. Resolve every required decision before editing.\n\n## Outcome and audience\n\n- Intended audience:\n- Story outcome:\n- Editorial tone:\n\n## Deliverables\n\n- Deliverable IDs and formats:\n- Target duration for each:\n- Aspect ratio and resolution for each:\n- Exact rational frame rate: determine after ingest\n\n## Required content\n\n- Mandatory moments, people, quotations, or topics:\n- Required opening and closing material:\n${weddingQuestions}\n## Exclusions and privacy\n\n- People or moments to exclude:\n- Sensitive/private sections:\n- External upload permission: not granted\n- Hosted transcription or generation permission: not granted\n\n## Language and accessibility\n\n- Verified names and pronunciations:\n- Caption requirements:\n- Languages:\n\n## Music, assets, and references\n\n- Licensed music and license records:\n- Reference films or visual direction:\n- Approved supplied assets:\n\n## Approval gates\n\n- [ ] Brief, deliverables, runtime, and aspect ratios approved\n- [ ] Story map approved before editorial compression\n- [ ] Any generated decorative asset approved individually\n- [ ] Review render approved before delivery promotion\n`;
}

function projectBrand(title) {
  return `# ${title} — Project Brand\n\n> Status: incomplete. This project-local file overrides the repository fallback. Fill it from approved references; do not invent project-specific facts or taste.\n\n## Story character\n\n- Emotional register:\n- Pacing and restraint:\n- Words the film should feel like:\n- Words the film should never feel like:\n\n## Visual system\n\n- Primary and supporting colors:\n- Typography and licensed font files:\n- Image treatment and grain:\n- Title, lower-third, and end-card behavior:\n- Safe zones and accessibility constraints:\n\n## Audio character\n\n- Dialogue and ambience priorities:\n- Licensed music direction:\n- Sound-effects restraint:\n\n## Approved references and exceptions\n\n- Reference paths or URLs intentionally supplied by the user:\n- One-project exceptions to the selected style:\n`;
}

function projectReadme(title, projectId, kind) {
  return `# ${title}\n\nStatus: setup required. This is a ${kind} project scaffold; no editing is authorized until the creative brief and privacy rules are complete.\n\n## First run\n\n1. From the repository root, restore and verify the locked environment:\n\n   npm run video:check\n\n   Enable graphics/transcription capabilities only when this job needs them.\n\n2. Complete creative-brief.md and brand.md.\n3. Copy, never move, source media into raw/video/ and raw/audio/.\n4. Confirm an independent backup of irreplaceable media.\n5. Build the first checksummed inventory and relink map:\n\n   npm run video:probe -- \\\n     --project projects/${projectId} \\\n     --hash \\\n     --output projects/${projectId}/manifests/media-inventory.v2.json \\\n     --write-relink \\\n     --overwrite\n\n6. Replace the unknown timeline format fields only with probed facts, then follow the edit-video skill stage gates.\n\n## Editable handoff\n\nDaVinci Resolve DRP/DRT is the primary editable package when a running scripting connection can export it. Keep picture, alternate angles, B-roll, graphics, dialogue, ambience, music, SFX, and captions separate. When Resolve scripting is unavailable, write checksum-verified portable OTIO/FCPXML plus the limited V1-only EDL without claiming DRP/DRT:\n\n   node .video-editor/run.mjs resolve \\\n     --timeline projects/${projectId}/timeline/timeline.json \\\n     --write-portable \\\n     --verify-source-hashes\n\nThe Resolve bridge and final promotion are dry-run or explicitly gated by default. Cleanup has no helper and remains a reviewed manual plan. Private media remains local unless an approval names the exact files and destination.\n`;
}

function hyperframesIndex(projectId, title) {
  const safeTitle = title
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  return `<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1920, height=1080">
    <title>${safeTitle} — graphics workspace</title>
    <style>
      * { box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; margin: 0; overflow: hidden; }
      body { background: #161616; color: #f2f0eb; font-family: system-ui, sans-serif; }
      #${projectId}-graphics-workspace {
        display: grid;
        width: 100%;
        height: 100%;
        place-items: center;
      }
      .notice { max-width: 980px; padding: 72px; text-align: center; }
      .notice strong { display: block; font-size: 52px; line-height: 1.08; }
      .notice span { display: block; margin-top: 24px; font-size: 24px; line-height: 1.4; }
    </style>
  </head>
  <body>
    <main id="${projectId}-graphics-workspace" data-composition-id="${projectId}-graphics-workspace" data-no-timeline data-width="1920" data-height="1080" data-start="0" data-duration="1" data-fps="30/1">
      <div class="notice">
        <strong>Graphics workspace</strong>
        <span>Not a deliverable. Approve graphics-plan.json, exact timebase, brand, and style before authoring.</span>
      </div>
    </main>
  </body>
</html>
`;
}

function graphicsReadme(projectId, title) {
  return `# ${title} — Graphics Build\n\nHyperFrames is the primary renderer. This scaffold is a valid blank review workspace, not an approved composition or deliverable. Keep the plan in graphics-plan.json and independently rerenderable parts in compositions/.\n\nFrom the repository root:\n\n   npm run video:graphics:validate -- --input projects/${projectId}/graphics-build/graphics-plan.json\n   npm run hyperframes:doctor\n   npm run hyperframes:lint -- projects/${projectId}/graphics-build\n   npm run hyperframes:check -- projects/${projectId}/graphics-build\n   npm run hyperframes:preview -- projects/${projectId}/graphics-build\n\nBefore a real render, replace the blank index only after reading DESIGN.md, the project brand, and the selected style. Use the exact rational timeline frame rate, keep overlays alpha-capable, add at least 0.5 seconds of tail when required, and place every render as a separate upper-track clip in the editable handoff.\n`;
}

function timelineSchema() {
  const safePath = {
    type: 'string',
    minLength: 1,
    pattern: '^(?!/)(?![A-Za-z]:[\\\\/])(?!.*(?:^|/)\\.\\.(?:/|$)).+',
  };
  const item = {
    type: 'object',
    additionalProperties: false,
    required: [
      'id', 'trackId', 'sourceId', 'sourcePath', 'sourceInFrame', 'sourceOutFrame',
      'timelineStartFrame', 'timelineEndFrame', 'enabled',
    ],
    properties: {
      id: {type: 'string', minLength: 1},
      name: {type: 'string'},
      trackId: {type: 'string', minLength: 1},
      sourceId: {type: ['string', 'null'], minLength: 1},
      sourcePath: safePath,
      sourceInFrame: {type: 'integer', minimum: 0},
      sourceOutFrame: {type: 'integer', minimum: 1},
      timelineStartFrame: {type: 'integer', minimum: 0},
      timelineEndFrame: {type: 'integer', minimum: 1},
      enabled: {type: 'boolean'},
      syncGroupId: {type: ['string', 'null']},
      notes: {type: 'array', items: {type: 'string'}},
    },
  };
  const trackProperties = {
    id: {type: 'string', minLength: 1},
    name: {type: 'string', minLength: 1},
    role: {type: 'string', minLength: 1},
    enabled: {type: 'boolean'},
    locked: {type: 'boolean'},
    items: {type: 'array', items: item},
  };
  const track = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'role', 'enabled', 'locked', 'items'],
    properties: trackProperties,
  };
  const audioTrack = {
    ...track,
    properties: {...trackProperties, audioType: {enum: RESOLVE_AUDIO_TYPES}},
    allOf: [
      {
        if: {properties: {items: {minItems: 1}}},
        then: {required: ['audioType']},
      },
    ],
  };
  const captionTrack = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'role', 'enabled', 'locked', 'items'],
    properties: {
      ...trackProperties,
      items: {type: 'array', items: {type: 'object'}},
    },
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Edit Video Neutral Timeline',
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion', 'projectId', 'timelineId', 'status', 'format', 'startTimecode',
      'videoTracks', 'audioTracks', 'captionTracks', 'graphicsItems', 'musicItems',
      'captionItems', 'markers', 'reviewRender', 'interchange',
    ],
    properties: {
      $schema: {type: 'string'},
      schemaVersion: {const: 1},
      projectId: {type: 'string', minLength: 1},
      timelineId: {type: 'string', minLength: 1},
      name: {type: 'string'},
      status: {enum: ['template', 'assembling', 'needs-review', 'approved', 'complete', 'blocked']},
      format: {
        type: 'object',
        additionalProperties: false,
        required: ['width', 'height', 'pixelAspectRatio', 'frameRateNumerator', 'frameRateDenominator', 'dropFrame', 'selectionRule'],
        properties: {
          width: {type: ['integer', 'null'], minimum: 1},
          height: {type: ['integer', 'null'], minimum: 1},
          pixelAspectRatio: {type: ['string', 'null']},
          frameRateNumerator: {type: ['integer', 'null'], minimum: 1},
          frameRateDenominator: {type: ['integer', 'null'], minimum: 1},
          dropFrame: {type: ['boolean', 'null']},
          selectionRule: {type: 'string', minLength: 1},
        },
      },
      startTimecode: {type: 'string', pattern: '^\\d{2}:\\d{2}:\\d{2}[:;]\\d{2}$'},
      videoTracks: {type: 'array', minItems: 1, items: track},
      audioTracks: {type: 'array', items: audioTrack},
      captionTracks: {type: 'array', items: captionTrack},
      graphicsItems: {type: 'array', items: item},
      musicItems: {type: 'array', items: item},
      captionItems: {type: 'array', items: {type: 'object'}},
      markers: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'frame', 'kind', 'label', 'status'],
          properties: {
            id: {type: 'string', minLength: 1},
            frame: {type: 'integer', minimum: 0},
            kind: {type: 'string', minLength: 1},
            label: {type: 'string'},
            status: {type: 'string', minLength: 1},
            notes: {type: 'array', items: {type: 'string'}},
          },
        },
      },
      reviewRender: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'status', 'burnInTimecode', 'sourceTimelineRevision'],
        properties: {
          path: safePath,
          status: {type: 'string', minLength: 1},
          burnInTimecode: {type: 'boolean'},
          sourceTimelineRevision: {type: ['integer', 'null'], minimum: 1},
        },
      },
      interchange: {
        type: 'object',
        additionalProperties: false,
        required: [
          'primaryFormat', 'primaryPath', 'fallbackFormat', 'fallbackPath',
          'nativeProjectPath', 'nativeTimelinePath', 'otioPath', 'resolveInstallStatus',
          'resolveVersion', 'resolveScriptingStatus', 'validatedInResolve',
        ],
        properties: {
          primaryFormat: {enum: ['DRP_DRT', 'FCPXML']},
          primaryPath: safePath,
          fallbackFormat: {const: 'EDL'},
          fallbackPath: safePath,
          nativeProjectPath: safePath,
          nativeTimelinePath: safePath,
          otioPath: safePath,
          resolveInstallStatus: {enum: ['unknown', 'not-installed', 'installed']},
          resolveVersion: {type: ['string', 'null']},
          resolveScriptingStatus: {enum: ['unknown', 'available', 'connection-unavailable-current-session', 'disabled', 'not-supported']},
          validatedInResolve: {type: 'boolean'},
        },
      },
    },
    description: 'JSON Schema checks shape and safe relative paths. The Resolve bridge additionally enforces equal half-open durations, track membership, collision rules, exact timing, relink hashes, and project containment.',
  };
}

function stageSchema() {
  const artifact = {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'role', 'required', 'status'],
    properties: {
      path: {type: 'string', minLength: 1},
      role: {type: 'string', minLength: 1},
      required: {type: 'boolean'},
      status: {enum: ['missing', 'pending', 'ready', 'generated', 'verified', 'skipped']},
    },
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Edit Video Stage Manifest',
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'projectId', 'stage', 'status', 'updatedAt', 'requiresApproval', 'approval', 'inputs', 'outputs', 'checks', 'decisions', 'data', 'notes'],
    properties: {
      $schema: {type: 'string'},
      schemaVersion: {const: 1},
      projectId: {type: 'string', minLength: 1},
      stage: {enum: STAGE_NAMES},
      status: {enum: ['pending', 'in-progress', 'needs-review', 'approved', 'complete', 'skipped', 'blocked']},
      updatedAt: {type: ['string', 'null'], format: 'date-time'},
      requiresApproval: {type: 'boolean'},
      approval: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'recordPath'],
        properties: {
          status: {enum: ['not-required', 'pending', 'approved', 'rejected']},
          recordPath: {type: 'string', minLength: 1},
        },
      },
      inputs: {type: 'array', items: artifact},
      outputs: {type: 'array', items: artifact},
      checks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'status'],
          properties: {
            id: {type: 'string', minLength: 1},
            status: {enum: ['pending', 'pass', 'fail', 'waived', 'not-applicable']},
            evidence: {type: ['string', 'null']},
          },
        },
      },
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'status', 'value'],
          properties: {
            id: {type: 'string', minLength: 1},
            status: {enum: ['provisional', 'confirmed', 'deferred', 'rejected']},
            value: {},
          },
        },
      },
      data: {type: 'object'},
      notes: {type: 'array', items: {type: 'string'}},
    },
  };
}

function relinkMapSchema() {
  const safeProjectPath = {
    type: 'string',
    minLength: 1,
    pattern: '^(?!/)(?![A-Za-z]:/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//)(?!.*\\\\)[^\\u0000]+$',
    description: 'Project-relative path with forward slashes, no empty/dot/parent segments, no drive prefix, and no NUL or backslash.',
  };
  const checksumEntry = {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'sha256'],
    properties: {
      path: safeProjectPath,
      sha256: {
        type: 'string',
        pattern: '^[A-Fa-f0-9]{64}$',
        description: 'Exactly 64 hexadecimal SHA-256 characters; writers canonicalize to lowercase.',
      },
    },
  };
  const missingMediaEntry = {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'reason'],
    properties: {
      path: safeProjectPath,
      reason: {
        enum: ['not-found', 'unreadable', 'hash-mismatch', 'not-in-inventory', 'unsupported-media'],
        description: 'Why a project-relative media path cannot currently be relinked.',
      },
    },
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'relink-map.schema.json',
    title: 'Edit Video Source Relink Map',
    description: 'Canonical source and derivative checksums. Duplicate paths with conflicting hashes are rejected by ingest and Resolve validation.',
    type: 'object',
    additionalProperties: false,
    required: [
      '$schema', 'schemaVersion', 'projectId', 'status', 'hashAlgorithm',
      'pathPolicy', 'sources', 'derivatives', 'missingMedia',
    ],
    properties: {
      $schema: {const: 'relink-map.schema.json'},
      schemaVersion: {const: 1},
      projectId: {type: 'string', minLength: 1},
      status: {enum: ['awaiting-ingest', 'ready', 'stale', 'error']},
      hashAlgorithm: {const: 'sha256'},
      pathPolicy: {const: 'project-relative-forward-slashes'},
      sources: {type: 'array', uniqueItems: true, items: checksumEntry},
      derivatives: {type: 'array', uniqueItems: true, items: checksumEntry},
      missingMedia: {type: 'array', uniqueItems: true, items: missingMediaEntry},
    },
  };
}

function starterFiles(projectId, title, kind) {
  const style = kind === 'wedding' ? 'documentary-wedding' : kind;
  const files = {
    'README.md': projectReadme(title, projectId, kind),
    'project.json': formatJson({
      schemaVersion: 1,
      id: projectId,
      title,
      kind,
      status: 'setup-required',
      style,
      brand: 'brand.md',
      graphicsBackend: 'hyperframes',
      graphicsFallback: 'remotion',
      editableHandoff: 'davinci-resolve',
      deliverables: [],
      privacy: {
        externalUploadAllowed: false,
        generatedDocumentaryMediaAllowed: false,
        localProcessingDefault: true,
      },
      paths: {
        rawVideo: 'raw/video',
        rawAudio: 'raw/audio',
        broll: 'broll',
        music: 'audio/music',
        soundEffects: 'audio/sfx',
        licenses: 'audio/licenses',
        references: 'assets/references',
        generatedAssets: 'assets/generated',
        proxies: 'proxies',
        sync: 'sync/sync-map.json',
        transcript: 'transcript',
        timeline: 'timeline/timeline.json',
        relinkMap: 'timeline/relink-map.json',
        graphicsBuild: 'graphics-build',
        reviews: 'reviews',
        manifests: 'manifests',
        outputs: 'outputs',
      },
    }),
    'brand.md': projectBrand(title),
    'creative-brief.md': creativeBrief(title, kind),
    'broll/manifest.json': formatJson({
      schemaVersion: 1,
      projectId,
      recorded: [],
      generated: [],
      generatedMediaPolicy: 'disabled-until-item-level-approval',
    }),
    'audio/licenses/licenses.json': formatJson({schemaVersion: 1, projectId, music: [], soundEffects: []}),
    'sync/sync-map.json': formatJson({
      schemaVersion: 1,
      projectId,
      status: 'awaiting-ingest',
      timebase: 'probe-source-exact-rational',
      methods: ['embedded-timecode', 'waveform', 'slate', 'recorded-time', 'visual-evidence'],
      groups: [],
      verificationPolicy: {checkpoints: ['start', 'middle', 'end'], lowConfidenceAction: 'flag-for-human-review'},
    }),
    'timeline/timeline.json': formatJson(timelineTemplate(projectId, title)),
    'timeline/relink-map.json': formatJson({
      $schema: 'relink-map.schema.json',
      schemaVersion: 1,
      projectId,
      status: 'awaiting-ingest',
      hashAlgorithm: 'sha256',
      pathPolicy: 'project-relative-forward-slashes',
      sources: [],
      derivatives: [],
      missingMedia: [],
    }),
    'timeline/relink-map.schema.json': formatJson(relinkMapSchema()),
    'timeline/timeline.schema.json': formatJson(timelineSchema()),
    'transcript/transcript.json': formatJson({schemaVersion: 1, projectId, status: 'awaiting-synchronized-sources', sources: [], speakers: [], segments: [], words: [], lowConfidenceRanges: []}),
    'transcript/corrections.json': formatJson({schemaVersion: 1, projectId, matchPolicy: 'single-word-whole-word-only-for-automatic-application', permanent: [], projectSpecific: [], humanVerificationRequiredFor: ['names', 'quotations', 'low-confidence-words']}),
    'transcript/cutsheet.json': formatJson({schemaVersion: 1, projectId, status: 'awaiting-story-map', timelineId: `${projectId}-primary`, policy: {automaticFillerRemoval: false, automaticSilenceTrim: false, preserveChronology: kind !== 'talking-head', preserveCompleteThoughts: true}, segments: []}),
    'transcript/edited-transcript.json': formatJson({schemaVersion: 1, projectId, status: 'awaiting-edit', timelineId: `${projectId}-primary`, sourceTranscript: 'transcript/transcript.json', timebase: 'edited-timeline-seconds', segments: [], words: []}),
    'graphics-build/graphics-plan.json': formatJson({schemaVersion: 1, renderer: 'hyperframes', timebase: 'seconds', items: []}),
    'graphics-build/DESIGN.md': `# ${title} — Graphics Design\n\nSnapshot the selected repository brand and style here before the first render. Record exact fonts, colors, safe zones, frame rate, renderer version, and approved exceptions. HyperFrames is the default; keep graphics separately rerenderable.\n`,
    'graphics-build/README.md': graphicsReadme(projectId, title),
    'graphics-build/.gitignore': '.hyperframes/\n.thumbnails/\nrenders/\n',
    'graphics-build/hyperframes.json': formatJson({
      $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
      registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
      paths: {blocks: 'compositions', components: 'compositions/components', assets: 'assets'},
      media: {autoProxy: true},
    }),
    'graphics-build/meta.json': formatJson({id: `${projectId}-graphics`, name: `${title} Graphics`}),
    'graphics-build/index.html': hyperframesIndex(projectId, title),
    'reviews/approval-log.json': formatJson({schemaVersion: 1, projectId, privacyDefault: 'local-only', approvals: [], rule: 'Approval must name scope, artifacts or action, destination when networked, approver, and timestamp.'}),
    'reviews/qa-report.json': formatJson({schemaVersion: 1, projectId, status: 'pending', timelineRevision: null, technicalIssues: [], editorialCompositionIssues: [], privacyTruthIssues: []}),
    'reviews/editorial-checklist.md': `# ${title} — Editorial Review\n\n## Technical\n\n- [ ] Sync, source relinks, frame cadence, color, audio, captions, and exports pass\n- [ ] Both sides and the tail of every transition were inspected\n\n## Editorial and composition\n\n- [ ] Story, chronology, identities, quotations, pacing, framing, and typography pass\n- [ ] Every mandatory moment is present or explicitly waived\n\n## Privacy and truth\n\n- [ ] No unapproved upload, generated documentary evidence, or excluded material appears\n`,
    'manifests/stage-manifest.schema.json': formatJson(stageSchema()),
  };

  for (const stage of STAGE_NAMES) {
    files[`manifests/${stage}.json`] = formatJson(stageManifest(projectId, stage));
  }
  for (const relative of [
    'raw/video/.gitkeep',
    'raw/audio/.gitkeep',
    'audio/music/.gitkeep',
    'audio/sfx/.gitkeep',
    'assets/references/.gitkeep',
    'assets/generated/.gitkeep',
    'proxies/.gitkeep',
    'graphics-build/compositions/.gitkeep',
    'reviews/frames/.gitkeep',
    'outputs/interchange/.gitkeep',
    'outputs/review/.gitkeep',
    'outputs/delivery/.gitkeep',
    'outputs/stems/.gitkeep',
    'outputs/graphics/.gitkeep',
    'outputs/captions/.gitkeep',
  ]) {
    files[relative] = '';
  }
  return files;
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ['help', 'overwrite', 'json'],
    values: ['project', 'name', 'kind'],
  });
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  rejectPositionals(args);

  if (!args.project && !args.name) {
    throw new CliError('Missing required option: --name (or pass an explicit --project)');
  }
  if (!args.project && !args.kind) {
    throw new CliError('Missing required option: --kind');
  }
  const kind = args.kind ?? 'wedding';
  if (!ALLOWED_KINDS.has(kind)) {
    throw new CliError(`kind must be one of: ${[...ALLOWED_KINDS].join(', ')}`);
  }

  const rawName = args.name?.trim() || path.basename(resolveUserPath(args.project, {label: 'project path'}));
  const projectId = toKebabCase(rawName);
  const title = displayTitle(args.name, projectId);
  let repository = null;
  let projectPath;
  if (args.project) {
    projectPath = resolveUserPath(args.project, {label: 'project path'});
  } else {
    repository = findRepositoryRoot(process.cwd());
    const projectsRoot = path.resolve(repository, 'projects');
    refuseSymlink(projectsRoot, 'projects root');
    projectPath = path.resolve(projectsRoot, projectId);
    assertInside(projectsRoot, projectPath, 'automatic project path');
  }

  assertNotFilesystemRoot(projectPath, 'project path');
  refuseSymlink(projectPath, 'project root');
  let existingRoot = null;
  try {
    existingRoot = fs.statSync(projectPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (existingRoot && !existingRoot.isDirectory()) {
    throw new CliError(`Project path exists but is not a directory: ${projectPath}`);
  }

  const report = {
    ok: true,
    project: projectPath,
    repository,
    id: projectId,
    title,
    kind,
    createdDirectories: [],
    existingDirectories: [],
    createdFiles: [],
    overwrittenFiles: [],
    preservedFiles: [],
  };

  fs.mkdirSync(projectPath, {recursive: true});
  for (const relative of DIRECTORIES) {
    const target = path.resolve(projectPath, relative);
    assertInside(projectPath, target, 'scaffold directory');
    refuseSymlinkChain(projectPath, target, 'scaffold directory');
    let exists = false;
    try {
      const stat = fs.statSync(target);
      if (!stat.isDirectory()) {
        throw new CliError(`Scaffold directory path is occupied by a file: ${target}`);
      }
      exists = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (exists) {
      report.existingDirectories.push(relative);
    } else {
      fs.mkdirSync(target, {recursive: true});
      report.createdDirectories.push(relative);
    }
  }

  for (const [relative, content] of Object.entries(starterFiles(projectId, title, kind))) {
    const target = path.resolve(projectPath, relative);
    assertInside(projectPath, target, 'starter file');
    refuseSymlinkChain(projectPath, target, 'starter file');
    let exists = false;
    try {
      const stat = fs.statSync(target);
      if (!stat.isFile()) {
        throw new CliError(`Starter-file path is occupied by a directory: ${target}`);
      }
      exists = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    if (!exists) {
      fs.writeFileSync(target, content, {encoding: 'utf8', flag: 'wx'});
      report.createdFiles.push(relative);
    } else if (args.overwrite) {
      fs.writeFileSync(target, content, {encoding: 'utf8', flag: 'w'});
      report.overwrittenFiles.push(relative);
    } else {
      report.preservedFiles.push(relative);
    }
  }

  if (args.json) {
    process.stdout.write(formatJson(report));
  } else {
    process.stdout.write(`Scaffolded ${title} (${kind}) at ${projectPath}\n`);
    process.stdout.write(`  directories created: ${report.createdDirectories.length}\n`);
    process.stdout.write(`  files created: ${report.createdFiles.length}\n`);
    process.stdout.write(`  files preserved: ${report.preservedFiles.length}\n`);
    process.stdout.write(`  files overwritten: ${report.overwrittenFiles.length}\n`);
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.exitCode = printCliError(error, {json: process.argv.includes('--json')});
}
