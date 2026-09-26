"""
Local companion server for hero_focus_picker.html - lets the picker read and
write the REAL site config (data/hero_images.yaml) and the REAL converted
photos (static/images/hero/), instead of only generating a YAML snippet to
copy-paste by hand.

Run via run_hero_picker.bat, or `py hero_config_server.py` / `python
hero_config_server.py`. It starts a localhost-only web server, serves
hero_focus_picker.html from it, and opens it in your default browser.
hero_focus_picker.html still works if opened directly as a file:// page (with
no server running) - it just falls back to the old offline/copy-paste mode.

API (all localhost-only, all paths relative to the repo root):
  GET    /api/config          -> {header, images} parsed from data/hero_images.yaml
  PUT    /api/config          -> body {images: [...]}, rewrites data/hero_images.yaml
  POST   /api/upload          -> body = raw image bytes, header X-Filename = original
                                  filename; converts to .webp in static/images/hero/,
                                  appends a default config entry, returns {header, images}
  DELETE /api/image?path=...  -> removes the config entry for that path and deletes the
                                  matching file under static/images/hero/, returns
                                  {header, images}
"""

import json
import mimetypes
import re
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import yaml

import site_image_converter

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
HERO_YAML_PATH = REPO_ROOT / "data" / "hero_images.yaml"
HERO_IMAGES_DIR = REPO_ROOT / "static" / "images" / "hero"
PICKER_HTML_PATH = SCRIPT_DIR / "hero_focus_picker.html"

DEFAULT_PORT = 8877

# Kept in sync with hero_focus_picker.html's/data/hero_images.yaml's own documented
# defaults - fields equal to these are omitted from the saved YAML, exactly like
# the picker's own offline-mode YAML preview already does.
DEFAULT_ZOOM = 1.35
DEFAULT_FOCUS = "50% 50%"
DEFAULT_TYPE = "pan"
DEFAULT_DIRECTION = "right"
DEFAULT_DURATION = 12
DEFAULT_AMOUNT_BY_TYPE = {"pan": 6, "zoom-in": 0.15, "zoom-out": 0.15, "tilt": 2, "none": 0}


def read_header_comment():
    """Everything before the first non-comment/non-blank line (the "images:" line)."""
    if not HERO_YAML_PATH.exists():
        return ""
    lines = HERO_YAML_PATH.read_text(encoding="utf-8").splitlines(keepends=True)
    header_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped == "" or stripped.startswith("#"):
            header_lines.append(line)
        else:
            break
    return "".join(header_lines)


def load_config():
    if not HERO_YAML_PATH.exists():
        return {"header": "", "images": []}
    data = yaml.safe_load(HERO_YAML_PATH.read_text(encoding="utf-8")) or {}
    return {"header": read_header_comment(), "images": data.get("images", [])}


def _quoted_str_representer(dumper, value):
    return dumper.represent_scalar("tag:yaml.org,2002:str", value, style='"')


class _QuotedStrDumper(yaml.SafeDumper):
    pass


_QuotedStrDumper.add_representer(str, _quoted_str_representer)


def save_config(images):
    header = read_header_comment()
    body = yaml.dump(
        {"images": images},
        Dumper=_QuotedStrDumper,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
    )
    HERO_YAML_PATH.write_text(header + body, encoding="utf-8")


def _diff_tier(tier_val, base_start, base_animation):
    """Keeps only tablet/mobile fields that actually differ from the entry's own
    base (desktop) values - mirrors hero_focus_picker.html's own diffTierLines()
    so an enabled-but-unchanged override doesn't bloat the saved file."""
    if not tier_val or not tier_val.get("enabled"):
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
    """Drops fields that equal the documented defaults, keeping the file minimal."""
    out = {"path": entry["path"]}
    if entry.get("alt"):
        out["alt"] = entry["alt"]
    if entry.get("mirror"):
        out["mirror"] = entry["mirror"]
    if entry.get("hide_below"):
        out["hide_below"] = entry["hide_below"]

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


def unique_path_for(stem):
    """Avoids clobbering an existing hero image file when adding a new one."""
    candidate = f"{stem}.webp"
    n = 2
    while (HERO_IMAGES_DIR / candidate).exists():
        candidate = f"{stem}-{n}.webp"
        n += 1
    return candidate


SAFE_FILENAME_STEM = re.compile(r"[^a-zA-Z0-9_-]+")


def safe_stem(filename):
    stem = Path(filename).stem.strip().lower().replace(" ", "-")
    stem = SAFE_FILENAME_STEM.sub("-", stem).strip("-")
    return stem or "hero-photo"


