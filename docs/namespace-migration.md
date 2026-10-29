# Upgrade to the QS namespace

Version `0.2.0` uses the plugin/repository name `qs-video-editor`, marketplace `qs-video-editor-local`, and six QS skill names:

| Previous skill | Current skill |
| --- | --- |
| `video-setup` | `qs-video-setup` |
| `video-quick` | `qs-video-quick` |
| `video-transcribe` | `qs-video-transcribe` |
| `video-graphics` | `qs-video-graphics` |
| `edit-video` | `qs-video-edit` |
| `video-review` | `qs-video-review` |

The plugin and all six skills use the same packaged QS logo. The new package contains no legacy skill aliases.

## 1. Install the new plugin

From the source checkout, register and install it:

```bash
codex plugin marketplace add /absolute/path/to/qs-video-editor --json
codex plugin add qs-video-editor@qs-video-editor-local --json
```

The second command prints `installedPath`. Use that cached plugin path for the migration below. Installing the new plugin leaves the workspace bound to its previous runtime until you migrate it.

## 2. Migrate and check the workspace

Replace both paths. Read the plan before applying it, and check the resulting binding before removing the old plugin.

```bash
QS_VIDEO_PLUGIN="/absolute/path/from/installedPath"
QS_VIDEO_WORKSPACE="/absolute/path/to/video-workspaces/main"

node "$QS_VIDEO_PLUGIN/runtime/scripts/video.mjs" migrate --workspace "$QS_VIDEO_WORKSPACE" --json
node "$QS_VIDEO_PLUGIN/runtime/scripts/video.mjs" migrate --workspace "$QS_VIDEO_WORKSPACE" --apply --json

cd "$QS_VIDEO_WORKSPACE"
node .video-editor/run.mjs check --profile full --json
```

Migration backs up the previous receipt and any replaced configuration. It preserves workspace identity, project files, dependency locks, approvals, and outputs.

## 3. Remove the old identity

After the new binding passes, remove the original plugin and marketplace if they are still present:

```bash
codex plugin remove video-editor@video-editor-local --json
codex plugin marketplace remove video-editor-local --json
codex plugin list --marketplace qs-video-editor-local --json
```

If a removal reports that the old identity is already absent, continue to verification. The listing should show version `0.2.0`, installed and enabled. Reload Codex and check that its picker shows the six QS names and no old `video-editor:` entries. New installations need no removal steps.

## Workspace compatibility

The internal `.video-editor/` directory, receipt engine ID `video-editor`, and workspace-local `video:*` npm commands keep their existing names for compatibility. They are separate from the public plugin/skill names.

The namespace change does not rename private projects, re-transcribe media, render a film, update dependencies, or grant an approval. Public examples use generic names; existing project records retain their original names and paths.

## Rollback

Keep a reviewed earlier runtime available until the new installation and workspace check pass. To restore that runtime, follow the [rollback procedure](installation.md#version-binding-and-rollback). Use the earlier runtime's migration command and preserve all outputs created since the update.

Update/rollback contract tests and a live installed-version recovery check passed on macOS; details are in the [verification record](draft-inspection.md). Those checks do not establish native editor import. Pre-QS checkpoints are retained only in the maintainer's private local history; there is no earlier public release tag.
