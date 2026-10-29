# Workspace bootstrap and migration

Use the shared `runtime/scripts/video.mjs` dispatcher. From an existing workspace prefer `node .video-editor/run.mjs` so runtime version/digest binding is checked. The plugin and workspace are independent.

Profiles are quick, graphics, transcribe and full. Full adds editorial setup; graphics, transcription and portable Resolve Python support remain selective capabilities. Bootstrap defaults to a read-only plan and --apply writes only setup files. It performs no install, download, media copy, account change or editor launch.

First-run conflicts block the complete plan. After setup, matching/missing files can be restored while customization remains user-owned. Symlink destinations and overlapping roots are refused. A setup lock serializes writes. Different runtime content requires an explicit reviewed migration.

Migration changes known legacy npm helper bindings and records original replaced config bytes in local backups. Project state, approvals, locks, sources, outputs, local styles and brand remain intact. Restore a recorded runtime if its source/cache is unavailable; never silently use the latest version. Retire legacy copies only once callers are migrated and the new host installation works.

Run `npm test` for current bootstrap/migration/package regressions and `npm run test:helpers` / `npm run test:resolve` for the preserved helper contracts. See [installation](../../docs/installation.md) and [release preparation](../../docs/release.md). The historical bootstrap-test.mjs was absent; no current documentation claims it ran.
