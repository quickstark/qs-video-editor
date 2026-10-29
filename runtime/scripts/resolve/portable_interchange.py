#!/usr/bin/env python3
"""Write portable edit interchange without importing or contacting Resolve.

The writers intentionally use only the Python standard library.  OTIO carries
the exact integer frame values plus a rational-rate metadata record, FCPXML
uses rational seconds, and CMX3600 is a deliberately limited V1 picture list.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from xml.etree import ElementTree as ET

from timeline_contract import FrameRate, TimelineValidationError, resolve_contained_project_path


PORTABLE_FORMATS = ("OTIO", "FCPXML", "EDL")
OTIO_COLOR_MAP = {
    "Blue": "BLUE",
    "Cyan": "CYAN",
    "Green": "GREEN",
    "Yellow": "YELLOW",
    "Red": "RED",
    "Pink": "PINK",
    "Purple": "PURPLE",
    "Fuchsia": "MAGENTA",
    "Rose": "PINK",
    "Lavender": "PURPLE",
    "Sky": "CYAN",
    "Mint": "GREEN",
    "Lemon": "YELLOW",
    "Sand": "ORANGE",
    "Cocoa": "ORANGE",
    "Cream": "WHITE",
}
XML_ID_RE = re.compile(r"[^A-Za-z0-9_.-]+")


class PortableWriteError(RuntimeError):
    """Raised when an explicitly requested portable write cannot finish."""


def _rate_number(rate: FrameRate) -> float:
    # OTIO's JSON schema stores RationalTime.rate as a JSON number rather than
    # a numerator/denominator pair.  Exact values remain in Codex metadata.
    return rate.numerator / rate.denominator


def _rational_time(frames: int, rate: FrameRate) -> Dict[str, Any]:
    return {
        "OTIO_SCHEMA": "RationalTime.1",
        "value": int(frames),
        "rate": _rate_number(rate),
    }


def _time_range(start: int, duration: int, rate: FrameRate) -> Dict[str, Any]:
    return {
        "OTIO_SCHEMA": "TimeRange.1",
        "start_time": _rational_time(start, rate),
        "duration": _rational_time(duration, rate),
    }


def _otio_base(
    schema: str,
    name: str,
    metadata: Mapping[str, Any],
    enabled: bool = True,
) -> Dict[str, Any]:
    return {
        "OTIO_SCHEMA": schema,
        "metadata": dict(metadata),
        "name": name,
        "source_range": None,
        "effects": [],
        "markers": [],
        "enabled": bool(enabled),
    }


def _timeline_duration(normalized: Mapping[str, Any]) -> int:
    endpoints = [1]
    endpoints.extend(int(item["timelineEndFrame"]) for item in normalized["clips"])
    endpoints.extend(
        int(marker["frame"]) + int(marker["durationFrames"])
        for marker in normalized["markers"]
    )
    return max(endpoints)


def _exact_metadata(rate: FrameRate) -> Dict[str, Any]:
    return {
        "frameRateNumerator": rate.numerator,
        "frameRateDenominator": rate.denominator,
        "dropFrame": rate.drop_frame,
        "frameIntervals": "half-open",
    }


def build_otio(
    normalized: Mapping[str, Any],
    project_root: Path,
) -> Tuple[str, List[str]]:
    """Return an OTIO JSON document and explicit representation notes."""

    rate: FrameRate = normalized["frameRate"]
    total_duration = _timeline_duration(normalized)
    items_by_track: Dict[str, List[Mapping[str, Any]]] = {}
    maximum_source_out: Dict[str, int] = {}
    resolved_sources: Dict[str, Path] = {}
    for item in normalized["clips"]:
        items_by_track.setdefault(str(item["trackId"]), []).append(item)
        resolved = resolve_contained_project_path(
            str(item["sourcePath"]), project_root, f"{item['_location']}.sourcePath"
        )
        resolved_sources[str(item["id"])] = resolved
        source_key = str(resolved)
        maximum_source_out[source_key] = max(
            maximum_source_out.get(source_key, 0), int(item["sourceOutFrame"])
        )

    stack_markers: List[Dict[str, Any]] = []
    for marker in normalized["markers"]:
        stack_markers.append(
            {
                "OTIO_SCHEMA": "Marker.2",
                "metadata": {
                    "codex": {
                        "id": marker["id"],
                        "kind": marker["kind"],
                        "status": marker["status"],
                        "note": marker["note"],
                        "exactFrame": marker["frame"],
                        "durationFrames": marker["durationFrames"],
                    }
                },
                "name": marker["label"],
                "color": OTIO_COLOR_MAP.get(str(marker["color"]), "BLUE"),
                "comment": marker["note"],
                "marked_range": _time_range(
                    int(marker["frame"]), int(marker["durationFrames"]), rate
                ),
            }
        )

    tracks: List[Dict[str, Any]] = []
    ordered_tracks: List[Mapping[str, Any]] = []
    for track_type in ("video", "audio", "subtitle"):
        ordered_tracks.extend(normalized["tracks"][track_type])
    for track in ordered_tracks:
        track_type = str(track["type"])
        track_payload = _otio_base(
            "Track.1",
            str(track["name"]),
            {
                "codex": {
                    "trackId": track["id"],
                    "trackType": track_type,
                    "trackIndex": track["index"],
                    "role": track["role"],
                    "audioType": track.get("audioType"),
                    "locked": track["locked"],
                    **_exact_metadata(rate),
                }
            },
            bool(track["enabled"]),
        )
        # OTIO's core Track kind has only Video/Audio. Caption identity is
        # retained in metadata until an adapter supports a caption track kind.
        track_payload["kind"] = "Audio" if track_type == "audio" else "Video"
        children: List[Dict[str, Any]] = []
        cursor = 0
        ordered_items = sorted(
            items_by_track.get(str(track["id"]), []),
            key=lambda item: (int(item["timelineStartFrame"]), str(item["id"])),
        )
        for item in ordered_items:
            item_start = int(item["timelineStartFrame"])
            if item_start > cursor:
                gap = _otio_base("Gap.1", "", {}, True)
                gap["source_range"] = _time_range(0, item_start - cursor, rate)
                children.append(gap)

            duration = int(item["sourceOutFrame"]) - int(item["sourceInFrame"])
            source_path = resolved_sources[str(item["id"])]
            reference = {
                "OTIO_SCHEMA": "ExternalReference.1",
                "metadata": {
                    "codex": {
                        "sourceId": item.get("sourceId"),
                        "sourcePath": item["sourcePath"],
                        "referenceOnly": True,
                    }
                },
                "name": source_path.name,
                "available_range": _time_range(
                    0, maximum_source_out[str(source_path)], rate
                ),
                "available_image_bounds": None,
                "target_url": source_path.as_uri(),
            }
            clip = _otio_base(
                "Clip.2",
                str(item["id"]),
                {
                    "codex": {
                        "itemId": item["id"],
                        "trackId": item["trackId"],
                        "role": track["role"],
                        "kind": item["kind"],
                        "sourceId": item.get("sourceId"),
                        "sourcePath": item["sourcePath"],
                        "sourceInFrame": item["sourceInFrame"],
                        "sourceOutFrameExclusive": item["sourceOutFrame"],
                        "timelineStartFrame": item["timelineStartFrame"],
                        "timelineEndFrameExclusive": item["timelineEndFrame"],
                        "syncGroupId": item.get("syncGroupId"),
                        "notes": item.get("notes", []),
                        **_exact_metadata(rate),
                    }
                },
                bool(item["enabled"]),
            )
            clip["source_range"] = _time_range(
                int(item["sourceInFrame"]), duration, rate
            )
            clip["media_references"] = {"DEFAULT_MEDIA": reference}
            clip["active_media_reference_key"] = "DEFAULT_MEDIA"
            children.append(clip)
            cursor = int(item["timelineEndFrame"])
        if cursor < total_duration:
            tail = _otio_base("Gap.1", "", {}, True)
            tail["source_range"] = _time_range(0, total_duration - cursor, rate)
            children.append(tail)
        track_payload["children"] = children
        tracks.append(track_payload)

    stack = _otio_base(
        "Stack.1",
        "tracks",
        {
            "codex": {
                "timelineId": normalized["timelineId"],
                "durationFrames": total_duration,
                **_exact_metadata(rate),
            }
        },
    )
    stack["markers"] = stack_markers
    stack["children"] = tracks
    timeline = {
        "OTIO_SCHEMA": "Timeline.1",
        "metadata": {
            "codex": {
                "schemaVersion": normalized["schemaVersion"],
                "projectId": normalized["projectId"],
                "timelineId": normalized["timelineId"],
                "startTimecode": normalized["startTimecode"],
                "timelineStartFrame": normalized["timelineStartFrame"],
                "width": normalized["format"]["width"],
                "height": normalized["format"]["height"],
                "pixelAspectRatio": normalized["format"].get("pixelAspectRatio"),
                **_exact_metadata(rate),
            }
        },
        "name": normalized["timelineId"],
        "global_start_time": _rational_time(normalized["timelineStartFrame"], rate),
        "tracks": stack,
    }
    limitations = [
        (
            "OTIO RationalTime.rate is a JSON number; exact numerator/denominator and all "
            "integer frame boundaries are duplicated in codex metadata."
        ),
        (
            "Schema v1 has no probed full source duration/timecode origin; ExternalReference "
            "available_range is the conservative minimum ending at the greatest referenced "
            "sourceOutFrame. Refresh probe metadata before extending trim handles."
        ),
    ]
    if normalized["tracks"]["subtitle"]:
        limitations.append(
            "OTIO core has no caption Track kind; caption tracks use Video kind with their "
            "caption role and source reference preserved in codex metadata."
        )
    return json.dumps(timeline, indent=2, sort_keys=True) + "\n", limitations


def _fcpx_time(frames: int, rate: FrameRate) -> str:
    numerator = int(frames) * rate.denominator
    denominator = rate.numerator
    common = _gcd(abs(numerator), denominator)
    numerator //= common
    denominator //= common
    if denominator == 1:
        return f"{numerator}s"
    return f"{numerator}/{denominator}s"


def _gcd(left: int, right: int) -> int:
    while right:
        left, right = right, left % right
    return left or 1


def _xml_id(value: str, prefix: str) -> str:
    cleaned = XML_ID_RE.sub("-", value).strip(".-")
    if not cleaned or not (cleaned[0].isalpha() or cleaned[0] == "_"):
        cleaned = f"{prefix}-{cleaned}"
    return cleaned


def _fcpx_role(track: Mapping[str, Any]) -> str:
    role = str(track["role"]).strip().lower()
    subrole = re.sub(r"[^a-z0-9_-]+", "-", role).strip("-") or str(track["id"]).lower()
    if track["type"] == "video":
        main_role = "video"
    elif "music" in role:
        main_role = "music"
    elif "sfx" in role or "effect" in role:
        main_role = "effects"
    else:
        main_role = "dialogue"
    return f"{main_role}.{subrole}"


def _add_metadata(parent: ET.Element, values: Mapping[str, Any]) -> None:
    metadata = ET.SubElement(parent, "metadata")
    for key, value in values.items():
        ET.SubElement(
            metadata,
            "md",
            {
                "key": f"com.openai.codex.{key}",
                "value": (
                    value
                    if isinstance(value, str)
                    else json.dumps(value, separators=(",", ":"), sort_keys=True)
                ),
            },
        )


def _indent_xml(element: ET.Element, level: int = 0) -> None:
    indent = "\n" + "  " * level
    child_indent = "\n" + "  " * (level + 1)
    if len(element):
        if not element.text or not element.text.strip():
            element.text = child_indent
        for child in element:
            _indent_xml(child, level + 1)
            if not child.tail or not child.tail.strip():
                child.tail = child_indent
        element[-1].tail = indent


def build_fcpxml(
    normalized: Mapping[str, Any],
    project_root: Path,
) -> Tuple[str, List[str]]:
    """Return an Apple FCPXML 1.10 document with referenced source assets."""

    rate: FrameRate = normalized["frameRate"]
    total_duration = _timeline_duration(normalized)
    root = ET.Element("fcpxml", {"version": "1.10"})
    resources = ET.SubElement(root, "resources")
    ET.SubElement(
        resources,
        "format",
        {
            "id": "r1",
            "name": f"Codex {normalized['format']['width']}x{normalized['format']['height']}",
            "frameDuration": _fcpx_time(1, rate),
            "width": str(normalized["format"]["width"]),
            "height": str(normalized["format"]["height"]),
            "paspH": "1",
            "paspV": "1",
        },
    )

    noncaption_items = [item for item in normalized["clips"] if item["kind"] != "captions"]
    source_info: Dict[str, Dict[str, Any]] = {}
    for item in noncaption_items:
        resolved = resolve_contained_project_path(
            str(item["sourcePath"]), project_root, f"{item['_location']}.sourcePath"
        )
        key = str(resolved)
        info = source_info.setdefault(
            key,
            {
                "path": resolved,
                "relativePath": item["sourcePath"],
                "sourceIds": set(),
                "hasVideo": False,
                "hasAudio": False,
                "maxSourceOut": 0,
            },
        )
        if item.get("sourceId"):
            info["sourceIds"].add(str(item["sourceId"]))
        track = normalized["trackLookup"][item["trackId"]]
        info["hasVideo"] = info["hasVideo"] or track["type"] == "video"
        info["hasAudio"] = info["hasAudio"] or track["type"] == "audio"
        info["maxSourceOut"] = max(info["maxSourceOut"], int(item["sourceOutFrame"]))

    asset_ids: Dict[str, str] = {}
    for index, (key, info) in enumerate(sorted(source_info.items()), start=2):
        asset_id = f"r{index}"
        asset_ids[key] = asset_id
        attributes = {
            "id": asset_id,
            "name": info["path"].name,
            "start": "0s",
            "duration": _fcpx_time(info["maxSourceOut"], rate),
            "hasVideo": "1" if info["hasVideo"] else "0",
            "hasAudio": "1" if info["hasAudio"] else "0",
        }
        if info["hasVideo"]:
            attributes["format"] = "r1"
        asset = ET.SubElement(resources, "asset", attributes)
        ET.SubElement(
            asset,
            "media-rep",
            {
                "kind": "original-media",
                "src": info["path"].as_uri(),
                "suggestedFilename": info["path"].name,
            },
        )
        _add_metadata(
            asset,
            {
                "sourcePath": info["relativePath"],
                "sourceIds": sorted(info["sourceIds"]),
                "referenceOnly": True,
            },
        )

    event = ET.SubElement(root, "event", {"name": normalized["projectId"]})
    project = ET.SubElement(
        event,
        "project",
        {"name": normalized["timelineId"], "id": _xml_id(normalized["timelineId"], "p")},
    )
    sequence = ET.SubElement(
        project,
        "sequence",
        {
            "format": "r1",
            "duration": _fcpx_time(total_duration, rate),
            "tcStart": _fcpx_time(normalized["timelineStartFrame"], rate),
            "tcFormat": "DF" if rate.drop_frame else "NDF",
        },
    )
    spine = ET.SubElement(sequence, "spine")
    carrier = ET.SubElement(
        spine,
        "gap",
        {"name": "Codex track carrier", "duration": _fcpx_time(total_duration, rate)},
    )

    sorted_items = sorted(
        noncaption_items,
        key=lambda item: (
            int(item["timelineStartFrame"]),
            normalized["trackLookup"][item["trackId"]]["type"],
            int(normalized["trackLookup"][item["trackId"]]["index"]),
            str(item["id"]),
        ),
    )
    for item in sorted_items:
        track = normalized["trackLookup"][item["trackId"]]
        resolved = resolve_contained_project_path(
            str(item["sourcePath"]), project_root, f"{item['_location']}.sourcePath"
        )
        lane = int(track["index"]) if track["type"] == "video" else -int(track["index"])
        attributes = {
            "ref": asset_ids[str(resolved)],
            "name": str(item["id"]),
            "lane": str(lane),
            "offset": _fcpx_time(int(item["timelineStartFrame"]), rate),
            "start": _fcpx_time(int(item["sourceInFrame"]), rate),
            "duration": _fcpx_time(
                int(item["sourceOutFrame"]) - int(item["sourceInFrame"]), rate
            ),
            "enabled": "1" if item["enabled"] else "0",
            "srcEnable": "video" if track["type"] == "video" else "audio",
        }
        if track["type"] == "video":
            attributes["videoRole"] = _fcpx_role(track)
            attributes["format"] = "r1"
        else:
            attributes["audioRole"] = _fcpx_role(track)
        clip = ET.SubElement(carrier, "asset-clip", attributes)
        notes = item.get("notes", [])
        if notes:
            ET.SubElement(clip, "note").text = "\n".join(str(note) for note in notes)
        _add_metadata(
            clip,
            {
                "item": {
                    "itemId": item["id"],
                    "trackId": item["trackId"],
                    "trackName": track["name"],
                    "trackIndex": track["index"],
                    "trackType": track["type"],
                    "role": track["role"],
                    "fcpxRole": _fcpx_role(track),
                    "kind": item["kind"],
                    "sourceId": item.get("sourceId"),
                    "sourcePath": item["sourcePath"],
                    "sourceInFrame": item["sourceInFrame"],
                    "sourceOutFrameExclusive": item["sourceOutFrame"],
                    "timelineStartFrame": item["timelineStartFrame"],
                    "timelineEndFrameExclusive": item["timelineEndFrame"],
                    "syncGroupId": item.get("syncGroupId"),
                    **_exact_metadata(rate),
                }
            },
        )

    for marker in normalized["markers"]:
        ET.SubElement(
            carrier,
            "marker",
            {
                "start": _fcpx_time(int(marker["frame"]), rate),
                "duration": _fcpx_time(int(marker["durationFrames"]), rate),
                "value": str(marker["label"]),
                "completed": "1" if marker["status"] in {"approved", "resolved", "complete"} else "0",
                "note": json.dumps(
                    {
                        "id": marker["id"],
                        "kind": marker["kind"],
                        "status": marker["status"],
                        "note": marker["note"],
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            },
        )
    _add_metadata(
        carrier,
        {
            "declaredTracks": [
                {
                    "id": track["id"],
                    "name": track["name"],
                    "type": track["type"],
                    "index": track["index"],
                    "role": track["role"],
                    "audioType": track.get("audioType"),
                    "enabled": track["enabled"],
                    "locked": track["locked"],
                }
                for track_type in ("video", "audio", "subtitle")
                for track in normalized["tracks"][track_type]
            ],
            "captionItemsDeferred": [
                {
                    "itemId": item["id"],
                    "trackId": item["trackId"],
                    "sourcePath": item["sourcePath"],
                    "timelineStartFrame": item["timelineStartFrame"],
                    "timelineEndFrameExclusive": item["timelineEndFrame"],
                }
                for item in normalized["clips"]
                if item["kind"] == "captions"
            ],
        },
    )
    _add_metadata(
        sequence,
        {
            "timeline": {
                "projectId": normalized["projectId"],
                "timelineId": normalized["timelineId"],
                "startTimecode": normalized["startTimecode"],
                "timelineStartFrame": normalized["timelineStartFrame"],
                "durationFrames": total_duration,
                **_exact_metadata(rate),
            }
        },
    )

    _indent_xml(root)
    xml_body = ET.tostring(root, encoding="unicode", short_empty_elements=True)
    document = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n' + xml_body + "\n"
    limitations: List[str] = []
    limitations.append(
        "Schema v1 has no probed full source duration/timecode origin; each FCPXML asset "
        "duration is the conservative minimum ending at the greatest referenced sourceOutFrame."
    )
    if normalized["tracks"]["subtitle"]:
        limitations.append(
            "FCPXML records caption tracks/items as Codex metadata but does not synthesize "
            "caption text from external SRT; import the sidecar captions separately."
        )
    return document, limitations


def frames_to_timecode(frames: int, rate: FrameRate) -> str:
    """Convert a non-negative frame count to nominal CMX/SMPTE timecode."""

    if frames < 0:
        raise PortableWriteError("EDL timecode frame count cannot be negative")
    nominal = rate.nominal
    delimiter = ";" if rate.drop_frame else ":"
    frame_number = int(frames)
    if rate.drop_frame:
        drop_count = 2 if nominal == 30 else 4
        frames_per_ten_minutes = nominal * 60 * 10 - drop_count * 9
        frames_per_minute = nominal * 60 - drop_count
        ten_minute_blocks, remainder = divmod(frame_number, frames_per_ten_minutes)
        frame_number += drop_count * 9 * ten_minute_blocks
        if remainder >= drop_count:
            frame_number += drop_count * ((remainder - drop_count) // frames_per_minute)
    ff = frame_number % nominal
    total_seconds = frame_number // nominal
    ss = total_seconds % 60
    total_minutes = total_seconds // 60
    mm = total_minutes % 60
    hh = (total_minutes // 60) % 24
    return f"{hh:02d}:{mm:02d}:{ss:02d}{delimiter}{ff:02d}"


def _reel_name(source_path: str) -> str:
    digest = hashlib.sha1(source_path.encode("utf-8")).hexdigest().upper()[:6]
    return f"CX{digest}"


def build_edl(normalized: Mapping[str, Any]) -> Tuple[str, List[str]]:
    """Return a conservative CMX3600 V1 picture list and loss report."""

    rate: FrameRate = normalized["frameRate"]
    primary_track = normalized["tracks"]["video"][0]
    items = [
        item
        for item in normalized["clips"]
        if item["trackId"] == primary_track["id"] and item["enabled"]
    ]
    items.sort(key=lambda item: (int(item["timelineStartFrame"]), str(item["id"])))
    lines = [
        f"TITLE: {normalized['timelineId']}",
        "FCM: DROP FRAME" if rate.drop_frame else "FCM: NON-DROP FRAME",
        f"* CODEX EXACT RATE: {rate.numerator}/{rate.denominator}",
        "* CODEX FRAME INTERVALS: HALF-OPEN [IN, OUT)",
        "* CODEX RECORD START: " + normalized["startTimecode"],
        "",
    ]
    for event_number, item in enumerate(items, start=1):
        record_in = normalized["timelineStartFrame"] + int(item["timelineStartFrame"])
        record_out = normalized["timelineStartFrame"] + int(item["timelineEndFrame"])
        lines.append(
            f"{event_number:03d}  {_reel_name(str(item['sourcePath'])):<8} V     C        "
            f"{frames_to_timecode(int(item['sourceInFrame']), rate)} "
            f"{frames_to_timecode(int(item['sourceOutFrame']), rate)} "
            f"{frames_to_timecode(record_in, rate)} "
            f"{frames_to_timecode(record_out, rate)}"
        )
        lines.append(f"* FROM CLIP NAME: {item['id']}")
        lines.append(f"* SOURCE FILE: {item['sourcePath']}")
        lines.append(
            f"* CODEX TRACK: {primary_track['id']} ROLE: {primary_track['role']}"
        )
        if item.get("sourceId"):
            lines.append(f"* CODEX SOURCE ID: {item['sourceId']}")
        lines.append("")

    omitted_tracks = (
        len(normalized["tracks"]["video"]) - 1
        + len(normalized["tracks"]["audio"])
        + len(normalized["tracks"]["subtitle"])
    )
    omitted_items = len(normalized["clips"]) - len(items)
    limitations = [
        (
            "CMX3600 contains only enabled clips from the first picture track "
            f"({primary_track['id']}); {omitted_tracks} other declared tracks and "
            f"{omitted_items} non-V1/disabled items are not representable in this fallback."
        ),
        (
            "CMX3600 does not preserve layered graphics, audio roles/layouts, sync groups, "
            "markers, captions, effects, or exact rational rate fields; exact rate and source "
            "paths are retained in comments."
        ),
        "Source timecode is represented as frame offsets from 00:00:00:00 because schema v1 has no source timecode origin.",
    ]
    return "\n".join(lines).rstrip() + "\n", limitations


def render_portable_documents(
    normalized: Mapping[str, Any],
    project_root: Path,
    include_edl: bool,
) -> Tuple[Dict[str, str], List[str]]:
    documents: Dict[str, str] = {}
    limitations: List[str] = [
        "DRP and DRT are Resolve-native packages and are never fabricated offline; use --apply with a running Resolve.",
        "Schema v1 is hard cuts only; transitions, retimes, effects, grades, automation, multicam containers, and Fusion graphs remain deferred.",
    ]
    documents["OTIO"], notes = build_otio(normalized, project_root)
    limitations.extend(notes)
    documents["FCPXML"], notes = build_fcpxml(normalized, project_root)
    limitations.extend(notes)
    if include_edl:
        documents["EDL"], notes = build_edl(normalized)
        limitations.extend(notes)
    return documents, limitations


def _ensure_contained_destination(path: Path, project_root: Path) -> None:
    resolved = path.resolve()
    root = project_root.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise PortableWriteError(f"portable destination escaped projectRoot: {resolved}") from exc


def _fsync_directory(directory: Path) -> None:
    descriptor: Optional[int] = None
    try:
        descriptor = os.open(str(directory), os.O_RDONLY)
        os.fsync(descriptor)
    except OSError:
        # The artifact file itself was fsynced; not every platform/filesystem
        # accepts fsync on a directory descriptor.
        pass
    finally:
        if descriptor is not None:
            os.close(descriptor)


def write_portable_documents(
    normalized: Mapping[str, Any],
    plan: Mapping[str, Any],
    overwrite: bool,
    include_edl: bool,
) -> Dict[str, Any]:
    """Atomically promote portable documents to the validated plan targets."""

    project_root = Path(str(plan["projectRoot"])).resolve()
    documents, limitations = render_portable_documents(
        normalized, project_root, include_edl=include_edl
    )
    exports = {
        str(entry["format"]): entry
        for entry in plan["resolve"]["exports"]
        if entry["format"] in documents
    }
    missing_targets = sorted(set(documents) - set(exports))
    if missing_targets:
        raise PortableWriteError(
            "plan is missing portable targets: " + ", ".join(missing_targets)
        )

    targets: List[Tuple[str, Path, Path, bytes]] = []
    errors: List[str] = []
    for format_name in PORTABLE_FORMATS:
        if format_name not in documents:
            continue
        export = exports[format_name]
        target = Path(str(export["path"]))
        staging = Path(str(export["stagingPath"]))
        _ensure_contained_destination(target, project_root)
        _ensure_contained_destination(staging, project_root)
        if target.parent != staging.parent:
            errors.append(f"{format_name} staging path is not in the destination directory")
        if target.exists() and not overwrite:
            errors.append(
                f"{format_name} export already exists (pass --overwrite-portable to replace it): {target}"
            )
        if staging.exists():
            errors.append(f"staging export already exists; inspect/remove it before retrying: {staging}")
        targets.append((format_name, target, staging, documents[format_name].encode("utf-8")))
    if errors:
        raise PortableWriteError("Portable preflight failed:\n- " + "\n- ".join(errors))

    staged: List[Path] = []
    results: List[Dict[str, Any]] = []
    try:
        for _, target, staging, payload in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            _ensure_contained_destination(target, project_root)
            with staging.open("xb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            staged.append(staging)

        for format_name, target, staging, payload in targets:
            if overwrite:
                os.replace(str(staging), str(target))
            else:
                try:
                    os.link(str(staging), str(target))
                except FileExistsError as exc:
                    raise PortableWriteError(
                        f"{format_name} destination appeared during promotion: {target}"
                    ) from exc
                staging.unlink()
            if staging in staged:
                staged.remove(staging)
            _fsync_directory(target.parent)
            results.append(
                {
                    "format": format_name,
                    "path": str(target),
                    "bytes": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                    "status": "written",
                    "sourceMedia": "referenced-by-file-uri; not copied",
                }
            )
    except PortableWriteError:
        raise
    except OSError as exc:
        raise PortableWriteError(f"portable atomic write failed: {exc}") from exc
    finally:
        for staging in staged:
            try:
                staging.unlink()
            except FileNotFoundError:
                pass

    return {
        "ok": True,
        "mode": "portable-written",
        "resolveConnected": False,
        "timelineManifest": plan["timelineManifest"],
        "projectRoot": str(project_root),
        "outputs": results,
        "nativePackages": {
            "DRP": "not attempted offline",
            "DRT": "not attempted offline",
        },
        "privacyWarning": (
            "OTIO and FCPXML contain absolute local file:// media references; "
            "keep these machine-local packages private and regenerate or relink them before sharing"
        ),
        "relinkVerification": plan["resolve"].get("relinkVerification"),
        "unsupportedOrDeferred": limitations,
        "collisionPolicy": (
            "explicit --overwrite-portable; each file replaced atomically from same-directory staging"
            if overwrite
            else "no overwrite; each file promoted without replacement from same-directory staging"
        ),
    }
