# HyperFrames-first graphics

Use HyperFrames as the default renderer for motion graphics. Keep planning separate from building, keep each part independently rerenderable, and place rendered parts on editable Resolve upper tracks.

## Plan before authoring

Read the edited transcript, creative brief, script comments, B-roll transcript, brand, style, and timeline markers.

Default to no graphic. A beat earns one when it is:

- a requested title, lower third, date, venue, or chapter;
- a concrete fact, map, document, photograph, or relationship that becomes clearer visually;
- an accessibility or translation need;
- a deliberate emotional or structural transition.

Leave vows, reactions, connective tissue, and intimate emotional delivery unobstructed unless the brief requires otherwise.

Allowed plan kinds:

- stat
- card
- screenshot
- takeover
- zoom
- diagram
- b-roll-slot
- lower-third
- title
- end-card

Write the complete plan to `graphics-build/graphics-plan.json`, including a readable rationale for each item. Validate it before building.

## Choose part behavior

- Overlay: transparent graphic that floats above picture. Render with alpha and place on the declared graphics upper track (V4 in the default scaffold).
- Segment: opaque graphic or cutaway that replaces picture. Keep it as a separate upper-track clip rather than flattening it into V1.
- Geometry-only move: use Resolve or FFmpeg for crops, push-ins, and reframes when no browser-rendered element is required.

When the assembly plan needs trim handles, give a rendered part its nominal duration plus at least 0.5 seconds of tail. Otherwise declare that the part has no safety tail and verify its exit before end of file. Keep exact placement and tail policy in the neutral timeline or graphics manifest, not only inside the renderer.

## Pin and validate HyperFrames

1. Pin an exact workspace-local HyperFrames version and record that version in each project render manifest; do not create floating nested installs.
2. Run the pinned `npm run hyperframes:doctor` command before the first build.
3. Keep project source directly under `graphics-build/`, with compositions under `graphics-build/compositions/`.
4. From the repository root, run `npm run hyperframes:lint -- projects/new-film/graphics-build`, `npm run hyperframes:check -- projects/new-film/graphics-build`, and the no-open preview on every part before rendering. The older `hyperframes:inspect` command is retained only as a deprecated diagnostic; `check` is the current combined runtime, layout, motion, and contrast gate.
5. Record the exact command, props, frame rate, dimensions, and output hash.
6. Do not silently upgrade an approved job.

## Honor the seeked timeline contract

HyperFrames compositions are seeked, not played.

- Create one paused master timeline.
- Put every tween at an absolute second.
- Use no random values, timers, requestAnimationFrame loops, or mutable real-time state.
- Make every frame deterministic when rendered out of order.
- Give every boundary exit an explicit final state.
- Use from-to tweens with defined start and end states.
- Keep time in seconds.
- Do not animate the same transform property in CSS and GSAP.

## Avoid silent renderer failures

- Do not transform a video element directly. Crop or move a wrapper, or perform footage geometry outside the browser.
- Replace blur reveals with deterministic opacity or mask reveals.
- Do not depend on grayscale filters; use explicit color treatment.
- Tween concrete properties, not class names.
- Give state changes real duration, roughly 0.2 to 0.35 seconds, rather than near-zero tweens.
- Do not render raw color emoji. Use a tested font asset or pre-rendered transparent image.
- Do not rely on backdrop blur over a transparent render.
- Bundle licensed final font files. A named-font download or documented substitute is acceptable for a preview only; do not call it a final until the approved fonts are local.

## Composite safely

- Match the base exact rational frame rate.
- Cut replacement-segment base slices at placement time.
- Set overlay end-of-file behavior to pass. Use repeat only for an intentional held frame.
- Fail duplicate-frame QA above 8 percent unless the plan explicitly declares held content; clean moving output should normally stay under 3 percent.
- Do not hide duplicate frames by forcing the output frame rate.
- Do not use frame padding to hold a zoom.
- Prefer FFmpeg or Resolve for footage motion to avoid browser-induced luma changes.
- Reset timestamps and frame counters for mid-video FFmpeg moves.
- Anchor moves to measured scene cuts when rendered timing differs from nominal transcript timing.
- Crop-detect black bars before placing screen recordings.
- Inspect the first and last second of every part.

## Keep composition rules concrete

- Use one focal point per frame.
- Move at most two meaningful elements simultaneously.
- Stagger entrances by at least 0.4 seconds when several elements appear.
- Use one accent color as the visual emphasis.
- Design entrances and exits.
- Give long beats meaningful motion throughout rather than freezing after the opening.
- Measure real pixel bounds for crops and zooms.
- Prefer actual assets over approximations.
- Surface conflicts between local direction and the standing style.

## Respect safe zones

Store safe zones as normalized proportions and render them at output resolution.

- 16:9: keep critical titles and faces inside 10 percent margins. Reserve the rightmost 40 percent of an outro when end-screen cards are planned.
- 9:16: keep key content clear of platform UI. The historical 1080 by 1920 baseline keeps key visuals between y=200 and y=1620, with top 200 and bottom 300 as background-only.

## Use Remotion only as a fallback

Choose Remotion when React components, Studio editing, Player embedding, or an existing Remotion asset makes it materially better. Keep its version exact across every Remotion package. Drive animation from frames, not CSS animation. Render graphics as separate Resolve clips just like HyperFrames outputs.

## Gate generated imagery

Recorded footage and licensed real assets come first. Require authorization and provenance before using Higgsfield or another provider. Never generate people or events that could be mistaken for documentary wedding footage.
