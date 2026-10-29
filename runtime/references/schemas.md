# Durable JSON contracts

Use UTF-8 JSON, stable IDs, project-relative paths where possible, exact rational frame rates, and explicit schema versions. Reject unknown timing units. The files in the active job are authoritative; do not substitute a similarly named example from another project.

## Project manifest

Keep identity, privacy, tool routing, paths, stage order, editable handoff, and declared deliverables explicit. A new scaffold uses this compact core and may extend it without changing the meaning of existing fields:

```json
{
  "schemaVersion": 1,
  "id": "example-wedding-film",
  "title": "Example Wedding Film",
  "kind": "wedding",
  "status": "setup-required",
  "style": "documentary-wedding",
  "brand": "brand.md",
  "graphicsBackend": "hyperframes",
  "graphicsFallback": "remotion",
  "editableHandoff": "davinci-resolve",
  "deliverables": [],
  "privacy": {
    "localProcessingDefault": true,
    "externalUploadAllowed": false,
    "generatedDocumentaryMediaAllowed": false
  }
}
```

Keep unknown creative facts as reviewable assumptions; never turn them into on-screen defaults.

## Neutral timeline

The version-1 Resolve bridge consumes the frame-based shape used by `projects/<job>/timeline/timeline.json`:

```json
{
  "schemaVersion": 1,
  "projectId": "example-wedding-film",
  "timelineId": "example-wedding-film-highlight",
  "status": "assembling",
  "format": {
    "width": 3840,
    "height": 2160,
    "pixelAspectRatio": "1:1",
    "frameRateNumerator": 24000,
    "frameRateDenominator": 1001,
    "dropFrame": false,
    "selectionRule": "probe-primary-camera-and-use-exact-rational-timebase"
  },
  "startTimecode": "01:00:00:00",
  "videoTracks": [
    {
      "id": "V1",
      "name": "Primary Picture",
      "role": "primary-picture",
      "enabled": true,
      "locked": false,
      "items": []
    }
  ],
  "audioTracks": [],
  "captionTracks": [],
  "graphicsItems": [],
  "musicItems": [],
  "captionItems": [],
  "markers": [],
  "reviewRender": {
    "path": "outputs/review/example-wedding-film-review.mp4",
    "status": "pending",
    "burnInTimecode": true,
    "sourceTimelineRevision": null
  },
  "interchange": {
    "primaryFormat": "DRP_DRT",
    "primaryPath": "outputs/interchange/example-wedding-film.fcpxml",
    "fallbackFormat": "EDL",
    "fallbackPath": "outputs/interchange/example-wedding-film.edl",
    "nativeProjectPath": "outputs/interchange/example-wedding-film-primary.drp",
    "nativeTimelinePath": "outputs/interchange/example-wedding-film-primary.drt",
    "otioPath": "outputs/interchange/example-wedding-film-primary.otio",
    "resolveInstallStatus": "unknown",
    "resolveVersion": null,
    "resolveScriptingStatus": "unknown",
    "validatedInResolve": false
  }
}
```

Track array order defines the Resolve track index. Every track requires `id`, `name`, `role`, `enabled`, `locked`, and `items`. A non-empty audio track also requires a probed and intentional Resolve `audioType` such as `mono` or `stereo`; never guess channel layout merely to pass validation.

Every editable item uses half-open frame intervals:

```json
{
  "id": "ceremony-vow-001",
  "trackId": "V1",
  "sourceId": "camera-a-A001",
  "sourcePath": "raw/video/A001.mov",
  "sourceInFrame": 2960,
  "sourceOutFrame": 3398,
  "timelineStartFrame": 1007,
  "timelineEndFrame": 1445,
  "enabled": true,
  "syncGroupId": "ceremony-vow-001-av",
  "notes": ["Mandatory moment"]
}
```

Require nonnegative starts, positive and equal source/record durations, a declared track, and no collision on an ordinary track. Put simultaneous material on additional declared tracks.

## Relink map

