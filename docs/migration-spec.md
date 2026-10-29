# QS Video Editor migration and workspace contract

Status: version 0.2.0 source is published and local installation is verified on macOS. Updated 2026-10-29. This document defines the workspace contracts and full acceptance matrix; the [verification record](draft-inspection.md) identifies completed checks and remaining backend/platform work. Public plugin-directory submission is separate.

## Problem and scope

The original skill mixes installation, quick operations, sustained editorial work, graphics, transcription, and review. The preserved draft started separating a shared runtime but removed its discovery and bootstrap entrypoints before replacing them. Ship six focused workflows without six implementations, while retaining independent media workspaces and existing projects.

Scope includes moving and recording the draft, implementing focused entrypoints/profile bootstrap/migration, evaluating AI editing methods, writing documentation, verifying the package, and pushing source to GitHub. No tickets are created. Existing project content and dependency pins are preserved; local command bindings may migrate. System software and media dependency installations are separate.

## Evidence and governing decisions

- The original workspace used `.agents/skills/edit-video/`. Its callers now use the bound shared-runtime launcher, and media lives outside the plugin.
- Historical migration checkpoints remain recoverable locally. Public publication uses a sanitized source snapshot and excludes private legacy history.
- Shared helpers and neutral templates live under `runtime/`; the six QS skills, synchronized manifests, profile bootstrap and allowlisted packager are implemented.
- The preserved Node suite passes 8 groups; Resolve contract tests pass 33 cases. The old README's bootstrap-test claim was not reproducible because that file is absent.
- Keep FFmpeg/ffprobe as media core, WhisperX as current transcription baseline, HyperFrames as preferred graphics renderer, Resolve as optional native editor, and portable interchange as an offline fallback. Do not upgrade existing workspace locks as part of installation.
- Use the versioned local marketplace for installation. Public plugin-directory preparation is a separate release gate.

See [draft inspection](draft-inspection.md) and the source-linked [GitHub evaluation](upstream-evaluation.md). Upstream capabilities are not installed capabilities.

## Domain and ownership

| Concept | Owner and invariant |
| --- | --- |
| Plugin release | Immutable, versioned instructions and shared runtime; no project data or caches |
| Workflow | One user-facing task boundary; calls the shared runtime and reads only relevant references |
| Capability | A tool-backed operation with explicit availability, version, and optional setup |
| Profile | A default capability set; not authorization to install tools or edit media |
| Workspace | User-owned project container with its own pins, environment, cache, and runtime binding |
| Project/job | Stable identity, sources, brief, timeline, stage manifests, reviews, and outputs |
| Approval | Permission for a recorded action, revision/material, destination, and cost scope |
| Stage result | Reusable only while its inputs, parameters, tool/model identity, and dependencies match |

Plugin updates, workspace migrations, dependency upgrades, and editorial revisions are separate operations. No operation silently implies another.

## Architecture boundary

| Alternative | Caller migration | Failure isolation and tests | Decision |
| --- | --- | --- | --- |
| Copy runtime and dependencies into every workflow/workspace | Easy legacy paths, many drift-prone copies | Fixes and upgrades diverge; duplicated tests and large packages | Reject |
| Thin skills over one runtime; workspace-local binding and data | Requires a dispatcher and temporary legacy adapter | Tool failures isolated by capability; one implementation and fixture matrix | Choose |

Target layout consists of portable `plugin.json`, Codex compatibility `.codex-plugin/plugin.json`, a local marketplace descriptor at `.agents/plugins/marketplace.json`, six `skills/<name>/SKILL.md` files with optional UI metadata, shared `runtime/scripts/`, `runtime/references/`, profile definitions, neutral profile templates, and documentation. It needs no MCP server or remote service. A renderer skill or review agent may help but is not a mandatory external plugin dependency.

Each skill resolves the loaded plugin root from its own actual location and invokes the same runtime. Never hardcode this author's home directory, infer a workspace from plugin installation depth, or duplicate safety rules across six scripts. Shared invariants live in one reference that each entrypoint links to; workflow-specific references load on demand.

The portable manifest uses the current Agent Plugins format. The Codex overlay declares `skills: "./skills/"`. Identity, version, descriptions, and supported interface fields must agree. Generate the overlay from one metadata source or validate parity. Verify the target host rather than relying on a schema check alone. Use `qs-video-edit` as the full editorial entrypoint. The former `edit-video` name is migration history; the package has six namespaced skills without duplicate aliases.

## Six workflow contracts

