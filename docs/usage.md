# Get good results with the six skills

Tell Codex what you want to receive, where the inputs/workspace are, and what matters about the edit. A clear output and a named existing project are more useful than a long list of tools. Codex should choose the smallest workflow, reuse verified work, and ask only about decisions that materially affect the result.

## Choose the entrypoint

| Need | Skill | Useful detail to provide |
| --- | --- | --- |
| New machine/workspace or extra capability | `qs-video-setup` | Workspace path and requested work |
| A few trims, conversions, resize or extraction | `qs-video-quick` | Inputs, output directory, format, boundaries |
| Transcript, corrections, captions | `qs-video-transcribe` | Sources/language, verified names, edited timeline if any |
| Titles, overlays or standalone motion | `qs-video-graphics` | Text, style, duration, aspect ratio, alpha requirement |
| A film or sustained revision | `qs-video-edit` | Workspace/job, audience, deliverables, must-keep/exclude decisions |
| Quality check of an existing revision | `qs-video-review` | Exact render/timeline, check types, known concerns |

In Codex's skill picker select the namespaced entry, for example `$qs-video-editor:qs-video-quick`, when that is how the installed host displays it. Natural-language requests work too. Optional capabilities should not become a checklist imposed on every job.

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

## A sustained edit in practice

1. Name the existing job or create one once. Confirm audience, deliverables, privacy, must-keep material and style.
2. Probe sources and retain checksums. Synchronize/transcribe only material that needs it.
3. Build a source-linked selection/story map. Review editorial compression before spending time on finishing.
4. Review an early sample. Make graphics as independent layers, then finish dialogue, ambience, music and captions.
5. Review the exact render. Keep technical, motion, listening, editorial/privacy and import results separate.
6. Deliver a reviewed render plus the requested editable package, relink map, source ranges, graphics source, stems and captions. Preserve earlier approved versions.

For documentary/wedding work, silence removal, hook-first restructuring and reaction substitution are not automatic defaults. A transcript is evidence of words, not proof of identity, facial reactions or chronology.

## Terminal workflow

After [workspace setup](installation.md), use the bound launcher from its root. Helpful commands:

```bash
node .video-editor/run.mjs --help
node .video-editor/run.mjs check --profile quick
node .video-editor/run.mjs scaffold --name "Client Interview" --kind documentary
node .video-editor/run.mjs evidence --project projects/client-interview --json
node .video-editor/run.mjs resolve --help
```

Scaffold sustained jobs only after selecting the full profile. It supports `documentary`, `wedding`, and `talking-head`; explicit `--project <path>` is available. Evidence output is a compact, hash-bound project/timeline summary, not a claim that footage has been watched.

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

Ordinary requested local editing covers necessary reversible processing. Reuse valid approvals for the same scope. External upload/generation, installs, publishing, destructive cleanup, and replacing approved outputs need their own authorization where it is not already given.

Final delivery uses the reviewed render's SHA-256 and current timeline SHA-256 in both QA and its export approval entry. Keep those facts with the actual human decision; do not fabricate an approval to satisfy a script. A later change to the bytes or timeline blocks promotion. Existing legacy records remain intact; ambiguous revision coverage is a review decision, not permission to broaden them.

WhisperX normalization, waveform synchronization, semantic clip ranking and full finishing still include tool-directed/manual work. The Resolve bridge implements version-1 hard-cut assembly; unsupported transitions, retimes, captions and advanced finishing require explicit treatment in the editor. See [capabilities](../runtime/references/capabilities.md) for the boundary.
