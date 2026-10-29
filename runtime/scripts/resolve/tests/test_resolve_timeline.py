from __future__ import annotations

import copy
from fractions import Fraction
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from xml.etree import ElementTree as ET


RESOLVE_SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(RESOLVE_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(RESOLVE_SCRIPT_DIR))

from portable_interchange import frames_to_timecode  # noqa: E402
from timeline_contract import (  # noqa: E402
    FrameRate,
    TimelineValidationError,
    build_plan,
    load_and_validate,
    timecode_to_frames,
    validate_timeline,
)


FIXTURE_DIR = RESOLVE_SCRIPT_DIR / "fixtures"
FIXTURE_PATH = FIXTURE_DIR / "timeline.json"
RELINK_FIXTURE_PATH = FIXTURE_DIR / "relink-map.json"
CLI_PATH = RESOLVE_SCRIPT_DIR / "resolve_timeline.py"


def load_fixture_dict():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def load_relink_fixture_dict():
    return json.loads(RELINK_FIXTURE_PATH.read_text(encoding="utf-8"))


def copy_fixture_project(destination: Path) -> Path:
    shutil.copytree(FIXTURE_DIR / "media", destination / "media")
    shutil.copy2(RELINK_FIXTURE_PATH, destination / "relink-map.json")
    timeline_path = destination / "timeline.json"
    timeline_path.write_text(json.dumps(load_fixture_dict()), encoding="utf-8")
    return timeline_path