class Handler(BaseHTTPRequestHandler):
    server_version = "FTSKHeroPicker/1.0"

    def log_message(self, format, *args):  # noqa: A002 - matches base class signature
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status, message):
        self._send_json(status, {"error": message})

    def _send_file(self, path, content_type=None):
        if not path.is_file():
            self._send_error_json(404, f"Not found: {path.name}")
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type or mimetypes.guess_type(str(path))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # ---- routing ----

    def do_GET(self):
        parsed = urlparse(self.path)
        route = unquote(parsed.path)

        if route in ("/", "/hero_focus_picker.html"):
            self._send_file(PICKER_HTML_PATH, "text/html; charset=utf-8")
        elif route.startswith("/images/hero/"):
            filename = route[len("/images/hero/"):]
            if "/" in filename or ".." in filename:
                self._send_error_json(400, "Invalid path")
                return
            self._send_file(HERO_IMAGES_DIR / filename)
        elif route.startswith("/static/"):
            # Serves the site's own static/ folder verbatim - only used by the
            # picker's device-frame mockup (decorative cave-silhouette motif).
            relative = route[len("/static/"):]
            if ".." in relative:
                self._send_error_json(400, "Invalid path")
                return
            self._send_file(REPO_ROOT / "static" / relative)
        elif route == "/api/config":
            self._send_json(200, load_config())
        else:
            self._send_error_json(404, "Not found")

    def do_PUT(self):
        if urlparse(self.path).path != "/api/config":
            self._send_error_json(404, "Not found")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8-sig"))
            images = [prune_defaults(entry) for entry in payload["images"]]
            save_config(images)
            self._send_json(200, load_config())
        except Exception as exc:  # noqa: BLE001 - report back to the picker UI
            self._send_error_json(400, str(exc))

    def do_POST(self):
        if urlparse(self.path).path != "/api/upload":
            self._send_error_json(404, "Not found")
            return
        try:
            original_name = unquote(self.headers.get("X-Filename", "photo.jpg"))
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                raise ValueError("Empty upload")

            raw_bytes = self.rfile.read(length)
            HERO_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

            tmp_path = HERO_IMAGES_DIR / f"_upload_tmp_{original_name}"
            tmp_path.write_bytes(raw_bytes)
            try:
                stem = safe_stem(original_name)
                out_name = unique_path_for(stem)
                result = site_image_converter.process_image(
                    tmp_path, HERO_IMAGES_DIR, max_width=1600, max_height=1600, quality=82, log=lambda *_: None
                )
                if not result:
                    raise ValueError("Could not convert this image (unsupported/corrupt file?)")
                out_path, width, height = result
                final_path = HERO_IMAGES_DIR / out_name
                out_path.replace(final_path)
            finally:
                tmp_path.unlink(missing_ok=True)

            orientation_direction = "down" if height > width else "right"
            config = load_config()
            new_entry = {
                "path": f"/images/hero/{out_name}",
                "alt": "",
                "animation": {"direction": orientation_direction},
            }
            config["images"].append(new_entry)
            save_config([prune_defaults(e) for e in config["images"]])
            response = load_config()
            response["new_path"] = new_entry["path"]
            self._send_json(200, response)
        except Exception as exc:  # noqa: BLE001 - report back to the picker UI
            self._send_error_json(400, str(exc))

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/image":
            self._send_error_json(404, "Not found")
            return
        try:
            query = parse_qs(parsed.query)
            target_path = (query.get("path") or [""])[0]
            if not target_path.startswith("/images/hero/") or ".." in target_path:
                raise ValueError("Invalid path")

            config = load_config()
            remaining = [e for e in config["images"] if e.get("path") != target_path]
            if len(remaining) == len(config["images"]):
                raise ValueError("No such image in data/hero_images.yaml")
            save_config([prune_defaults(e) for e in remaining])

            filename = target_path[len("/images/hero/"):]
            file_path = HERO_IMAGES_DIR / filename
            if file_path.is_file():
                file_path.unlink()

            self._send_json(200, load_config())
        except Exception as exc:  # noqa: BLE001 - report back to the picker UI
            self._send_error_json(400, str(exc))


def find_free_port(start_port):
    import socket

    for port in range(start_port, start_port + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("No free port found")


def main():
    if not HERO_YAML_PATH.exists():
        print(f"ERROR: {HERO_YAML_PATH} not found - run this from a checkout of ftsk_site.")
        return

    port = find_free_port(DEFAULT_PORT)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"

    print("=" * 60)
    print(" FTSK Hero Focus Picker - local server")
    print("=" * 60)
    print(f"\nOpen (or leave open): {url}")
    print("This server only listens on your own machine (127.0.0.1) and only")
    print("edits files inside this repository. Press Ctrl+C to stop.\n")

    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
