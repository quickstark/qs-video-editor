---
name: qs-video-edit
description: Create or revise a sustained local video edit with source-linked decisions, review renders, and an editable Resolve or portable handoff.
---

# qs-video-edit

Select the existing workspace/job explicitly, read project.json, brief, local brand/style, manifests and approvals, then the pipeline reference. Resume verified stages; do not rerun completed work without invalidation. FFmpeg owns media processing, local WhisperX is optional, HyperFrames supplies graphics, and Resolve supplies native exports only when connected and verified. Use portable interchange offline. Keep meaning and chronology truthful, require reviewed story decisions before compression, and preserve separate editable tracks.

Read [shared invariants](../../runtime/references/shared.md) before media work and [setup](../../docs/installation.md) for commands and version binding. Resolve the plugin root as two directories above this skill; never assume an author's checkout path. Every helper lives once in `runtime/scripts/`. From a workspace, prefer `node .video-editor/run.mjs <command>` so the recorded runtime version is used. Run `--help` before composing unfamiliar commands.

Read only the relevant shared references: [quick operations](../../runtime/references/quick-operations.md), [rough cut](../../runtime/references/rough-cut.md), [graphics](../../runtime/references/graphics.md), [pipeline](../../runtime/references/pipeline.md), [Resolve](../../runtime/references/resolve.md), [QA](../../runtime/references/qa.md), and [schemas](../../runtime/references/schemas.md).
