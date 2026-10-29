# Dependency research and upgrade gate

Checked 2026-10-29. Keep a distinction between an upstream capability, a locally installed version, and a version validated by this distribution.

| Component | Distribution baseline | Current evidence and decision |
| --- | --- | --- |
| Node | >=22 | Keep the declared minimum; no system installation bundled |
| HyperFrames | 0.7.109, exact npm lock | Upstream is in the 0.8 series. Current authoring docs add quality names `looks`/`delivery`, retain `standard`/`high`, and document rational `--fps`. Retain the baseline until a fresh install and render matrix passes |
| GSAP | 3.14.2, exact npm lock | Keep the existing compatible pin with the renderer; no independent upgrade validated |
| WhisperX | 3.8.6, locked Python 3.11 | PyPI lists 3.8.6 as stable and 3.8.7rc1 as prerelease. Retain stable; upstream Python support is wider than this tested runtime |
| Resolve | Detect locally | No bundled editor or universal edition/version promise; verify connection, return values, and editor import on the recipient machine |
| Codex discovery | Local skill directory | Current docs list workspace `.agents/skills` and user `~/.agents/skills`; restart if discovery does not refresh |

Primary sources:

- [HyperFrames releases](https://github.com/heygen-com/hyperframes/releases)
- [HyperFrames preview/render reference](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-cli/references/preview-render.md)
- [WhisperX releases and Python requirements](https://pypi.org/project/whisperx/)
- [Codex local skill discovery](https://developers.openai.com/codex/skills)

GitHub now lists v0.8.216 (2026-10-29), independently checked during the plugin migration. Live npm registry access and a fresh render matrix were not run here. Do not treat the GitHub release as proof that an upgrade has been installed or tested; the existing lock remains 0.7.109. See the [upstream evaluation](../../docs/upstream-evaluation.md).

## Validate an upgrade before changing the template

1. In a disposable, network-enabled bootstrap workspace, read live registry metadata and choose an exact stable candidate. Install it with `npm install --save-dev --save-exact hyperframes@<candidate>` and preserve the resolved lock. Never float `latest` inside a live edit.
2. Run doctor, lint, and check. Verify local preview without automatically opening a system browser. Retain the existing tool's no-telemetry setting.
3. Render a small opaque title and transparent overlay with no private assets at `24000/1001` and `30000/1001`. Verify frame count, duration, dimensions, timebase, alpha, first/last states, font handling, seek determinism, and compositing over moving test footage.
4. Review motion and listen to any audio used. Metadata and still frames alone do not establish the render matrix.
5. Update `assets/workspace/package.json` and `package-lock.json` together; rerun bootstrap, package roundtrip, core safety, and Resolve tests. Record the candidate and observed results here. Leave active projects pinned until their own revision is authorized.

WhisperX normalization and edited-transcript captions remain useful next automation candidates; waveform synchronization additionally needs offset/drift fixtures and confidence thresholds. They are not advertised as completed helpers in this release.
