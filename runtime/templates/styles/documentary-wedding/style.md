# Documentary Wedding Style

Status: provisional, ready for first edit, and subject to the confirmation list in brand.md. This style is designed for a sincere wedding film built from real, synchronized material. It deliberately replaces the playbook's talking-head compression rules with documentary continuity and emotional patience.

## Intent

The viewer should feel present, not marketed to. Favor glances, breath, room tone, hands, weather, architecture, fabric, movement through space, and complete spoken thoughts. The edit may become lyrical, but it must stay factually honest. Chronology may be compressed; it must not be falsified.

## Format and frame

- Primary canvas: 16:9.
- Resolution: preserve source detail; target UHD 3840x2160 when hero sources support it, otherwise 1920x1080. Decide after ingest.
- Frame rate: probe and retain the exact rational timebase of the primary camera. Never convert 24000/1001 to 24/1 or 30000/1001 to 30/1 by shorthand.
- Title safe: keep essential text inside 8% on all sides. Keep faces and key gestures clear of title graphics.
- Delivery: editable Resolve-friendly interchange package first, review MP4 second, flattened master after approval.

## Story grammar

Use a broadly chronological spine:

1. Place and anticipation
2. Preparations and relationships
3. Arrival and procession
4. Ceremony, readings, vows, rings, kiss
5. Release and portraits
6. Reception entrances, toasts, meal, and shared reactions
7. First dances and open dance floor
8. A real closing gesture or image

The actual footage decides which chapters exist. Never manufacture a missing chapter or imply an event occurred. A short cold open may preview later authentic images, but it must not change cause, meaning, or chronology.

## Scene vocabulary

### Establishing observation

Wide or medium frames that locate time and place. Hold 3-8 seconds when the shot is stable. Use native ambience; no title is required.

### Intimate detail

Hands, clothing, flowers, objects, handwritten notes, or environmental details that were actually filmed. Use as visual bridges, not as substitutes for missing people or events. Hold 2-5 seconds.

### Procession and movement

Prioritize spatial continuity. Cut on motivated movement or eyeline; retain a wide safety angle through entrances. Avoid speed ramps unless the source clearly supports a single, non-emotional transition.

### Ceremony master

The continuity anchor. Return to it when alternate angles break orientation or sync. Do not cut away merely to increase cut frequency.

### Vow close coverage

Use the most stable, flattering, truthful angle. Preserve complete phrases, breaths, meaningful repetition, laughter, and silence. Reaction shots must be synchronous or honestly offset as non-literal montage outside a quoted moment.

### Reaction

Use family and guest reactions only when identity and timing are supported by the source. Never create a false response to a vow, toast, kiss, or announcement.

### Portrait interlude

May be more lyrical and music-led. Keep motion natural; a digital push is optional and restrained to 2-5% over at least four seconds. Do not animate faces with generative tools.

### Toast

Preserve setup, meaning, and payoff. Remove only verified technical dead time, duplicated false starts, or content approved for omission. Cutaways may cover edits but must not alter who is speaking or what caused a reaction.

### Dance and celebration montage

Energy may rise. Typical shot length is 1-3 seconds, with longer holds for a complete action or relationship beat. Avoid relentless beat cutting; keep occasional natural sound anchors.

### Title card

Use only verified text. Anatomy at 1920x1080: content box centered, maximum width 1240px; names in display face at 112-148px; verified date/location line at 28-34px; at least 32px vertical gap; one hairline rule no wider than 360px; 8% title-safe margin. At UHD, scale dimensions by two.

### Lower third

Only for a verified speaker identity when the audience needs it. Anatomy at 1920x1080: left edge 154px, baseline region y=830-930px, maximum width 620px, name 42px, role 24px, 12px gap, two lines maximum. Fade or mask in over 10-14 frames and hold long enough to read.

### Picture-in-picture

Disabled by default. If an explicitly requested comparison requires it, use one fixed 16:9 inset at 1920x1080: x=1288, y=669, width=560, height=315, 72px right and 96px bottom margin, 2px $rule border, no bounce, and one entrance per continuous run. Scale geometry proportionally for other canvases.

## Boundaries and transitions

| Boundary | Default mechanic |
| --- | --- |
| Same continuous action or dialogue | Straight cut on action, eyeline, or phrase boundary |
| Angle change during vows/toasts | Straight cut with continuous synchronized audio |
| Chapter change with a natural visual bridge | 8-16 frame dissolve only when it expresses elapsed time |
| Preparation to ceremony | Motivated sound bridge, then straight cut or restrained 12-frame dissolve |
| Ceremony to celebration | Authentic applause/bells/cheer as an audio bridge |
| Real footage to title | 10-16 frame luminance-neutral dissolve or clean cut on sound |
| Title to real footage | Title clears fully; footage returns without a decorative transition |
| HyperFrames multi-scene graphic | Restrained crossfade/reveal; every scene enters, and the transition owns the outgoing scene |

No whip pans, film-burn packs, faux light leaks, glitch transitions, or template flourishes by default.

## Camera behavior