| Workflow | Required behavior | Output and bounded stopping point |
| --- | --- | --- |
| `qs-video-setup` | Inspect host and requested job; preview bootstrap; select/add capabilities; preserve existing files | Workspace receipt and actionable readiness report; setup never starts a film |
| `qs-video-quick` | Probe inputs; plan one or many operations; detect output collisions; execute reversible derivatives | Outputs plus per-item input/output hashes, settings, and status; no forced story/transcript/Resolve |
| `qs-video-transcribe` | Local ASR/alignment; preserve machine output; apply reviewed corrections; retain source time | Transcript and correction history; optionally timeline-aware captions after a cut map exists |
| `qs-video-graphics` | Brief/style-based deterministic compositions; separate review and render | Editable composition source, preview, separate graphic layers; no required whole-film edit |
| `qs-video-edit` | Resume named project or create a new job; selective pipeline stages; current scoped review gates | Review render and editable handoff with separable tracks; native exports only after live verification |
| `qs-video-review` | Select check types and revision; inspect without altering media | Timestamped findings and coverage for technical, visual/motion, listening, editorial/privacy, and import |

Automatic routing chooses the smallest workflow satisfying the request. Explicit selection takes precedence. Selecting full editorial does not force transcription, graphics, cloud generation, or Resolve installation. Missing optional tools block only the requested dependent stage. Review reports distinguish `passed`, `failed`, `not-run`, and `blocked`; extracted stills never count as listening or complete motion review.

## Capability-based bootstrap

| Profile | Required for its work | Workspace setup | Excluded by default |
| --- | --- | --- | --- |
| `quick` | Node 22+, FFmpeg/ffprobe | Minimal receipt, launcher, operation records | Python, models, renderer, Resolve, full project scaffold |
| `graphics` | `quick` + locked HyperFrames/GSAP and browser | Graphics lock/template and composition area | WhisperX, Python ASR environment, Resolve |
| `transcribe` | `quick` + uv, Python 3.11, locked WhisperX | Python lock/environment and workspace-local model cache | Renderer, Resolve, diarization tokens unless requested |
| `full` | `quick`; add transcript/graphics capabilities only for selected stages | Neutral brand/styles, project contracts, selected locks | Remote processing; native Resolve dependency when offline handoff suffices |

Resolve portable validation/export requires Python 3.11 but not WhisperX. Detect that smaller capability independently. Native editor use additionally requires a verified installed version/edition, live bridge, and supported operations. Read-only review with no media processing should not fail merely because FFmpeg is missing.

Shared dispatcher commands:

```text
node <plugin-root>/runtime/scripts/video.mjs bootstrap --workspace <path> --profile quick [--apply] [--json]
node <plugin-root>/runtime/scripts/video.mjs check --workspace <path> --profile quick [--json]
node <plugin-root>/runtime/scripts/video.mjs migrate --workspace <existing-path> [--apply] [--json]
node <plugin-root>/runtime/scripts/video.mjs quick --workspace <path> --plan <operations.json> [--apply] [--json]
```

Bootstrap defaults to a read-only plan and performs no installation, downloads, media reads, editor launch, or account changes. Preflight the entire plan before writes. Reject path traversal, symlink destinations/escape, non-regular files, overlapping plugin/workspace roots, conflicting first-run files, unsupported receipt versions, and unknown profiles. Use argument arrays with no shell interpolation.

`--apply` is the helper's write gate; Codex can use it when the user's setup request already authorizes these local changes. It does not require another permission question. Installations/model downloads remain separate commands under their existing authorized scope. Model prewarming, when requested, contains no footage and is recorded separately.

Write created files atomically with an exclusive workspace setup lock. Release locks on failure; diagnose a stale lock rather than steal it from a live process. Restore matching missing files on rerun; preserve modified files; report conflicts without partial replacement. Profile additions only add needed setup and never downgrade or remove another capability. An interrupted run records enough created-file state for safe resumption, without deleting user content as rollback.

The receipt `.video-editor/workspace.json` records schema version, stable workspace ID, enabled capabilities, plugin/runtime version and digest, original template hashes, dependency-lock hashes, and migration provenance. Installation location is a replaceable hint, not an identity. Keep sensitive paths local.

Generated workspace launchers call the bound shared runtime; they contain no implementation copy. An update must not silently redirect a workspace to a different version. If the bound runtime is unavailable after cache eviction or uninstall, stop with instructions to restore that version from the local marketplace/source revision. Media and project records remain readable. Never silently fall back to the newest runtime.

## Shared processing and failure behavior

Reuse the existing helpers for probing, derivative registration, graphics-plan validation, frame extraction, portable interchange, and promotion after adapting their callers. The initial supported timeline remains version 1 hard-cut assembly. Unsupported retimes, transitions, grading, captions, or audio automation must be reported as unsupported/deferred rather than flattened or discarded without consent.

