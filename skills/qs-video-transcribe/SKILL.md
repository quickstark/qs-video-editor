---
name: qs-video-transcribe
description: Transcribe local audio or video, review word timing and corrections, and prepare captions for an edited timeline.
---

# qs-video-transcribe

Read the rough-cut reference. Use the workspace transcription capability and shared WhisperX launcher. Preserve original ASR output; verify names and uncertain words against audio. Use captions.mjs only with explicit source-to-timeline ranges and corrected timed words. Flag unaligned words; never invent precise timestamps. Skip diarization unless needed and authorized.

Read [shared invariants](../../runtime/references/shared.md) before media work and [setup](../../docs/installation.md) for commands and version binding. Resolve the plugin root as two directories above this skill; never assume an author's checkout path. Every helper lives once in `runtime/scripts/`. From a workspace, prefer `node .video-editor/run.mjs <command>` so the recorded runtime version is used. Run `--help` before composing unfamiliar commands.

Read only the relevant shared references: [quick operations](../../runtime/references/quick-operations.md), [rough cut](../../runtime/references/rough-cut.md), [graphics](../../runtime/references/graphics.md), [pipeline](../../runtime/references/pipeline.md), [Resolve](../../runtime/references/resolve.md), [QA](../../runtime/references/qa.md), and [schemas](../../runtime/references/schemas.md).
