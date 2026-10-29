#!/usr/bin/env python3
"""Validate the neutral edit manifest and build a deterministic Resolve plan.

This module intentionally uses only the Python standard library.  Neutral
timeline intervals are half-open: ``sourceOutFrame`` and ``timelineEndFrame``
are excluded.  Resolve's AppendToTimeline ``endFrame`` is inclusive, so the
plan performs that conversion in one visible place.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import re
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple


TIMECODE_RE = re.compile(r"^(\d{2}):(\d{2}):(\d{2})([:;])(\d{2})$")
SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
SHA256_RE = re.compile(r"^[0-9A-Fa-f]{64}$")
PROJECT_PATH_POLICY = "project-relative-forward-slashes"
KNOWN_RESOLVE_RATES = {
    Fraction(24000, 1001): "23.976",
    Fraction(30000, 1001): "29.97",
    Fraction(48000, 1001): "47.952",
    Fraction(60000, 1001): "59.94",
    Fraction(120000, 1001): "119.88",
}
DROP_FRAME_RATES = {Fraction(30000, 1001), Fraction(60000, 1001)}
MARKER_COLORS = {
    "chapter": "Blue",
    "editorial-note": "Yellow",
    "qa": "Red",
    "approval": "Green",
    "music-cue": "Purple",
    "sync-warning": "Red",
}
ALLOWED_MARKER_COLORS = {
    "Blue",
    "Cyan",
    "Green",
    "Yellow",
    "Red",
    "Pink",
    "Purple",
    "Fuchsia",
    "Rose",
    "Lavender",
    "Sky",
    "Mint",
    "Lemon",
    "Sand",
    "Cocoa",
    "Cream",
}
FIXED_AUDIO_TYPES = {
    "mono",
    "stereo",
    "lrc",
    "lcr",
    "lrcs",
    "lcrs",
    "quad",
    "5.0",
    "5.0film",
    "5.1",
    "5.1film",
    "7.0",
    "7.0film",
    "7.1",
    "7.1film",
}


class TimelineValidationError(ValueError):
    """Raised when a timeline cannot be translated without guessing."""

    def __init__(self, errors: Sequence[str]):
        self.errors = list(errors)
        super().__init__("Timeline validation failed:\n- " + "\n- ".join(self.errors))


@dataclass(frozen=True)
class FrameRate:
    numerator: int
    denominator: int
    drop_frame: bool

    @property
    def fraction(self) -> Fraction:
        return Fraction(self.numerator, self.denominator)

    @property
    def nominal(self) -> int:
        value = self.fraction
        return (value.numerator + value.denominator // 2) // value.denominator

    @property
    def resolve_setting(self) -> str:
        value = self.fraction
        if value in KNOWN_RESOLVE_RATES:
            result = KNOWN_RESOLVE_RATES[value]
        elif value.denominator == 1:
            result = str(value.numerator)
        elif _has_terminating_decimal(value.denominator):
            result = _terminating_decimal(value)
        else:
            raise TimelineValidationError(
                [
                    "format frame rate %s/%s has no safe Resolve setting token; "
                    "use a probed canonical rational rate"
                    % (self.numerator, self.denominator)
                ]
            )
        if self.drop_frame:
            result += " DF"
        return result

    @property
    def rational_label(self) -> str:
        return f"{self.numerator}/{self.denominator}"


def _has_terminating_decimal(denominator: int) -> bool:
    for factor in (2, 5):
        while denominator % factor == 0:
            denominator //= factor
    return denominator == 1


def _terminating_decimal(value: Fraction) -> str:
    denominator = value.denominator
    places = 0
    while denominator != 1:
        if denominator % 10 == 0:
            denominator //= 10
            places += 1
        elif denominator % 5 == 0:
            denominator //= 5
            places += 1
        elif denominator % 2 == 0:
            denominator //= 2
            places += 1
        else:  # pragma: no cover - guarded by _has_terminating_decimal
            raise ValueError("non-terminating decimal")
    scale = 10**places
    scaled = value * scale
    while scaled.denominator != 1:
        places += 1
        scale *= 10
        scaled = value * scale
    whole = scaled.numerator // scaled.denominator
    if places == 0:
        return str(whole)
    integer_part, fractional_part = divmod(whole, scale)
    fractional = str(fractional_part).zfill(places).rstrip("0")
    return f"{integer_part}.{fractional}" if fractional else str(integer_part)


def timecode_to_frames(timecode: str, rate: FrameRate) -> int:
    """Convert SMPTE timecode to Resolve's nominal absolute frame number."""

    match = TIMECODE_RE.match(timecode)
    if not match:
        raise TimelineValidationError(
            [f"startTimecode {timecode!r} must be HH:MM:SS:FF or HH:MM:SS;FF"]
        )
    hours, minutes, seconds, delimiter, frames = match.groups()
    hh, mm, ss, ff = map(int, (hours, minutes, seconds, frames))
    errors: List[str] = []
    if hh > 23:
        errors.append("startTimecode hours must be between 00 and 23")
    if mm > 59 or ss > 59:
        errors.append("startTimecode minutes and seconds must be between 00 and 59")
    if ff >= rate.nominal:
        errors.append(
            f"startTimecode frame field {ff:02d} exceeds nominal {rate.nominal} fps"
        )
    if rate.drop_frame and delimiter != ";":
        errors.append("drop-frame timelines must use ';' before the frame field")
    if not rate.drop_frame and delimiter != ":":
        errors.append("non-drop-frame timelines must use ':' before the frame field")
    if errors:
        raise TimelineValidationError(errors)

    total_minutes = hh * 60 + mm
    result = ((hh * 3600 + mm * 60 + ss) * rate.nominal) + ff
    if rate.drop_frame:
        drop_count = 2 if rate.fraction == Fraction(30000, 1001) else 4
        if mm % 10 != 0 and ss == 0 and ff < drop_count:
            raise TimelineValidationError(
                [
                    f"startTimecode {timecode!r} names a skipped drop-frame number "
                    f"(first valid frame is {drop_count:02d})"
                ]
            )
        result -= drop_count * (total_minutes - total_minutes // 10)
    return result


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _audio_type_valid(value: str) -> bool:
    if value in FIXED_AUDIO_TYPES:
        return True
    if value.startswith("adaptive"):
        suffix = value[len("adaptive") :]
        return suffix.isdigit() and 1 <= int(suffix) <= 36
    return False


def _add_error(errors: List[str], condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def _track_role_kind(track_type: str, role: str) -> str:
    normalized = role.lower()
    if track_type == "subtitle":
        return "captions"
    if track_type == "video" and "graphic" in normalized:
        return "graphics"
    if track_type == "audio" and "music" in normalized:
        return "music"
    return track_type


def _normalize_item(
    item: Any,
    location: str,
    expected_track_id: Optional[str],
    track_lookup: Mapping[str, Dict[str, Any]],
    errors: List[str],
) -> Optional[Dict[str, Any]]:
    if not isinstance(item, Mapping):
        errors.append(f"{location} must be an object")
        return None

    item_id = item.get("id")
    track_id = item.get("trackId")
    source_path = item.get("sourcePath")
    _add_error(errors, _is_nonempty_string(item_id), f"{location}.id must be a non-empty string")
    _add_error(errors, _is_nonempty_string(track_id), f"{location}.trackId must be a non-empty string")
    _add_error(errors, _is_nonempty_string(source_path), f"{location}.sourcePath must be a non-empty string")
    if expected_track_id is not None and track_id != expected_track_id:
        errors.append(
            f"{location}.trackId {track_id!r} must match containing track {expected_track_id!r}"
        )
    if _is_nonempty_string(track_id) and track_id not in track_lookup:
        errors.append(f"{location}.trackId {track_id!r} does not name a declared track")

    frame_fields = (
        "sourceInFrame",
        "sourceOutFrame",
        "timelineStartFrame",
        "timelineEndFrame",
    )
    for field in frame_fields:
        value = item.get(field)
        _add_error(errors, _is_int(value), f"{location}.{field} must be an integer")

    source_in = item.get("sourceInFrame")
    source_out = item.get("sourceOutFrame")
    timeline_start = item.get("timelineStartFrame")
    timeline_end = item.get("timelineEndFrame")
    if _is_int(source_in) and source_in < 0:
        errors.append(f"{location}.sourceInFrame must be >= 0")
    if _is_int(source_out) and _is_int(source_in) and source_out <= source_in:
        errors.append(f"{location}.sourceOutFrame must be greater than sourceInFrame")
    if _is_int(timeline_start) and timeline_start < 0:
        errors.append(f"{location}.timelineStartFrame must be >= 0")
    if _is_int(timeline_end) and _is_int(timeline_start) and timeline_end <= timeline_start:
        errors.append(f"{location}.timelineEndFrame must be greater than timelineStartFrame")
    if all(_is_int(item.get(field)) for field in frame_fields):
        source_duration = source_out - source_in
        timeline_duration = timeline_end - timeline_start
        if source_duration != timeline_duration:
            errors.append(
                f"{location} duration mismatch: source is {source_duration} frames but "
                f"timeline is {timeline_duration} frames; retimes require an explicit derivative"
            )

    enabled = item.get("enabled")
    _add_error(errors, isinstance(enabled, bool), f"{location}.enabled must be boolean")
    notes = item.get("notes", [])
    if not isinstance(notes, list) or not all(isinstance(note, str) for note in notes):
        errors.append(f"{location}.notes must be an array of strings when present")
    source_id = item.get("sourceId")
    if source_id is not None and not _is_nonempty_string(source_id):
        errors.append(f"{location}.sourceId must be a non-empty string or null")
    sync_group_id = item.get("syncGroupId")
    if sync_group_id is not None and not _is_nonempty_string(sync_group_id):
        errors.append(f"{location}.syncGroupId must be a non-empty string or null")

    if errors and not (
        _is_nonempty_string(item_id)
        and _is_nonempty_string(track_id)
        and _is_nonempty_string(source_path)
        and all(_is_int(item.get(field)) for field in frame_fields)
        and isinstance(enabled, bool)
    ):
        return None

    track = track_lookup.get(str(track_id))
    return {
        "id": str(item_id),
        "trackId": str(track_id),
        "sourceId": item.get("sourceId"),
        "sourcePath": str(source_path),
        "sourceInFrame": int(source_in),
        "sourceOutFrame": int(source_out),
        "timelineStartFrame": int(timeline_start),
        "timelineEndFrame": int(timeline_end),
        "enabled": bool(enabled),
        "syncGroupId": item.get("syncGroupId"),
        "notes": list(notes) if isinstance(notes, list) else [],
        "kind": _track_role_kind(track["type"], track["role"]) if track else "unknown",
        "_location": location,
    }


def validate_timeline(data: Any) -> Dict[str, Any]:
    """Validate and normalize a version-1 neutral timeline dictionary."""

    if not isinstance(data, Mapping):
        raise TimelineValidationError(["timeline root must be a JSON object"])
    errors: List[str] = []

    _add_error(errors, data.get("schemaVersion") == 1, "schemaVersion must equal 1")
    for key in ("projectId", "timelineId"):
        _add_error(errors, _is_nonempty_string(data.get(key)), f"{key} must be a non-empty string")

    format_data = data.get("format")
    if not isinstance(format_data, Mapping):
        errors.append("format must be an object")
        format_data = {}
    width = format_data.get("width")
    height = format_data.get("height")
    numerator = format_data.get("frameRateNumerator")
    denominator = format_data.get("frameRateDenominator")
    drop_frame = format_data.get("dropFrame")
    _add_error(errors, _is_int(width) and width > 0, "format.width must be a positive integer")
    _add_error(errors, _is_int(height) and height > 0, "format.height must be a positive integer")
    _add_error(
        errors,
        _is_int(numerator) and numerator > 0,
        "format.frameRateNumerator must be a positive integer",
    )
    _add_error(
        errors,
        _is_int(denominator) and denominator > 0,
        "format.frameRateDenominator must be a positive integer",
    )
    _add_error(errors, isinstance(drop_frame, bool), "format.dropFrame must be boolean")

    rate: Optional[FrameRate] = None
    if (
        _is_int(numerator)
        and numerator > 0
        and _is_int(denominator)
        and denominator > 0
        and isinstance(drop_frame, bool)
    ):
        rate = FrameRate(numerator, denominator, drop_frame)
        if drop_frame and rate.fraction not in DROP_FRAME_RATES:
            errors.append(
                "format.dropFrame is supported only for 30000/1001 and 60000/1001"
            )
        try:
            _ = rate.resolve_setting
        except TimelineValidationError as exc:
            errors.extend(exc.errors)

    start_timecode = data.get("startTimecode")
    _add_error(
        errors,
        _is_nonempty_string(start_timecode),
        "startTimecode must be a non-empty SMPTE timecode string",
    )
    timeline_start_frame: Optional[int] = None
    if rate and _is_nonempty_string(start_timecode):
        try:
            timeline_start_frame = timecode_to_frames(str(start_timecode), rate)
        except TimelineValidationError as exc:
            errors.extend(exc.errors)

    tracks_by_type: Dict[str, List[Dict[str, Any]]] = {
        "video": [],
        "audio": [],
        "subtitle": [],
    }
    track_lookup: Dict[str, Dict[str, Any]] = {}
    source_track_keys = (
        ("videoTracks", "video"),
        ("audioTracks", "audio"),
        ("captionTracks", "subtitle"),
    )
    for key, track_type in source_track_keys:
        tracks = data.get(key, [])
        if not isinstance(tracks, list):
            errors.append(f"{key} must be an array")
            continue
        for index, track in enumerate(tracks, start=1):
            location = f"{key}[{index - 1}]"
            if not isinstance(track, Mapping):
                errors.append(f"{location} must be an object")
                continue
            track_id = track.get("id")
            name = track.get("name")
            role = track.get("role")
            _add_error(errors, _is_nonempty_string(track_id), f"{location}.id must be a non-empty string")
            _add_error(errors, _is_nonempty_string(name), f"{location}.name must be a non-empty string")
            _add_error(errors, _is_nonempty_string(role), f"{location}.role must be a non-empty string")
            _add_error(errors, isinstance(track.get("enabled"), bool), f"{location}.enabled must be boolean")
            _add_error(errors, isinstance(track.get("locked"), bool), f"{location}.locked must be boolean")
            items = track.get("items")
            if not isinstance(items, list):
                errors.append(f"{location}.items must be an array")
                items = []
            audio_type = track.get("audioType")
            if audio_type is not None and (
                not isinstance(audio_type, str) or not _audio_type_valid(audio_type)
            ):
                errors.append(
                    f"{location}.audioType {audio_type!r} is not a Resolve audio track type"
                )
            if track_type == "audio" and items and audio_type is None:
                errors.append(
                    f"{location}.audioType is required before an audio track contains items"
                )
            if _is_nonempty_string(track_id):
                if track_id in track_lookup:
                    errors.append(f"duplicate track id {track_id!r}")
                    continue
                normalized_track = {
                    "id": str(track_id),
                    "name": str(name) if isinstance(name, str) else "",
                    "role": str(role) if isinstance(role, str) else "",
                    "enabled": track.get("enabled") is True,
                    "locked": track.get("locked") is True,
                    "items": items,
                    "type": track_type,
                    "index": index,
                    "audioType": audio_type,
                    "audioTypeSource": "manifest" if audio_type is not None else "resolve-default-empty-track",
                }
                tracks_by_type[track_type].append(normalized_track)
                track_lookup[str(track_id)] = normalized_track

    if not tracks_by_type["video"]:
        errors.append("videoTracks must declare at least one editable picture track")

    items_by_id: Dict[str, Dict[str, Any]] = {}
    item_order: List[str] = []

    def merge_item(normalized: Optional[Dict[str, Any]], forced_kind: Optional[str] = None) -> None:
        if normalized is None:
            return
        if forced_kind is not None:
            normalized["kind"] = forced_kind
        item_id = normalized["id"]
        prior = items_by_id.get(item_id)
        if prior is None:
            items_by_id[item_id] = normalized
            item_order.append(item_id)
            return
        comparable_prior = {k: v for k, v in prior.items() if k not in {"kind", "_location"}}
        comparable_new = {k: v for k, v in normalized.items() if k not in {"kind", "_location"}}
        if comparable_prior != comparable_new:
            errors.append(
                f"item id {item_id!r} is defined inconsistently at "
                f"{prior['_location']} and {normalized['_location']}"
            )
            return
        if forced_kind:
            prior["kind"] = forced_kind

    for track in track_lookup.values():
        for item_index, item in enumerate(track["items"]):
            merge_item(
                _normalize_item(
                    item,
                    f"{track['type']}Tracks[{track['index'] - 1}].items[{item_index}]",
                    track["id"],
                    track_lookup,
                    errors,
                )
            )

    specialized = (
        ("graphicsItems", "graphics", "video"),
        ("musicItems", "music", "audio"),
        ("captionItems", "captions", "subtitle"),
    )
    for key, forced_kind, expected_type in specialized:
        values = data.get(key, [])
        if not isinstance(values, list):
            errors.append(f"{key} must be an array")
            continue
        for index, item in enumerate(values):
            normalized = _normalize_item(
                item,
                f"{key}[{index}]",
                None,
                track_lookup,
                errors,
            )
            if normalized:
                track = track_lookup.get(normalized["trackId"])
                if track and track["type"] != expected_type:
                    errors.append(
                        f"{key}[{index}] must target a {expected_type} track, not {track['type']}"
                    )
                if forced_kind == "graphics" and track:
                    if track["index"] <= 1:
                        errors.append(
                            f"{key}[{index}] must stay on an upper video track (index >= 2)"
                        )
                    if "graphic" not in track["role"].lower():
                        errors.append(
                            f"{key}[{index}] track role {track['role']!r} must identify graphics"
                        )
                if forced_kind == "music" and track and "music" not in track["role"].lower():
                    errors.append(
                        f"{key}[{index}] track role {track['role']!r} must identify music"
                    )
                merge_item(normalized, forced_kind)

    # A specialized music item can make an otherwise empty audio track non-empty.
    for item in items_by_id.values():
        track = track_lookup.get(item["trackId"])
        if track and track["type"] == "audio" and track["audioType"] is None:
            errors.append(
                f"audio track {track['id']!r} requires audioType because item {item['id']!r} targets it"
            )
        if item["kind"] == "graphics" and track:
            if track["type"] != "video" or track["index"] <= 1:
                errors.append(
                    f"graphics item {item['id']!r} must stay on an upper video track (index >= 2)"
                )
        if item["kind"] == "music" and track and track["type"] != "audio":
            errors.append(f"music item {item['id']!r} must target an audio track")

    # Resolve cannot place overlapping clips on one ordinary track without changing edits.
    by_track: Dict[str, List[Dict[str, Any]]] = {}
    for item_id in item_order:
        item = items_by_id[item_id]
        if item["kind"] == "captions":
            continue
        by_track.setdefault(item["trackId"], []).append(item)
    for track_id, items in by_track.items():
        ordered = sorted(items, key=lambda item: (item["timelineStartFrame"], item["id"]))
        for left, right in zip(ordered, ordered[1:]):
            if left["timelineEndFrame"] > right["timelineStartFrame"]:
                errors.append(
                    f"items {left['id']!r} and {right['id']!r} overlap on track {track_id!r}"
                )

    markers = data.get("markers", [])
    normalized_markers: List[Dict[str, Any]] = []
    if not isinstance(markers, list):
        errors.append("markers must be an array")
        markers = []
    marker_ids = set()
    marker_frames = set()
    for index, marker in enumerate(markers):
        location = f"markers[{index}]"
        if not isinstance(marker, Mapping):
            errors.append(f"{location} must be an object")
            continue
        marker_id = marker.get("id")
        frame = marker.get("frame")
        kind = marker.get("kind")
        label = marker.get("label")
        status = marker.get("status")
        _add_error(errors, _is_nonempty_string(marker_id), f"{location}.id must be a non-empty string")
        _add_error(errors, _is_int(frame) and frame >= 0, f"{location}.frame must be an integer >= 0")
        _add_error(errors, _is_nonempty_string(kind), f"{location}.kind must be a non-empty string")
        _add_error(errors, _is_nonempty_string(label), f"{location}.label must be a non-empty string")
        _add_error(errors, _is_nonempty_string(status), f"{location}.status must be a non-empty string")
        duration = marker.get("durationFrames", 1)
        _add_error(errors, _is_int(duration) and duration > 0, f"{location}.durationFrames must be > 0")
        color = marker.get("color", MARKER_COLORS.get(str(kind), "Blue"))
        _add_error(
            errors,
            isinstance(color, str) and color in ALLOWED_MARKER_COLORS,
            f"{location}.color {color!r} is not a supported Resolve marker color",
        )
        if _is_nonempty_string(marker_id):
            if marker_id in marker_ids:
                errors.append(f"duplicate marker id {marker_id!r}")
            marker_ids.add(marker_id)
        if _is_int(frame):
            if frame in marker_frames:
                errors.append(
                    f"multiple timeline markers target frame offset {frame}; Resolve stores one marker per frame"
                )
            marker_frames.add(frame)
        if (
            _is_nonempty_string(marker_id)
            and _is_int(frame)
            and frame >= 0
            and _is_nonempty_string(kind)
            and _is_nonempty_string(label)
            and _is_nonempty_string(status)
            and _is_int(duration)
            and duration > 0
            and isinstance(color, str)
        ):
            normalized_markers.append(
                {
                    "id": str(marker_id),
                    "frame": int(frame),
                    "kind": str(kind),
                    "label": str(label),
                    "status": str(status),
                    "note": str(marker.get("note", "")),
                    "durationFrames": int(duration),
                    "color": color,
                }
            )

    if errors:
        raise TimelineValidationError(errors)
    assert rate is not None and timeline_start_frame is not None

    clips = [items_by_id[item_id] for item_id in item_order]
    clips.sort(
        key=lambda item: (
            track_lookup[item["trackId"]]["type"],
            track_lookup[item["trackId"]]["index"],
            item["timelineStartFrame"],
            item["id"],
        )
    )
    normalized_markers.sort(key=lambda marker: (marker["frame"], marker["id"]))
    return {
        "schemaVersion": 1,
        "projectId": str(data["projectId"]),
        "timelineId": str(data["timelineId"]),
        "format": {
            "width": int(width),
            "height": int(height),
            "pixelAspectRatio": format_data.get("pixelAspectRatio"),
        },
        "frameRate": rate,
        "startTimecode": str(start_timecode),
        "timelineStartFrame": timeline_start_frame,
        "tracks": tracks_by_type,
        "trackLookup": track_lookup,
        "clips": clips,
        "markers": normalized_markers,
        "interchange": data.get("interchange", {}),
    }


def load_and_validate(path: Path) -> Dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        raise TimelineValidationError([f"timeline manifest does not exist: {path}"])
    except json.JSONDecodeError as exc:
        raise TimelineValidationError(
            [f"timeline manifest is not valid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"]
        )
    return validate_timeline(data)


def infer_project_root(timeline_path: Path) -> Path:
    parent = timeline_path.resolve().parent
    if parent.name == "timeline":
        return parent.parent
    return parent


def _is_within(path: Path, directory: Path) -> bool:
    try:
        path.relative_to(directory)
        return True
    except ValueError:
        return False


def resolve_contained_project_path(
    path_value: str,
    project_root: Path,
    field_name: str,
) -> Path:
    """Resolve a manifest path without allowing it to escape the project.

    Manifest paths are intentionally portable and must therefore be relative.
    ``Path.resolve`` also follows any existing symlinks, so a source symlink
    that points outside the project is rejected rather than trusted.
    """

    if "\\" in path_value:
        raise TimelineValidationError(
            [
                f"{field_name} must use forward slashes for a project-relative path; "
                f"backslashes are not allowed: {path_value}"
            ]
        )
    project_root = project_root.expanduser().resolve()
    candidate = Path(path_value).expanduser()
    if candidate.is_absolute():
        raise TimelineValidationError(
            [f"{field_name} must be project-relative, not absolute: {path_value}"]
        )
    resolved = (project_root / candidate).resolve()
    if not _is_within(resolved, project_root):
        raise TimelineValidationError(
            [f"{field_name} escapes projectRoot: {path_value} -> {resolved}"]
        )
    return resolved


def resolve_export_directory(export_dir: Path, project_root: Path) -> Path:
    """Resolve an explicit CLI export directory, still contained by project."""

    if not export_dir.is_absolute() and "\\" in str(export_dir):
        raise TimelineValidationError(
            [
                "--export-dir must use forward slashes when project-relative; "
                f"backslashes are not allowed: {export_dir}"
            ]
        )
    project_root = project_root.expanduser().resolve()
    candidate = export_dir.expanduser()
    if not candidate.is_absolute():
        candidate = project_root / candidate
    resolved = candidate.resolve()
    if not _is_within(resolved, project_root):
        raise TimelineValidationError(
            [
                "--export-dir must remain inside projectRoot: "
                f"{export_dir} -> {resolved}"
            ]
        )
    return resolved


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            block = handle.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def verify_source_integrity(
    referenced_sources: Iterable[Mapping[str, Any]],
    project_root: Path,
    relink_map_path: Path,
    expected_project_id: str,
) -> Dict[str, Any]:
    """Verify every timeline source against the durable SHA-256 relink map."""

    project_root = project_root.resolve()
    relink_map_path = relink_map_path.resolve()
    if not _is_within(relink_map_path, project_root):
        raise TimelineValidationError(
            [f"relink map must remain inside projectRoot: {relink_map_path}"]
        )
    if not relink_map_path.is_file():
        return {
            "status": "missing-relink-map",
            "path": str(relink_map_path),
            "hashAlgorithm": "sha256",
            "sources": [],
            "errors": [f"relink map does not exist: {relink_map_path}"],
        }
    try:
        with relink_map_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        return {
            "status": "invalid-relink-map",
            "path": str(relink_map_path),
            "hashAlgorithm": "sha256",
            "sources": [],
            "errors": [
                f"relink map JSON is invalid at line {exc.lineno}, column {exc.colno}: {exc.msg}"
            ],
        }
    errors: List[str] = []
    if not isinstance(data, Mapping):
        errors.append("relink map root must be an object")
        data = {}
    schema_version = data.get("schemaVersion")
    if not _is_int(schema_version) or schema_version != 1:
        errors.append("relink map schemaVersion must equal integer 1")
    relink_project_id = data.get("projectId")
    if relink_project_id != expected_project_id:
        errors.append(
            "relink map projectId must match timeline projectId "
            f"{expected_project_id!r}, got {relink_project_id!r}"
        )
    relink_status = data.get("status")
    if relink_status != "ready":
        errors.append(f"relink map status must equal 'ready', got {relink_status!r}")
    if data.get("hashAlgorithm") != "sha256":
        errors.append("relink map hashAlgorithm must equal 'sha256'")
    path_policy = data.get("pathPolicy")
    if path_policy != PROJECT_PATH_POLICY:
        errors.append(
            f"relink map pathPolicy must equal {PROJECT_PATH_POLICY!r}, got {path_policy!r}"
        )
    missing_media = data.get("missingMedia")
    if not isinstance(missing_media, list):
        errors.append("relink map missingMedia must be an array")
        missing_media_count: Optional[int] = None
    else:
        missing_media_count = len(missing_media)
        if missing_media:
            errors.append(
                "relink map missingMedia must be empty before a hash-verified handoff "
                f"({missing_media_count} unresolved entr{'y' if missing_media_count == 1 else 'ies'})"
            )

    expected_by_path: Dict[str, str] = {}
    for collection_name in ("sources", "derivatives"):
        entries = data.get(collection_name, [])
        if not isinstance(entries, list):
            errors.append(f"relink map {collection_name} must be an array")
            continue
        for index, entry in enumerate(entries):
            location = f"relink map {collection_name}[{index}]"
            if not isinstance(entry, Mapping):
                errors.append(f"{location} must be an object")
                continue
            path_value = entry.get("path")
            expected_sha = entry.get("sha256")
            if not _is_nonempty_string(path_value):
                errors.append(f"{location}.path must be a non-empty project-relative string")
                continue
            if not isinstance(expected_sha, str) or not SHA256_RE.match(expected_sha):
                errors.append(f"{location}.sha256 must be exactly 64 hexadecimal characters")
                continue
            try:
                resolved = resolve_contained_project_path(
                    str(path_value), project_root, f"{location}.path"
                )
            except TimelineValidationError as exc:
                errors.extend(exc.errors)
                continue
            key = str(resolved)
            normalized_sha = expected_sha.lower()
            prior = expected_by_path.get(key)
            if prior is not None and prior != normalized_sha:
                errors.append(f"relink map contains conflicting SHA-256 values for {path_value}")
                continue
            expected_by_path[key] = normalized_sha

    source_results: List[Dict[str, Any]] = []
    for source in sorted(referenced_sources, key=lambda value: str(value["resolvedPath"])):
        resolved = Path(str(source["resolvedPath"]))
        expected = expected_by_path.get(str(resolved))
        if not resolved.is_file():
            status = "missing-source"
            actual: Optional[str] = None
            errors.append(f"referenced source does not exist: {resolved}")
        elif expected is None:
            status = "missing-checksum-entry"
            actual = None
            errors.append(f"relink map has no SHA-256 entry for referenced source: {resolved}")
        else:
            actual = _sha256_file(resolved)
            if actual == expected:
                status = "verified"
            else:
                status = "checksum-mismatch"
                errors.append(
                    f"SHA-256 mismatch for {resolved}: expected {expected}, actual {actual}"
                )
        source_results.append(
            {
                "sourcePath": source["sourcePath"],
                "resolvedPath": str(resolved),
                "itemIds": sorted(source.get("itemIds", [])),
                "expectedSha256": expected,
                "actualSha256": actual,
                "status": status,
            }
        )

    return {
        "status": "verified" if not errors else "failed",
        "path": str(relink_map_path),
        "schemaVersion": schema_version,
        "projectId": relink_project_id,
        "expectedProjectId": expected_project_id,
        "relinkStatus": relink_status,
        "hashAlgorithm": "sha256",
        "pathPolicy": path_policy,
        "missingMediaCount": missing_media_count,
        "sources": source_results,
        "errors": errors,
    }


def _safe_export_stem(value: str) -> str:
    result = SAFE_NAME_RE.sub("-", value.strip()).strip(".-")
    if not result:
        raise TimelineValidationError(["timelineId cannot produce a safe export filename"])
    return result


def _export_paths(
    normalized: Mapping[str, Any],
    project_root: Path,
    export_dir: Optional[Path],
    include_edl: bool,
) -> List[Dict[str, Any]]:
    stem = _safe_export_stem(str(normalized["timelineId"]))
    interchange = normalized.get("interchange")
    interchange = interchange if isinstance(interchange, Mapping) else {}

    default_export_root = (project_root / "outputs" / "interchange").resolve()
    if not _is_within(default_export_root, project_root):
        raise TimelineValidationError(
            [
                "default outputs/interchange directory resolves outside projectRoot: "
                f"{default_export_root}"
            ]
        )
    if export_dir is not None:
        base = resolve_export_directory(export_dir, project_root)
        fcpxml_path = base / f"{stem}.fcpxml"
        edl_path = base / f"{stem}.edl"
        drp_path = base / f"{stem}.drp"
        drt_path = base / f"{stem}.drt"
        otio_path = base / f"{stem}.otio"
    else:
        primary = interchange.get("primaryPath")
        if _is_nonempty_string(primary):
            fcpxml_path = resolve_contained_project_path(
                str(primary), project_root, "interchange.primaryPath"
            )
            base = fcpxml_path.parent
        else:
            base = default_export_root
            fcpxml_path = base / f"{stem}.fcpxml"
        fallback = interchange.get("fallbackPath")
        edl_path = (
            resolve_contained_project_path(
                str(fallback), project_root, "interchange.fallbackPath"
            )
            if _is_nonempty_string(fallback)
            else base / f"{stem}.edl"
        )
        native_project = interchange.get("nativeProjectPath")
        native_timeline = interchange.get("nativeTimelinePath")
        portable_otio = interchange.get("otioPath")
        drp_path = (
            resolve_contained_project_path(
                str(native_project), project_root, "interchange.nativeProjectPath"
            )
            if _is_nonempty_string(native_project)
            else base / f"{stem}.drp"
        )
        drt_path = (
            resolve_contained_project_path(
                str(native_timeline), project_root, "interchange.nativeTimelinePath"
            )
            if _is_nonempty_string(native_timeline)
            else base / f"{stem}.drt"
        )
        otio_path = (
            resolve_contained_project_path(
                str(portable_otio), project_root, "interchange.otioPath"
            )
            if _is_nonempty_string(portable_otio)
            else base / f"{stem}.otio"
        )

        manifest_exports = {
            "interchange.primaryPath": fcpxml_path,
            "interchange.fallbackPath": edl_path,
            "interchange.nativeProjectPath": drp_path,
            "interchange.nativeTimelinePath": drt_path,
            "interchange.otioPath": otio_path,
        }
        outside_default = [
            f"{field} must resolve under outputs/interchange/ (or use --export-dir): {path}"
            for field, path in manifest_exports.items()
            if not _is_within(path.resolve(), default_export_root)
        ]
        if outside_default:
            raise TimelineValidationError(outside_default)

    exports = [
        {
            "format": "DRP",
            "path": str(drp_path.resolve()),
            "required": True,
            "api": "ProjectManager.ExportProject",
        },
        {
            "format": "DRT",
            "path": str(drt_path.resolve()),
            "required": True,
            "api": "Timeline.Export(EXPORT_DRT)",
        },
        {
            "format": "OTIO",
            "path": str(otio_path.resolve()),
            "required": False,
            "api": "Timeline.Export(EXPORT_OTIO)",
        },
        {
            "format": "FCPXML",
            "path": str(fcpxml_path.resolve()),
            "required": False,
            "api": "Timeline.Export(EXPORT_FCPXML_1_10)",
        },
    ]
    if include_edl:
        exports.append(
            {
                "format": "EDL",
                "path": str(edl_path.resolve()),
                "required": False,
                "api": "Timeline.Export(EXPORT_EDL, EXPORT_NONE)",
                "limitation": "single-track-style fallback; does not preserve the full edit model",
            }
        )
    for export in exports:
        path = Path(export["path"])
        export["exists"] = path.exists()
        export["stagingPath"] = str(path.with_name(f".{path.stem}.codex-staging{path.suffix}"))
    return exports


def build_plan(
    normalized: Mapping[str, Any],
    timeline_path: Path,
    project_root: Path,
    resolve_project_name: Optional[str] = None,
    resolve_timeline_name: Optional[str] = None,
    export_dir: Optional[Path] = None,
    load_existing_project: bool = False,
    replace_existing_timeline: bool = False,
    overwrite_exports: bool = False,
    allow_missing_media: bool = False,
    include_edl: bool = True,
    collision_formats: Optional[Iterable[str]] = None,
    collision_overwrite_flag: str = "--overwrite-exports",
    verify_source_hashes: bool = False,
    require_verified_sources: bool = False,
    relink_map_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Build the fully resolved, JSON-serializable dry-run/apply plan."""

    project_root = project_root.expanduser().resolve()
    if not timeline_path.is_absolute() and "\\" in str(timeline_path):
        raise TimelineValidationError(
            [
                "timeline manifest must use forward slashes when project-relative; "
                f"backslashes are not allowed: {timeline_path}"
            ]
        )
    timeline_path = timeline_path.expanduser().resolve()
    if not _is_within(timeline_path, project_root):
        raise TimelineValidationError(
            [f"timeline manifest must remain inside projectRoot: {timeline_path}"]
        )
    project_name = resolve_project_name or str(normalized["projectId"])
    timeline_name = resolve_timeline_name or str(normalized["timelineId"])
    if not _is_nonempty_string(project_name):
        raise TimelineValidationError(["Resolve project name must be non-empty"])
    if not _is_nonempty_string(timeline_name):
        raise TimelineValidationError(["Resolve timeline name must be non-empty"])

    rate: FrameRate = normalized["frameRate"]
    media_by_path: Dict[str, Dict[str, Any]] = {}
    referenced_sources: Dict[str, Dict[str, Any]] = {}
    planned_clips: List[Dict[str, Any]] = []
    caption_items: List[Dict[str, Any]] = []
    for item in normalized["clips"]:
        source_path = resolve_contained_project_path(
            item["sourcePath"], project_root, f"{item['_location']}.sourcePath"
        )
        media_key = str(source_path)
        source_entry = referenced_sources.setdefault(
            media_key,
            {
                "sourcePath": item["sourcePath"],
                "resolvedPath": media_key,
                "exists": source_path.is_file(),
                "referenceOnly": True,
                "itemIds": [],
            },
        )
        source_entry["itemIds"].append(item["id"])
        track = normalized["trackLookup"][item["trackId"]]
        if item["kind"] == "captions":
            caption_items.append(
                {
                    "itemId": item["id"],
                    "trackId": item["trackId"],
                    "sourcePath": media_key,
                    "exists": source_path.is_file(),
                    "reason": "Resolve scripting API does not document subtitle-media append; import SRT separately",
                }
            )
            continue
        if media_key not in media_by_path:
            exists = source_path.is_file()
            media_by_path[media_key] = {
                "sourcePath": item["sourcePath"],
                "resolvedPath": media_key,
                "exists": exists,
                "referenceOnly": True,
            }
        media_type = 1 if track["type"] == "video" else 2
        planned_clips.append(
            {
                "itemId": item["id"],
                "kind": item["kind"],
                "trackId": item["trackId"],
                "trackType": track["type"],
                "trackIndex": track["index"],
                "mediaType": media_type,
                "sourcePath": media_key,
                "sourceInFrame": item["sourceInFrame"],
                "sourceOutFrameExclusive": item["sourceOutFrame"],
                "resolveEndFrameInclusive": item["sourceOutFrame"] - 1,
                "timelineStartFrame": item["timelineStartFrame"],
                "timelineEndFrameExclusive": item["timelineEndFrame"],
                "recordFrame": normalized["timelineStartFrame"] + item["timelineStartFrame"],
                "recordFrameFormula": (
                    f"Timeline.GetStartFrame()+{item['timelineStartFrame']}"
                ),
                "durationFrames": item["sourceOutFrame"] - item["sourceInFrame"],
                "enabled": item["enabled"],
                "syncGroupId": item.get("syncGroupId"),
                "notes": item.get("notes", []),
            }
        )

    missing = [
        entry["resolvedPath"] for entry in referenced_sources.values() if not entry["exists"]
    ]
    if missing and not allow_missing_media:
        raise TimelineValidationError(
            ["source media does not exist: " + path for path in sorted(missing)]
        )

    if relink_map_path is None:
        resolved_relink_map = (project_root / "timeline" / "relink-map.json").resolve()
    else:
        if not relink_map_path.is_absolute() and "\\" in str(relink_map_path):
            raise TimelineValidationError(
                [
                    "--relink-map must use forward slashes when project-relative; "
                    f"backslashes are not allowed: {relink_map_path}"
                ]
            )
        candidate_relink_map = relink_map_path.expanduser()
        if not candidate_relink_map.is_absolute():
            candidate_relink_map = project_root / candidate_relink_map
        resolved_relink_map = candidate_relink_map.resolve()
        if not _is_within(resolved_relink_map, project_root):
            raise TimelineValidationError(
                [f"--relink-map must remain inside projectRoot: {resolved_relink_map}"]
            )
    if not _is_within(resolved_relink_map, project_root):
        raise TimelineValidationError(
            [f"relink map resolves outside projectRoot: {resolved_relink_map}"]
        )
    if verify_source_hashes or require_verified_sources:
        relink_verification = verify_source_integrity(
            referenced_sources.values(),
            project_root,
            resolved_relink_map,
            str(normalized["projectId"]),
        )
    else:
        relink_verification = {
            "status": "not-run",
            "path": str(resolved_relink_map),
            "hashAlgorithm": "sha256",
            "expectedProjectId": str(normalized["projectId"]),
            "requiredContract": {
                "schemaVersion": 1,
                "status": "ready",
                "pathPolicy": PROJECT_PATH_POLICY,
                "missingMedia": [],
            },
            "note": (
                "default dry-run does not read or hash the relink map; use "
                "--verify-source-hashes for the strict handoff preflight"
            ),
            "sources": [
                {
                    "sourcePath": entry["sourcePath"],
                    "resolvedPath": entry["resolvedPath"],
                    "itemIds": sorted(entry["itemIds"]),
                    "status": "not-verified",
                }
                for entry in sorted(
                    referenced_sources.values(), key=lambda value: value["resolvedPath"]
                )
            ],
            "errors": [],
        }
    if require_verified_sources and relink_verification["status"] != "verified":
        verification_errors = list(relink_verification.get("errors", []))
        if not verification_errors:
            verification_errors = ["source integrity verification did not complete"]
        raise TimelineValidationError(
            ["source-integrity preflight failed: " + error for error in verification_errors]
        )

    exports = _export_paths(normalized, project_root, export_dir, include_edl)
    export_errors: List[str] = []
    expected_suffixes = {
        "DRP": ".drp",
        "DRT": ".drt",
        "OTIO": ".otio",
        "FCPXML": ".fcpxml",
        "EDL": ".edl",
    }
    export_paths_seen: Dict[str, str] = {}
    protected_raw = (project_root / "raw").resolve()
    for export in exports:
        export_path = Path(export["path"])
        expected_suffix = expected_suffixes[export["format"]]
        if export_path.suffix.lower() != expected_suffix:
            export_errors.append(
                f"{export['format']} destination must end in {expected_suffix}: {export_path}"
            )
        prior_format = export_paths_seen.get(str(export_path))
        if prior_format:
            export_errors.append(
                f"{prior_format} and {export['format']} resolve to the same export path: {export_path}"
            )
        export_paths_seen[str(export_path)] = export["format"]
        if not _is_within(export_path.resolve(), project_root):
            export_errors.append(
                f"export destination resolves outside projectRoot: {export_path}"
            )
        if _is_within(export_path, protected_raw):
            export_errors.append(f"export destination may not be inside raw/: {export_path}")
        if str(export_path) in media_by_path:
            export_errors.append(f"export destination collides with referenced source media: {export_path}")
    if export_errors:
        raise TimelineValidationError(export_errors)
    selected_collision_formats = (
        {str(value).upper() for value in collision_formats}
        if collision_formats is not None
        else {str(export["format"]) for export in exports}
    )
    known_formats = {str(export["format"]) for export in exports}
    unknown_collision_formats = selected_collision_formats - known_formats
    if unknown_collision_formats:
        raise TimelineValidationError(
            [
                "unknown export collision scope: "
                + ", ".join(sorted(unknown_collision_formats))
            ]
        )
    collisions = [
        export["path"]
        for export in exports
        if export["format"] in selected_collision_formats and export["exists"]
    ]
    if collisions and not overwrite_exports:
        raise TimelineValidationError(
            [
                f"export already exists (pass {collision_overwrite_flag} to replace it): " + path
                for path in collisions
            ]
        )
    stale_staging = [
        export["stagingPath"]
        for export in exports
        if (
            export["format"] in selected_collision_formats
            and overwrite_exports
            and Path(export["stagingPath"]).exists()
        )
    ]
    if stale_staging:
        raise TimelineValidationError(
            ["staging export already exists; inspect/remove it before retrying: " + path for path in stale_staging]
        )

    tracks: List[Dict[str, Any]] = []
    for track_type in ("video", "audio", "subtitle"):
        for track in normalized["tracks"][track_type]:
            tracks.append(
                {
                    "id": track["id"],
                    "type": track_type,
                    "index": track["index"],
                    "name": track["name"],
                    "role": track["role"],
                    "audioType": track["audioType"] if track_type == "audio" else None,
                    "audioTypeSource": track["audioTypeSource"] if track_type == "audio" else None,
                    "enabled": track["enabled"],
                    "locked": track["locked"],
                }
            )

    link_groups: Dict[str, List[str]] = {}
    for clip in planned_clips:
        group = clip.get("syncGroupId")
        if _is_nonempty_string(group):
            link_groups.setdefault(str(group), []).append(clip["itemId"])
    link_groups = {
        group: items for group, items in sorted(link_groups.items()) if len(items) >= 2
    }

    markers = []
    for marker in normalized["markers"]:
        markers.append(
            {
                **marker,
                "customData": json.dumps(
                    {
                        "codexTimelineMarkerId": marker["id"],
                        "kind": marker["kind"],
                        "status": marker["status"],
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            }
        )

    interchange = normalized.get("interchange")
    interchange = interchange if isinstance(interchange, Mapping) else {}
    declared_primary_format = interchange.get("primaryFormat")

    return {
        "mode": "dry-run",
        "timelineManifest": str(timeline_path),
        "projectRoot": str(project_root),
        "schemaAssumptions": {
            "intervals": "half-open [in, out)",
            "timelineFrameValues": "integer frames at the exact rational sequence timebase",
            "relativeSourcePaths": "resolved from projectRoot",
            "projectRelativePathSeparators": "forward slashes only; backslashes rejected",
            "pathContainment": (
                "manifest source/export paths must be relative and remain under projectRoot; "
                "manifest exports stay under outputs/interchange unless --export-dir is explicit"
            ),
            "rawMediaPolicy": "reference paths only; never copy, move, rename, transcode, upload, or delete",
        },
        "editableHandoff": {
            "effectivePrimaryFormat": "DRP_DRT",
            "declaredPrimaryFormat": declared_primary_format,
            "compatibility": (
                "legacy primaryFormat=FCPXML is retained as a portable-path declaration; "
                "nativeProjectPath/nativeTimelinePath remain the authoritative primary pair"
                if declared_primary_format == "FCPXML"
                else "DRP and DRT are primary; OTIO/FCPXML are portable fallbacks"
            ),
        },
        "resolve": {
            "project": {
                "name": project_name,
                "action": "load-existing" if load_existing_project else "create-new",
                "existingProjectPolicy": (
                    "explicitly load and mutate" if load_existing_project else "fail if name exists"
                ),
            },
            "settingsBeforeTimelineCreation": {
                "timelineFrameRate": rate.resolve_setting,
                "timelineResolutionWidth": str(normalized["format"]["width"]),
                "timelineResolutionHeight": str(normalized["format"]["height"]),
                "exactRationalTimebase": rate.rational_label,
                "dropFrame": rate.drop_frame,
            },
            "timeline": {
                "name": timeline_name,
                "action": (
                    "replace-if-present-else-create"
                    if replace_existing_timeline
                    else "create-new-and-fail-if-name-exists"
                ),
                "startTimecode": normalized["startTimecode"],
                "startFrame": normalized["timelineStartFrame"],
            },
            "tracks": tracks,
            "media": sorted(media_by_path.values(), key=lambda value: value["resolvedPath"]),
            "referencedSources": sorted(
                referenced_sources.values(), key=lambda value: value["resolvedPath"]
            ),
            "relinkVerification": relink_verification,
            "clips": planned_clips,
            "linkGroups": link_groups,
            "markers": markers,
            "captionItemsDeferred": caption_items,
            "save": True,
            "exports": exports,
            "exportCollisionPolicy": (
                "replace atomically through same-directory staging"
                if overwrite_exports
                else "fail before Resolve connection if any target exists"
            ),
            "exportCollisionFormats": sorted(selected_collision_formats),
        },
    }


def validation_summary(normalized: Mapping[str, Any], timeline_path: Path) -> Dict[str, Any]:
    counts = {
        "videoTracks": len(normalized["tracks"]["video"]),
        "audioTracks": len(normalized["tracks"]["audio"]),
        "captionTracks": len(normalized["tracks"]["subtitle"]),
        "clips": len([item for item in normalized["clips"] if item["kind"] != "captions"]),
        "captionItems": len([item for item in normalized["clips"] if item["kind"] == "captions"]),
        "markers": len(normalized["markers"]),
    }
    rate: FrameRate = normalized["frameRate"]
    return {
        "valid": True,
        "timelineManifest": str(timeline_path.resolve()),
        "projectId": normalized["projectId"],
        "timelineId": normalized["timelineId"],
        "exactRationalTimebase": rate.rational_label,
        "resolveFrameRateSetting": rate.resolve_setting,
        "startTimecode": normalized["startTimecode"],
        "startFrame": normalized["timelineStartFrame"],
        "counts": counts,
    }
