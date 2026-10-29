# QS Video Editor for Codex

<img src="assets/qs-video-editor.png" width="112" alt="QS Video Editor logo">

Six local workflows for setup, media processing, transcription, motion graphics, editing, and review. They share one runtime and keep your media, project decisions, and outputs in a separate workspace.

FFmpeg handles media processing. HyperFrames handles graphics, WhisperX handles local transcription, and DaVinci Resolve provides an optional editor handoff. Set up only the tools your job needs.

## Install

You need the **Codex CLI with `codex plugin` support**, Git, Node.js 22+, and FFmpeg/ffprobe on your command path. Python, graphics packages, and transcription models are needed only for the workflows that use them.

For a new installation, run this in a terminal:

```bash
git clone https://github.com/quickstark/qs-video-editor.git
cd qs-video-editor

codex plugin marketplace add "$PWD"
codex plugin add qs-video-editor@qs-video-editor-local --json
codex plugin list --marketplace qs-video-editor-local --json
```

If you already have this checkout, start with `cd` and skip the clone. The final command should show `qs-video-editor@qs-video-editor-local`, version `0.2.0`, installed and enabled. Reload Codex if the six skills do not appear in its picker.

Upgrading the original `video-editor` plugin? Follow the [namespace migration](docs/namespace-migration.md) to update the workspace binding and remove the old skill names.

## Set up your first workspace

In Codex, select `$qs-video-editor:qs-video-setup` and use a request like this:

```text
Create a video workspace at ~/video-workspaces/first-edit using the installed
QS Video Editor runtime. I need trims and conversions only. Check the quick
profile, show the setup plan, create the workspace, and verify it.
Keep the workspace outside the plugin checkout.
```

Setup creates the workspace configuration and launcher. It does not install packages, download models, or move media. Then select `$qs-video-editor:qs-video-quick` and name your input files, output folder, and requested changes.

For terminal setup, graphics or transcription dependencies, and an existing workspace, use the [installation guide](docs/installation.md). You do not need to run `npm install` in this plugin repository.

## Choose a workflow

| Skill | Use it for | Setup profile |
| --- | --- | --- |
| `qs-video-setup` | Create a workspace, check tools, or add a capability | Selected for the job |
| `qs-video-quick` | Trims, conversions, resizing, and audio extraction | `quick` |
| `qs-video-transcribe` | Local transcripts, corrections, and captions | `transcribe` |
| `qs-video-graphics` | Titles, lower thirds, overlays, and standalone motion graphics | `graphics` |
| `qs-video-edit` | A sustained edit and editable handoff | `full`, with other capabilities added as needed |
| `qs-video-review` | Technical, visual, listening, editorial, or editor-import review | Tools needed for the selected checks |

The [usage guide](docs/usage.md) has prompts for each workflow and instructions for resuming an existing project. A full editorial workspace does not automatically install graphics or transcription tools.

## Keep the plugin and media separate

```text
work/
├── qs-video-editor/          # Plugin source
└── video-workspaces/
    └── my-film/              # Media, projects, dependencies, and outputs
```

Installing the plugin copies its instructions and runtime into the Codex cache. A workspace records the runtime version and digest it uses. A workspace uses a different runtime only after an explicit migration.

## Verification and limits

Version `0.2.0` source publication and local installation were verified on macOS. Checks covered the six skills, workspace preservation, a real FFmpeg conversion, reproducible packaging, and update/rollback recovery. Fresh renderer/ASR installation, native Resolve import, and Windows/Linux remain unverified. See the [verification record](docs/draft-inspection.md) for the evidence.

To check this source checkout, use Node.js 22+ and Python 3.11, with FFmpeg/ffprobe available:

```bash
npm run check
npm test
npm run test:helpers
npm run test:resolve
```

The tests use temporary fixtures. They do not replace watching a render, listening to the audio, or checking an editor import.

## Documentation

| Document | Contents |
| --- | --- |
| [Installation](docs/installation.md) | Requirements, workspace setup, optional tools, and troubleshooting |
| [Usage](docs/usage.md) | Prompts, terminal commands, batch processing, and approvals |
| [Namespace migration](docs/namespace-migration.md) | Upgrade from the original plugin and restore an earlier binding |
| [Migration specification](docs/migration-spec.md) | Architecture, workspace contracts, and acceptance tests |
| [Upstream evaluation](docs/upstream-evaluation.md) | Related tools and proposed improvements |
| [Release procedure](docs/release.md) | Source/package checks and publication boundaries |

The source is `UNLICENSED`; no public license has been granted. Media, models, fonts, and other assets retain their own terms.
