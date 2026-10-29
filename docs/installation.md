# Install, set up, and migrate

The plugin contains instructions and a shared local runtime. A workspace contains your media, project decisions, dependency pins, environments, and outputs. Keep them in separate directories. Installing or updating the plugin never upgrades a project's dependencies or starts an edit.

## Requirements

| Work | Required tools | Setup downloads |
| --- | --- | --- |
| Quick local processing | Node 22+, FFmpeg, ffprobe | None from this plugin |
| Motion graphics | Quick tools, workspace-pinned HyperFrames/GSAP, browser | `npm ci` after setup |
| Local transcription | Quick tools, uv, Python 3.11, WhisperX | Locked packages, then model weights on first use |
| Portable Resolve interchange | Python 3.11 | No editor or ASR model required |
| Native Resolve handoff | Compatible installed/running Resolve with scripting available | Resolve is installed separately |

No API key is required for the local core. Diarization and optional remote tools have their own requirements. The macOS helper and synthetic-media tests are exercised locally; Windows/Linux and real renderer/transcription/editor import have separate verification requirements. Node/Python helpers do not bundle executable tools or model weights.

## Install the six skills

From a checked-out repository, use the installed Codex CLI's local marketplace flow:

```bash
codex plugin marketplace add /absolute/path/to/qs-video-editor
codex plugin add qs-video-editor@qs-video-editor-local
codex plugin list --marketplace qs-video-editor-local --json
```

These commands were checked against `codex-cli 0.163.0` help. They write Codex's plugin configuration/cache, so the host must allow that location. Reload Codex if discovery does not refresh. Verify that `qs-video-setup`, `qs-video-quick`, `qs-video-transcribe`, `qs-video-graphics`, `qs-video-edit`, and `qs-video-review` appear. Do not install six separate copies of the runtime or copy only a skill folder: its references point to the shared runtime.

For a GitHub install, register the repository/ref supported by your CLI instead of a local path. Pin a reviewed tag or commit. Installation alone does not prove that all optional capabilities are ready.

For the previously installed `video-editor@video-editor-local`, use the [namespace migration](namespace-migration.md) rather than keeping both identities installed. The compatibility directory `.video-editor/`, existing `video:*` npm aliases, and receipt engine ID stay unchanged so historical workspaces keep working.

## Create a workspace

The easiest prompt is:

> Use qs-video-setup to create a workspace at `<path>`. I need batch conversions only. Check the quick profile, preview the setup, then create it. Keep the workspace outside the plugin.

Equivalent terminal commands, replacing both absolute paths:

```bash
VIDEO_EDITOR_PLUGIN=/absolute/path/to/qs-video-editor
VIDEO_WORKSPACE=/absolute/path/to/video-workspaces/my-film
node "$VIDEO_EDITOR_PLUGIN/runtime/scripts/video.mjs" bootstrap --workspace "$VIDEO_WORKSPACE" --profile quick
node "$VIDEO_EDITOR_PLUGIN/runtime/scripts/video.mjs" bootstrap --workspace "$VIDEO_WORKSPACE" --profile quick --apply
cd "$VIDEO_WORKSPACE"
node .video-editor/run.mjs check --profile quick
```

The plan creates nothing. Apply writes a receipt, a thin bound launcher, and selected neutral configuration. It installs nothing and never copies footage. Paths containing spaces work when quoted.

| Profile | Use for | What it adds |
| --- | --- | --- |
| `quick` | Trims, conversions, resizing, extraction | Minimal launcher/receipt and npm aliases |
| `graphics` | Titles, overlays, motion graphics | Graphics lock and neutral brand/style files |
| `transcribe` | Local transcripts/captions | Python manifest/lock; no renderer |
| `full` | Sustained editorial projects | Brand/styles and editorial setup; other capabilities remain selective |

