# QS Video Editor for Codex

<img src="assets/qs-video-editor.png" width="112" alt="QS Video Editor logo">

Local video workflows ranging from one conversion to an editable documentary film, using FFmpeg, optional local transcription and motion graphics, and DaVinci Resolve when available.

**Status: local migration candidate, undergoing release checks.** The six skills, shared runtime, workspace setup/migration, documentation and packaging are implemented. See the [verification record](docs/draft-inspection.md) for what has actually passed and which host/tool checks remain.

## Choose the workflow

These six entrypoints share one runtime and the same project contracts.

| Workflow | Use it for | Default setup profile |
| --- | --- | --- |
| `qs-video-setup` | Inspect requirements, create a workspace, enable selected capabilities | Selected by the job |
| `qs-video-quick` | Single or batch trims, conversions, resizing, audio extraction | `quick` |
| `qs-video-transcribe` | Local transcripts, corrections, caption preparation | `transcribe` |
| `qs-video-graphics` | Titles, lower thirds, overlays, standalone motion graphics | `graphics` |
| `qs-video-edit` | Full editorial work with Resolve or a portable editable handoff | `full`, narrowed to needed stages |
| `qs-video-review` | Technical, visual, listening, editorial, and editor-import checks | Only tools needed by the selected checks |

Start with [the usage guide](docs/usage.md) for copyable prompts and guidance on resuming projects. For a simple conversion, specify input and output paths and use `qs-video-quick`. For a film, name a workspace and project, then use `qs-video-edit`. Existing jobs should resume from their manifests rather than be scaffolded again.

Install `qs-video-editor@qs-video-editor-local` using the [installation guide](docs/installation.md). Upgrading the original local plugin? Follow the [QS namespace migration](docs/namespace-migration.md) so only the new six skill names remain installed.

## Where things live

This source repository is `Github/Personal/qs-video-editor`, matching [quickstark/qs-video-editor](https://github.com/quickstark/qs-video-editor). Existing projects and media live separately in `Github/Personal/video-workspaces/main`. The old `Github/Personal/video-editor` entry is a compatibility symlink to that workspace so saved editor exports and Python launchers still resolve their absolute paths; it contains no second plugin or media copy. The redundant workspace-local skill implementation has been removed, with its original files recoverable from the preserved local-only private history. New workspaces should be siblings, for example `Github/Personal/video-workspaces/client-film`, outside the installed plugin and this source checkout.

On this Mac, `Personal` and `personal` resolve to the same directory. Git may display the existing lowercase spelling.

## Read next

| Document | Purpose |
| --- | --- |
| [Migration specification](docs/migration-spec.md) | Architecture, contracts, phased implementation, and acceptance tests |
| [Installation and setup](docs/installation.md) | Current checks, target install process, profiles, and troubleshooting |
| [Optimal use](docs/usage.md) | Workflow selection, prompt examples, approvals, and handoff expectations |
| [Draft inspection](docs/draft-inspection.md) | Preserved history, observed test results, and release blockers |
| [GitHub comparison](docs/upstream-evaluation.md) | Upstreams, related tools, ranked improvements, and evaluation criteria |
| [Release preparation](docs/release.md) | Private marketplace rollout and later public-release requirements |

## Checks available now

From this repository root, with Node 22+ and Python 3.11:

```bash
node runtime/scripts/self-test.mjs
PYTHONDONTWRITEBYTECODE=1 python3.11 -m unittest discover -s runtime/scripts/resolve/tests -p 'test_*.py' -v
```

These test existing helper behavior using isolated fixtures. They do not establish plugin discovery, profile bootstrap, a real renderer run, transcription accuracy, or editor import.

The original distribution was marked `UNLICENSED`. No public license has been selected or granted. Historical bootstrap/package code remains recoverable locally from private checkpoint `fe8ac88`; that history is excluded from the public branch, and the removed paths are not current commands.
