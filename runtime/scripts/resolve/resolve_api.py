#!/usr/bin/env python3
"""Apply a validated plan through Blackmagic's DaVinci Resolve scripting API."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sys
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


class ResolveApplyError(RuntimeError):
    pass


def _load_module_from_path(module_name: str, module_path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(module_name, str(module_path))
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load module spec from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def connect_to_resolve() -> Any:
    """Connect to a running Resolve without launching it."""

    try:
        import DaVinciResolveScript as dvr_script  # type: ignore
    except ImportError:
        if sys.platform.startswith("darwin"):
            module_path = Path(
                "/Library/Application Support/Blackmagic Design/DaVinci Resolve/"
                "Developer/Scripting/Modules/DaVinciResolveScript.py"
            )
        elif sys.platform.startswith(("win", "cygwin")):
            program_data = os.environ.get("PROGRAMDATA")
            if not program_data:
                raise ResolveApplyError("PROGRAMDATA is unset; cannot locate Resolve scripting module")
            module_path = Path(program_data) / (
                "Blackmagic Design/DaVinci Resolve/Support/Developer/Scripting/"
                "Modules/DaVinciResolveScript.py"
            )
        else:
            module_path = Path(
                "/opt/resolve/Developer/Scripting/Modules/DaVinciResolveScript.py"
            )
        try:
            dvr_script = _load_module_from_path("DaVinciResolveScript", module_path)
        except Exception as exc:
            raise ResolveApplyError(
                "Unable to load DaVinciResolveScript. Configure RESOLVE_SCRIPT_API, "
                "RESOLVE_SCRIPT_LIB, and PYTHONPATH as documented by Blackmagic, or use "
                f"the default module location. Underlying error: {exc}"
            ) from exc

    try:
        resolve = dvr_script.scriptapp("Resolve")
    except Exception as exc:
        raise ResolveApplyError(f"Resolve scripting connection failed: {exc}") from exc
    if not resolve:
        raise ResolveApplyError(
            "Resolve did not accept the scripting connection. Start DaVinci Resolve and "
            "allow external scripting in Resolve Preferences before using --apply. "
            "Edition- or function-specific limitations are reported by individual API calls."
        )
    return resolve


def _must(result: Any, operation: str) -> Any:
    if result is None or result is False:
        raise ResolveApplyError(f"Resolve API operation failed: {operation}")
    return result


def _project_names(project_manager: Any) -> List[str]:
    values = project_manager.GetProjectListInCurrentFolder()
    if not values:
        return []
    return [str(value) for value in values]


def _find_timelines(project: Any) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    count = int(project.GetTimelineCount() or 0)
    for index in range(1, count + 1):
        timeline = project.GetTimelineByIndex(index)
        if timeline:
            result[str(timeline.GetName())] = timeline
    return result


def _project_settings(project: Any, expected: Mapping[str, str], newly_created: bool) -> None:
    if newly_created:
        for key in (
            "timelineFrameRate",
            "timelineResolutionWidth",
            "timelineResolutionHeight",
        ):
            _must(project.SetSetting(key, str(expected[key])), f"Project.SetSetting({key})")
    for key in (
        "timelineFrameRate",
        "timelineResolutionWidth",
        "timelineResolutionHeight",
    ):
        actual = str(project.GetSetting(key))
        wanted = str(expected[key])
        if actual != wanted:
            action = "set" if newly_created else "verify"
            raise ResolveApplyError(
                f"Unable to {action} project setting {key}: Resolve reports {actual!r}, "
                f"manifest requires {wanted!r}. Existing project settings are never changed."
            )


def _delete_all_tracks(timeline: Any, track_type: str) -> None:
    count = int(timeline.GetTrackCount(track_type) or 0)
    for index in range(count, 0, -1):
        _must(timeline.DeleteTrack(track_type, index), f"Timeline.DeleteTrack({track_type}, {index})")


def _build_tracks(timeline: Any, tracks: Sequence[Mapping[str, Any]]) -> None:
    grouped: Dict[str, List[Mapping[str, Any]]] = {
        "video": [],
        "audio": [],
        "subtitle": [],
    }
    for track in tracks:
        grouped[str(track["type"])].append(track)

    # An empty Resolve timeline normally starts with V1/A1. Video has no subtype,
    # so retain V1 and add/delete only as needed.
    requested_video = grouped["video"]
    current_video = int(timeline.GetTrackCount("video") or 0)
    while current_video < len(requested_video):
        _must(timeline.AddTrack("video"), "Timeline.AddTrack(video)")
        current_video += 1
    while current_video > len(requested_video):
        _must(
            timeline.DeleteTrack("video", current_video),
            f"Timeline.DeleteTrack(video, {current_video})",
        )
        current_video -= 1

    # Audio subtypes cannot be changed in place through the documented API.
    # Add the exact requested tracks, then remove the original empty defaults.
    requested_audio = grouped["audio"]
    original_audio = int(timeline.GetTrackCount("audio") or 0)
    for track in requested_audio:
        audio_type = track.get("audioType") or "mono"
        _must(
            timeline.AddTrack("audio", str(audio_type)),
            f"Timeline.AddTrack(audio, {audio_type})",
        )
    for index in range(original_audio, 0, -1):
        _must(
            timeline.DeleteTrack("audio", index),
            f"Timeline.DeleteTrack(audio, {index})",
        )

    requested_subtitles = grouped["subtitle"]
    current_subtitles = int(timeline.GetTrackCount("subtitle") or 0)
    while current_subtitles < len(requested_subtitles):
        _must(timeline.AddTrack("subtitle"), "Timeline.AddTrack(subtitle)")
        current_subtitles += 1
    while current_subtitles > len(requested_subtitles):
        _must(
            timeline.DeleteTrack("subtitle", current_subtitles),
            f"Timeline.DeleteTrack(subtitle, {current_subtitles})",
        )
        current_subtitles -= 1

    for track_type in ("video", "audio", "subtitle"):
        actual_count = int(timeline.GetTrackCount(track_type) or 0)
        if actual_count != len(grouped[track_type]):
            raise ResolveApplyError(
                f"Resolve created {actual_count} {track_type} tracks; "
                f"the manifest requires {len(grouped[track_type])}"
            )
        for track in grouped[track_type]:
            index = int(track["index"])
            _must(
                timeline.SetTrackName(track_type, index, str(track["name"])),
                f"Timeline.SetTrackName({track_type}, {index})",
            )
            # Keep every track enabled and unlocked until all clips are inserted.
            _must(
                timeline.SetTrackEnable(track_type, index, True),
                f"Timeline.SetTrackEnable({track_type}, {index}, True)",
            )
            _must(
                timeline.SetTrackLock(track_type, index, False),
                f"Timeline.SetTrackLock({track_type}, {index}, False)",
            )


def _walk_media_pool(folder: Any) -> Iterable[Any]:
    for clip in folder.GetClipList() or []:
        yield clip
    for child in folder.GetSubFolderList() or []:
        yield from _walk_media_pool(child)


def _clip_file_path(clip: Any) -> Optional[Path]:
    try:
        properties = clip.GetClipProperty() or {}
    except Exception:
        return None
    value = properties.get("File Path") or properties.get("FilePath")
    if not value:
        return None
    try:
        return Path(str(value)).expanduser().resolve()
    except OSError:
        return None


def _import_media(media_pool: Any, paths: Sequence[str]) -> Dict[str, Any]:
    by_path: Dict[str, Any] = {}
    root = media_pool.GetRootFolder()
    if root:
        for clip in _walk_media_pool(root):
            path = _clip_file_path(clip)
            if path:
                by_path.setdefault(str(path), clip)

    result: Dict[str, Any] = {}
    for value in paths:
        path = str(Path(value).expanduser().resolve())
        if path in by_path:
            result[path] = by_path[path]
            continue
        imported = media_pool.ImportMedia([path])
        if not imported:
            raise ResolveApplyError(f"Resolve could not import source media: {path}")
        chosen = None
        for clip in imported:
            clip_path = _clip_file_path(clip)
            if clip_path and str(clip_path) == path:
                chosen = clip
                break
        if chosen is None and len(imported) == 1:
            chosen = imported[0]
        if chosen is None:
            raise ResolveApplyError(
                f"Resolve imported {path} but did not return an unambiguous MediaPoolItem"
            )
        result[path] = chosen
        by_path[path] = chosen
    return result


def _verify_source_extent(media_pool_item: Any, clip_plan: Mapping[str, Any]) -> None:
    try:
        frames_value = (media_pool_item.GetClipProperty() or {}).get("Frames")
        total_frames = int(float(str(frames_value))) if frames_value not in (None, "") else None
    except (TypeError, ValueError):
        total_frames = None
    if total_frames is not None and int(clip_plan["sourceOutFrameExclusive"]) > total_frames:
        raise ResolveApplyError(
            f"item {clip_plan['itemId']!r} ends at source frame "
            f"{clip_plan['sourceOutFrameExclusive']}, but Resolve reports only {total_frames} frames"
        )


def _append_clips(
    media_pool: Any,
    timeline: Any,
    clip_plans: Sequence[Mapping[str, Any]],
    media: Mapping[str, Any],
    actual_start_frame: int,
) -> Tuple[Dict[str, Any], List[str]]:
    timeline_items: Dict[str, Any] = {}
    warnings: List[str] = []
    for clip in clip_plans:
        media_pool_item = media[str(clip["sourcePath"])]
        _verify_source_extent(media_pool_item, clip)
        record_frame = actual_start_frame + int(clip["timelineStartFrame"])
        clip_info = {
            "mediaPoolItem": media_pool_item,
            "startFrame": int(clip["sourceInFrame"]),
            "endFrame": int(clip["resolveEndFrameInclusive"]),
            "mediaType": int(clip["mediaType"]),
            "trackIndex": int(clip["trackIndex"]),
            "recordFrame": record_frame,
        }
        appended = media_pool.AppendToTimeline([clip_info])
        if not appended or len(appended) != 1:
            raise ResolveApplyError(
                f"Resolve failed to append item {clip['itemId']!r} with clipInfo "
                f"{json.dumps({k: v for k, v in clip_info.items() if k != 'mediaPoolItem'}, sort_keys=True)}"
            )
        item = appended[0]
        timeline_items[str(clip["itemId"])] = item

        try:
            actual_record = int(round(float(item.GetStart(False))))
            if actual_record != record_frame:
                raise ResolveApplyError(
                    f"item {clip['itemId']!r} landed at frame {actual_record}, expected {record_frame}"
                )
            actual_duration = int(round(float(item.GetDuration(False))))
            if actual_duration != int(clip["durationFrames"]):
                raise ResolveApplyError(
                    f"item {clip['itemId']!r} duration is {actual_duration}, "
                    f"expected {clip['durationFrames']}"
                )
            track_type, track_index = item.GetTrackTypeAndIndex()
            if str(track_type) != str(clip["trackType"]) or int(track_index) != int(
                clip["trackIndex"]
            ):
                raise ResolveApplyError(
                    f"item {clip['itemId']!r} landed on {track_type} {track_index}, "
                    f"expected {clip['trackType']} {clip['trackIndex']}"
                )
        except ResolveApplyError:
            raise
        except Exception as exc:
            raise ResolveApplyError(
                f"could not verify appended item {clip['itemId']!r}: {exc}"
            ) from exc

        try:
            if not item.SetName(str(clip["itemId"])):
                warnings.append(f"Resolve did not rename timeline item {clip['itemId']!r}")
        except Exception:
            warnings.append(f"Resolve timeline-item naming unavailable for {clip['itemId']!r}")
        if not bool(clip["enabled"]):
            _must(item.SetClipEnabled(False), f"TimelineItem.SetClipEnabled({clip['itemId']})")
    return timeline_items, warnings


def _link_groups(
    timeline: Any,
    link_groups: Mapping[str, Sequence[str]],
    timeline_items: Mapping[str, Any],
) -> None:
    for group_id, item_ids in link_groups.items():
        items = [timeline_items[item_id] for item_id in item_ids]
        _must(
            timeline.SetClipsLinked(items, True),
            f"Timeline.SetClipsLinked(sync group {group_id})",
        )


def _add_markers(timeline: Any, markers: Sequence[Mapping[str, Any]]) -> None:
    for marker in markers:
        _must(
            timeline.AddMarker(
                int(marker["frame"]),
                str(marker["color"]),
                str(marker["label"]),
                str(marker["note"]),
                int(marker["durationFrames"]),
                str(marker["customData"]),
            ),
            f"Timeline.AddMarker({marker['id']})",
        )


def _apply_final_track_state(timeline: Any, tracks: Sequence[Mapping[str, Any]]) -> None:
    for track in tracks:
        track_type = str(track["type"])
        index = int(track["index"])
        _must(
            timeline.SetTrackEnable(track_type, index, bool(track["enabled"])),
            f"Timeline.SetTrackEnable({track_type}, {index})",
        )
        _must(
            timeline.SetTrackLock(track_type, index, bool(track["locked"])),
            f"Timeline.SetTrackLock({track_type}, {index})",
        )


def _export_destination(export: Mapping[str, Any], overwrite: bool) -> Tuple[Path, Path]:
    final_path = Path(str(export["path"]))
    if final_path.exists() and not overwrite:
        raise ResolveApplyError(
            f"export appeared after preflight and will not be overwritten: {final_path}"
        )
    final_path.parent.mkdir(parents=True, exist_ok=True)
    if overwrite and final_path.exists():
        staging = Path(str(export["stagingPath"]))
        if staging.exists():
            raise ResolveApplyError(f"staging export already exists: {staging}")
        return final_path, staging
    return final_path, final_path


def _finish_export(final_path: Path, working_path: Path, success: bool) -> bool:
    if not success or not working_path.is_file():
        if working_path != final_path and working_path.exists():
            working_path.unlink()
        elif working_path == final_path and working_path.exists():
            # This path did not exist at preflight, so a failed partial is ours.
            working_path.unlink()
        return False
    if working_path != final_path:
        os.replace(working_path, final_path)
    return True


def _export_one(
    resolve: Any,
    project_manager: Any,
    project: Any,
    timeline: Any,
    export: Mapping[str, Any],
    overwrite: bool,
) -> Dict[str, Any]:
    final_path, working_path = _export_destination(export, overwrite)
    export_format = str(export["format"])
    supported = True
    success = False

    if export_format == "DRP":
        success = bool(
            project_manager.ExportProject(project.GetName(), str(working_path), False)
        )
    else:
        constant_names = {
            "DRT": "EXPORT_DRT",
            "OTIO": "EXPORT_OTIO",
            "FCPXML": "EXPORT_FCPXML_1_10",
            "EDL": "EXPORT_EDL",
        }
        constant_name = constant_names[export_format]
        export_type = getattr(resolve, constant_name, None)
        if export_type is None:
            supported = False
        elif export_format == "EDL":
            subtype = getattr(resolve, "EXPORT_NONE", None)
            if subtype is None:
                supported = False
            else:
                success = bool(timeline.Export(str(working_path), export_type, subtype))
        else:
            success = bool(timeline.Export(str(working_path), export_type))

    if not supported:
        if bool(export["required"]):
            raise ResolveApplyError(
                f"required {export_format} export is unavailable in the running Resolve API"
            )
        return {
            "format": export_format,
            "path": str(final_path),
            "status": "skipped-unsupported-api-constant",
        }
    if not _finish_export(final_path, working_path, success):
        if bool(export["required"]):
            raise ResolveApplyError(f"required {export_format} export failed: {final_path}")
        return {
            "format": export_format,
            "path": str(final_path),
            "status": "optional-export-failed",
        }
    return {"format": export_format, "path": str(final_path), "status": "exported"}


def apply_plan(plan: Mapping[str, Any], overwrite_exports: bool) -> Dict[str, Any]:
    """Apply a dry-run plan to the currently running Resolve instance."""

    deferred_captions = plan["resolve"].get("captionItemsDeferred", [])
    if deferred_captions:
        raise ResolveApplyError(
            "caption items are present but the documented Resolve API does not expose "
            "subtitle-media append; create/import the requested SRT before applying this plan"
        )
    resolve = connect_to_resolve()
    project_manager = _must(resolve.GetProjectManager(), "Resolve.GetProjectManager")
    resolve_plan = plan["resolve"]
    project_plan = resolve_plan["project"]
    timeline_plan = resolve_plan["timeline"]
    project_name = str(project_plan["name"])
    timeline_name = str(timeline_plan["name"])

    existing_names = _project_names(project_manager)
    load_existing = project_plan["action"] == "load-existing"
    if load_existing:
        if project_name not in existing_names:
            raise ResolveApplyError(
                f"Resolve project {project_name!r} does not exist in the current database folder"
            )
        project = _must(
            project_manager.LoadProject(project_name),
            f"ProjectManager.LoadProject({project_name})",
        )
        newly_created = False
    else:
        if project_name in existing_names:
            raise ResolveApplyError(
                f"Resolve project {project_name!r} already exists; use --load-existing-project "
                "to opt into mutating it"
            )
        project = _must(
            project_manager.CreateProject(project_name),
            f"ProjectManager.CreateProject({project_name})",
        )
        newly_created = True

    _project_settings(project, resolve_plan["settingsBeforeTimelineCreation"], newly_created)
    media_pool = _must(project.GetMediaPool(), "Project.GetMediaPool")
    timelines = _find_timelines(project)
    existing_timeline = timelines.get(timeline_name)
    replace_timeline = timeline_plan["action"] == "replace-if-present-else-create"
    if existing_timeline and not replace_timeline:
        raise ResolveApplyError(
            f"timeline {timeline_name!r} already exists; pass --replace-existing-timeline "
            "to delete and rebuild it"
        )
    if existing_timeline:
        _must(
            media_pool.DeleteTimelines([existing_timeline]),
            f"MediaPool.DeleteTimelines({timeline_name})",
        )

    timeline = _must(
        media_pool.CreateEmptyTimeline(timeline_name),
        f"MediaPool.CreateEmptyTimeline({timeline_name})",
    )
    _must(project.SetCurrentTimeline(timeline), "Project.SetCurrentTimeline")
    _must(
        timeline.SetStartTimecode(str(timeline_plan["startTimecode"])),
        "Timeline.SetStartTimecode",
    )
    actual_start_frame = int(timeline.GetStartFrame())

    _build_tracks(timeline, resolve_plan["tracks"])
    media_paths = [entry["resolvedPath"] for entry in resolve_plan["media"]]
    media = _import_media(media_pool, media_paths)
    timeline_items, warnings = _append_clips(
        media_pool,
        timeline,
        resolve_plan["clips"],
        media,
        actual_start_frame,
    )
    _link_groups(timeline, resolve_plan["linkGroups"], timeline_items)
    _add_markers(timeline, resolve_plan["markers"])
    _apply_final_track_state(timeline, resolve_plan["tracks"])
    _must(project_manager.SaveProject(), "ProjectManager.SaveProject")

    export_results = []
    for export in resolve_plan["exports"]:
        export_results.append(
            _export_one(
                resolve,
                project_manager,
                project,
                timeline,
                export,
                overwrite_exports,
            )
        )

    result = dict(plan)
    result["mode"] = "applied"
    result["resolveRuntime"] = {
        "product": str(resolve.GetProductName()),
        "version": str(resolve.GetVersionString()),
        "project": str(project.GetName()),
        "timeline": str(timeline.GetName()),
        "timelineStartFrame": actual_start_frame,
        "exports": export_results,
        "warnings": warnings,
    }
    return result
