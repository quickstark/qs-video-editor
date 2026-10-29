---
name: qs-video-quick
description: Perform single or batch local video trims, conversions, resizing, and audio extraction without a full editorial project.
---

# qs-video-quick

Read the quick-operation reference. For repeatable single/batch work use the shared quick command with a schema-versioned JSON plan. Probe every input, show realized trim policy, write unique derivatives, and retain the per-item report. Plan mode is read-only; apply only within the user request. No transcript, renderer, or editor is needed. Preserve sources and check every output.

Read [shared invariants](../../runtime/references/shared.md) before media work and [setup](../../docs/installation.md) for commands and version binding. Resolve the plugin root as two directories above this skill; never assume an author's checkout path. Every helper lives once in `runtime/scripts/`. From a workspace, prefer `node .video-editor/run.mjs <command>` so the recorded runtime version is used. Run `--help` before composing unfamiliar commands.

Read only the relevant shared references: [quick operations](../../runtime/references/quick-operations.md), [rough cut](../../runtime/references/rough-cut.md), [graphics](../../runtime/references/graphics.md), [pipeline](../../runtime/references/pipeline.md), [Resolve](../../runtime/references/resolve.md), [QA](../../runtime/references/qa.md), and [schemas](../../runtime/references/schemas.md).
