---
name: qs-video-review
description: Review a video revision for technical, visual, audio, editorial, privacy, and editor-import quality with explicit coverage.
---

# qs-video-review

Read the QA reference. Establish the exact input/render hash and timeline revision. Select relevant technical, visual/motion, listening, editorial/privacy and import passes; report each as passed, failed, blocked or not-run. Sample heads/tails, cut boundaries, and representative interior points; use shot and transcript evidence when available. Stills do not prove motion or listening. Give timestamped actionable findings and never rewrite the edit during review.

Read [shared invariants](../../runtime/references/shared.md) before media work and [setup](../../docs/installation.md) for commands and version binding. Resolve the plugin root as two directories above this skill; never assume an author's checkout path. Every helper lives once in `runtime/scripts/`. From a workspace, prefer `node .video-editor/run.mjs <command>` so the recorded runtime version is used. Run `--help` before composing unfamiliar commands.

Read only the relevant shared references: [quick operations](../../runtime/references/quick-operations.md), [rough cut](../../runtime/references/rough-cut.md), [graphics](../../runtime/references/graphics.md), [pipeline](../../runtime/references/pipeline.md), [Resolve](../../runtime/references/resolve.md), [QA](../../runtime/references/qa.md), and [schemas](../../runtime/references/schemas.md).
