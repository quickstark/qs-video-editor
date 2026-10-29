# Tool and provider routing

Check the real environment before installing anything. Prefer project-local pins and structured interfaces.

## Required baseline

### Workspace runtime

Node 22 or newer, npm, FFmpeg, and ffprobe are the core requirements. From a
fresh checkout, restore the exact root lock and inspect the current machine:

    npm ci
    npm run video:check

Do not treat a version recorded in a project example as current machine state.
The environment check is read-only and is the source of truth for available
executables, exact renderer pins, and installed editor applications.

### FFmpeg and ffprobe

Use them for media facts and deterministic processing.

Verify:

    ffmpeg -version
    ffprobe -version
    ffmpeg -hwaccels
    ffmpeg -encoders
    ffmpeg -filters

On macOS, Homebrew is the normal install path:

    brew install ffmpeg

Do not assume every Homebrew build includes drawtext, ASS, zscale, stabilization, or every third-party filter. Route text and captions through HyperFrames, Resolve, or the verified filters that actually exist.

### DaVinci Resolve for native handoff

Target Resolve for the native editable handoff. Resolve is required to create
or apply DRP/DRT exports, but it is not required for validation, dry-run plans,
or the offline OTIO/FCPXML writer. The official installation provides Python
and Lua scripting modules, timeline construction, markers, project save and
export, DRT, FCPXML, and OTIO support. The installed README introduces the
package as the DaVinci Resolve Studio scripting API, then states in its “Studio
and AI Scripting APIs” section that the APIs cover a common superset of
functions for both Free and Studio. It also says a call can return `False` or
an appropriate error when a function is Studio-only in Free, its system
requirements are unmet, or required Extras are absent. Detect the running
edition and check every return value; keep the dry-run and offline portable
path when external scripting is unavailable.

Resolve must be running for an external script to connect. Prefer local-only scripting permission. Do not enable network scripting for this workflow.

## Default graphics backend

### HyperFrames

Install and pin it exactly in the workspace package, then record the resolved version with each project's renders:

    npm install --save-dev --save-exact hyperframes@0.7.109
    npm run hyperframes:doctor

Use the installed HyperFrames Codex plugin for current authoring guidance. Do not float latest inside an active job. Local rendering uses FFmpeg and a provisioned browser; hosted rendering is optional and may consume credits.

`hyperframes doctor` also probes optional `whisper-cpp`, Kokoro, MusicGen, and
Docker capabilities. Their absence does not block the default local
HyperFrames renderer used by this workspace.

## Standard local transcription

### WhisperX

Keep it out of system Python. Sync the locked Python 3.11 environment, then use
the repository wrapper:

    npm run video:python:sync
    npm run video:transcribe -- projects/new-film/sync/camera-a-scratch.wav --model small --compute_type int8 --device cpu --language en

The lock currently pins WhisperX 3.8.6 on Python 3.11. The wrapper defaults
model and library caches to `.cache/whisperx/` unless the caller already set
the corresponding environment variables. It never installs into system Python.

On macOS, a standalone TorchCodec diagnostic may need a compatible keg-only
FFmpeg sidecar when the system FFmpeg is newer than TorchCodec supports. That
sidecar is optional and diagnostic-only. Do not set its dynamic-library path
globally or inject it into a normal WhisperX process: PyAV bundles another
FFmpeg family, and mixing both sets can destabilize macOS. WhisperX preloads
file audio into memory before its pyannote VAD/diarization path, so the normal
repository wrapper keeps those library families isolated.

Record model downloads and diarization requirements. Speaker diarization can require a Hugging Face token and model agreement. Do not transmit private audio to a cloud service merely because local diarization is inconvenient.

## Optional adapters

### Remotion

Use `renderers/remotion/` only when the job benefits from React components or
Studio. It is a separate locked package, not a root npm workspace. Install it
only when selected, keep every Remotion package on the same exact version, and
start Studio without opening a system browser:

    npm --prefix renderers/remotion ci
    npm run remotion:dev

The package's `dev` script includes `--no-open`; keep that safety flag embedded rather than relying on every caller to remember it. Use the in-app Browser for preview. Treat Remotion as a graphics fallback, not the default NLE or timeline handoff. Its checked-in 30 fps cards are preview-safe only; conform or rebuild them at the approved project timebase before timeline use.

### Higgsfield

Treat Higgsfield as an optional paid generation provider. No Higgsfield
executable, plugin, or MCP adapter is bundled with this repository; verify the
current Codex session before promising it. Higgsfield currently documents an
[official CLI and MCP workflow](https://higgsfield.ai/cli). If an approved CLI
or authenticated MCP is available, prefer that structured interface over GUI automation.
Estimate cost before generation and require authorization before uploading any
private source.

### CapCut

CapCut can remain a user-selected manual or flattened-output editor, but no
structured Codex integration or editable OTIO/FCPXML import contract is
verified here. CapCut's current
[project-import guidance](https://www.capcut.com/help/import-a-previous-project-into-the-current-project)
describes exported video as flattened, without separately editable layers or
tracks. Do not describe it as an editable interchange fallback. Prefer
Resolve or another editor whose neutral interchange import has been tested for
the job, and do not make a brittle Computer Use-only CapCut workflow the
default.

## Codex-native capabilities

- Skill invocation owns repeatable stage decisions and scripts.
- HyperFrames and Remotion plugins provide renderer-specific guidance.
- Browser inspects local renderer previews.
- Computer Use operates Resolve only for GUI-only verification or actions.
- Subagents isolate frame-heavy technical, composition, and story reviews.
- Goal mode keeps long edits moving until a real output and handoff exist.

## Environment check policy

The check script should report, not install:

- OS, architecture, free space;
- FFmpeg and ffprobe versions and capabilities;
- Node, npm, Python 3.11, uv, and Git LFS;
- HyperFrames project pin and doctor availability;
- Remotion fallback version;
- Resolve and CapCut installation and versions;
- WhisperX availability;
- a reminder that fonts, licenses, source backup, Browser/Computer Use, and
  session capabilities still require separate human or session verification;
  the checker does not scan or approve them.

Install only after the user can review the exact command and impact.
