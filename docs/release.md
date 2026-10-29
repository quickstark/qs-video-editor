# Release preparation

The first rollout is a private local/GitHub plugin. Pushing source, installing a local plugin, publishing an archive, submitting to a directory and publishing an approved listing are separate actions.

## Reproducible checks

From the repository root:

```bash
npm run check
npm test
npm run test:helpers
npm run test:resolve
python3.11 scripts/package-plugin.py --output /absolute/path/out/qs-video-editor-0.2.0.zip
```

Build twice to distinct output paths and compare SHA-256. Extract into a new location, verify `checksums.json`, and rerun the same checks there. Archive output is for a requested release/handoff; ordinary source work should not leave ZIPs or test media in the repository. Tests clean up their temporary synthetic fixtures.

The packager uses an explicit source allowlist and fixed ZIP metadata. It rejects symlinks/unexpected file types, excludes Git internals, dependency installs, caches, private projects, models and rendered media, and includes per-file checksums. Do not zip the sibling legacy workspace. A checksum proves file identity, not legal or editorial correctness.

## Private release gate

- Portable and Codex manifests agree; exactly six skills have valid names/UI metadata and live references.
- Bootstrap, isolation, conflict, lock, migration-preservation, caption mapping and real-media quick tests pass.
- Existing helper/Resolve suites pass; stale render/timeline approvals and changed plans fail safely.
- An extracted package passes the checks without the author checkout. Two builds from identical source have matching archive digests.
- A host install/list verifies discovery. A harmless operation runs through the installed workspace binding, then update/uninstall checks show no workspace deletion.
- Commit/tag, dependency baseline, supported platforms, known limitations and rollback directions match the tested source.
- No private media, credentials, real project decisions or unreviewed data appear in the source/archive or Git history intended for publication.

Record exact outcomes in [draft inspection](draft-inspection.md). A passed local suite does not fill in a host-install or real-editor-import result. Do not label the repository or archive “release-ready” while required gates remain unverified.

## Versioning

Plugin metadata, compatibility overlay and source package version must agree. Commit source and docs together; tag only a tested candidate. Existing workspaces remain bound to their runtime digest and dependency locks. Migration is explicit and rollback restores a known earlier binding/configuration without deleting project data.

Earlier private migration checkpoints remain available locally and are excluded from public source history. They are not release tags. Do not publish an archive/private-history ref or infer an earlier public version tag.

## Sanitized GitHub source publication

Publish only the reviewed reusable source tree. Audit current files, example project identifiers, archive contents, and the intended public commit ancestry; a clean current tree does not sanitize older commits. Preserve the full pre-publication history under a local-only private ref for recovery. Never push that ref or use `git push --all`/`--mirror` for this repository.

For the first publication to the explicitly selected empty `quickstark/qs-video-editor` repository, start fresh public history from the sanitized tree. A connected GitHub API may initialize the public README, create the full tree and a commit, then advance `main` with an expected-head check when direct Git transport is unavailable. Require the returned tree SHA to match the tested local tree. Independently read back the remote commit/tree and the 0.2.0 manifest before recording source publication as passed. Adopt the verified public commit locally only after preserving the private history and verifying that the source tree is unchanged.

Source publication is separate from a tagged release, live Codex installation, a public plugin-directory listing and real editor import. Report each boundary truthfully. Follow the [namespace migration](namespace-migration.md) for installation/update and workspace rollback; a protected user configuration may require those host commands to run in an ordinary terminal.

## Public listing preparation

Supported draft copy:

| Field | Draft |
| --- | --- |
| Name | QS Video Editor |
| Subtitle | Local AI video editing |
| Category | Creativity |
| Purpose | Focused local workflows for setup, quick video processing, transcription, motion graphics, editorial work and review, with independent workspaces and editable handoffs |

Before a public release, choose the verified publisher and source license; confirm intended countries and commerce behavior; provide real public website, support, privacy and terms pages; prepare real icon files; and complete required review metadata/scans/attestations. Unknown URLs and publisher declarations remain absent rather than invented. Optional dark icons/colors are not blockers. A skills-only plugin has no MCP demo or reviewer-credentials requirement.

GitHub source publication does not grant an open-source license. Do not infer permission to redistribute models, media, renderer binaries, fonts or music from this package. Hosted processing and integrations remain opt-in. Public submission/publication requires its own authorized final step.
