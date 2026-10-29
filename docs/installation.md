# Install and set up a workspace

Install the plugin once, then create a separate workspace for your media and project files. Each workspace keeps its own dependencies and runtime binding.

## Requirements

Installing from source needs Git and a Codex CLI that supports `codex plugin`. The commands below were checked against `codex-cli 0.163.0`.

| Work | Required tools | Additional setup |
| --- | --- | --- |
| Trims, conversions, resizing, audio extraction | Node.js 22+, FFmpeg, ffprobe | None from this plugin |
| Motion graphics | Quick tools, workspace-pinned HyperFrames/GSAP, compatible browser | Install the workspace's locked npm packages |
| Local transcription | Quick tools, uv, Python 3.11, WhisperX | Install locked Python packages; models download on first use |
| Portable Resolve interchange | Python 3.11 | No editor or transcription model needed |
| Native Resolve handoff | Compatible installed/running Resolve with scripting available | Install and check Resolve separately |

The local core needs no API key. Speaker diarization and optional remote services have their own requirements. Tool binaries and model weights are not bundled. macOS helper and synthetic-media checks have passed; fresh renderer/ASR installs, native editor import, and Windows/Linux are [unverified](draft-inspection.md).

## 1. Install the plugin

Run this in a terminal. If you already have the checkout, skip the clone and change to its directory.

```bash
git clone https://github.com/quickstark/qs-video-editor.git
cd qs-video-editor

codex plugin marketplace add "$PWD"
codex plugin add qs-video-editor@qs-video-editor-local --json
codex plugin list --marketplace qs-video-editor-local --json
```

The install result includes `installedPath`, the absolute path to the cached plugin. Keep that value for terminal workspace setup. The listing should show `qs-video-editor@qs-video-editor-local`, version `0.2.0`, installed and enabled.

Reload Codex if its picker has not refreshed. It should show six skills: `qs-video-setup`, `qs-video-quick`, `qs-video-transcribe`, `qs-video-graphics`, `qs-video-edit`, and `qs-video-review`, under the `qs-video-editor` namespace. The plugin contains their shared runtime; copying a single skill folder is not a complete installation.

For the original `video-editor@video-editor-local` installation, follow the [namespace migration](namespace-migration.md). For a Git marketplace instead of a checkout, the CLI accepts `codex plugin marketplace add quickstark/qs-video-editor --ref <reviewed-commit>`. Use an existing reviewed commit; no release tag has been published.

## 2. Create a workspace

In Codex, select `$qs-video-editor:qs-video-setup` and ask:

```text
Create a workspace at ~/video-workspaces/first-edit using the installed
QS Video Editor runtime. I need batch conversions only. Check the quick
profile, show the setup plan, create the workspace, and verify it.
Keep it outside the plugin checkout.
```

For terminal setup, replace `QS_VIDEO_PLUGIN` with the `installedPath` from the install result. Choose a new workspace outside the plugin:

```bash
QS_VIDEO_PLUGIN="/absolute/path/from/installedPath"
QS_VIDEO_WORKSPACE="$HOME/video-workspaces/first-edit"

node "$QS_VIDEO_PLUGIN/runtime/scripts/video.mjs" bootstrap --workspace "$QS_VIDEO_WORKSPACE" --profile quick --json
node "$QS_VIDEO_PLUGIN/runtime/scripts/video.mjs" bootstrap --workspace "$QS_VIDEO_WORKSPACE" --profile quick --apply --json

cd "$QS_VIDEO_WORKSPACE"
node .video-editor/run.mjs check --profile quick
```

Read the first command's plan before running `--apply`. The plan writes nothing. Apply creates the receipt, launcher, and selected configuration; it installs no packages and copies no media. A successful check reports `Ready (quick)` and lists Node, FFmpeg, and ffprobe.

You can use a source checkout as `QS_VIDEO_PLUGIN` for development. Keep that checkout available: the workspace binds to its runtime content, and later runtime changes require migration.

## 3. Add only the capabilities you need

| Profile | Use for | Files added |
| --- | --- | --- |
| `quick` | Trims, conversions, resizing, extraction | Launcher, receipt, npm aliases |
| `graphics` | Titles, overlays, motion graphics | Graphics dependency lock and brand/style files |
| `transcribe` | Local transcripts and captions | Python manifest and lock |
| `full` | Sustained editorial projects | Brand/style files and editorial configuration |

