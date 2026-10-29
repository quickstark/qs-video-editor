# Use the six skills

Start with the output you need, the input files or existing project, and any constraints that matter. Name the workspace so Codex can resume its manifests and approvals. Choose the workflow below; add optional tools only when the job needs them.

## Choose the entrypoint

| Need | Skill | Useful detail to provide |
| --- | --- | --- |
| New machine/workspace or extra capability | `qs-video-setup` | Workspace path and requested work |
| A few trims, conversions, resize or extraction | `qs-video-quick` | Inputs, output directory, format, boundaries |
| Transcript, corrections, captions | `qs-video-transcribe` | Sources/language, verified names, edited timeline if any |
| Titles, overlays or standalone motion | `qs-video-graphics` | Text, style, duration, aspect ratio, alpha requirement |
| A film or sustained revision | `qs-video-edit` | Workspace/job, audience, deliverables, must-keep/exclude decisions |
| Quality check of an existing revision | `qs-video-review` | Exact render/timeline, check types, known concerns |

In Codex's skill picker, select the namespaced entry, such as `$qs-video-editor:qs-video-quick`. You can also ask for the workflow by name in a normal message. If you have not created a workspace, start with [installation and setup](installation.md).

## Copyable prompts

**Quick batch**

> Use qs-video-quick. Convert the MOV files in `<input folder>` to review MP4s under `<workspace>/outputs/review`. Preserve the originals and their frame rates. Show a collision-free plan, process them sequentially, and report failures and reusable completed outputs.

**Precise trim**

> Use qs-video-quick to keep 00:12.5 through 00:31.0 from `<file>`. I need accurate boundaries, so re-encode the derivative. Show the output duration and stream metadata.

If speed and no recompression matter more, ask for stream copy and accept keyframe-dependent boundaries. Stream-copy cuts are not guaranteed frame-exact.

**Transcript and edited captions**

> Use qs-video-transcribe for `<source>`, locally. These names are spelled `<names>`. Preserve machine output and source timestamps. Check uncertain words against audio. Prepare captions against the current edit ranges and flag cuts through speech or unaligned words.

**Graphics only**

> Use qs-video-graphics to make a five-second lower third reading `<text>`, matching `<reference/style>`. Deliver editable composition source, a preview, and a separate alpha overlay at the project's exact frame rate. Keep the title fully readable before animating it.

**Full documentary edit**

> Use qs-video-edit in `<workspace>`, project `<job>`. Make a four-minute film for `<audience>`. Preserve `<moments>` and exclude `<material>`. Keep meaningful pauses and complete thoughts. Reuse current transcripts/sync and approved story decisions. Prepare the next story map or review render, then an editable Resolve handoff or clearly identified portable fallback.

**Resume without restarting**

> Resume project `<job>` at `<workspace>`. Read the current manifests and approval log. Change only the opening title and its dependent outputs. Keep picture timing, completed transcription/sync, and prior approvals where their scope still applies.

**Review**

> Use qs-video-review on `<exact render>` and `<timeline>`. Inspect clip tails and transitions, check sync and captions, listen to dialogue/music, and assess pacing. Report timestamped findings and identify checks you could not perform. Do not alter the edit during review.

## Work through a sustained edit

1. Name the existing job or create one once. Confirm audience, deliverables, privacy, must-keep material and style.
2. Probe sources and retain checksums. Synchronize/transcribe only material that needs it.
3. Build a source-linked selection/story map. Review editorial compression before spending time on finishing.
4. Review an early sample. Make graphics as independent layers, then finish dialogue, ambience, music and captions.
5. Review the exact render. Keep technical, motion, listening, editorial/privacy and import results separate.
6. Deliver a reviewed render plus the requested editable package, relink map, source ranges, graphics source, stems and captions. Preserve earlier approved versions.

For documentary/wedding work, silence removal, hook-first restructuring and reaction substitution are not automatic defaults. A transcript is evidence of words, not proof of identity, facial reactions or chronology.

## Terminal workflow

After [workspace setup](installation.md), run commands from the workspace root through its bound launcher:

```bash
node .video-editor/run.mjs --help
node .video-editor/run.mjs check --profile quick
node .video-editor/run.mjs scaffold --name "Client Interview" --kind documentary
node .video-editor/run.mjs evidence --project projects/client-interview --json
node .video-editor/run.mjs resolve --help
```

Use the `full` profile before scaffolding a sustained edit. The scaffold supports `documentary`, `wedding`, and `talking-head`, and accepts an explicit `--project <path>`. Create each job once; resume its existing files for later revisions. The evidence command summarizes project/timeline records and their hashes. It does not inspect footage.

For a repeatable batch, save `operations.json`:

```json
{
  "schemaVersion": 1,
  "operations": [
    {"id": "review", "type": "resize", "input": "incoming/source.mov", "output": "outputs/review.mp4", "width": 1280},
    {"id": "audio", "type": "extract-audio", "input": "incoming/source.mov", "output": "outputs/dialogue.wav"}
  ]
}
```

Preview, save the resolved input hashes, then apply that exact plan:

```bash
node .video-editor/run.mjs quick --plan operations.json --json > preview.json
node -e 'const fs=require("node:fs");fs.writeFileSync("operations.resolved.json",JSON.stringify(JSON.parse(fs.readFileSync("preview.json")).resolvedPlan,null,2)+"\n")'
node .video-editor/run.mjs quick --plan operations.resolved.json --apply --json
```

Outputs must be inside the workspace, outside raw/control directories, with unique paths. Apply requires `inputSha256`. Receipts under `.video-editor/runs/` permit reuse only when the plan, inputs, FFmpeg version and existing output hash match. Existing unreceipted outputs are conflicts. Batch processing is sequential to bound resource use; a failed item stops execution and earlier completed items remain reusable. No arbitrary shell/FFmpeg expression is accepted through the batch schema.

For exact trimming use `type: "trim"`, numeric `start`/`end` seconds and `policy: "exact"`; use `"copy"` for approximate stream-copy boundaries. `"convert"` produces a standard review encode. Retain a finishing pipeline for HDR/color-critical work; the quick encoder is not a color-managed master exporter.

## Captions and speech boundaries

The caption mapper accepts schema version 1, a rational frame rate, `words` with `sourceId`, `text`, `start`/`end` in source seconds, and `clips` with `sourceId`, `sourceInFrame`, `sourceOutFrame`, `timelineStartFrame`. It handles removed gaps, reordered/repeated source clips, and explicit timeline offsets without rewriting the original words.

```bash
node .video-editor/run.mjs captions --input mapping.json --output captions.word-cues.srt --json
```

The output uses one cue per word, suitable for inspection or later grouping/styling. It flags cuts intersecting words, unaligned words, and overlaps. It does not infer sentence boundaries, repair truncated phonemes, or certify readability. Review and group cues for final delivery.

## Approvals and expectations

A request for local editing covers the reversible processing needed for that edit. Existing approvals remain valid within their recorded scope. Obtain authorization for uploads, remote generation, package installs, publishing, destructive cleanup, or replacement of approved outputs when it has not already been given.

Final promotion requires QA and an export approval that identify the reviewed render and current timeline by SHA-256. Record the actual review decision. Changing the render or timeline blocks promotion until the new revision is covered. Preserve legacy approvals; review unclear revision coverage before relying on them.

WhisperX normalization, waveform synchronization, semantic clip ranking and full finishing still include tool-directed/manual work. The Resolve bridge implements version-1 hard-cut assembly; unsupported transitions, retimes, captions and advanced finishing require explicit treatment in the editor. See [capabilities](../runtime/references/capabilities.md) for the boundary.