Add capabilities explicitly when needed, for example `--profile full --capabilities graphics,transcribe,resolve-portable`. Applying an additional profile preserves existing customization; it never removes a capability. A conflicting pre-existing dependency lock requires a reviewed merge. Run `npm ci` only for graphics and `npm run video:python:sync` only for transcription, within the user's setup authorization. Both may download packages. First transcription may also download models.

## Use an existing workspace

Do not bootstrap over it or rerun project scaffolding. First inspect and migrate its command bindings:

```bash
node "$VIDEO_EDITOR_PLUGIN/runtime/scripts/video.mjs" migrate --workspace /absolute/path/to/existing-workspace --json
node "$VIDEO_EDITOR_PLUGIN/runtime/scripts/video.mjs" migrate --workspace /absolute/path/to/existing-workspace --apply --json
```

The adapter rewrites known legacy npm helper paths to `.video-editor/run.mjs`, adds a workspace receipt, and keeps original replaced configuration in local migration backups. It preserves project data, approvals, user scripts, dependency declarations/locks, and local brand/styles. Unknown legacy script names stop the plan so they can be mapped deliberately. Applying the same migration again is a no-op.

Legacy source copies may still be needed by commands recorded in old project documents. Retire a redundant implementation only after its callers have been migrated, the shared runtime has been checked, and every original file is recoverable from Git history. A thin compatibility launcher can preserve an old command without retaining another implementation. Check Codex discovery separately: retiring a legacy skill does not register the new plugin. The old source and review drafts are retained in Git history.

## Relocate a media workspace

The `migrate` command above updates command bindings; it does not move project media. An authorized filesystem relocation must preserve the complete workspace, including dependency environments, caches, project instructions, IDs, manifests, approvals and outputs. Inventory file identities and hash durable records before moving; prefer a rename on the same filesystem so media is moved rather than copied. Keep a local relocation record and verify the new workspace through its bound launcher before retiring redundant code.

This workspace was relocated to `Github/Personal/video-workspaces/main`. Its inventory, documentation backups, path mapping and retired-skill Git blob identities are recorded under `.video-editor/relocations/2026-10-29-workspace-move/` in that private workspace. Its receipt still binds the same workspace identity and runtime digest to `qs-video-editor`.

The old `Github/Personal/video-editor` path remains a symlink to the relocated workspace because historical editor exports and Python entrypoints embed that absolute path. It adds no second implementation or duplicate media. Retain the link until those consumers have been explicitly relinked and tested. Do not bulk-rewrite approved manifests, historical run evidence or saved editor packages merely to change a filesystem path. A real editor import remains a separate verification step.

## Version binding and rollback

`.video-editor/workspace.json` records workspace identity, capabilities, template hashes, plugin version/digest, and the runtime location. The launcher refuses different runtime content. Restore the recorded version if the plugin was uninstalled, the cache was evicted, or the source checkout changed. Then preview an explicit migration to change the binding. Do not repair a mismatch by editing the receipt by hand.

Migration backups in `.video-editor/backups/` retain original replaced file bytes and the prior receipt. A rollback restores those configuration bytes/binding; it never deletes new media, outputs, or decisions. Inspect the exact backup before restoration and verify the runtime it points to exists. There is no automatic destructive rollback command.

## Troubleshooting

| Message | Next action |
| --- | --- |
| Workflow absent from Codex | Verify marketplace registration and plugin listing, then reload; a repository path alone is not an installation |
| Workspace/runtime differs | Restore the bound release or preview a migration; avoid silently using newer code |
| Conflicting workspace files | Review the listed files; use migration for an existing workspace |
| Setup/quick lock present | Check whether its owning process is running; do not remove a live lock |
| HyperFrames/WhisperX missing | Enable and install only that capability in this workspace |
| Resolve unavailable | Use verified portable interchange; identify native export/import as not run |
| Approval does not cover render | Read existing records; obtain a decision on the current concrete revision only if scope is missing |

See [optimal use](usage.md) for the editing workflows and [release preparation](release.md) for verification limits.