Batch operation plans use a schema-versioned list of stable operation IDs, input path/hash, output path, operation/options, trim policy, and expected streams/timebase. Plan mode reads/probes but writes nothing. Apply checks the input hash again, uses exclusive outputs, and records per-item outcomes. Resume reuses only verified outputs; cancellation terminates owned children, leaves partial derivatives identifiable, and returns nonzero for incomplete work. Default concurrency is one; a user-set bounded limit controls CPU, RAM, disk, and GPU pressure. Reject two operations claiming the same output.

Expose fast keyframe-aligned stream copy separately from exact re-encoded trimming. Record the requested and realized boundaries. Do not label stream-copy cuts frame-exact. Use low-resolution proxies and targeted review frames when useful; preserve exact source timing and hashes. Cache analyses by content plus parameters/tool/model version, never by filename/mtime alone. Benchmark optimizations before claiming a speed gain.

Preserve source timestamps in transcripts and a separate source-to-edited timeline mapping. Split/remap captions across cuts and sync offsets; flag unaligned words and overlapping speech. Human-check names and sensitive dialogue. First release may support a documented manual caption path; no claim of automated remapping until its fixtures pass.

All scripts return meaningful nonzero failures and structured JSON when requested, without printing credentials. Existing sources and approved outputs are never overwritten by default. Missing media or checksum mismatches block mutation before opening Resolve. Keep graphics source, alpha layers, audio stems, captions, and relink maps alongside the neutral timeline.

## Existing project and approval migration

1. Inventory the existing workspace read-only: exact skill version, locks, local instructions, active job candidates, caller paths, existing bootstrap receipt, source IDs, stages, approvals, and export hashes. Do not pick an active job from an example name.
2. Produce a migration plan with a before/after file list, content hashes, conflicts, legacy caller mapping, and exact rollback actions. A no-change plan writes nothing.
3. Add a workspace receipt and thin launcher. Change only explicitly inventoried launcher/npm bindings. Preserve unrelated scripts, fonts, styles, brand/brief overrides, locks, project IDs, paths, raw media, transcripts, sync, timelines, reviews, approvals, and outputs byte for byte. Detect but do not rewrite absolute paths in Resolve/relink records.
4. Validate the old manifest schema without coercing unknown versions. Record provenance outside legacy records. Preserve old approval records verbatim. Evaluate them against their original material, action, destination, cost scope, and revision evidence. A status-only legacy approval cannot authorize a changed export; request a concrete revision decision only when its scope cannot be established.
5. Verify helper parity and resume a synthetic project, then perform a read-only check of the existing workspace. Do not render, re-transcribe, promote, or change a real timeline during code migration.
6. Switch callers only after the new commands pass. Retain the old local skill while any npm/script or project still uses it. After every caller is migrated, remove only the now-unused runtime copy; preserve workspace/project data. Rollback restores changed launcher/config bytes and runtime binding, without deleting new media or rewriting old projects.

New approval records must bind the reviewed timeline/render hash or revision and relevant input scope. Promotion revalidates that binding. Keep valid approvals reusable: spelling-only corrections do not invalidate picture timing; changed cuts invalidate downstream timestamped captions, render QA, and export approvals. Plugin installation by itself invalidates none of them.

## Implementation order

These are specification phases, not created tickets. Current outcomes and verification limits are in [draft inspection](draft-inspection.md); acceptance tables remain the full qualification matrix.

| Phase | Outcome | Depends on | Verification |
| --- | --- | --- | --- |
| P1 | Portable/Codex manifests, six thin skills, shared invariants and dispatcher path resolution | Preserved baseline | I1–I3, R1–R2 |
| P2 | Profile bootstrap, receipt/binding, capability checks, isolated workspace setup | P1 | I4–I8 |
| P3 | Legacy adapter and safe migration/resumption | P2 | M1–M7 |
| P4 | Safe single/batch execution and accurate review/approval handling | P2; P3 for legacy parity | F1–F6 |
| P5 | Reproducible package, extracted-package tests, private host smoke test and documentation validation | P1–P4 | R1–R8 |

Start P1 with current helper code unchanged wherever possible; isolate compatibility fixes. Do not implement every optional tool in the comparison as a release prerequisite. Public license, publisher, repository visibility, and public listing facts do not block local implementation; they do block the corresponding public release.

## Installation acceptance tests