- Do not reframe merely to simulate coverage.
- Stabilize only when it improves watchability without warping faces, architecture, or horizon.
- Preserve the master angle for continuity; favor close coverage for emotion.
- Digital pushes are optional, linear or gently eased, 2-5%, and at least four seconds long.
- Do not use browser-rendered video transforms when FFmpeg geometry can do the same job.
- When source aspect ratios differ, crop deliberately and retain a source-relink record. Never stretch.

## Multicam and sync

- Group clips by recorded time, embedded timecode, waveform, slate, and visual evidence.
- Prefer dedicated recorder or lav audio for vows and toasts; retain camera audio as sync reference and emergency backup.
- Record sync method, offset, drift correction, confidence, and verification points in sync/sync-map.json.
- Verify beginning, middle, and end of every long source. A waveform match at the start is not proof against drift.
- Keep each source angle and each audio role on separate named tracks in timeline/timeline.json.
- If sync confidence is low, mark the range and request human review; do not hide it with B-roll.

## Spoken-word editing

Do not run automatic filler removal or blanket silence trimming. For vows, readings, ceremony, letters, interviews, and toasts:

- preserve complete thoughts and emotional pauses;
- retain meaningful stumbles, laughter, breath, and repeated words;
- never combine separate sentences into a quotation the person did not deliver;
- cross-check every cut against waveform and playback;
- add short, equal-power audio transitions only when needed to prevent clicks;
- use room tone from the same acoustic space to repair a genuinely approved removal.

Transcribe once with word timings, then remap timings to the edited timeline. Names and low-confidence words require human verification.

## Color and texture

Start neutral and skin-tone faithful. Match cameras before applying a look. Protect dress and shirt highlights; preserve black-level detail in suits and night footage. The provisional look is warm-neutral, not orange: modest highlight roll-off, restrained saturation, and no crushed blacks.

Film grain is optional and subtle: monochromatic, fine 35mm character, approximately 3-5% opacity at 1080p after resize. Do not add gate weave, dust, scratches, halation, or vintage damage unless requested. Graphics backgrounds use $bg, a quiet radial falloff, or a very fine $rule grid; never a generic flat black canvas.

## Typography and graphics

Use Cormorant Garamond Semibold for names and ceremonial titles, and Inter for supporting copy. Load real font files before final render. Use $accent on one focal element at most. Graphics are sparse: opening/closing card, verified lower thirds, and perhaps one chapter card if it clarifies structure.

Build each HyperFrames hero frame as a static, correct layout before animation. Motion is deterministic, seekable, and restrained. Use 0.45-0.9 second entrances, staggered by 0.12-0.25 seconds. Avoid animation during vows unless it is a quiet title that clears before the spoken line becomes emotionally central.

Generated assets are disabled. If approved, they may provide only abstract textures, non-representational shapes, or decorative botanical motifs. They may not portray people, venues, weather, vows, rings, flowers, or events as if captured at the wedding.

## Audio

Dialogue is the narrative anchor. Remove hum/noise conservatively, repair plosives manually, and avoid the over-denoised "underwater" sound. Preserve ambience and transitions between spaces.

- Dialogue target: intelligible and natural, generally -20 to -16 LUFS short-term depending on the moment.
- Review-film integrated target: approximately -16 LUFS, adjusted after a complete listen.
- True peak ceiling: -1.5 dBTP.
- Music under vows/toasts: begin around -24 to -20 dB relative to full-scale source level, then mix by ear around speech.
- Music-led montage: may rise, but dialogue and meaningful natural sound retain priority.
- SFX: real recorded samples only, sparse, and never used to fake an event.
- Deliver separate dialogue, ambience, music, and SFX stems with the interchange package.

Music must be user-supplied or demonstrably licensed. No automatic download.

## Captions

The hero film has no burned-in captions by default. When requested, produce an SRT and optionally a separate captioned review/delivery file. Captions are verbatim, sentence-cased, two lines maximum, inside title safe, and never animated word-by-word over vows.

## Measured pacing

| Material | Typical hold | Rule |
| --- | --- | --- |
| Establishing shot | 3-8 seconds | Let ambience establish place |
| Preparation/detail | 2-5 seconds | Follow action and relationships |
| Procession | Action-led | Preserve entrances and spatial continuity |
| Vows/readings | Thought-led | No maximum; preserve meaning and pauses |
| Reactions | 2-6 seconds | Use only when synchronous or honestly framed |
| Portraits | 2.5-6 seconds | Allow lyrical breath |
| Toasts | Thought-led | Keep setup and payoff together |
| Dance montage | 1-3 seconds | Break rhythm for complete actions |
| Closing image | 4-10 seconds | Leave a natural or musical tail |

These are review prompts, not automatic cut thresholds.

## Learned preferences

No learned preferences yet. Only add a preference after showing the user the exact diff and confirming it should apply to future documentary-wedding projects.

## Pre-lock confirmation

Confirm runtime and deliverables, source aspect ratios/frame rates, date and venue text, verified speaker names, typography, music licensing, desired ceremony/toast coverage, caption requirements, color references, and whether any generated decorative asset is desired. Unknown information stays omitted, never inferred.