`timeline/relink-map.json` is the checksum authority used before any Resolve mutation. It records project-relative forward-slash paths only. Every populated source or derivative entry is exactly a path plus SHA-256 digest:

```json
{
  "$schema": "relink-map.schema.json",
  "schemaVersion": 1,
  "projectId": "example-film",
  "status": "ready",
  "hashAlgorithm": "sha256",
  "pathPolicy": "project-relative-forward-slashes",
  "sources": [
    {
      "path": "raw/video/camera-a-001.mov",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  ],
  "derivatives": [],
  "missingMedia": []
}
```

Do not store absolute paths, parent traversals, backslashes, or unverified hashes. A missing-media record has the exact shape `{ "path": "raw/video/missing.mov", "reason": "not-found" }`; allowed reasons are `not-found`, `unreadable`, `hash-mismatch`, `not-in-inventory`, and `unsupported-media`. The ingest helper creates this map only with `--hash`; Resolve `--apply` verifies every referenced source against it before connecting or mutating. A non-empty `missingMedia` list keeps the map stale and must be resolved before an editable handoff.

After a local stage creates derived media, register it with
`register-derivative.mjs --project projects/<job> --input <project-contained-file>`.
The helper ffprobes and hashes the file, validates the complete existing map,
and atomically merges only the canonical derivative entry. An existing path is
an error unless `--overwrite` explicitly re-registers that same derivative;
source entries, status, and `missingMedia` are never cleared or relaxed.

Markers are timeline-relative frames:

```json
{
  "id": "required-first-kiss",
  "frame": 4128,
  "kind": "editorial-note",
  "label": "Required: first kiss",
  "status": "open"
}
```

The Resolve bridge stores the stable marker ID, kind, and status in marker custom data.

## Cutsheet

Each kept segment carries source-linked editorial meaning before it becomes frames in the neutral timeline:

```json
{
  "id": "vow-speaker-b-003",
  "sourceMediaId": "camera-a-A001",
  "sourceInSeconds": 123.456,
  "sourceOutSeconds": 141.706,
  "speaker": "partner-a",
  "text": "Corrected transcript text",
  "event": "ceremony",
  "storyBeat": "vows",
  "reason": "mandatory moment",
  "continuityNotes": "Use synchronous listener reaction on V2"
}
```

## Graphics plan

Use seconds for editorial planning, then convert placements to exact timeline frames:

```json
{
  "schemaVersion": 1,
  "timebase": "seconds",
  "renderer": "hyperframes",
  "items": [
    {
      "id": "opening-title",
      "start": 3.0,
      "end": 8.0,
      "kind": "title",
      "direction": "Render verified couple names over the approved establishing shot",
      "notes": "Omit date and venue until verified; do not obscure faces",
      "renderer": "hyperframes",
      "assetRefs": []
    }
  ]
}
```

Allowed kinds are `stat`, `card`, `screenshot`, `takeover`, `zoom`, `diagram`, `b-roll-slot`, `lower-third`, `title`, and `end-card`. Require unique IDs, finite seconds, `start >= 0`, `end > start`, ascending order, and no overlap. Consecutive items must abut within one microsecond or leave a gap greater than one second.

## Generated media manifest

Every optional hosted generation entry must carry provider, model, exact prompt, estimate, approval reference, private-source status, documentary status, source path, and output hash. Reject generated wedding people, voices, venues, events, reactions, or memories.

## Stage manifest

Follow `manifests/stage-manifest.schema.json`. Each stage records status, approval, inputs, outputs, checks, decisions, data, and notes:

```json
{
  "$schema": "stage-manifest.schema.json",
  "schemaVersion": 1,
  "projectId": "example-wedding-film",
  "stage": "graphics",
  "status": "needs-review",
  "updatedAt": null,
  "requiresApproval": false,
  "approval": {
    "status": "not-required",
    "recordPath": "reviews/approval-log.json"
  },
  "inputs": [],
  "outputs": [],
  "checks": [],
  "decisions": [],
  "data": {},
  "notes": []
}
```

Use `null` for intentionally unknown values only when the schema permits it. Do not use blank strings as missing-data placeholders.
