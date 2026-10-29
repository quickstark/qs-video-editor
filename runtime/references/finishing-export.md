# Finishing and editable export

Finish in separable, repeatable layers. The editable Resolve timeline is the primary handoff; flattened files are review and delivery artifacts.

## Match picture before styling it

- Normalize orientation and pixel aspect without altering raw files.
- Group cameras by event and compare exposure, white balance, saturation, and skin tone.
- Correct obvious discontinuities before applying a creative look.
- Keep color decisions in Resolve nodes or documented transforms so the user can revise them.
- Do not bake a destructive grade into the only editable media.
- Preserve source color metadata and identify HDR, log, raw, or mixed-gamma footage before grading.

## Protect dialogue

- Keep production dialogue and external recorder audio on distinct tracks.
- Apply repair only where needed: noise reduction, hum removal, de-ess, EQ, compression, and limiting.
- Preserve breaths, laughter, applause, and room tone that carry meaning.
- Measure loudness and true peak for the declared delivery target.
- Use short crossfades or ambience beds across angle and time changes.
- Never replace a voice or use synthetic speech without explicit consent.

## Add captions accessibly

- Generate captions from the edited transcript, not the source timeline.
- Correct names, places, vows, and speaker identity manually.
- Keep SRT or VTT as a durable sidecar for every long-form deliverable.
- Burn captions only when the brief requests them.
- Avoid covering faces, hands, rings, vows, or platform UI.
- Keep caption styling in the style snapshot and caption plan.

## Use licensed music

- Accept only user-supplied or explicitly licensed music.
- Store license evidence under audio/licenses/.
- Keep music on its own Resolve tracks with editable trims and automation.
- Favor dialogue intelligibility over a fixed nominal level.
- Use speech-aware ducking or hand automation when quiet vows require it.
- Keep fade-in, fade-out, and structural edit points explicit.

## Keep SFX sparse and real

- Use real sample files, not generated sine tones.
- Place only moments that support a cut, transition, or physical event.
- Keep SFX on a separate track and record source and license.
- Skip SFX when no suitable sample exists.

## Build editable deliverables

For each declared deliverable, preserve:

- neutral timeline.json;
- current Resolve project export DRP;
- current Resolve timeline export DRT;
- OTIO or FCPXML interchange when export succeeds;
- corrected caption sidecar;
- separate graphics source and rendered parts;
- music and SFX sources plus licenses;
- QA reports;
- flattened review master;
- declared delivery master.

Do not call the job complete when only an MP4 exists.

## Validate before promotion

Check:

- expected duration, frame rate, dimensions, field order, color tags, and codec;
- audio sample rate, channel layout, loudness, and true peak;
- no offline media, missing graphics, gaps, flash frames, frozen motion, or black tails;
- corrected titles, dates, names, and captions;
- exact deliverable filename and sidecars;
- Resolve project and interchange files reopen or import successfully;
- output hash and lineage.

## Promote and clean safely

- Dry-run by default.
- Promote one final per declared deliverable, not one final for the entire wedding.
- Never choose a candidate only because it has the newest modification time.
- Never delete raw, proxies required for relink, outputs, current graphics source, licenses, captions, transcripts, or the current Resolve package.
- Reclaim only allowlisted regenerable caches and superseded scratch that is older than the approved deliverable.
- Require an explicit apply flag after the user reviews the plan.
