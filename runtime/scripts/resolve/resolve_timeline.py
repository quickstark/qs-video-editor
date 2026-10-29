#!/usr/bin/env python3
"""Create Resolve-native or portable editable timelines from timeline.json.

Dry-run is the default.  Resolve and portable writer modules are imported only
behind their explicit mutation gates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from typing import Any, Dict, Optional, Sequence

from timeline_contract import (
    TimelineValidationError,
    build_plan,
    infer_project_root,
    load_and_validate,
    validation_summary,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Validate a neutral edit manifest and print an exact DaVinci Resolve plan. "
            "Nothing is written or connected unless --write-portable or --apply is present."
        )
    )
    parser.add_argument("--timeline", required=True, type=Path, help="path to timeline.json")
    parser.add_argument("--expected-timeline-sha256", help="reject a timeline changed since planning")
    parser.add_argument(
        "--project-root",
        type=Path,
        help="base for relative source/export paths (defaults to parent of timeline/)",
    )
    parser.add_argument("--resolve-project", help="Resolve project name (default: projectId)")
    parser.add_argument("--resolve-timeline", help="Resolve timeline name (default: timelineId)")
    parser.add_argument(
        "--export-dir",
        type=Path,
        help="override the output directory for DRP, DRT, OTIO, FCPXML, and EDL",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="validate schema and frame math without checking media or export paths",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="connect to an already-running Resolve and execute the printed plan",
    )
    parser.add_argument(
        "--write-portable",
        action="store_true",
        help="write source-relinkable OTIO, FCPXML 1.10, and (unless --no-edl) CMX3600 without Resolve",
    )
    parser.add_argument(
        "--load-existing-project",
        action="store_true",
        help="explicitly load and mutate an existing named Resolve project",
    )
    parser.add_argument(
        "--replace-existing-timeline",
        action="store_true",
        help="explicitly delete a same-named timeline before rebuilding it",
    )
    parser.add_argument(
        "--overwrite-exports",
        action="store_true",
        help="explicitly replace existing exports through same-directory staging",
    )
    parser.add_argument(
        "--overwrite-portable",
        action="store_true",
        help="with --write-portable only, atomically replace existing OTIO/FCPXML/EDL targets",
    )
    parser.add_argument(
        "--allow-missing-media",
        action="store_true",
        help=(
            "allow missing sources in ordinary dry-run plans only; incompatible with apply, "
            "portable write, or hash verification"
        ),
    )
    parser.add_argument(
        "--relink-map",
        type=Path,
        help="project-contained relink map (default: timeline/relink-map.json)",
    )
    parser.add_argument(
        "--verify-source-hashes",
        action="store_true",
        help=(
            "require a ready project-matching relink map with no missing media, then hash "
            "every referenced source against its SHA-256 entry"
        ),
    )
    parser.add_argument(
        "--no-edl",
        action="store_true",
        help="omit the limited EDL fallback; DRP, DRT, OTIO, and FCPXML remain planned",
    )
    return parser


def _print_json(value: Any, stream: Any = sys.stdout) -> None:
    json.dump(value, stream, indent=2, sort_keys=True)
    stream.write("\n")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if not args.timeline.is_absolute() and "\\" in str(args.timeline):
        parser.error(
            "--timeline must use forward slashes when project-relative; backslashes are not allowed"
        )
    timeline_path = args.timeline.expanduser().resolve()
    project_root = (
        args.project_root.expanduser().resolve()
        if args.project_root is not None
        else infer_project_root(timeline_path)
    )
    requested_modes = sum(bool(value) for value in (args.validate_only, args.apply, args.write_portable))
    if requested_modes > 1:
        parser.error("--validate-only, --apply, and --write-portable are mutually exclusive")
    if args.validate_only and args.verify_source_hashes:
        parser.error(
            "--verify-source-hashes performs media preflight and cannot be combined with --validate-only"
        )
    if (args.apply or args.write_portable or args.verify_source_hashes) and args.allow_missing_media:
        parser.error(
            "--allow-missing-media cannot be combined with --apply, --write-portable, "
            "or --verify-source-hashes"
        )
    if args.overwrite_portable and not args.write_portable:
        parser.error("--overwrite-portable requires --write-portable")
    if args.write_portable and args.overwrite_exports:
        parser.error("use --overwrite-portable, not --overwrite-exports, with --write-portable")
    if args.apply and args.overwrite_portable:
        parser.error("use --overwrite-exports, not --overwrite-portable, with --apply")
    if args.write_portable and (args.load_existing_project or args.replace_existing_timeline):
        parser.error(
            "Resolve project/timeline mutation flags cannot be combined with --write-portable"
        )

    try:
        actual_sha256 = hashlib.sha256(timeline_path.read_bytes()).hexdigest()
        if args.expected_timeline_sha256 and args.expected_timeline_sha256 != actual_sha256:
            parser.error("timeline changed since planning; read and review the current revision")
        normalized = load_and_validate(timeline_path)
        if args.validate_only:
            _print_json(validation_summary(normalized, timeline_path))
            return 0
        plan = build_plan(
            normalized,
            timeline_path,
            project_root,
            resolve_project_name=args.resolve_project,
            resolve_timeline_name=args.resolve_timeline,
            export_dir=args.export_dir,
            load_existing_project=args.load_existing_project,
            replace_existing_timeline=args.replace_existing_timeline,
            overwrite_exports=(
                args.overwrite_portable if args.write_portable else args.overwrite_exports
            ),
            allow_missing_media=args.allow_missing_media,
            include_edl=not args.no_edl,
            collision_formats=(
                ("OTIO", "FCPXML", "EDL")
                if args.write_portable and not args.no_edl
                else (("OTIO", "FCPXML") if args.write_portable else None)
            ),
            collision_overwrite_flag=(
                "--overwrite-portable" if args.write_portable else "--overwrite-exports"
            ),
            verify_source_hashes=(args.apply or args.verify_source_hashes),
            require_verified_sources=(args.apply or args.verify_source_hashes),
            relink_map_path=args.relink_map,
        )
        if args.write_portable:
            # This module has no Resolve dependency and never contacts the app.
            from portable_interchange import PortableWriteError, write_portable_documents

            try:
                result = write_portable_documents(
                    normalized,
                    plan,
                    overwrite=args.overwrite_portable,
                    include_edl=not args.no_edl,
                )
            except PortableWriteError as exc:
                _print_json(
                    {"ok": False, "phase": "portable-write", "error": str(exc)},
                    stream=sys.stderr,
                )
                return 3
            _print_json(result)
            return 0
        if not args.apply:
            _print_json(plan)
            return 0

        if hashlib.sha256(timeline_path.read_bytes()).hexdigest() != actual_sha256:
            parser.error("timeline changed during planning; nothing was sent to Resolve")

        # Importing this module is intentionally delayed until the mutation gate.
        from resolve_api import ResolveApplyError, apply_plan

        try:
            result = apply_plan(plan, overwrite_exports=args.overwrite_exports)
        except ResolveApplyError as exc:
            _print_json(
                {"ok": False, "phase": "resolve-apply", "error": str(exc)},
                stream=sys.stderr,
            )
            return 4
        _print_json(result)
        return 0
    except TimelineValidationError as exc:
        _print_json(
            {
                "ok": False,
                "phase": "validation-or-preflight",
                "error": str(exc),
                "details": exc.errors,
            },
            stream=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
