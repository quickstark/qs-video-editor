# Synchronization, transcription, and rough cut

Use transcripts to make decisions, not to replace listening and visual review. Wedding edits require sync, identity, room tone, and continuity in addition to words.

## Probe and hash first

For every source, record:

- project-relative paths in canonical JSON artifacts; portable OTIO/FCPXML exports are a deliberate local-import exception because they resolve media with absolute `file://` URLs, so treat those exports as private, machine-local handoff files and regenerate or relink them before sharing;
- SHA-256 or another stable content hash;
- duration;
- exact rational video frame rate;
- dimensions, codec, pixel format, rotation, and color tags;
- audio sample rate, channel count, layout, and codec;
- start timecode when present; keep free-form creation, device, location, and
  other source tags out of the durable inventory unless the brief requires a
  reviewed privacy-safe field;
- chapter and data streams.

Do not trust filename extensions or rounded frame rates. Retain both `r_frame_rate` and `avg_frame_rate`, plus stream timebase and frame count when present, so variable-frame-rate sources remain identifiable.

## Synchronize before transcription

1. Group clips by event and recording device.
2. Prefer matching source timecode only after checking that clocks agree.
3. Otherwise extract mono scratch tracks and correlate waveforms. A local deterministic extraction starts with:

   ```bash
   ffmpeg -nostdin \
     -i projects/new-film/raw/video/camera-a.mov \
     -map 0:a:0 -vn -ac 1 -ar 16000 -c:a pcm_s16le \
     projects/new-film/sync/camera-a-scratch.wav
   ```
4. Store source-to-master offsets and drift corrections in sync-map.json.
5. Verify at least three points across every long event.
6. Keep original recorder audio as a separate editable track.

Do not bake synchronization into destructive source rewrites.

## Transcribe once per valid input state

- Run WhisperX from an isolated Python 3.11 environment.
- Prefer a pinned stable release and CPU int8 on macOS unless a verified faster path exists.
- Store model, language, alignment model, diarization settings, hashes, and command.
- Reuse results only when the source hash and every timing-affecting parameter match.
- Transcribe B-roll audio when it may include useful direction or speech.
- Treat diarization as a suggestion and verify the couple, officiant, and speakers manually.
- Expect overlapping speech and singing to need correction.

For an approved English-language local CPU pass, the pinned baseline is:

```bash
npm run video:transcribe -- projects/new-film/sync/camera-a-scratch.wav \
  --model small --device cpu --compute_type int8 --language en \
  --output_format json \
  --output_dir projects/new-film/transcript/whisperx-raw/camera-a
```

The first run may download models. Do not enable diarization or add a Hugging Face token until the brief requires it and the identity-review workflow is ready. Preserve the raw result, then manually normalize it into the job's durable `transcript/transcript.json` starter contract while recording the source hash, model, language, alignment settings, and command. No repository normalizer CLI exists yet; do not imply that this conversion is automatic.

Keep the source transcript immutable. Write corrections and edited-timeline remapping as separate artifacts.

## Correct words without breaking time

- Apply permanent single-word mishears from brand.md.
- Keep one-off names in the project correction list.
- Review unknown words in context before deletion.
- Automatically apply only whole-word replacements that preserve token count.
- Flag multiword corrections for a transcript rebuild or an explicit aligned mapping.
- Investigate suspicious word spans rather than assuming silence boundaries are correct.

## Write a readable cutsheet

Each segment must include:

- stable ID;
- source media ID and path;
- source in and out;
- record start and duration;
- selected video and audio track roles;
- speaker and text;
- event or story beat;
- reason for inclusion;
- continuity or sync notes.

Validate finite times, source bounds, nonnegative duration, stable ordering, and declared overlaps before building a timeline.

## Apply FFmpeg cut invariants

- Use one planned filtergraph for deterministic proxy or review assembly.
- Do not stream-copy arbitrary cut points; re-encode picture when cuts are not keyframe-aligned.
- Carry audio through segment operations without repeated lossy encodes, then mix and encode once.
- Preserve exact rational FPS and reset timestamps inside filtergraphs after trims.
- Strip problematic chapters or data streams from derived files when they create false duration or black tails.
- Extend retake seams or use short audio fades when a word tail would clip.
- Do not globally snap cuts to silence.
- Use VideoToolbox for fast review encodes when verified, and retain a software fallback.

Pass -nostdin to FFmpeg. Disconnect ffprobe stdin rather than passing -nostdin, which ffprobe does not support.

## Adapt decisions to the content

For talking-head jobs, filler, false starts, and redundant takes may be shortened aggressively when cadence survives.

For weddings:

- preserve intentional pauses and emotional delivery;
- keep complete meaning in vows and speeches;
- use J-cuts and L-cuts to maintain continuity and reactions;
- avoid changing chronology in a way that misrepresents events;
- keep clean dialogue and room tone across angle changes;
- mark every deliberate time compression in the editorial report.

## Produce both timeline and review evidence

Build timeline/timeline.json first. Construct the editable Resolve timeline from it, then render a review proxy from Resolve or a lineage-equivalent FFmpeg assembly. Remap transcript timing against the neutral timeline and verify representative words near the beginning, middle, and end.