`full` includes quick processing and editorial setup. Add graphics, transcription, or portable Resolve explicitly when needed. Applying another profile adds capabilities while preserving existing customization. Conflicting dependency files require a reviewed merge.

For example, add graphics using the same plugin and workspace paths:

```bash
node "$QS_VIDEO_PLUGIN/runtime/scripts/video.mjs" bootstrap --workspace "$QS_VIDEO_WORKSPACE" --profile graphics --json
node "$QS_VIDEO_PLUGIN/runtime/scripts/video.mjs" bootstrap --workspace "$QS_VIDEO_WORKSPACE" --profile graphics --apply --json

cd "$QS_VIDEO_WORKSPACE"
npm ci
npm run hyperframes:doctor
node .video-editor/run.mjs check --profile graphics
```

For transcription, preview and apply the `transcribe` profile, then run `npm run video:python:sync` from the workspace and `node .video-editor/run.mjs check --profile transcribe`. Python 3.11 and uv must already be available. Package installation uses the checked-in lock; the first transcription may download model weights.

Both package-install commands download dependencies. Run them in the workspace for the requested capability. For a combined setup, the dispatcher also accepts `--profile full --capabilities graphics,transcribe,resolve-portable`.

## Use an existing workspace

Resume its existing projects. To update legacy command bindings or select a different runtime, preview a migration with the chosen plugin:

```bash
QS_VIDEO_PLUGIN="/absolute/path/to/the/reviewed/plugin"
QS_VIDEO_WORKSPACE="/absolute/path/to/existing-workspace"

node "$QS_VIDEO_PLUGIN/runtime/scripts/video.mjs" migrate --workspace "$QS_VIDEO_WORKSPACE" --json
node "$QS_VIDEO_PLUGIN/runtime/scripts/video.mjs" migrate --workspace "$QS_VIDEO_WORKSPACE" --apply --json

cd "$QS_VIDEO_WORKSPACE"
node .video-editor/run.mjs check --profile full
```

Migration updates known legacy npm commands and the runtime binding. It backs up replaced configuration and the previous receipt under `.video-editor/backups/`. It preserves project IDs, media, approvals, dependency locks, and customized brand/style files. Unknown legacy commands stop the plan for review. Repeating a matching migration makes no changes.

Keep an earlier runtime available until the new binding passes its check. Then retire any old plugin or source copy whose callers have been migrated. The original private implementation is recoverable only from the maintainer's preserved local history, not from this public branch.

## Version binding and rollback

`.video-editor/workspace.json` records the workspace identity, capabilities, runtime version/digest/location, and template hashes. The launcher stops if the recorded runtime is missing or its content differs. Restore that runtime or preview an explicit migration; do not edit the receipt to bypass the check.

To roll back, restore the reviewed earlier runtime at an available location and use its own migration plan and apply commands. Inspect the receipt/configuration backups first, then check the restored binding. Preserve outputs created since the update. There is no automatic deletion or destructive rollback command.

Moving a media workspace is a separate operation. Preserve its complete inventory, hashes, dependencies, and project files, then check it at the new location. Saved editor exports or Python launchers may contain absolute paths and need relinking. The maintainer's earlier relocation and compatibility symlink are recorded in the [verification history](draft-inspection.md).

## Troubleshooting

| Problem | Next action |
| --- | --- |
| `codex plugin` is unavailable | Use a Codex CLI with plugin support; the commands were checked on 0.163.0 |
| Skills are absent from the picker | Check the plugin listing, then reload Codex |
| Workspace/runtime differs | Restore the recorded runtime or preview migration to a reviewed version |
| Setup reports conflicts | Inspect the listed files; migrate an existing workspace instead of replacing its configuration |
| A setup/quick lock exists | Check whether its owning process is running before retrying |
| HyperFrames/WhisperX is missing | Add and install that capability in the workspace |
| Resolve is unavailable | Use portable interchange and record native import as unverified |
| An approval does not cover the render | Review the current revision and record a decision for that exact output |

Continue with the [usage guide](usage.md). For release evidence and remaining limits, see the [verification record](draft-inspection.md).
