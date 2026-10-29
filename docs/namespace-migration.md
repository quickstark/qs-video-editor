# Upgrade to the QS namespace

Version 0.2.0 uses the repository/package/plugin name `qs-video-editor`, marketplace `qs-video-editor-local`, display name **QS Video Editor**, and six skill names:

| Previous skill | Current skill |
| --- | --- |
| `video-setup` | `qs-video-setup` |
| `video-quick` | `qs-video-quick` |
| `video-transcribe` | `qs-video-transcribe` |
| `video-graphics` | `qs-video-graphics` |
| `edit-video` | `qs-video-edit` |
| `video-review` | `qs-video-review` |

The package contains one logo at `assets/qs-video-editor.png`; both plugin manifests and all six skill UI metadata files reference it. There are no duplicate legacy skill aliases.

## Replace the original installed plugin

Use a terminal/session allowed to write the Codex user configuration and cache. A successful source change does not reinstall a cached plugin. Replace both absolute paths below. Run each step only after the preceding step succeeds:

```bash
codex plugin marketplace add /absolute/path/to/qs-video-editor --json
codex plugin add qs-video-editor@qs-video-editor-local --json
node /absolute/path/to/qs-video-editor/runtime/scripts/video.mjs migrate --workspace /absolute/path/to/video-workspaces/main --json
node /absolute/path/to/qs-video-editor/runtime/scripts/video.mjs migrate --workspace /absolute/path/to/video-workspaces/main --apply --json
node /absolute/path/to/video-workspaces/main/.video-editor/run.mjs check --profile full --json
codex plugin remove video-editor@video-editor-local --json
codex plugin marketplace remove video-editor-local --json
codex plugin list --marketplace qs-video-editor-local --json
```

Verify that the new plugin is installed and enabled at version 0.2.0, all six QS skills are present, and the old identity is absent. Reload Codex if the current skill picker still shows its previous catalog. New installations omit the two removal steps.

## Workspace compatibility

The internal `.video-editor/` directory, schema-v1 receipt engine ID `video-editor`, and workspace-local `video:*` npm aliases are compatibility contracts, not extra public plugin names. Existing project IDs, media names, manifests, approvals and dependency locks are preserved. The binding migration updates only the reviewed runtime version/digest/location and backed-up control files; it never re-transcribes, renders or changes an approval.

Sanitizing the public source changes only neutral templates, documentation and synthetic fixtures. It does not rename private projects or rewrite their historical records.

## Update and rollback checks

The regression suite exercises a previous-version fixture, rejection of an unreviewed runtime change, explicit migration to the current runtime, and explicit migration back. It checks stable workspace identity, exact approval/media/lock bytes, and survival of outputs created after the update. These are runtime contract tests, not proof of a live host reinstall or editor import.

Keep a known earlier runtime available until installation and workspace checks succeed. To roll back a workspace, restore that reviewed runtime in a separate location and run its own `migrate --workspace <path>` plan and apply commands. Review the backed-up receipt and keep all newer outputs. Do not edit the receipt manually or reset private projects. Pre-QS history is retained locally for recovery and is excluded from the sanitized public branch; do not assume an earlier public release tag exists.
