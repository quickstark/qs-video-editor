# Changelog

## 0.2.0 — QS namespace and packaged logo

- Rename the plugin to `qs-video-editor` and expose six `qs-video-*` skills, including `qs-video-edit` for sustained editorial work.
- Package one generated QS logo and reference it from plugin and skill metadata; keep binary assets in the reproducible checksum archive.
- Namespace the marketplace to `qs-video-editor-local`; preserve the workspace format and dependency pins. Existing workspaces use an explicit version-binding migration.
- Document replacement of the former installed `video-editor` identity so its old skill names can be retired after the new plugin is installed.

## 0.1.0 — local migration candidate

- Split the original edit-video workflow into setup, quick, transcribe, graphics, full editorial and review skills over one runtime.
- Add independent workspace bootstrap, selective profiles, runtime binding and legacy npm caller migration.
- Add hash-resolved single/batch plans, exclusive derivative outputs, receipts and resumable sequential processing.
- Add compact source-linked project evidence and rational-time caption remapping with speech-boundary warnings.
- Bind delivery QA and approval to reviewed render/timeline hashes; add stale-plan checks to Resolve.
- Preserve legacy source/history and project data; add usage, installation, migration, research and release documentation.
- Add reproducible allowlisted packaging and synthetic-media regression checks.

Native editor import, a fresh renderer/ASR installation, Windows/Linux and public directory release are separately qualified; no dependency upgrade is implied by this candidate.
