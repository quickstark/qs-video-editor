# Pipeline and workspace contract

Use one neutral, durable edit model to drive the Resolve timeline, review renders, graphics placement, captions, and exports. Treat a movie file as evidence of a build, not as the source of truth.

## Separate taste from jobs

Keep permanent material at the repository root:

    AGENTS.md
    brand.md
    styles/<style>/
    assets/fonts/
    assets/logos/
    assets/sfx/
    renderers/

Keep one disposable job under projects/<content-name>/:

    project.json
    creative-brief.md
    raw/
    proxies/
    broll/
    audio/
    assets/
    transcript/
    sync/
    timeline/
    graphics-build/
    reviews/
    manifests/
    outputs/

Name jobs for the content in kebab case. Never use a camera filename, date-only name, stage suffix, final, or v2 as the job folder.

## Give every artifact one owner

- raw/: immutable source footage and recorder files.
- proxies/: regenerable edit proxies whose names preserve source identity.
- sync/: sync groups, source-to-master offsets, drift corrections, confidence, and verification evidence.
- transcript/: source transcript, B-roll transcript, corrections, cutsheet, edited transcript, and transcription parameters tied to input hashes.
- timeline/: neutral timeline.json and stage lineage. This is the editable decision model.
- graphics-build/: approved plan, HyperFrames source, per-part outputs, and renderer cache.
- broll/: recorded support footage plus its provenance manifest.
- assets/references/: approved project-specific documents, photographs, logos, and visual references.
- assets/generated/: separately approved decorative generated assets and their provenance; never documentary evidence.
- audio/: licensed music, licenses, SFX, dialogue and ambience plans, and filtergraphs.
- outputs/captions/: corrected SRT or VTT plus styling plan.
- reviews/: extracted frames, technical/editorial reports, approval records, and accepted findings.
- manifests/: stage state, hashes, tool versions, exact commands, and structured run reports.
- outputs/interchange/: exported DRP, DRT, OTIO, FCPXML, and EDL. The bridge prints its JSON report to stdout; capture it deliberately in the owning stage manifest when a durable report is required.
- outputs/: review renders, declared masters, stems, graphics, captions, and interchange. Never use it as scratch.

Do not create a generic temp or notes folder. Put regenerable heavyweight files in a named cache under the stage that owns them.

## Make the neutral timeline primary

Store every editable item as a source reference plus source range, record range, track, role, and stable ID. Keep these classes separate:

- V1: primary story picture.
- V2: alternate angles and cutaways.
- V3: recorded B-roll and support footage.
- V4 and above: HyperFrames graphics, titles, overlays, and any approved decorative generated clips.
- A1 and A2: production dialogue and recorder audio.
- A3: natural ambience.
- A4: licensed music.
- A5: sparse SFX.
- subtitle tracks: corrected captions when Resolve import supports them; always keep a sidecar.

Keep rendered graphics as distinct clips on upper video tracks. Do not bake them into the base picture before the editable handoff.

## Track stage state

For every stage, record:

- status: pending, in-progress, needs-review, approved, complete, skipped, or blocked;
- input artifact paths and hashes;
- output artifact paths and hashes;
- exact command or renderer props;
- tool and version;
- start and completion timestamps;
- approval identity and notes;
- downstream artifacts invalidated by a change.

Never infer the newest valid output from a filename or modification time.

## Apply invalidation strictly

Use this dependency order:

    source hashes
      -> probe and sync map
      -> source transcript
      -> cutsheet
      -> neutral timeline
      -> Resolve timeline
      -> edited transcript
      -> graphics windows
      -> captions and audio automation
      -> review render
      -> final deliverables

Examples:

- A source file change invalidates everything derived from that source.
- A transcript spelling-only correction does not invalidate picture timing.
- A cutsheet timing change invalidates the Resolve timeline and every timestamped downstream artifact.
- A local graphic copy edit invalidates that part and composites that consume it, not the base cut.
- A global safe-zone or font change invalidates every graphic using that style.
- A music level change invalidates the audio mix and review render, not picture or graphics.

Snapshot the selected style and renderer lock information into the job before the first render so old projects remain reproducible when shared defaults evolve.

## Preserve recoverability

- Back up irreplaceable footage independently before editing.
- Hash source files without altering them.
- Build proxies and normalized audio as new files.
- Default every promotion, cleanup, and Resolve build to dry-run.
- Never overwrite an approved Resolve timeline. Create a new named revision and preserve the previous approved timeline.
- Export both the Resolve project and a timeline interchange package before closing a job.
