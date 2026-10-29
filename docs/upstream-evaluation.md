# AI video-editing repositories and methods

Research snapshot from 2026-10-29. This compares upstream source and documentation; it does not benchmark installed tools. No upstream code or media was copied. QS Video Editor has its own implementation and uses the dependencies listed below.

## Most relevant AI editing patterns

| Repository | Source-supported method | Our decision |
| --- | --- | --- |
| [video-timeline-copilot](https://github.com/ludmila-omlopes/video-timeline-copilot) | Transcript-first Codex workflow, compact transcript/visual evidence, spoken-word cut checks, preview/QA loop | Adopt source-linked evidence summaries and speech-boundary warnings; keep deeper audible-tail analysis optional |
| [FableCut](https://github.com/ronak-create/FableCut) and its [changelog](https://github.com/ronak-create/FableCut/blob/main/CHANGELOG.md) | Compact clip summaries, small agent patch operations, revision-conflict rejection | Add expected timeline hash checks and a compact evidence command; defer another browser editor |
| [video-evaluator](https://github.com/45ck/video-evaluator) | Uniform/change-point/per-shot sampling and explicit evidence gaps | Include input digest, sample reasons and coverage limitations; do not equate still samples with motion/listening |
| [Kinocut](https://github.com/KyaniteLabs/kinocut) | Allowlisted workflow operations, per-step receipts, resumable execution | Adopt plan → validate → execute → receipt for local batch work; keep one CLI instead of requiring an MCP server |
| [auto-edit-video-skill](https://github.com/natyang1234/auto-edit-video-skill) | Reviewed render snapshots, SHA-256 receipts, mechanical QA and optional adapters | Bind QA/export approval to the render and timeline actually reviewed |
| [timecode-agent](https://github.com/mupozg823/timecode-agent) | Transcript-first evidence ledgers and lazy visual verification | Read inventory/transcript first, inspect decision-critical frames, retain source IDs and spans |
| [agent-video-editor](https://github.com/kmilo93sd/agent-video-editor) | Shared editing craft separated from video-type recipes | Keep shared invariants and concise kind-specific guidance; avoid one giant skill |
| [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) | Editable parameterized motion recipes and preview/composition parity | Document explicit graphics parameters/editability; build only needed title/lower-third recipes |
| [AutoVideo-Agent](https://github.com/wangxin6x/AutoVideo-Agent) | Offline storyboard/manifest/media/timeline/QA path | Add a tiny real FFmpeg source/encode/probe smoke test instead of relying only on dummy media |

The new runtime implements the narrow patterns above: six entrypoints, a common safety reference, bound workspace setup, hash-resolved batch plans/receipts, compact evidence summaries, caption remapping with word-cut warnings, render/timeline-bound promotion, and a synthetic media smoke test. It does not claim a full semantic search engine, adaptive scene detector, visual scorer, waveform synchronizer, or browser editor.

## Optional larger tools

| Repository | Why it is interesting | Cost/boundary |
| --- | --- | --- |
| [StoryToolkitAI](https://github.com/octimot/StoryToolkitAI) | Semantic transcript/video indexing and source-linked story assembly | Useful retrieval method; full GUI/model stack is outside the default plugin |
| [ClipsAI](https://github.com/ClipsAI/clipsai) | Topic-based clip selection and speaker-focused reframing | Optional interview/podcast adapter; evaluate model, vision and diarization setup separately |
| [Rescript](https://github.com/wassgha/rescript) | Reversible transcript-driven cut ranges and original-media previews | Study the method; current license differs from earlier releases, so do not assume old permissive terms apply |
| [davinci-resolve-mcp](https://github.com/samuelgursky/davinci-resolve-mcp) | Richer timeline/media inspection and review marker operations | Optional adapter; retain direct scripting and offline interchange, detect edition/version limitations |
| [Crayotter](https://github.com/idwts/Crayotter) | Structured edit blueprint and resource-bounded execution graph | Future scheduling pattern; serialize mutations and do not import cloud defaults or unmeasured speed claims |

## Dependency upstreams and adjacent utilities

| Upstream | Current fit | Next evaluation |
| --- | --- | --- |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | Existing deterministic media core | Reuse installed filters before adding dependencies; explicitly distinguish exact encode vs keyframe stream copy |
| [WhisperX](https://github.com/m-bain/whisperX) | Existing local ASR/alignment | Normalize raw output carefully; missing word alignments, overlap and speaker labels need review |
| [HyperFrames](https://github.com/heygen-com/hyperframes) and [releases](https://github.com/heygen-com/hyperframes/releases) | Existing code-driven graphics; local pin remains 0.7.109 | GitHub lists 0.8.216 on research date. Test a fresh locked install, alpha, rational fps, audio, motion and extracted-package parity before changing pins |
| [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | Useful independent validation of our portable timeline output | Optional conformance job. External adapters are separate packages after 0.16; core installation is not proof that all editor formats work |
| [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | Candidate shot boundaries for review/cut planning | Optional local analysis; compare scene precision and review-time savings before adding OpenCV |
| [Auto-Editor](https://github.com/WyattBlue/auto-editor) | Candidate silence/motion first-pass suggestions | Optional talking-head mode; no automatic documentary/wedding compression |
| [ffmpeg-normalize](https://github.com/slhck/ffmpeg-normalize) | Two-pass loudness normalization and before/after measurements | Compare with a small direct FFmpeg wrapper; preserve channel layout, originals and stems |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | Apple Silicon-oriented local ASR candidate | Benchmark speed, memory, names and alignment on consented fixtures; do not call it a drop-in WhisperX alignment replacement |

The HyperFrames release listed here was checked on the research date. The workspace pin remains 0.7.109 until a different version passes the local qualification checks.

## Adoption order and experiments

1. **Ship the focused foundation:** validate discovery, bootstrap isolation, legacy caller migration, unique outputs, exact source hashes, revision-bound approval and a real-media smoke test.
2. **Improve evidence quality:** add small deterministic scene/freeze/audio analyses to the compact summary. Compare a transcript-only route to decision-critical visual sampling; record evidence coverage and human correction rate.
3. **Evaluate optional intelligence:** semantic selects and reframing must produce unapproved source-linked candidates. Measure recall of required moments, speech truncation, review time, memory and elapsed processing on the same fixture. No claimed improvement without those measurements.

License names in upstream summaries are not permission to redistribute models, music, fonts, sample footage or binaries. Inspect the exact chosen revision and its component licenses before copying or bundling anything. Our current source remains UNLICENSED; private use and a future public license decision are separate.
