# Video Editor plugin source

This repository contains the local Video Editor plugin and its preserved migration history. Read README.md and docs/migration-spec.md before changing implementation. Current readiness and observed checks are recorded in docs/draft-inspection.md. Historical inspection findings are separate from the current implementation; do not reintroduce them as current status.

Keep the six workflow skills thin. Maintain one shared runtime under runtime/; do not copy it into each skill or workspace. Workspaces, media, project manifests, approvals, installed dependencies, and model caches belong outside this plugin repository. Existing projects were explicitly migrated to the sibling video-workspaces/main workspace. The old video-editor entry is only a compatibility symlink for saved absolute paths; do not recreate a plugin implementation there.

Never infer the active job from example names. Preserve raw sources, exact rational timebases, stable source IDs, approved revisions, dependency pins, and scoped approvals. Do not infer an upload or final-delivery approval from local editing authorization. Read the relevant project instructions before media work.

The historical implementation has known installation and portability gaps. Passing the existing helper suites does not qualify the plugin for installation or release. Do not advertise a missing command, stage, test, native editor export, or listened/watched review as completed.

Run checks proportionate to the changed implementation. Use isolated synthetic fixtures; remove temporary test files. Keep runtime changes separate from planning/documentation changes and record them in Git. Publish only after the release gates in docs/release.md pass and publication is authorized.
