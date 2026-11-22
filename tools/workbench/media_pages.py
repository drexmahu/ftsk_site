"""Validation of media page front matter (content/media/*.md).

Mirrors layouts/partials/media/prepare.html so mistakes are reported in the
workbench instead of failing the Hugo build.
"""

import re
from pathlib import PurePosixPath
from urllib.parse import urlsplit

LAYOUTS = ("reel", "grid", "rows", "showcase")
CAPTIONS = ("none", "hover", "below")
WIDTHS = ("contained", "wide", "full")
TYPES = ("photo", "video")
MAX_SECTIONS = 40
MAX_ITEMS = 400
VIDEO_TYPES = {".mp4", ".m4v", ".webm", ".ogv", ".mov"}
RANGES = {"height": (120, 900), "height_mobile": (100, 700), "columns": (1, 6),
          "columns_mobile": (1, 3), "gap": (0, 48)}
YOUTUBE = re.compile(r"(?:youtu\.be/|youtube(?:-nocookie)?\.com/(?:watch\?(?:[^#\s]*&)?v=|embed/|shorts/|live/|v/))([A-Za-z0-9_-]{11})", re.I)


class MediaError(ValueError):
    pass


def youtube_id(value) -> str:
    text = str(value or "").strip()
    found = YOUTUBE.search(text)
    if found:
        return found.group(1)
    return text if re.fullmatch(r"[A-Za-z0-9_-]{11}", text) else ""


def parse_ratio(value) -> float:
    """Return width/height for '3:2', '16:9' or '1.5'; 0 when empty or invalid."""
    if isinstance(value, bool) or value in (None, ""):
        return 0.0
    text = str(value).strip()
    ratio = 0.0
    pair = re.fullmatch(r"(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)", text)
    if pair and float(pair.group(2)) > 0:
        ratio = float(pair.group(1)) / float(pair.group(2))
    elif re.fullmatch(r"\d+(?:\.\d+)?", text):
        ratio = float(text)
    return min(5.0, max(0.2, ratio)) if ratio > 0 else 0.0


def sentence_count(text) -> int:
    plain = re.sub(r"[*_`>#\[\]()]", "", str(text or ""))
    return len([part for part in re.split(r"(?<=[.!?…])\s+", plain.strip()) if re.search(r"\w", part)])


def _text(value, label, limit=2000, *, multiline=False):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise MediaError(f"{label} must be text.")
    if len(value) > limit:
        raise MediaError(f"{label} must be up to {limit} characters.")
    if not multiline and any(ord(character) < 32 for character in value):
        raise MediaError(f"{label} must be a single line.")
    return value


