"""Hero configuration normalization shared by the Workbench and site editor."""

import math
import re
from pathlib import Path

import yaml

DEFAULT_ZOOM = 1.35
DEFAULT_FOCUS = "50% 50%"
DEFAULT_TYPE = "pan"
DEFAULT_DIRECTION = "right"
DEFAULT_DURATION = 12
DEFAULT_AMOUNT_BY_TYPE = {"pan": 6, "zoom-in": 0.15, "zoom-out": 0.15, "tilt": 2, "none": 0}


def _quoted_str_representer(dumper, value):
    return dumper.represent_scalar("tag:yaml.org,2002:str", value, style='"')


class _QuotedStrDumper(yaml.SafeDumper):
    pass


_QuotedStrDumper.add_representer(str, _quoted_str_representer)


def _diff_tier(tier_val, base_start, base_animation):
    """Keep only device overrides that differ from their desktop values."""
    if not tier_val:
        return None

    base_zoom = base_start.get("zoom", DEFAULT_ZOOM)
    base_focus = base_start.get("focus", DEFAULT_FOCUS)
    base_type = base_animation.get("type", DEFAULT_TYPE)
    base_direction = base_animation.get("direction", DEFAULT_DIRECTION)
    base_amount = base_animation.get("amount", DEFAULT_AMOUNT_BY_TYPE.get(base_type, 6))
    base_duration = base_animation.get("duration", DEFAULT_DURATION)

    t_zoom = tier_val.get("zoom", base_zoom)
    t_focus = tier_val.get("focus", base_focus)
    t_type = tier_val.get("type", base_type)
    t_direction = tier_val.get("direction", base_direction)
    t_amount = tier_val.get("amount", base_amount)
    t_duration = tier_val.get("duration", base_duration)

    out = {}
    if t_type != base_type:
        out["type"] = t_type
        if t_type in ("pan", "tilt"):
            out["direction"] = t_direction
        if DEFAULT_AMOUNT_BY_TYPE.get(t_type, 6) > 0:
            out["amount"] = t_amount
        out["duration"] = t_duration
    else:
        if base_type in ("pan", "tilt") and t_direction != base_direction:
            out["direction"] = t_direction
        if DEFAULT_AMOUNT_BY_TYPE.get(t_type, 6) > 0 and abs(float(t_amount) - float(base_amount)) > 0.001:
            out["amount"] = t_amount
        if t_duration != base_duration:
            out["duration"] = t_duration
    if abs(float(t_zoom) - float(base_zoom)) > 0.001:
        out["zoom"] = t_zoom
    if t_focus != base_focus:
        out["focus"] = t_focus
    return out or None


def prune_defaults(entry):
    """Drop documented defaults without losing POIs or device overrides."""
    out = {"path": entry["path"]}
    if entry.get("alt"):
        out["alt"] = entry["alt"]
    if entry.get("mirror"):
        out["mirror"] = entry["mirror"]
    if entry.get("hide_below"):
        out["hide_below"] = entry["hide_below"]
    poi = entry.get("poi")
    if poi is None:
        poi = {"x": 50, "y": 50}
    if poi is not None:
        if not isinstance(poi, dict):
            raise ValueError("poi must contain numeric x and y coordinates")
        try:
            coordinates = {axis: float(poi[axis]) for axis in ("x", "y")}
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("poi must contain numeric x and y coordinates") from exc
        if not all(math.isfinite(value) and 0 <= value <= 100 for value in coordinates.values()):
            raise ValueError("poi coordinates must be finite percentages between 0 and 100")
        out["poi"] = coordinates

    start = entry.get("start") or {}
    start_out = {}
    if start.get("focus") and start["focus"] != DEFAULT_FOCUS:
        start_out["focus"] = start["focus"]
    if start.get("zoom") is not None and abs(float(start["zoom"]) - DEFAULT_ZOOM) > 0.001:
        start_out["zoom"] = start["zoom"]
    if start_out:
        out["start"] = start_out

    animation = entry.get("animation") or {}
    anim_type = animation.get("type", DEFAULT_TYPE)
    anim_out = {}
    if anim_type != DEFAULT_TYPE:
        anim_out["type"] = anim_type
    if anim_type in ("pan", "tilt") and animation.get("direction", DEFAULT_DIRECTION) != DEFAULT_DIRECTION:
        anim_out["direction"] = animation["direction"]
    default_amount = DEFAULT_AMOUNT_BY_TYPE.get(anim_type, 6)
    if animation.get("amount") is not None and abs(float(animation["amount"]) - default_amount) > 0.001:
        anim_out["amount"] = animation["amount"]
    if animation.get("duration") is not None and animation["duration"] != DEFAULT_DURATION:
        anim_out["duration"] = animation["duration"]
    if anim_out:
        out["animation"] = anim_out

    for tier in ("mobile", "tablet"):
        diff = _diff_tier(entry.get(tier), start, animation)
        if diff:
            out[tier] = diff
    return out


SAFE_FILENAME_STEM = re.compile(r"[^a-zA-Z0-9_-]+")


def safe_stem(filename):
    stem = Path(filename).stem.strip().lower().replace(" ", "-")
    stem = SAFE_FILENAME_STEM.sub("-", stem).strip("-")
    return stem or "hero-photo"
