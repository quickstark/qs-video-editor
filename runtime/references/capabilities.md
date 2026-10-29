# Automation boundary

Run `--help` on the checked-in helper before composing a command. All Node helpers need Node 22+ and only built-in modules. Python Resolve/packaging helpers use the standard library.

| Stage | Implemented interface | Remaining work |
| --- | --- | --- |
| Standalone setup | `video.mjs bootstrap --workspace <dir> --profile <profile> [--apply]` | Software installation is separate; no automatic upgrade or account setup |
| Job scaffold | `scaffold-project.mjs --name <name> --kind <kind>` from workspace root, or explicit `--project` | User/project decisions must still be supplied |
| Preflight | `check-environment.mjs --project <workspace> [--require <tool>]` | Baseline readiness does not certify every optional tool, license, or editor |
| Inventory | `probe-media.mjs --input <file>` or `--project <job> --hash` | Content/identity judgments require review |
| Derivative lineage | `register-derivative.mjs --project <job> --input <project-relative-file>` | The producing command must be run separately |
| Transcription | `run-whisperx.mjs [--workspace <workspace>] <WhisperX arguments>` | Alignment model downloads/agreements, raw-result normalization, corrections, and edited-timeline remapping |
| Sync/proxies | Direct FFmpeg and source timecode workflow | No generic waveform-correlation or proxy assembly helper |
| Story/captions | Durable starter contracts and referenced workflows | No cutsheet builder; captions.mjs maps corrected timed words through explicit clip ranges and emits word-cue SRT/warnings |
| Graphics | `validate-graphics-plan.mjs --input <plan>` plus pinned HyperFrames CLI | Agent authors compositions; renderer plugins are helpful but optional |
| Review frames | `extract-review-frames.mjs --input <render> --output-dir <dir> --dry-run` | Supply boundaries explicitly; images cannot establish audio or complete motion review |
| Resolve | `scripts/resolve/resolve_timeline.py` | Version-1 hard-cut assembly; see resolve.md for deferred transitions, retimes, grading, audio automation, and captions |
| Offline interchange | Resolve helper `--write-portable --verify-source-hashes` | Editor import must be tested separately; no offline DRP/DRT |
| Final promotion | `promote-final.mjs --project <job> --input <render> --name <file> [--apply]` | Requires current approval and QA records |
| Cleanup | Reviewed manual plan | No deletion helper |
| Plugin distribution | `scripts/package-plugin.py --output <new.zip>` from plugin root | Public licensing/plugin publication is separate |

FFmpeg examples and manual stages are contracts to execute and review, not claims of automation. Record commands, versions, inputs, outputs, and any skipped or blocked checks in the owning manifest. Never turn an unavailable optional adapter into a blocker for an unrelated local operation.

Shared dispatcher additions: `migrate` for legacy npm bindings, `quick` for safe single/batch operations with receipts, `captions` for timing remap, and `evidence` for compact hash-bound project summaries. These do not automate semantic selection, waveform sync, uncertain-word correction or complete human review.
