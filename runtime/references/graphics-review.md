# Bounded graphics review

Use at most three review rounds for the declared revision: the first render/review, then at most two correction rounds. Stop early when the checks pass. An unmet prerequisite is blocked; exhausted rounds with open findings remain needs-review. Neither outcome grants approval. Do not change the revision identifier solely to reset an exhausted loop.

For each round:

1. Check actual asset/font bytes, loaded fonts, dimensions, rational FPS, frame count and alpha. Run the pinned HyperFrames check. Reject missing assets, clipped copy, incorrect timing or broken transparency.
2. Inspect entrance, readable hold, exit, first/last second, and declared safety tail. Test overlays over light, dark and moving original backgrounds. Check safe bounds at delivery resolution; preserve meaningful action in real footage.
3. Watch the complete short render. Record playback coverage separately from stills, decoded-frame analysis, listening, and editor import. A silent graphic has no listening pass to claim.
4. Record timestamp/frame, expected versus observed behavior, evidence path, severity and owning artifact. Fix at most three independent causes in that round. Recheck affected outputs and a small regression sample.
5. Stop after three total rounds. Technical/privacy failures remain open. A deliberate style exception needs an actual scoped decision and must not be presented as approval of a changed render or film.

## Evidence and scope

Keep evidence under `reviews/graphics/<item-id>/<revision>/`. Record the brief/source/asset/lock hashes, renderer/browser versions, render hash, frame evidence, playback coverage, findings and dispositions. New render bytes require review of those bytes; do not reuse a previous round's pass. Calculate the `current` hash tuple from the actual current files before evaluating the record, and record the decoded `frameCount` so partial playback cannot pass. A film may reference this evidence through its existing graphics stage's `checks`, `outputs`, and `data`. Standalone graphics need no dummy film timeline or export approval.

Keep the composition source and its rendered layer separately editable. This review cannot certify the complete film, Resolve import, or final delivery. Existing render/timeline-bound approval and promotion gates still apply.

## Local-only previews

Use local assets and licensed local fonts. Set `HYPERFRAMES_NO_TELEMETRY=1`. Every snapshot command must include `--describe false`: the pinned CLI can otherwise request remote vision analysis when a vision key is present. Use `--json` on check, snapshot and render to suppress startup update/skill lookups in HyperFrames 0.7.109. Do not use hosted scoring, CDN fonts or remote media to complete a local review.

From a workspace with the reviewed pinned tools (replace the project path and times):

```bash
export HYPERFRAMES_NO_TELEMETRY=1
export HYPERFRAMES_NO_AUTO_INSTALL=1
./node_modules/.bin/hyperframes check projects/my-graphic/graphics-build --json --no-browser-gpu
./node_modules/.bin/hyperframes snapshot projects/my-graphic/graphics-build --json --at 0,1,3 --describe false --no-browser-gpu
```

### Maintainer verification

From the plugin source or an extracted package, use an existing dependency workspace and a licensed local TTF. The test reads the pinned tools, copies only synthetic source and the local font into a new temporary directory, and never installs or migrates anything:

```bash
npm test
npm run test:graphics -- --workspace /absolute/path/to/existing/workspace --font /absolute/path/to/licensed.ttf
```

The optional `--chrome` selects an installed Chrome executable. A fresh `--output` directory outside the plugin, installed cache and existing workspace retains local evidence; otherwise the test removes its temporary output. The full matrix covers all three canonical examples at both rational rates, plus portrait fixtures, backward seeking with callbacks suppressed, exact pixels, real alpha renders, composites, font loading, measured bounds and injected defects. An outbound network guard and a dummy vision key exercise local-only snapshots. Failed renderer scripts or correctness warnings invalidate the result, even when the CLI writes a movie successfully. Automated frame analysis and synthetic review records do not claim a human playback review or delivery approval.

## Canonical bounded decision

This original example evaluates recorded review evidence. It cannot perform a visual review or invent its evidence. Fixture records in tests are synthetic; they are not human approvals. `passed` means the named graphics checks pass, not that an export is approved.

<!-- qs-example: graphics-review -->
```js
export function graphicsReviewOutcome({revision, current, prerequisites = [], rounds = []} = {}) {
  const result = (status, canRevise, reason) => ({status, canRevise, reason, approved: false});
  if (typeof revision !== 'string' || !revision.trim()) return result('blocked', false, 'Missing revision');
  if (!Array.isArray(prerequisites) || prerequisites.length) return result('blocked', false, 'Unmet prerequisites');
  if (!Array.isArray(rounds) || rounds.length > 3) return result('blocked', false, 'At most three rounds');
  if (!rounds.length) return result('needs-review', true, 'Initial review required');
  const required = ['assets', 'fonts', 'format', 'alpha', 'layout', 'motion', 'privacy', 'first-last-second'];
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    if (!r || r.round !== i + 1 || r.revision !== revision) return result('blocked', false, 'Round order or revision differs');
    if (!['briefSha256', 'sourceSha256', 'renderSha256'].every(k => /^[\da-f]{64}$/i.test(r[k] ?? ''))) return result('blocked', false, 'Missing revision hashes');
    if (!Number.isSafeInteger(r.frameCount) || r.frameCount < 2) return result('blocked', false, 'Missing decoded frame count');
    if (!r.checks || !Array.isArray(r.findings)) return result('blocked', false, 'Missing checks or findings');
    if (r.findings.some(f => !f || typeof f.id !== 'string' || !f.id.trim() || !['open', 'fixed', 'accepted'].includes(f.status) || !['technical', 'style', 'privacy', 'copy'].includes(f.category) || !['error', 'warning', 'info'].includes(f.severity))) return result('blocked', false, 'Malformed finding');
    if (i && r.renderSha256 === rounds[i - 1].renderSha256) return result('blocked', false, 'Correction rounds require new render evidence');
  }
  const last = rounds.at(-1);
  if (!current || !['briefSha256', 'sourceSha256', 'renderSha256'].every(k => /^[\da-f]{64}$/i.test(current[k] ?? '') && current[k] === last[k])) return result('blocked', false, 'Current artifact hashes differ from reviewed evidence');
  const open = last.findings.some(f => f.status !== 'fixed' && !(f.category === 'style' && f.status === 'accepted' && typeof f.decision === 'string' && f.decision.trim()));
  const playback = last.playback;
  const watched = playback?.status === 'passed' && Number.isSafeInteger(playback.startFrame) && playback.startFrame === 0 && Number.isSafeInteger(playback.endFrame) && playback.endFrame === last.frameCount - 1;
  const passing = required.every(k => last.checks[k] === 'passed') && !open && watched;
  if (passing) return result('passed', false, 'Recorded checks and full playback pass; export approval remains separate');
  return result('needs-review', rounds.length < 3, rounds.length === 3 ? 'Round limit reached; retain open findings' : 'Fix concrete findings, then review the new render');
}
```