def run_cli(*arguments: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env["RESOLVE_SCRIPT_LIB"] = "/definitely/not/a/resolve/library"
    return subprocess.run(
        [sys.executable, str(CLI_PATH), *arguments],
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )


class FrameMathTests(unittest.TestCase):
    def test_fractional_non_drop_hour_uses_nominal_frame_number(self):
        rate = FrameRate(24000, 1001, False)
        self.assertEqual(rate.fraction, Fraction(24000, 1001))
        self.assertEqual(rate.resolve_setting, "23.976")
        self.assertEqual(timecode_to_frames("01:00:00:00", rate), 86400)
        self.assertEqual(frames_to_timecode(86400, rate), "01:00:00:00")

    def test_2997_drop_frame_hour_round_trip(self):
        rate = FrameRate(30000, 1001, True)
        self.assertEqual(rate.resolve_setting, "29.97 DF")
        self.assertEqual(timecode_to_frames("01:00:00;00", rate), 107892)
        self.assertEqual(frames_to_timecode(107892, rate), "01:00:00;00")

    def test_drop_frame_rejects_skipped_minute_number(self):
        with self.assertRaises(TimelineValidationError) as context:
            timecode_to_frames("00:01:00;00", FrameRate(30000, 1001, True))
        self.assertIn("skipped drop-frame number", str(context.exception))

    def test_non_drop_requires_colon(self):
        with self.assertRaises(TimelineValidationError):
            timecode_to_frames("00:00:00;00", FrameRate(24, 1, False))


class TimelineValidationTests(unittest.TestCase):
    def test_fixture_validates(self):
        normalized = load_and_validate(FIXTURE_PATH)
        self.assertEqual(normalized["projectId"], "resolve-bridge-fixture")
        self.assertEqual(len(normalized["clips"]), 4)
        self.assertEqual(normalized["frameRate"].rational_label, "24000/1001")

    def test_half_open_durations_must_match(self):
        data = load_fixture_dict()
        data["videoTracks"][0]["items"][0]["timelineEndFrame"] = 239
        with self.assertRaises(TimelineValidationError) as context:
            validate_timeline(data)
        self.assertIn("duration mismatch", str(context.exception))

    def test_overlaps_on_same_track_are_rejected(self):
        data = load_fixture_dict()
        duplicate = copy.deepcopy(data["videoTracks"][0]["items"][0])
        duplicate["id"] = "overlapping-video"
        duplicate["timelineStartFrame"] = 100
        duplicate["timelineEndFrame"] = 340
        data["videoTracks"][0]["items"].append(duplicate)
        with self.assertRaises(TimelineValidationError) as context:
            validate_timeline(data)
        self.assertIn("overlap on track", str(context.exception))

    def test_nonempty_audio_track_requires_explicit_layout(self):
        data = load_fixture_dict()
        del data["audioTracks"][0]["audioType"]
        with self.assertRaises(TimelineValidationError) as context:
            validate_timeline(data)
        self.assertIn("audioType", str(context.exception))

    def test_empty_audio_track_can_defer_to_documented_resolve_default(self):
        data = load_fixture_dict()
        data["musicItems"] = []
        del data["audioTracks"][1]["audioType"]
        normalized = validate_timeline(data)
        self.assertIsNone(normalized["tracks"]["audio"][1]["audioType"])
        self.assertEqual(
            normalized["tracks"]["audio"][1]["audioTypeSource"],
            "resolve-default-empty-track",
        )

    def test_graphics_must_be_on_upper_track(self):
        data = load_fixture_dict()
        data["graphicsItems"][0]["trackId"] = "V1"
        with self.assertRaises(TimelineValidationError) as context:
            validate_timeline(data)
        self.assertIn("upper video track", str(context.exception))

    def test_nested_caption_item_is_deferred_not_treated_as_audio(self):
        data = load_fixture_dict()
        data["captionTracks"] = [
            {
                "id": "C1",
                "name": "Captions",
                "role": "accessibility-captions",
                "enabled": True,
                "locked": False,
                "items": [
                    {
                        "id": "captions-srt",
                        "trackId": "C1",
                        "sourceId": "captions",
                        "sourcePath": "media/captions.srt",
                        "sourceInFrame": 0,
                        "sourceOutFrame": 360,
                        "timelineStartFrame": 0,
                        "timelineEndFrame": 360,
                        "enabled": True,
                        "syncGroupId": None,
                        "notes": [],
                    }
                ],
            }
        ]
        normalized = validate_timeline(data)
        plan = build_plan(
            normalized, FIXTURE_PATH, FIXTURE_DIR, allow_missing_media=True
        )
        self.assertEqual(
            plan["resolve"]["captionItemsDeferred"][0]["itemId"], "captions-srt"
        )
        self.assertFalse(
            any(
                clip["itemId"] == "captions-srt"
                for clip in plan["resolve"]["clips"]
            )
        )


class ContainmentAndIntegrityTests(unittest.TestCase):
    def test_absolute_source_path_is_rejected(self):
        data = load_fixture_dict()
        data["videoTracks"][0]["items"][0]["sourcePath"] = "/etc/passwd"
        normalized = validate_timeline(data)
        with self.assertRaises(TimelineValidationError) as context:
            build_plan(normalized, FIXTURE_PATH, FIXTURE_DIR)
        self.assertIn("project-relative, not absolute", str(context.exception))

    def test_source_path_escape_is_rejected(self):
        data = load_fixture_dict()
        data["graphicsItems"][0]["sourcePath"] = "../outside.mov"
        normalized = validate_timeline(data)
        with self.assertRaises(TimelineValidationError) as context:
            build_plan(normalized, FIXTURE_PATH, FIXTURE_DIR, allow_missing_media=True)
        self.assertIn("escapes projectRoot", str(context.exception))

    def test_project_relative_source_and_export_paths_reject_backslashes(self):
        source_data = load_fixture_dict()
        source_data["graphicsItems"][0]["sourcePath"] = "media\\escape.fixture"
        with self.assertRaises(TimelineValidationError) as source_context:
            build_plan(
                validate_timeline(source_data),
                FIXTURE_PATH,
                FIXTURE_DIR,
                allow_missing_media=True,
            )
        self.assertIn("backslashes are not allowed", str(source_context.exception))

        export_data = load_fixture_dict()
        export_data["interchange"]["otioPath"] = (
            "outputs\\interchange\\portable-edit.otio"
        )
        with self.assertRaises(TimelineValidationError) as export_context:
            build_plan(validate_timeline(export_data), FIXTURE_PATH, FIXTURE_DIR)
        self.assertIn("backslashes are not allowed", str(export_context.exception))

    def test_source_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            timeline_path = copy_fixture_project(root)
            outside = root.parent / f"{root.name}-outside.fixture"
            outside.write_text("outside", encoding="utf-8")
            try:
                (root / "media" / "escape.fixture").symlink_to(outside)
                data = json.loads(timeline_path.read_text(encoding="utf-8"))
                data["graphicsItems"][0]["sourcePath"] = "media/escape.fixture"
                normalized = validate_timeline(data)
                with self.assertRaises(TimelineValidationError) as context:
                    build_plan(normalized, timeline_path, root)
                self.assertIn("escapes projectRoot", str(context.exception))
            finally:
                outside.unlink()

    def test_manifest_export_outside_default_interchange_root_is_rejected(self):
        data = load_fixture_dict()
        data["interchange"]["otioPath"] = "exports/portable-edit.otio"
        normalized = validate_timeline(data)
        with self.assertRaises(TimelineValidationError) as context:
            build_plan(normalized, FIXTURE_PATH, FIXTURE_DIR)
        self.assertIn("outputs/interchange", str(context.exception))

    def test_absolute_manifest_export_is_rejected(self):
        data = load_fixture_dict()
        data["interchange"]["primaryPath"] = "/tmp/escape.fcpxml"
        normalized = validate_timeline(data)
        with self.assertRaises(TimelineValidationError) as context:
            build_plan(normalized, FIXTURE_PATH, FIXTURE_DIR)
        self.assertIn("project-relative, not absolute", str(context.exception))

    def test_explicit_export_dir_must_remain_inside_project(self):
        normalized = load_and_validate(FIXTURE_PATH)
        plan = build_plan(
            normalized,
            FIXTURE_PATH,
            FIXTURE_DIR,
            export_dir=Path("custom/interchange"),
        )
        for export in plan["resolve"]["exports"]:
            self.assertIn("/custom/interchange/", export["path"])
        with self.assertRaises(TimelineValidationError) as context:
            build_plan(
                normalized,
                FIXTURE_PATH,
                FIXTURE_DIR,
                export_dir=Path("../escape"),
            )
        self.assertIn("inside projectRoot", str(context.exception))
        with self.assertRaises(TimelineValidationError) as slash_context:
            build_plan(
                normalized,
                FIXTURE_PATH,
                FIXTURE_DIR,
                export_dir=Path("custom\\interchange"),
            )
        self.assertIn("backslashes are not allowed", str(slash_context.exception))

    def test_default_export_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            timeline_path = copy_fixture_project(root)
            data = json.loads(timeline_path.read_text(encoding="utf-8"))
            data["interchange"] = {}
            normalized = validate_timeline(data)
            outside = root.parent / f"{root.name}-outside-exports"
            outside.mkdir()
            (root / "outputs").mkdir()
            try:
                (root / "outputs" / "interchange").symlink_to(outside, target_is_directory=True)
                with self.assertRaises(TimelineValidationError) as context:
                    build_plan(normalized, timeline_path, root)
                self.assertIn("resolves outside projectRoot", str(context.exception))
            finally:
                outside.rmdir()

    def test_sha256_relink_verification_passes_and_mismatch_blocks(self):
        normalized = load_and_validate(FIXTURE_PATH)
        plan = build_plan(
            normalized,
            FIXTURE_PATH,
            FIXTURE_DIR,
            verify_source_hashes=True,
            require_verified_sources=True,
            relink_map_path=Path("relink-map.json"),
        )
        self.assertEqual(plan["resolve"]["relinkVerification"]["status"], "verified")
        self.assertEqual(
            plan["resolve"]["relinkVerification"]["projectId"],
            "resolve-bridge-fixture",
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            timeline_path = copy_fixture_project(root)
            (root / "media" / "camera-a.fixture").write_text(
                "changed", encoding="utf-8"
            )
            normalized_copy = load_and_validate(timeline_path)
            with self.assertRaises(TimelineValidationError) as context:
                build_plan(
                    normalized_copy,
                    timeline_path,
                    root,
                    verify_source_hashes=True,
                    require_verified_sources=True,
                    relink_map_path=Path("relink-map.json"),
                )
        self.assertIn("SHA-256 mismatch", str(context.exception))

    def test_strict_relink_contract_fields_are_required(self):
        cases = (
            ("schemaVersion", 2, "schemaVersion must equal integer 1"),
            ("projectId", "different-project", "projectId must match timeline projectId"),
            ("status", "awaiting-ingest", "status must equal 'ready'"),
            ("pathPolicy", "platform-native", "pathPolicy must equal"),
            ("missingMedia", ["raw/video/missing.mov"], "missingMedia must be empty"),
        )
        for field, value, expected_error in cases:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                timeline_path = copy_fixture_project(root)
                relink = load_relink_fixture_dict()
                relink[field] = value
                (root / "relink-map.json").write_text(
                    json.dumps(relink), encoding="utf-8"
                )
                with self.assertRaises(TimelineValidationError) as context:
                    build_plan(
                        load_and_validate(timeline_path),
                        timeline_path,
                        root,
                        verify_source_hashes=True,
                        require_verified_sources=True,
                        relink_map_path=Path("relink-map.json"),
                    )
            self.assertIn(expected_error, str(context.exception))

    def test_relink_entry_and_cli_paths_reject_backslashes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            timeline_path = copy_fixture_project(root)
            relink = load_relink_fixture_dict()
            relink["sources"][0]["path"] = "media\\camera-a.fixture"
            (root / "relink-map.json").write_text(json.dumps(relink), encoding="utf-8")
            with self.assertRaises(TimelineValidationError) as entry_context:
                build_plan(
                    load_and_validate(timeline_path),
                    timeline_path,
                    root,
                    verify_source_hashes=True,
                    require_verified_sources=True,
                    relink_map_path=Path("relink-map.json"),
                )
            self.assertIn("backslashes are not allowed", str(entry_context.exception))

            with self.assertRaises(TimelineValidationError) as map_context:
                build_plan(
                    load_and_validate(timeline_path),
                    timeline_path,
                    root,
                    relink_map_path=Path("timeline\\relink-map.json"),
                )
            self.assertIn("backslashes are not allowed", str(map_context.exception))

        cli_result = run_cli("--timeline", "projects\\example\\timeline.json")
        self.assertEqual(cli_result.returncode, 2)
        self.assertIn("backslashes are not allowed", cli_result.stderr)

    def test_default_dry_run_does_not_require_ready_relink_map(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            timeline_path = copy_fixture_project(root)
            relink = load_relink_fixture_dict()
            relink["status"] = "awaiting-ingest"
            (root / "relink-map.json").write_text(json.dumps(relink), encoding="utf-8")
            plan = build_plan(
                load_and_validate(timeline_path),
                timeline_path,
                root,
                relink_map_path=Path("relink-map.json"),
            )
        verification = plan["resolve"]["relinkVerification"]
        self.assertEqual(verification["status"], "not-run")
        self.assertIn("default dry-run does not read", verification["note"])

    def test_hash_verified_portable_write_blocks_unresolved_missing_media(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            timeline_path = copy_fixture_project(root)
            relink = load_relink_fixture_dict()
            relink["missingMedia"] = ["raw/video/not-yet-found.mov"]
            (root / "relink-map.json").write_text(json.dumps(relink), encoding="utf-8")
            result = run_cli(
                "--timeline",
                str(timeline_path),
                "--project-root",
                str(root),
                "--relink-map",
                "relink-map.json",
                "--write-portable",
                "--verify-source-hashes",
            )
            self.assertFalse((root / "outputs").exists())
        self.assertEqual(result.returncode, 2)
        self.assertIn("missingMedia must be empty", result.stderr)

    def test_apply_checksum_failure_stops_before_resolve_import(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            timeline_path = copy_fixture_project(root)
            (root / "media" / "camera-a.fixture").write_text(
                "changed before apply", encoding="utf-8"
            )
            result = run_cli(
                "--timeline",
                str(timeline_path),
                "--project-root",
                str(root),
                "--relink-map",
                "relink-map.json",
                "--apply",
            )
        self.assertEqual(result.returncode, 2)
        self.assertIn("SHA-256 mismatch", result.stderr)
        self.assertNotIn("resolve-apply", result.stderr)


class DryRunPlanTests(unittest.TestCase):
    def test_plan_contains_exact_resolve_clip_math_and_primary_package(self):
        normalized = load_and_validate(FIXTURE_PATH)
        plan = build_plan(normalized, FIXTURE_PATH, FIXTURE_DIR)
        resolve = plan["resolve"]
        self.assertEqual(plan["editableHandoff"]["effectivePrimaryFormat"], "DRP_DRT")
        self.assertEqual(plan["editableHandoff"]["declaredPrimaryFormat"], "DRP_DRT")
        video = next(
            clip for clip in resolve["clips"] if clip["itemId"] == "camera-a-video"
        )
        graphic = next(
            clip
            for clip in resolve["clips"]
            if clip["itemId"] == "hyperframes-opening-title"
        )
        self.assertEqual(video["resolveEndFrameInclusive"], 249)
        self.assertEqual(video["recordFrame"], 86400)
        self.assertEqual(video["recordFrameFormula"], "Timeline.GetStartFrame()+0")
        self.assertEqual(graphic["trackType"], "video")
        self.assertEqual(graphic["trackIndex"], 2)
        self.assertEqual(graphic["mediaType"], 1)
        self.assertEqual(
            resolve["linkGroups"]["camera-a-sync"],
            ["camera-a-dialogue", "camera-a-video"],
        )
        self.assertEqual(resolve["relinkVerification"]["status"], "not-run")
        exports = {entry["format"]: entry for entry in resolve["exports"]}
        self.assertTrue(exports["DRP"]["required"])
        self.assertTrue(exports["DRT"]["required"])
        self.assertFalse(exports["OTIO"]["required"])
        self.assertFalse(exports["FCPXML"]["required"])
        self.assertTrue(
            exports["DRP"]["path"].endswith(
                "/outputs/interchange/resolve-package.drp"
            )
        )
        self.assertTrue(
            exports["DRT"]["path"].endswith(
                "/outputs/interchange/resolve-timeline.drt"
            )
        )
        self.assertTrue(
            exports["OTIO"]["path"].endswith(
                "/outputs/interchange/portable-edit.otio"
            )
        )

    def test_legacy_fcpxml_primary_declaration_remains_compatible(self):
        data = load_fixture_dict()
        data["interchange"]["primaryFormat"] = "FCPXML"
        plan = build_plan(validate_timeline(data), FIXTURE_PATH, FIXTURE_DIR)
        self.assertEqual(plan["editableHandoff"]["effectivePrimaryFormat"], "DRP_DRT")
        self.assertIn("legacy primaryFormat=FCPXML", plan["editableHandoff"]["compatibility"])

    def test_missing_media_is_a_preflight_error(self):
        data = load_fixture_dict()
        data["videoTracks"][0]["items"][0]["sourcePath"] = "media/missing.mov"
        data["audioTracks"][0]["items"][0]["sourcePath"] = "media/missing.mov"
        normalized = validate_timeline(data)
        with self.assertRaises(TimelineValidationError) as context:
            build_plan(normalized, FIXTURE_PATH, FIXTURE_DIR)
        self.assertIn("source media does not exist", str(context.exception))

    def test_allow_missing_media_is_plan_only(self):
        data = load_fixture_dict()
        data["graphicsItems"][0]["sourcePath"] = "media/missing.mov"
        normalized = validate_timeline(data)
        plan = build_plan(
            normalized,
            FIXTURE_PATH,
            FIXTURE_DIR,
            allow_missing_media=True,
        )
        missing = [entry for entry in plan["resolve"]["media"] if not entry["exists"]]
        self.assertEqual(len(missing), 1)

    def test_cli_default_is_deterministic_offline_dry_run(self):
        command = ("--timeline", str(FIXTURE_PATH))
        first = run_cli(*command)
        second = run_cli(*command)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(first.stdout, second.stdout)
        plan = json.loads(first.stdout)
        self.assertEqual(plan["mode"], "dry-run")
        self.assertEqual(plan["resolve"]["project"]["action"], "create-new")
        self.assertFalse((FIXTURE_DIR / "outputs").exists())

    def test_validate_only_does_not_require_media(self):
        data = load_fixture_dict()
        data["graphicsItems"][0]["sourcePath"] = "media/not-present.mov"
        with tempfile.TemporaryDirectory() as temporary:
            timeline_path = Path(temporary) / "timeline.json"
            timeline_path.write_text(json.dumps(data), encoding="utf-8")
            result = run_cli("--timeline", str(timeline_path), "--validate-only")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["valid"])


class PortableWriteTests(unittest.TestCase):
    def test_write_portable_creates_relinkable_tracks_markers_and_limited_edl(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            timeline_path = copy_fixture_project(root)
            output_dir = root / "outputs" / "interchange"
            output_dir.mkdir(parents=True)
            # Native-package collisions are outside the scoped portable write.
            (output_dir / "ceremony-highlight.drp").write_text("existing", encoding="utf-8")
            (output_dir / "ceremony-highlight.drt").write_text("existing", encoding="utf-8")
            result = run_cli(
                "--timeline",
                str(timeline_path),
                "--project-root",
                str(root),
                "--export-dir",
                "outputs/interchange",
                "--write-portable",
                "--verify-source-hashes",
                "--relink-map",
                "relink-map.json",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report["mode"], "portable-written")
            self.assertFalse(report["resolveConnected"])
            self.assertEqual(report["relinkVerification"]["status"], "verified")
            self.assertEqual(
                {entry["format"] for entry in report["outputs"]},
                {"OTIO", "FCPXML", "EDL"},
            )
            self.assertEqual(report["nativePackages"]["DRP"], "not attempted offline")

            otio = json.loads(
                (output_dir / "ceremony-highlight.otio").read_text(encoding="utf-8")
            )
            self.assertEqual(otio["OTIO_SCHEMA"], "Timeline.1")
            self.assertEqual(
                otio["metadata"]["codex"]["frameRateNumerator"], 24000
            )
            self.assertEqual(len(otio["tracks"]["children"]), 4)
            self.assertEqual(len(otio["tracks"]["markers"]), 2)
            graphics_track = next(
                track
                for track in otio["tracks"]["children"]
                if track["metadata"]["codex"]["trackId"] == "V2"
            )
            graphic_clip = next(
                child
                for child in graphics_track["children"]
                if child["OTIO_SCHEMA"] == "Clip.2"
            )
            self.assertEqual(
                graphic_clip["metadata"]["codex"]["role"], "graphics-with-alpha"
            )
            self.assertTrue(
                graphic_clip["media_references"]["DEFAULT_MEDIA"]["target_url"].startswith(
                    "file://"
                )
            )

            fcpxml_path = output_dir / "ceremony-highlight.fcpxml"
            fcpxml = ET.parse(fcpxml_path).getroot()
            self.assertEqual(fcpxml.attrib["version"], "1.10")
            self.assertEqual(
                fcpxml.find("./resources/format").attrib["frameDuration"],
                "1001/24000s",
            )
            clips = fcpxml.findall("./event/project/sequence/spine/gap/asset-clip")
            self.assertEqual({clip.attrib["lane"] for clip in clips}, {"1", "2", "-1", "-2"})
            self.assertEqual(
                len(fcpxml.findall("./event/project/sequence/spine/gap/marker")), 2
            )

            edl = (output_dir / "ceremony-highlight.edl").read_text(encoding="utf-8")
            self.assertIn("* CODEX EXACT RATE: 24000/1001", edl)
            self.assertIn("* SOURCE FILE: media/camera-a.fixture", edl)
            self.assertNotIn("hyperframes-alpha.fixture", edl)
            self.assertNotIn("licensed-music.fixture", edl)
            self.assertFalse(any(output_dir.glob(".*.codex-staging.*")))

    def test_portable_collisions_need_scoped_overwrite_and_no_edl_is_honored(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            timeline_path = copy_fixture_project(root)
            base_arguments = (
                "--timeline",
                str(timeline_path),
                "--project-root",
                str(root),
                "--export-dir",
                "outputs/interchange",
                "--write-portable",
                "--no-edl",
                "--verify-source-hashes",
                "--relink-map",
                "relink-map.json",
            )
            first = run_cli(*base_arguments)
            self.assertEqual(first.returncode, 0, first.stderr)
            output_dir = root / "outputs" / "interchange"
            self.assertFalse((output_dir / "ceremony-highlight.edl").exists())
            collision = run_cli(*base_arguments)
            self.assertEqual(collision.returncode, 2)
            self.assertIn("--overwrite-portable", collision.stderr)
            replaced = run_cli(*base_arguments, "--overwrite-portable")
            self.assertEqual(replaced.returncode, 0, replaced.stderr)
            self.assertFalse(any(output_dir.glob(".*.codex-staging.*")))


if __name__ == "__main__":
    unittest.main()