| ID | Scenario | Required observable evidence |
| --- | --- | --- |
| I1 | Fresh extracted package, no author checkout | Host discovers exactly six workflows; scripts/references resolve inside package |
| I2 | Two install locations, spaces, unrelated cwd | Same operations resolve correctly; no author absolute paths or parent-depth assumptions |
| I3 | Only Node and FFmpeg installed | Quick conversion works with no renderer, Python, model, or Resolve requirement |
| I4 | Bootstrap plan, including absent destination | File-tree snapshot unchanged; no directory, receipt, cache, install, network, or launch |
| I5 | Apply twice, restore missing file, customized file | First creates selected files; second no-op; restoration preserves customization |
| I6 | Conflicts, symlinks, traversal, concurrent setup, interruption | Fail before conflicting writes; lock ownership respected; rerun safely resumes |
| I7 | Every profile and additive profile change | Only selected locks/dependencies requested; no unexpected downloads or project edits |
| I8 | Two workspaces, removed/moved install and unavailable old version | Separate environments/caches/receipts; version binding restored explicitly; no silent upgrade |

## Migration acceptance tests

| ID | Scenario | Required observable evidence |
| --- | --- | --- |
| M1 | Customized legacy fixture with existing jobs and approvals | Inventory and dry-run write nothing; apply changes only listed binding/config files |
| M2 | Repeated migration and interrupted migration | Idempotent result, no duplicate records/projects; safe partial resumption |
| M3 | Prior source/transcript/sync/timeline/review/export state | Before/after hashes match for every protected file; same IDs and rational times |
| M4 | Valid, rejected, revoked, stale, ambiguous approvals | Preserve all records; reuse only covered actions; changed revision cannot inherit export approval |
| M5 | Existing dependency locks and user instructions | Hashes unchanged; no automatic npm/uv/model upgrade; overrides retain precedence |
| M6 | Rollback plus outputs created since migration | Old caller bytes/binding restored; all project files and newer outputs retained |
| M7 | Legacy caller retirement | Search proves no callers remain before deleting old skill; old/new helper parity passes |

## Functional acceptance tests

| ID | Scenario | Required observable evidence |
| --- | --- | --- |
| F1 | Batch collisions, shell-like filenames, changed sources, interruption | No source overwrite, command injection, or stale-output reuse; correct item states and exit code |
| F2 | Quick trim modes and mixed media | Realized time bounds verified; exact/copy distinction preserved; VFR and audio layout explicit |
| F3 | Transcript/caption cuts, offsets, missing words | Source text retained; mapped times valid and monotonic; unresolved alignment flagged |
| F4 | QA and final promotion against different revisions | Technical/visual/listening/import claims separate; stale QA/approval blocks promotion |
| F5 | Renderer at 24000/1001 and 30000/1001, alpha/opaque | Probe frame count/timebase/alpha; inspect first/last/transition frames and actual motion |
| F6 | Resolve present/absent, live native export and offline interchange | Offline path succeeds without editor; DRP/DRT claimed only after verified native export/import |

## Release acceptance tests

| ID | Scenario | Required observable evidence |
| --- | --- | --- |
| R1 | Manifest/skill validation | Matching identities/versions, six matching folder/frontmatter names, valid UI metadata and references |
| R2 | Package allowlist and private-data canaries | Archive contains only manifests, skills, shared runtime, neutral templates and docs; excludes `.git`, private workspace, media, names, credentials, installs, models, test output |
| R3 | Identical package built twice | Identical archive digest, fixed ordering/timestamps, complete per-file checksum manifest |
| R4 | Extract package and run tests there | Node/Python baseline plus I/M/F suites pass without source checkout; tampering rejected |
| R5 | Clean host local marketplace | Install/list/six-workflow discovery and harmless conversion verified; uninstall leaves workspaces intact |
| R6 | Update and rollback | New install does not change existing workspace runtime/pins; explicit migration and version restore work |
| R7 | Docs and supported platform matrix | Copyable documented commands run; no nonexistent tests; macOS evidence plus Windows/Linux status explicitly recorded |
| R8 | Private release candidate | All required gates pass on exact commit/archive; no actionable blocking finding; truthful release notes and rollback instructions |

Public directory readiness additionally requires the verified publisher, chosen source license, real public website/support/privacy/terms URLs, icon assets, countries, commerce declaration, release notes, required scans/attestations, and authorized submission. A skills-only plugin has no MCP demo/credentials requirement. These are separate from private installation tests.

## First candidate boundaries

The initial implementation executes batch jobs sequentially. Parallel scheduling and an automated destructive rollback/legacy removal command are deferred; backups permit reviewed configuration restoration. Caption output is word-level SRT plus warnings, not automatic sentence editing or final subtitle styling. Evidence output summarizes known records; adaptive scene/visual analysis remains optional. Existing advanced editorial stages retain their documented tool-directed/manual path. The initial renderer/ASR locks are unchanged. This candidate's local tests cannot establish fresh graphics/ASR installation, Windows/Linux compatibility, or a live Resolve import.
