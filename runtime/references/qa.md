# Visual, technical, and editorial QA

Give the editor eyes through controlled frame extraction, local previews, Resolve inspection, and independent subagents. Do not ask one reviewer to judge every dimension at once.

## Review early and at the end

- After the first 10 percent of a graphics build, inspect representative output before scaling the pattern.
- After each stage, inspect its direct output rather than waiting for the final.
- At final, review every distinct visual state, boundary, clip tail, and mandated story moment.

## Extract deliberate evidence

Use extract-review-frames.mjs to capture:

- regular interval samples;
- a frame immediately before and after each edit or graphic boundary;
- starts and tails of every generated part;
- every title, lower third, caption layout, and directed visual moment;
- suspected luma or color seams;
- exact timestamps reported by a prior review.

The helper does not infer edit points or clip tails from `timeline.json`.
Supply each time explicitly with `--boundary`, from a JSON boundaries file, or
from `graphics-plan.json`. Review the complete dry-run plan before removing
`--dry-run`:

```bash
npm run video:review:frames -- \
  --input projects/new-film/outputs/review/new-film-review.mp4 \
  --output-dir projects/new-film/reviews/frames \
  --graphics-plan projects/new-film/graphics-build/graphics-plan.json \
  --boundary 12.5 --boundary 47.25 --dry-run
```

Keep review frames under `reviews/frames/` and reports under `reviews/`. Do not flood the main task with every frame. Delegate raw evidence to the project-scoped read-only agents in `.codex/agents/`: `video_technical_reviewer`, `video_composition_reviewer`, and `wedding_story_privacy_reviewer`.

## Run independent passes

### Technical

Check:

- offline or missing media;
- wrong aspect, rotation, crop, stretch, black bars, or safe-zone violation;
- duplicate, dropped, frozen, or flash frames;
- luma, gamma, or color shifts at seams;
- clipped titles, broken alpha, font substitution, or disappearing elements;
- audio sync, clicks, dropouts, clipping, and abrupt ambience;
- exact FPS, duration, and codec metadata;
- first and last second of every clip.

### Composition and style

Check:

- clear focal point and hierarchy;
- readable type at delivery size;
- graphics that support rather than obscure emotion;
- restrained motion and accent color;
- faces, hands, rings, and meaningful action unobstructed;
- every directed element built or explicitly skipped;
- every overlay consistent with its style convention;
- exits, holds, spacing, and rhythm.

### Story, identity, and privacy

Check:

- correct names, people, speakers, date, venue, and chronology;
- mandatory moments and intended emotional arc;
- no excluded person, sensitive moment, or private data;
- reactions and voice-over do not misrepresent time or identity;
- no generated media appears documentary;
- vows and speeches retain meaning and dignity.

Return timestamped findings with severity, evidence frame, expected behavior, and owning stage. Do not return vague taste complaints without a concrete visual reason.

## Use Browser for local renderer previews

Start the local HyperFrames or Remotion preview, open its exact URL in the in-app Browser, and inspect rendered state. Use screenshots and local interaction for composition, responsive controls, and precise visual feedback. Do not use Browser as a substitute for deterministic media probing.

## Use Computer Use for Resolve-only checks

Prefer the Resolve scripting bridge for repeatable project operations. Use Computer Use when visual inspection or a GUI-only setting remains:

- open the exact project and timeline;
- verify track names, clip placement, markers, offline status, and subtitle visibility;
- scrub or jump to named timestamps;
- inspect viewer, mixer, scopes, or inspector state;
- confirm relink or import behavior.

Keep each flow narrow. Re-read app state after actions. Do not change security settings, overwrite an approved timeline, relink to an ambiguous file, or start a final render without the required approval.

## Accept only after iteration

1. Collect independent reports.
2. Deduplicate findings by timestamp and cause.
3. Map each finding to its owning artifact.
4. Fix only invalidated artifacts.
5. Rebuild the Resolve timeline non-destructively.
6. Re-extract affected evidence plus a small regression sample.
7. Repeat until every high and medium finding passes or is explicitly accepted.

Keep accepted exceptions in the QA report so future runs do not repeatedly reopen a deliberate choice.