def _number(value, label, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        raise MediaError(f"{label} must be a number from {low} to {high}.")


def _ratio(value, label):
    if value in (None, ""):
        return
    if isinstance(value, bool) or not isinstance(value, (str, int, float)) or not parse_ratio(value):
        raise MediaError(f'{label} must look like 3:2, 16:9 or 1.5.')


def validate_page_fields(meta: dict) -> None:
    if meta.get("description") is not None:
        _text(meta["description"], "description", 600)
    if meta.get("menu_title") is not None:
        _text(meta["menu_title"], "menu_title", 80)
    if meta.get("weight") is not None and (isinstance(meta["weight"], bool) or not isinstance(meta["weight"], int)
                                           or not -1000 <= meta["weight"] <= 1000):
        raise MediaError("weight must be a whole number from -1000 to 1000.")
    if meta.get("hide_from_menu") is not None and not isinstance(meta["hide_from_menu"], bool):
        raise MediaError("hide_from_menu must be true or false.")
    settings = meta.get("media_page")
    if settings is None:
        return
    if not isinstance(settings, dict):
        raise MediaError("media_page must be a mapping.")
    if settings.get("width") is not None and settings["width"] not in WIDTHS:
        raise MediaError("media_page.width must be contained, wide or full.")
    _text(settings.get("credit_label"), "media_page.credit_label", 40)


def video_kind(source: str) -> str:
    """Classify a video source: 'youtube', 'file', or '' when unusable."""
    source = (source or "").strip()
    if youtube_id(source):
        return "youtube"
    return "file" if source.startswith(("/", "https://", "http://")) and not source.startswith("//") else ""


def validate_sections(meta: dict, *, asset_exists, video_exists) -> list[str]:
    """Raise MediaError for build-breaking mistakes; return editorial warnings."""
    validate_page_fields(meta)
    sections = meta.get("media_sections", [])
    if sections is None:
        sections = []
    if not isinstance(sections, list):
        raise MediaError("media_sections must be a list.")
    if len(sections) > MAX_SECTIONS:
        raise MediaError(f"A media page can have up to {MAX_SECTIONS} sections.")
    warnings = []
    seen = set()
    missing = {"alt": [], "credit": [], "text": [], "long": [], "poster": [], "video": []}
    for number, section in enumerate(sections, 1):
        where = f"Section {number}"
        if not isinstance(section, dict):
            raise MediaError(f"{where} must be a mapping.")
        title = _text(section.get("title"), f"{where} title", 160)
        where = f'Section {number}' + (f' "{title}"' if title else "")
        _text(section.get("subtitle"), f"{where} subtitle", 600, multiline=True)
        identifier = section.get("id")
        if identifier not in (None, ""):
            if not isinstance(identifier, str) or not re.fullmatch(r"[\w-]{1,80}", identifier):
                raise MediaError(f"{where}: id may only contain letters, numbers, - and _.")
            if identifier in seen:
                raise MediaError(f"{where}: id {identifier!r} is used by another section.")
            seen.add(identifier)
        layout = section.get("layout", "reel")
        if layout not in LAYOUTS:
            raise MediaError(f"{where}: layout must be reel, grid, rows or showcase.")
        if section.get("caption") is not None and section["caption"] not in CAPTIONS:
            raise MediaError(f"{where}: caption must be none, hover or below.")
        for key, (low, high) in RANGES.items():
            if section.get(key) is not None:
                _number(section[key], f"{where}: {key}", low, high)
        _ratio(section.get("ratio"), f"{where}: ratio")
        items = section.get("items", [])
        if items is None:
            items = []
        if not isinstance(items, list):
            raise MediaError(f"{where}: items must be a list.")
        if len(items) > MAX_ITEMS:
            raise MediaError(f"{where}: up to {MAX_ITEMS} items per section.")
        if not items:
            warnings.append(f"{where} has no items yet; it will not appear on the page.")
        if not title and items:
            warnings.append(f"{where} has no title; visitors will see the photos without a heading.")
        for index, item in enumerate(items, 1):
            label = f"{where}, item {index}"
            if not isinstance(item, dict):
                raise MediaError(f"{label} must be a mapping.")
            kind = item.get("type", "photo")
            if kind not in TYPES:
                raise MediaError(f"{label}: type must be photo or video.")
            for key, limit, multiline in (("title", 200, False), ("credit", 200, False), ("alt", 300, False),
                                          ("text", 4000, True)):
                _text(item.get(key), f"{label}: {key}", limit, multiline=multiline)
            _ratio(item.get("ratio"), f"{label}: ratio")
            tag = f"{title or number} #{index}"
            if kind == "photo":
                source = item.get("src")
                if not isinstance(source, str) or not source.strip():
                    raise MediaError(f"{label}: choose a photo.")
                asset_exists(source)
                if not (item.get("alt") or item.get("title")):
                    missing["alt"].append(tag)
            else:
                source = item.get("video") or item.get("src")
                if not isinstance(source, str) or not source.strip():
                    raise MediaError(f"{label}: add a YouTube link or a video file.")
                source = source.strip()
                if not video_kind(source):
                    raise MediaError(f"{label}: use a YouTube link, or a video file such as /videos/clip.mp4 or an https:// address.")
                if video_kind(source) == "file":
                    suffix = PurePosixPath(urlsplit(source).path).suffix.lower()
                    if suffix not in VIDEO_TYPES:
                        raise MediaError(f"{label}: video files must be MP4, WebM, OGV or MOV.")
                    if not item.get("poster"):
                        missing["poster"].append(tag)
                    if source.startswith("/") and not video_exists(source):
                        missing["video"].append(tag)
                poster = item.get("poster")
                if poster:
                    if not isinstance(poster, str):
                        raise MediaError(f"{label}: poster must be text.")
                    if poster.startswith("/images/"):
                        asset_exists(poster)
                    elif not poster.startswith(("https://", "http://")):
                        raise MediaError(f"{label}: poster must be a local /images/... file or an https:// address.")
            if not item.get("credit"):
                missing["credit"].append(tag)
            count = sentence_count(item.get("text"))
            if not count:
                missing["text"].append(tag)
            elif count > 4:
                missing["long"].append(tag)

    def summary(items):
        shown = ", ".join(items[:4]) + (f" and {len(items) - 4} more" if len(items) > 4 else "")
        return f"{len(items)} item{'s' if len(items) != 1 else ''} ({shown})"

    if missing["video"]:
        warnings.append(f"Video file not found in static/: {summary(missing['video'])}. Copy it to the site folder before publishing.")
    if missing["alt"]:
        warnings.append(f"No alt text or title for {summary(missing['alt'])}; screen readers cannot describe them.")
    if missing["text"]:
        warnings.append(f"No description text under {summary(missing['text'])}. Aim for 3–4 sentences.")
    if missing["long"]:
        warnings.append(f"Description longer than 4 sentences: {summary(missing['long'])}.")
    if missing["credit"]:
        warnings.append(f"No photographer/author credit for {summary(missing['credit'])}.")
    if missing["poster"]:
        warnings.append(f"Video files without a poster image: {summary(missing['poster'])}. A cover image makes the gallery look finished.")
    return warnings
