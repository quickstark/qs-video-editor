# Migration and verification record

Updated 2026-10-29. This is the source/readiness record, not a claim that a real film was watched, transcribed, rendered with every backend, or imported into an editor.

## Preserved draft

The earlier session left a repository in `/tmp/video-editor-plugin-914p4ung`, blocked from its intended destination. It contained commits `cbe986b` and `fe8ac88`, plus a staged move into `runtime/`. The move removed discovery/bootstrap/packaging files without replacement. The earlier README referenced a missing `bootstrap-test.mjs` and incorrectly implied those bootstrap/package checks were available.

The repository was moved into `Github/Personal/video-editor-plugin`. All 50 working files, the commit head and staged status matched before and after. `git fsck --full` passed. Commit `849c1d6` preserves the unfinished structure unchanged. It is a checkpoint, not a release.

The original baseline passed 8 Node helper groups and 33 Python Resolve contract tests. Those checks did not establish installation, profile bootstrap, renderer/ASR compatibility or native editor import.

## Implementation

- Six thin skills and synchronized portable/Codex manifests share one runtime.
- Workspace profiles, receipt/version binding and known legacy npm caller migration preserve independent project state.
- Quick operations use source hashes, unique derivative outputs and per-plan resumable receipts.
- Caption mapping retains rational timeline ranges and flags word intersections/missing alignment.
- Compact project evidence and frame sampling coverage distinguish known artifacts from unperformed visual/audio checks.
- Promotion binds QA/export approval to reviewed render and timeline hashes; Resolve accepts an expected timeline hash before mutation.
- Documentation and an allowlisted reproducible package builder support private distribution.

## Verification

| Check | Observed state |
| --- | --- |
| Original source/history move | Passed: 50 files, commit and staging preserved |
| Original baseline | Passed: 8 Node groups, 33 Resolve cases |
| New runtime regression tests | Passed: 11 tests, including real FFmpeg media, resumption, stale sources/timelines, caption remapping, explicit update/rollback and package reproducibility |
| Complete suite in extracted package | Passed: 11 runtime tests, 8 helper groups, 33 Resolve cases, metadata and 79 local documentation links |
| Existing workspace migration | Applied: npm bindings now call the shared runtime; 4,370 protected project/config records unchanged, including 327 content hashes |
| Local Codex host install/discovery | Version 0.2.0 installed and enabled; all six QS skills are discoverable with no legacy skill aliases or host errors. Installed conversion, actual 0.1.0-to-0.2.0 update/rollback, uninstall safe stop and reinstall recovery passed. |
| Fresh HyperFrames/WhisperX install and backend render/transcription | Not run; existing pins preserved |
| Real Resolve native export/import | Not run; contract/portable fixtures are separate evidence |
| Windows/Linux | Not run |
| GitHub push | Repository `quickstark/qs-video-editor` is empty; Git transport is now reachable. Sanitized source publication remains pending independent remote readback. |
| Public directory readiness | Not ready: license/public URLs/publication metadata and directory review remain separate; the packaged QS logo is present. |

No historical claim has been converted into release evidence. See [release gates](release.md) and [acceptance matrix](migration-spec.md).

## Cleanup

On 2026-10-29 the source checkout was renamed from `video-editor-plugin` to `qs-video-editor` to match its GitHub repository. Commit `41e08ab` and the runtime implementation were preserved. The supported migration command updated only the existing workspace receipt's runtime location, retaining its workspace identity, runtime digest, capabilities and approvals, with the prior receipt backed up locally. Verification found 4,790 other inventoried workspace records unchanged, and the bound environment check passed. The separate media workspace was retained until the user explicitly authorized its relocation.

The user then authorized migration of projects and media and removal of the duplicate plugin implementation. The entire workspace was renamed on the same filesystem to `Github/Personal/video-workspaces/main`. The original `video-editor` entry is now a compatibility symlink for saved absolute paths, not another directory containing a plugin or copied media. All 57 legacy skill files were verified against reachable Git blobs before their workspace copy was removed. The private relocation ledger retains the file/blob mapping for recovery without another live source copy.

Post-move verification found 61,720 inventoried entries and 444 content hashes unchanged, including media, approvals, manifests, outputs, dependency locks and the runtime receipt. Only the workspace README and two obsolete helper commands in its project README changed, with their original bytes retained privately. Historical transcript launcher metadata was preserved. The bound environment check, 8 helper groups and 33 Resolve cases passed from the new location. Python 3.11.15, installed WhisperX 3.8.6 metadata, HyperFrames CLI 0.7.109, GSAP 3.14.2 and 39 legacy interpreter paths were checked without reinstalling dependencies, downloading models, running transcription or importing a real editor project. Codex registration and GitHub publication remain separate pending checks.

The temporary plugin repository was moved, not copied. The temporary review Git directory and state pointers were removed only after verifying their reachable objects existed in the new repository. The redundant work-in-progress bundle was removed after its commits were verified in the new Git history. Test archives/extracted source and synthetic media are temporary and cleaned after verification. Existing media/project output is preserved.

## QS namespace candidate 0.2.0

The plugin, marketplace, package and six public skill names now use the QS namespace. A shared transparent RGBA logo (1254 × 1254, below 5 MiB) is included in both manifests, all six skill UI records, and the reproducible checksum package. Public fixture examples use generic project/speaker names; private media and legacy history are excluded from the intended public snapshot.

Current source checks passed: metadata and local documentation links; 11 runtime tests including explicit update/rollback preservation and reproducible packaging with extracted metadata validation; 8 helper groups; 33 Resolve tests. YAML was parsed for all six skill/frontmatter pairs, and the logo's transparency and package dimensions were checked. These checks do not establish a fresh live host update or a real native editor import.

The existing media workspace is now explicitly bound to the installed 0.2.0 runtime cache. Its environment check passed. Of 61,730 inventoried file records, only the runtime receipt changed; all 61,729 protected records and 328 content-hashed records remained unchanged. One backup preserves the previous receipt. The workspace identity, dependencies, approvals and outputs are preserved. The legacy plugin was removed through the supported CLI after the new binding passed. Restoring the previous runtime from local-only private checkpoint `a8e00db` was tested in a temporary directory; its digest matched the original 0.1.0 binding exactly.

GitHub source publication and final sanitized-history verification are pending. Do not push the private migration ancestry or treat this checkpoint as a published/tagged release.
