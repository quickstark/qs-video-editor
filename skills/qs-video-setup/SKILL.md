---
name: qs-video-setup
description: Set up local video editing capabilities and independent workspaces, or migrate a legacy edit-video workspace.
---

# qs-video-setup

Inspect the requested output and existing workspace. Read the shared setup guide. Select quick, graphics, transcribe, or full; add only capabilities actually needed. Run the bootstrap or migration plan first, then apply local changes already authorized by the user. Bootstrap does not install dependencies or select a media project. Never scaffold over an existing job.

Read [shared invariants](../../runtime/references/shared.md) before media work and [setup](../../docs/installation.md) for commands and version binding. Resolve the plugin root as two directories above this skill; never assume an author's checkout path. Every helper lives once in `runtime/scripts/`. From a workspace, prefer `node .video-editor/run.mjs <command>` so the recorded runtime version is used. Run `--help` before composing unfamiliar commands.

Read only the relevant shared references: [quick operations](../../runtime/references/quick-operations.md), [rough cut](../../runtime/references/rough-cut.md), [graphics](../../runtime/references/graphics.md), [pipeline](../../runtime/references/pipeline.md), [Resolve](../../runtime/references/resolve.md), [QA](../../runtime/references/qa.md), and [schemas](../../runtime/references/schemas.md).
