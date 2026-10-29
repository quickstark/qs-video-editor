# DaVinci Resolve editable handoff

## Contents

- [Source of truth](#source-of-truth)
- [Default deliverables](#default-deliverables)
- [Neutral timeline contract](#neutral-timeline-contract)
- [Dry run and portable write](#dry-run-and-portable-write)
- [Resolve apply](#resolve-apply)
- [Resolve setup](#resolve-setup)
- [What apply does](#what-apply-does)
- [Collision and media safety](#collision-and-media-safety)
- [Known limitations](#known-limitations)
- [Offline tests](#offline-tests)

## Source of truth

Ground Resolve automation in the locally installed Blackmagic documentation:

- API: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/README.txt`
- examples: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Examples/`
- module: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules/DaVinciResolveScript.py`

Run `npm run video:check` for the current installed Resolve version; do not
reuse a version or connection result recorded by an earlier session. The local
Blackmagic README introduces the scripting package as the DaVinci Resolve
Studio API, then states in its "Studio and AI Scripting APIs" section that the
API is a common superset for Free and Studio and that a call can return `False`
when it invokes a Studio-only function. Treat the installed API and every call
result as authoritative; do not infer availability from a method name.

The bridge uses only documented calls: `ProjectManager.CreateProject`,
`LoadProject`, `SaveProject`, and `ExportProject`; `Project.SetSetting`;
`MediaPool.ImportMedia`, `CreateEmptyTimeline`, `AppendToTimeline`, and
`DeleteTimelines`; and timeline track, marker, linking, and export methods.

Portable serialization is grounded in Apple's installed FCPXML 1.10 DTD at
`/Applications/iMovie.app/Contents/Frameworks/Interchange.framework/Versions/A/Resources/FCPXMLv1_10.dtd`,
Apple's [FCPXML reference](https://developer.apple.com/documentation/professional-video-applications/document-type-definition),
and the Academy Software Foundation's pinned
[OTIO 0.18.1 schema map](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/v0.18.1/src/opentimelineio/CORE_VERSION_MAP.cpp)
and [adapter guide](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/v0.18.1/docs/tutorials/write-an-adapter.md).
CMX3600 limits follow the official
[OTIO CMX3600 adapter](https://github.com/OpenTimelineIO/otio-cmx3600-adapter).

## Default deliverables

Treat the Resolve-native pair as the primary editable handoff:

1. `<timelineId>.drp` — Resolve project export, created with
   `withStillsAndLUTs=False`.
2. `<timelineId>.drt` — Resolve timeline export.

Also create portable fallbacks either offline or, when supported, through the
running API:

- `<timelineId>.otio` through `EXPORT_OTIO`;
- FCPXML 1.10 through `EXPORT_FCPXML_1_10`;
- EDL through `EXPORT_EDL` + `EXPORT_NONE`, unless `--no-edl` is passed.

Use `interchange.nativeProjectPath`, `nativeTimelinePath`, `otioPath`,
`primaryPath`, and `fallbackPath` when present. Manifest output paths must be
project-relative and resolve under `outputs/interchange/`. If paths are
omitted, that directory and `timelineId` provide the defaults. An explicit
`--export-dir` overrides all destinations, but it too must resolve inside the
project root.

The current scaffold declares `interchange.primaryFormat: DRP_DRT`. Some
version-1 manifests retain `FCPXML` from the older portable-only contract;
treat that legacy value as a compatibility declaration for `primaryPath`, not
as delivery priority. The effective primary handoff is always
`nativeProjectPath` + `nativeTimelinePath`; OTIO and FCPXML are portable
fallbacks. The bridge accepts the legacy field without rewriting it.

DRP and DRT failures stop the apply. OTIO, FCPXML, and EDL failures are reported
without claiming those files were created. EDL is only a limited fallback; it
cannot preserve the complete multitrack audio, graphics, captions, or effects
model.

## Neutral timeline contract

Run `scripts/resolve/resolve_timeline.py` against the durable
`timeline/timeline.json`. The dependency-free validator deliberately handles a
small, transparent version-1 contract rather than silently coercing edits.

Required ready-to-build values:

- `schemaVersion: 1`, non-empty `projectId`, and non-empty `timelineId`;
- positive width and height;
- exact `frameRateNumerator` and `frameRateDenominator` plus boolean
  `dropFrame`;
- SMPTE `startTimecode`, using `;` for drop frame and `:` otherwise;
- at least one video track;
- track IDs, names, roles, enabled/locked states, and item arrays;
- for every item: stable ID, track ID, source path, source/timeline frame
  bounds, and enabled state.

Frame intervals are half-open: `[sourceInFrame, sourceOutFrame)` and
`[timelineStartFrame, timelineEndFrame)`. Source and record durations must
match. Resolve documents `AppendToTimeline.endFrame` as inclusive, so the
bridge sends `sourceOutFrame - 1`. It sends each explicit record position as:

```text
Timeline.GetStartFrame() + timelineStartFrame
```

This runtime anchor avoids guessing Resolve's internal absolute start-frame
representation while preserving the manifest's exact offset. The dry-run also
prints the SMPTE-derived absolute value for review.

Use canonical probed rates. The bridge preserves the rational rate in the
plan and maps common 1001-based values to Resolve's documented UI tokens, such
as `24000/1001 -> 23.976` and `30000/1001 drop-frame -> 29.97 DF`. It never
rounds 23.976 to 24 or 29.97 to 30.

Set `audioType` before an audio track contains an item. Accepted documented
values are `mono`, `stereo`, `lrc`, `lcr`, `lrcs`, `lcrs`, `quad`, the
documented 5.0/5.1/7.0/7.1 film and non-film variants, and
`adaptive1` through `adaptive36`. An empty placeholder track may omit it and
uses Resolve's documented empty-track default (`mono`) if an apply is ever
requested. Never add media to such a track until probe data and editorial
intent provide an explicit type.

`graphicsItems` must target a declared video track at index 2 or higher whose
role identifies graphics. Both alpha and opaque HyperFrames renders remain
ordinary, separately editable upper-track clips. `musicItems` must target a
declared audio track whose role identifies music. The validator de-duplicates
an item repeated identically in a track and a specialized array, but rejects
conflicting duplicates.

Items may not overlap on the same ordinary track. Use additional declared
tracks to represent simultaneous material. Items sharing a non-empty
`syncGroupId` are linked in Resolve when the group has at least two members.

Markers use timeline-relative frame offsets. Stable marker ID, kind, and
status are stored as JSON in Resolve marker `customData` so a later script can
round-trip editorial state.

All `sourcePath` values must be project-relative. Absolute paths, `..` escapes,
and symlinks that resolve outside the project root are rejected. This is a
security boundary as well as a portability rule.

That rule governs the canonical JSON manifests and relink map. Offline OTIO and
FCPXML are a deliberate local-import exception: their media references resolve
to absolute `file://` URLs because editors need a concrete local relink target.
Those portable exports can reveal the workstation username and directory
layout. Keep them private and local, and regenerate or relink/redact them for a
different workstation instead of publishing them as repository artifacts.

The strict relink gate requires `schemaVersion: 1`, a `projectId` equal to the
timeline project, `status: ready`, `hashAlgorithm: sha256`,
`pathPolicy: project-relative-forward-slashes`, and an empty `missingMedia`
array. Every populated entry in `sources` or `derivatives` has this minimum
shape:

```json
{
  "path": "raw/camera-a.mov",
  "sha256": "64 hexadecimal characters"
}
```

Paths follow the same containment policy and may not contain backslashes.
Conflicting duplicate paths, unresolved `missingMedia`, missing entries,
missing files, and hash mismatches fail a required integrity check.
After creating a proxy, normalized audio file, graphics render, or review
derivative, run `register-derivative.mjs` with the job and project-contained
media path before the asset enters the timeline. Do not hand-edit checksum
entries.

## Dry run and portable write

Dry run is always the default and does not import the Resolve module:

```bash
node .video-editor/run.mjs resolve \
  --timeline projects/new-film/timeline/timeline.json
```

An ordinary dry run does not open the relink map or hash potentially large
media files. Its plan reports `relinkVerification.status: not-run` and the
strict contract required later. Add `--verify-source-hashes` to perform that
read-only integrity gate immediately; `--apply` performs it automatically. Use
`--relink-map` only to select a different project-contained map.

Use structural validation without checking media/export paths:

```bash
node .video-editor/run.mjs resolve \
  --timeline projects/new-film/timeline/timeline.json \
  --validate-only
```

Example project scaffolds may intentionally contain unresolved format fields.
They must fail ready-to-build validation until ingest probing supplies width,
height, exact rational frame rate, and drop-frame state. Do not interpret a
scaffold directory as authorization to start that edit.

Portable files can be created without Resolve:

```bash
node .video-editor/run.mjs resolve \
  --timeline projects/new-film/timeline/timeline.json \
  --write-portable \
  --verify-source-hashes
```

This explicit mode writes OTIO JSON, FCPXML 1.10, and CMX3600 EDL. Add
`--no-edl` to omit the lossy EDL. Existing portable targets fail before any
write; `--overwrite-portable` is the scoped replacement gate. It never creates
or pretends to create DRP/DRT, never imports the Resolve module, and never
connects to the application. Keep `--verify-source-hashes` on durable handoff
writes so a missing, stale, or mismatched relink entry blocks the write. Without
that flag, portable mode still checks source existence and reports checksum
verification as `not-run`; reserve that weaker mode for intermediate tests.
The resulting OTIO and FCPXML intentionally contain absolute local media URLs;
the command report repeats this privacy warning. They are editor-import
packages, not share-safe canonical manifests.

Each document is rendered in memory, fsynced to a same-directory staging file,
and promoted atomically per file. Without overwrite, promotion uses a hard-link
operation that cannot replace a destination appearing during the write. With
overwrite, `os.replace` is used only after the scoped flag. Multi-file promotion
is not a transaction; if the host fails between promotions, inspect the JSON
report and checksums before retrying.

Portable representation:

- OTIO uses the 0.18.1 stable schema family (`Timeline.1`, `Stack.1`,
  `Track.1`, `Gap.1`, `Clip.2`, `ExternalReference.1`, `Marker.2`). Gaps encode
  explicit record positions; top-stack markers, named tracks, roles, item
  state, source-relative metadata, and absolute file-URI references are
  retained. OTIO stores rate as a JSON number, so the bridge also stores the
  exact numerator/denominator and every integer frame boundary in namespaced
  metadata.
- FCPXML declares version 1.10, exact rational seconds, referenced
  `media-rep` file URLs, positive video lanes, negative audio lanes, component
  roles, clip metadata, and markers attached to a full-duration carrier gap.
  The writer output is checked by tests and was validated against Apple's
  installed 1.10 DTD. FCPXML has lanes rather than durable named NLE tracks, so
  canonical track names remain in Codex metadata and `timeline.json`.
- CMX3600 contains only enabled clips on the first picture track. Exact rate
  and source paths are comments; other picture layers, audio, graphics,
  captions, roles, sync groups, and markers are reported as lost/deferred.

Apple warns that DTD validity alone does not guarantee import behavior, and
OTIO applications differ on file-URI handling. Keep `timeline.json` and the
checksum relink map authoritative, then import-test the portable file in the
intended editor. Version 1 does not carry probed full source duration or source
timecode origin; OTIO `available_range` and FCPXML asset duration therefore use
the conservative known extent ending at the greatest referenced source-out.
Refresh probe metadata before expecting extra trim handles.

## Resolve apply

After reviewing the JSON plan, connect to an already-running Resolve instance:

```bash
node .video-editor/run.mjs resolve \
  --timeline projects/new-film/timeline/timeline.json \
  --apply
```

Create-new is the default. Explicit mutation gates are separate:

- `--load-existing-project` permits loading and modifying the named project;
- `--replace-existing-timeline` permits deletion/rebuild of only the
  same-named timeline;
- `--overwrite-exports` permits atomic replacement of named export files;
- `--allow-missing-media` is dry-run-only and cannot be combined with apply,
  portable write, or checksum verification.

`--apply` automatically hashes every referenced source against
`timeline/relink-map.json` before importing the Resolve module. A missing map,
missing checksum entry, changed file, or mismatch blocks the operation before
Resolve is contacted. `--relink-map` may point to a different map only when it
remains inside the project root.

Use `--resolve-project`, `--resolve-timeline`, `--project-root`, or
`--export-dir` only when the manifest defaults are not the intended targets.

## Resolve setup

The installed Blackmagic README says Resolve must already be running for an
external script. The script does not launch Resolve. In Resolve Preferences,
permit command-line/external scripting; the README notes that scripting access
can be limited to the Console or extended to the local network and warns about
the security implications of outside access. Prefer local access.

For the default macOS install, the bridge can load the installed module by its
absolute path. Blackmagic also documents these environment variables:

```bash
export RESOLVE_SCRIPT_API="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting"
export RESOLVE_SCRIPT_LIB="/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so"
export PYTHONPATH="$PYTHONPATH:$RESOLVE_SCRIPT_API/Modules/"
```

The official API prerequisites list 64-bit Python 3.6 or newer (as well as
older supported Lua/Python options). These bridge scripts require Python 3.7
or newer and only the standard library.

Use Computer Use only to verify the installed application/project state or to
perform an editor operation the API cannot express. Do not use UI automation
to bypass the dry-run, approval, collision, or private-media rules.

## What apply does

Apply performs the following checked sequence:

1. Validate contained paths, source existence, export collisions, and every
   referenced source SHA-256 against the relink map.
2. Connect to the running Resolve process.
3. Create a unique project, or load one only with the explicit flag.
4. Set frame rate and resolution before creating a timeline. For an existing
   project, verify those settings exactly and refuse to change them.
5. Reject a same-named timeline, or delete only that timeline with the explicit
   replacement flag.
6. Create the timeline, set its start timecode, and build named tracks.
7. Import each unique absolute path into the Media Pool by reference. Reuse a
   matching existing Media Pool item when possible.
8. Append video-only (`mediaType: 1`) and audio-only (`mediaType: 2`) items at
   explicit `recordFrame` positions and declared track indexes.
9. Verify each returned item's record start, duration, and track.
10. Disable requested clips, link sync groups, add markers, then apply final
   track enabled/locked states.
11. Save the project and export the Resolve-native package plus supported
    fallbacks.

## Collision and media safety

The script never calls `ArchiveProject`, media consolidation, relink, replace,
copy, proxy-generation, transcription, upload, render, or delete-media APIs.
`ImportMedia` references each source at its existing path. Source files are
opened read-only for existence and optional SHA-256 verification; they are
never renamed, moved, transcoded, modified, copied into exports, or deleted.

The planner normalizes the timeline, source, relink-map, export, and staging
paths before any editor connection. Timeline and source paths must remain under
the project root. Manifest exports must also remain under
`outputs/interchange/`, unless a project-contained `--export-dir` is explicitly
selected. Export/source collisions and exports inside `raw/` are rejected.

Every planned export is checked before Resolve is contacted. Existing targets
block the operation by default. With `--overwrite-exports`, Resolve writes a
same-directory staging file first and `os.replace` promotes it only after the
API reports success and the staged file exists. A stale staging file blocks a
retry for manual inspection.

Creating a Resolve project is a database mutation and is not transactional.
The bridge preflights schema, media, and output collisions first, but if Resolve
fails midway, inspect the newly created project rather than assuming rollback.
It never auto-deletes a project.

## Known limitations

- The version-1 contract builds a hard-cut rough assembly. It does not yet
  express transitions, retimes, keyframes, grades, Fairlight automation,
  multicam containers, compound clips, or Fusion compositions.
- The documented scripting API does not expose an ordinary subtitle-media
  append parallel to `AppendToTimeline`. Caption items are reported as
  deferred, and apply stops before connecting when any are present. Import a
  separately generated SRT through an approved workflow, then represent that
  completed handoff in the project manifest.
- Source and timeline frame rates are assumed already conformed by documented
  derivatives. The bridge does not reinterpret VFR media or retime clips.
- An existing project must already match the requested frame rate and
  resolution. Resolve may lock timeline frame rate after timelines exist, so
  the bridge refuses to rewrite existing project settings.
- Resolve-native OTIO/FCPXML/EDL availability is checked from runtime API
  constants. The offline standard-library writers remain available without
  Resolve, but their representations are still narrower than DRT/DRP.
- Media Pool file-path matching uses Resolve's reported `File Path`. Image
  sequences or unusual virtual media may require a future explicit source-ID
  mapping.

## Offline tests

Run the dependency-free tests without starting Resolve:

```bash
node .video-editor/run.mjs resolve-test
```

The fixture files are text placeholders used only for path, checksum, schema,
frame-math, dry-run, atomic-write, and serialization tests. Never pass them to
`--apply`. Tests do not launch or mutate Resolve and write portable artifacts
only inside temporary directories.
