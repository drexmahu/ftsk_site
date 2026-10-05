"""Local browser workspace for existing FTSK site tools (not a post editor)."""

import argparse
from contextlib import nullcontext
import io
import json
import logging
import mimetypes
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import warnings
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from urllib.request import urlopen
from urllib.error import URLError

from PIL import Image, ImageOps, UnidentifiedImageError
import yaml

import social_preview
from content_workbench import ContentService, ContentError, ConflictError
from member_workbench import MemberService
from membership_image_converter import membership_image_converter as portraits
from site_image_converter import hero_config_server as hero
from site_image_converter import site_image_converter as photos

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent

LOGGER = logging.getLogger("site_workbench")
MAX_UPLOAD = 30 * 1024 * 1024
MAX_PIXELS = 25_000_000
DEFAULT_PORT = 8879


class ToolError(ValueError):
    pass


def integer(value: object, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ToolError(f"{label} must be an integer between {minimum} and {maximum}.")
    return value


def safe_path(root: Path, relative: str) -> Path:
    if (not relative or "\\" in relative or ":" in relative or Path(relative).is_absolute()
            or any(part in ("", ".", "..") for part in relative.split("/"))):
        raise ToolError("Use a relative path without traversal or backslashes.")
    path = root / relative
    if not path.resolve().is_relative_to(root.resolve()):
        raise ToolError("Path is outside the permitted folder.")
    for item in (path, *path.parents):
        attributes = getattr(item.lstat(), "st_file_attributes", 0) if item.exists() else 0
        if item.is_symlink() or attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ToolError("Linked folders/files are not supported.")
        if item == root:
            break
    return path


class Workbench:
    def __init__(self, root: Path = REPO_ROOT) -> None:
        self.root = root.resolve()
        self.token = secrets.token_urlsafe(32)
        self.temporary = tempfile.TemporaryDirectory(prefix="ftsk-workbench-")
        self.scratch = Path(self.temporary.name)
        self.uploads: dict[str, dict] = {}
        self.lock = threading.RLock()
        self.job: dict = {"state": "idle", "action": "", "log": "", "exit_code": None}
        self.job_thread: threading.Thread | None = None
        self.active_command: subprocess.Popen | None = None
        self.preview: subprocess.Popen | None = None
        self.preview_log = ""
        self.preview_port = 1313
        self.closed = False
        self.content = ContentService(self, safe_path)
        self.members = MemberService(self, safe_path)
        self.render_server: WorkbenchServer | None = None
        self.render_thread: threading.Thread | None = None
        self.render_origin = ""
        self.workbench_port = 0

    def hugo_executable(self) -> str:
        version = (self.root / ".hugo-version").read_text(encoding="utf-8").strip()
        pinned = self.root / ".tools" / "hugo" / version / "hugo.exe"
        executable = str(pinned) if pinned.is_file() else shutil.which("hugo")
        if not executable:
            raise ToolError("Hugo not found. Run scripts/setup-dev-env.ps1.")
        return executable

    def stage(self, filename: str, raw: bytes) -> dict:
        if not raw or len(raw) > MAX_UPLOAD:
            raise ToolError("Choose a non-empty image up to 30 MiB.")
        if Path(filename).suffix.lower() not in photos.SUPPORTED_EXTENSIONS:
            raise ToolError("Supported uploads: JPG, PNG and WebP.")
        with self.lock:
            if len(self.uploads) >= 100:
                raise ToolError("Upload queue is full. Remove some queued photos first.")
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(io.BytesIO(raw)) as source:
                        if source.width * source.height > MAX_PIXELS:
                            raise ToolError("Photo exceeds 25 million pixels. Resize the original first.")
                        image = ImageOps.exif_transpose(source).convert("RGB")
                        image.load()
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError,
                    Image.DecompressionBombWarning) as exc:
                raise ToolError(f"Cannot decode image: {exc}") from exc
            identifier = secrets.token_hex(12)
            folder = self.scratch / identifier
            folder.mkdir()
            name = hero.safe_stem(filename)
            source_path = folder / f"{name}.png"
            image.save(source_path, "PNG")
            preview = image.copy()
            preview.thumbnail((1400, 1400), Image.Resampling.LANCZOS)
            preview.save(folder / "preview.jpg", "JPEG", quality=90)
            entry = {"id": identifier, "name": filename, "stem": name,
                     "width": image.width, "height": image.height}
            self.uploads[identifier] = entry
            return entry

    def upload(self, identifier: str) -> dict:
        if identifier not in self.uploads:
            raise ToolError("Photo is no longer queued. Upload it again.")
        return self.uploads[identifier]

    def remove_upload(self, identifier: str) -> None:
        with self.lock:
            self.upload(identifier)
            folder = self.scratch / identifier
            for path in folder.iterdir():
                path.unlink()
            folder.rmdir()
            del self.uploads[identifier]

    def destination(self, folder: str) -> Path:
        if not re.fullmatch(r"[\w-]+(?:/[\w-]+)*", folder):
            raise ToolError("Folder must use letters, numbers, hyphens or underscores (for example turak/2026-trip).")
        path = safe_path(self.root / "static" / "images", folder)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def convert(self, payload: dict, portrait: bool = False) -> dict:
        with self.lock:
            entry = self.upload(str(payload.get("id", "")))
            folder = payload.get("folder", "members" if portrait else "hero")
            if not isinstance(folder, str):
                raise ToolError("Output folder must be text.")
            target = self.destination(folder)
            quality = integer(payload.get("quality", 85 if portrait else 82), "Quality", 1, 100)
            width = integer(payload.get("width", 1400 if portrait else 1600), "Maximum width", 64, 6000)
            height = integer(payload.get("height", 1400 if portrait else 1600), "Maximum height", 64, 6000)
            stem = payload.get("name") or entry["stem"]
            if not isinstance(stem, str) or not re.fullmatch(r"[\w-]+", stem):
                raise ToolError("Output filename must be a stem using letters, numbers, hyphens or underscores.")
            base = stem
            suffixes = ("_thumb.webp", "_full.webp") if portrait else (".webp",)
            number = 1
            while any((target / (base + suffix)).exists() for suffix in suffixes):
                number += 1
                base = f"{stem}-{number}"
            workspace = self.scratch / entry["id"]
            source = workspace / f'{entry["stem"]}.png'
            logs: list[str] = []
            with tempfile.TemporaryDirectory(dir=self.scratch, prefix="convert-") as staging:
                output = Path(staging)
                if portrait:
                    thumb = integer(payload.get("thumb", 400), "Thumbnail size", 64, 1200)
                    box = payload.get("crop")
                    if not isinstance(box, list) or len(box) != 4:
                        raise ToolError("Confirm a manual square face crop before converting.")
                    left, top, right, bottom = [
                        integer(value, "Crop coordinate", 0, max(entry["width"], entry["height"]))
                        for value in box
                    ]
                    if not (0 <= left < right <= entry["width"] and 0 <= top < bottom <= entry["height"]
                            and right - left == bottom - top):
                        raise ToolError("Crop must be a square inside the EXIF-corrected image.")
                    result = portraits.process_image(
                        source, output, thumb, width, height, quality, log=logs.append,
                        manual_crop=lambda _path, _image: (left, top, right, bottom),
                    )
                else:
                    result = photos.process_image(source, output, width, height, quality, log=logs.append)
                if not result:
                    raise ToolError("\n".join(logs) or "Image conversion failed.")
                written: list[Path] = []
                try:
                    for suffix in suffixes:
                        destination = safe_path(self.root / "static" / "images", f"{folder}/{base}{suffix}")
                        with destination.open("xb") as stream:
                            written.append(destination)
                            stream.write((output / (entry["stem"] + suffix)).read_bytes())
                except OSError:
                    for path in written:
                        path.unlink(missing_ok=True)
                    raise
            files = []
            for path in written:
                with Image.open(path) as image:
                    files.append({"url": "/images/" + path.relative_to(self.root / "static" / "images").as_posix(),
                                  "width": image.width, "height": image.height, "bytes": path.stat().st_size})
            return {"files": files, "log": "\n".join(logs)}

    def load_hero(self) -> dict:
        path = self.root / "data" / "hero_images.yaml"
        text = path.read_text(encoding="utf-8")
        header = []
        for line in text.splitlines(keepends=True):
            if line.strip() and not line.lstrip().startswith("#"):
                break
            header.append(line)
        data = yaml.safe_load(text)
        if not isinstance(data, dict) or not isinstance(data.get("images"), list):
            raise ToolError("data/hero_images.yaml must contain an images list.")
        return {"header": "".join(header), "images": data["images"]}

    def save_hero(self, entries: list) -> dict:
        if not isinstance(entries, list) or not entries:
            raise ToolError("Keep at least one hero photo.")
        images = []
        seen = set()
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
                raise ToolError("Each hero entry needs a local image path.")
            path = entry["path"]
            if not path.startswith("/images/hero/"):
                raise ToolError("Hero photos must be under /images/hero/.")
            file = safe_path(self.root / "static", path.lstrip("/"))
            if not file.is_file():
                raise ToolError(f"Hero image is missing: {path}")
            if path in seen:
                raise ToolError(f"Duplicate hero photo: {path}")
            seen.add(path)
            json.dumps(entry, allow_nan=False)
            for key in ("start", "animation", "tablet", "mobile", "poi"):
                if key in entry and not isinstance(entry[key], dict):
                    raise ToolError(f"Hero {key} must be an object.")
            cleaned = hero.prune_defaults(entry)
            # Reject non-finite JSON numbers before serializing YAML.
            json.dumps(cleaned, allow_nan=False)
            images.append(cleaned)
        config = self.load_hero()
        body = config["header"] + yaml.dump(
            {"images": images}, Dumper=hero._QuotedStrDumper, allow_unicode=True,
            default_flow_style=False, sort_keys=False,
        )
        destination = safe_path(self.root / "data", "hero_images.yaml")
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent,
                                         prefix=".hero-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(body)
        try:
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        return self.load_hero()

    def add_hero(self, filename: str, raw: bytes) -> dict:
        with self.lock:
            entry = self.stage(filename, raw)
            try:
                result = self.convert({"id": entry["id"], "folder": "hero"})
                path = result["files"][0]["url"]
                try:
                    config = self.load_hero()
                    config["images"].append({"path": path, "alt": "",
                                             "animation": {"direction": "down" if entry["height"] > entry["width"] else "right"}})
                    response = self.save_hero(config["images"])
                except (ValueError, TypeError, KeyError, OSError, yaml.YAMLError):
                    safe_path(self.root / "static", path.lstrip("/")).unlink()
                    raise
            finally:
                self.remove_upload(entry["id"])
            response["new_path"] = path
            return response

    def delete_hero(self, path: str) -> dict:
        with self.lock:
            config = self.load_hero()
            entries = [entry for entry in config["images"] if entry["path"] != path]
            if len(entries) == len(config["images"]):
                raise ToolError("No such photo in the hero slideshow.")
            # Remove from the slideshow only; existing posts/social cards may use this file.
            return self.save_hero(entries)

    def preview_status(self) -> dict:
        url = f"http://127.0.0.1:{self.preview_port}/"
        responsive = False
        try:
            with urlopen(url, timeout=0.5) as response:
                responsive = response.status == 200
        except (URLError, OSError):
            pass
        owned = self.preview is not None and self.preview.poll() is None
        return {"url": url, "responsive": responsive, "owned": owned,
                "state": "running" if responsive else "starting" if owned else "stopped",
                "log": self.preview_log}

    def start_preview(self) -> dict:
        with self.lock:
            if self.closed:
                raise ToolError("Workbench is shutting down.")
            status = self.preview_status()
            if status["responsive"] or status["owned"]:
                return status
            if self.job["state"] == "running":
                raise ToolError("Wait for the current build/check before starting preview.")
            executable = self.hugo_executable()
            self.preview_log = ""
            self.preview = subprocess.Popen(
                [executable, "server", "--bind", "127.0.0.1", "--port", str(self.preview_port),
                 "--baseURL", status["url"], "--renderToMemory", "--disableFastRender",
                 "--buildDrafts", "--buildFuture"],
                cwd=self.root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
            )
            process = self.preview

            def read_log() -> None:
                assert process.stdout is not None
                for line in process.stdout:
                    with self.lock:
                        self.preview_log = (self.preview_log + line)[-30_000:]
                process.stdout.close()

            threading.Thread(target=read_log, daemon=True).start()
            return {"state": "starting", "owned": True, "url": status["url"], "responsive": False, "log": ""}

    def stop_preview(self) -> None:
        with self.lock:
            process = self.preview
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        with self.lock:
            self.preview = None

    def run_command(self, arguments: list[str], label: str, environment: dict | None = None,
                    capture: Path | None = None) -> None:
        with self.lock:
            if self.closed:
                raise ToolError("Workbench is shutting down.")
            self.job["log"] = (self.job["log"] + f"\n--- {label} ---\n")[-60_000:]
            process = subprocess.Popen(arguments, cwd=self.root, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                                       env={**os.environ, **(environment or {})})
            self.active_command = process
        assert process.stdout is not None
        timed_out = threading.Event()

        def expire() -> None:
            if process.poll() is None:
                timed_out.set()
                process.kill()

        timer = threading.Timer(180, expire)
        timer.start()
        try:
            with capture.open("w", encoding="utf-8") if capture else nullcontext(None) as sink:
                for line in process.stdout:
                    with self.lock:
                        self.job["log"] = (self.job["log"] + line)[-60_000:]
                    if sink:
                        sink.write(line)
            code = process.wait()
            if timed_out.is_set():
                raise ToolError(f"{label} exceeded 180 seconds and was stopped.")
            if code:
                raise ToolError(f"{label} failed (exit {code}). See the log.")
        finally:
            timer.cancel()
            process.stdout.close()
            with self.lock:
                if self.active_command is process:
                    self.active_command = None

    def start_job(self, action: str) -> dict:
        if action not in ("build", "links", "members", "regressions"):
            raise ToolError("Unknown build/check action.")
        with self.lock:
            if self.closed or self.job["state"] == "running":
                raise ToolError("A check is already running or the workspace is shutting down.")
            self.job = {"state": "running", "action": action, "log": "", "exit_code": None}
            self.job_thread = threading.Thread(target=self.execute_job, args=(action,), daemon=True)
            self.job_thread.start()
            return dict(self.job)

    def start_content_preview(self, payload: dict, origin: str) -> dict:
        with self.lock:
            if self.closed or self.job["state"] == "running":
                raise ToolError("Wait for the current build/check to finish.")
            _, info = self.content.prepare_preview(payload, origin)
            self.content.preview = {"state": "building", "id": info["identifier"], "url": "", "path": payload["path"],
                                    "revision": "", "warnings": info["page"]["warnings"]}
            self.job = {"state": "running", "action": "content-preview", "preview_id": info["identifier"],
                        "log": "", "exit_code": None}
            self.job_thread = threading.Thread(target=self.execute_job, args=("content-preview", info), daemon=True)
            self.job_thread.start()
            return dict(self.job)

    def execute_job(self, action: str, preview_info: dict | None = None) -> None:
        try:
            if action == "content-preview" and preview_info:
                self.content.build_preview(preview_info)
            elif action in ("build", "links"):
                with tempfile.TemporaryDirectory(prefix="ftsk-workbench-build-") as destination:
                    self.run_command(
                        [self.hugo_executable(), "--destination", destination,
                         "--baseURL", "https://www.ftsk.hu/", "--buildDrafts", "--buildFuture"],
                        "Build (temporary output; drafts and future posts included)",
                    )
                    if action == "links":
                        self.run_command(
                            [sys.executable, "scripts/verify_site_links.py", "--root", destination,
                             "--base-url", "https://www.ftsk.hu/"], "Internal links and assets",
                        )
            elif action == "members":
                self.run_command([sys.executable, "scripts/verify_members.py"], "Members and participants")
            else:
                node = shutil.which("node")
                if not node:
                    raise ToolError("Node.js not found. Run the environment installer.")
                self.run_command([node, "scripts/site_image_converter/test_hero_framing.js"], "Hero framing")
                self.run_command([node, "scripts/test_404_navigation.js"], "404 navigation")
                self.run_command([sys.executable, "-m", "unittest", "discover", "-s", "scripts",
                                  "-p", "test_social*.py"], "Social previews and image selection")
                self.run_command([sys.executable, "-m", "unittest", "discover", "-s",
                                  "scripts/membership_image_converter", "-p", "test_manual_crop.py"],
                                 "Manual portrait crop")
                self.run_command([sys.executable, "-m", "unittest", "discover", "-s", "scripts",
                                  "-p", "test_*workbench.py"], "Site, content and member workbench")
            with self.lock:
                self.job.update(state="passed", exit_code=0)
        except (ToolError, ContentError, OSError, subprocess.SubprocessError) as exc:
            LOGGER.exception("Build/check failed")
            with self.lock:
                self.job["log"] = (self.job["log"] + f"\nERROR: {exc}\n")[-60_000:]
                self.job.update(state="failed", exit_code=1)
                if action == "content-preview":
                    self.content.preview.update(state="failed", url="", error=str(exc))
                    if preview_info:
                        shutil.rmtree(preview_info["directory"])

    def close(self) -> None:
        with self.lock:
            self.closed = True
            process = self.active_command
        self.stop_preview()
        if self.render_server:
            self.render_server.shutdown()
            self.render_server.server_close()
            if self.render_thread:
                self.render_thread.join(timeout=5)
            self.render_server = None
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if self.job_thread:
            self.job_thread.join(timeout=10)
        self.temporary.cleanup()


class WorkbenchServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], app: Workbench, render_only: bool = False) -> None:
        self.app = app
        self.render_only = render_only
        super().__init__(address, Handler)
        if not render_only:
            app.workbench_port = self.server_port
            app.render_server = WorkbenchServer(("127.0.0.1", 0), app, render_only=True)
            app.render_origin = f"http://127.0.0.1:{app.render_server.server_port}"
            app.render_thread = threading.Thread(target=app.render_server.serve_forever, daemon=True)
            app.render_thread.start()


class Handler(BaseHTTPRequestHandler):
    server: WorkbenchServer

    def reject(self, message: str, mutation: bool) -> bool:
        length = self.headers.get("Content-Length", "")
        if mutation and length.isdigit() and 0 < int(length) <= MAX_UPLOAD:
            self.connection.settimeout(2)
            try:
                self.rfile.read(int(length))
            except OSError as exc:
                LOGGER.warning("Rejected request body interrupted: %s", exc)
        self.json(403, {"error": message})
        return False

    def guard(self, mutation: bool = False) -> bool:
        port = self.server.server_port
        hosts = (f"127.0.0.1:{port}", f"localhost:{port}")
        if self.headers.get("Host") not in hosts:
            return self.reject("Use the localhost workbench address.", mutation)
        origin = self.headers.get("Origin")
        if origin and origin not in tuple(f"http://{host}" for host in hosts):
            return self.reject("Cross-origin requests are not allowed.", mutation)
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            return self.reject("Cross-site requests are not allowed.", mutation)
        if mutation and not secrets.compare_digest(self.headers.get("X-Workbench-Token", ""), self.server.app.token):
            return self.reject("Missing workbench request token. Reload this page.", mutation)
        return True

    def send(self, status: int, body: bytes, mime: str, download: str = "", rendered: bool = False) -> None:
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if rendered:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
                         ("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
                          if rendered else "style-src 'self' 'unsafe-inline'; ") +
                         "img-src 'self' data: blob:; "
                         f"frame-src 'self' {self.server.app.render_origin}; connect-src 'self'; object-src 'none'; "
                         "base-uri 'none'; frame-ancestors 'self'" +
                         (f" http://127.0.0.1:{self.server.app.workbench_port} http://localhost:{self.server.app.workbench_port}"
                          if rendered else ""))
        if download:
            self.send_header("Content-Disposition", f'attachment; filename="{download}"')
        self.end_headers()
        self.wfile.write(body)

    def json(self, status: int, value: object) -> None:
        self.send(status, json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                  "application/json; charset=utf-8")

    def body(self, limit: int = MAX_UPLOAD) -> bytes:
        length = self.headers.get("Content-Length", "")
        if not length.isdigit() or not 0 < int(length) <= limit:
            raise ToolError(f"Request must have a Content-Length between 1 and {limit} bytes.")
        self.connection.settimeout(30)
        raw = self.rfile.read(int(length))
        if len(raw) != int(length):
            raise ToolError("Upload was interrupted.")
        return raw

    def payload(self) -> dict:
        value = json.loads(self.body(4 * 1024 * 1024))
        if not isinstance(value, dict):
            raise ToolError("Expected a JSON object.")
        return value

    def file(self, path: Path, rendered: bool = False) -> None:
        if not path.is_file():
            self.json(404, {"error": "File not found."})
            return
        self.send(200, path.read_bytes(), mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                  rendered=rendered)

    def do_GET(self) -> None:
        if not self.guard():
            return
        try:
            self.get()
        except (ToolError, ValueError, TypeError, OSError, yaml.YAMLError, social_preview.PreviewError) as exc:
            LOGGER.warning("GET %s: %s", self.path, exc)
            self.json(400, {"error": str(exc)})

    def get(self) -> None:
        app = self.server.app
        parsed = urlsplit(self.path)
        route = unquote(parsed.path)
        if self.server.render_only:
            if route.startswith("/render/"):
                self.file(app.content.rendered_file(route), rendered=True)
            else:
                self.json(404, {"error": "The preview server only serves isolated rendered files."})
        elif route == "/":
            self.file(SCRIPT_DIR / "workbench" / "index.html")
        elif route.startswith("/workbench/"):
            self.file(safe_path(SCRIPT_DIR / "workbench", route[len("/workbench/"):]))
        elif route == "/api/workbench/status":
            with app.lock:
                self.json(200, {"token": app.token, "preview": app.preview_status(), "job": dict(app.job),
                                "uploads": list(app.uploads.values()), "python": sys.executable,
                                "contentPreview": dict(app.content.preview)})
        elif route == "/api/workbench/content/catalog":
            with app.lock:
                self.json(200, app.content.catalog())
        elif route == "/api/workbench/members":
            with app.lock:
                self.json(200, app.members.catalog())
        elif route == "/api/workbench/content/page":
            with app.lock:
                self.json(200, app.content.read(parse_qs(parsed.query).get("path", [""])[0]))
        elif route == "/api/workbench/content/preview":
            with app.lock:
                self.json(200, {**app.content.preview, "job": dict(app.job)})
        elif route == "/api/workbench/assets":
            with app.lock:
                self.json(200, app.content.assets(parse_qs(parsed.query).get("folder", [""])[0]))
        elif route == "/api/workbench/content/help":
            document = parse_qs(parsed.query).get("document", ["CONTENT_GUIDE.md"])[0]
            if document not in ("CONTENT_GUIDE.md", "BLOGPOST_TEMPLATES.md", "TANFOLYAM_GUIDE.md"):
                raise ToolError("Unknown content guide.")
            self.json(200, {"name": document, "source": (app.root / "docs" / document).read_text(encoding="utf-8")})
        elif route.startswith("/api/workbench/uploads/"):
            identifier = route.split("/")[-1]
            with app.lock:
                app.upload(identifier)
                self.file(app.scratch / identifier / "preview.jpg")
        elif route == "/api/config":
            with app.lock:
                self.json(200, app.load_hero())
        elif route == "/hero/hero_focus_picker.html":
            page = (SCRIPT_DIR / "site_image_converter" / "hero_focus_picker.html").read_text(encoding="utf-8")
            page = page.replace("<head>", '<head><script src="/workbench/hero-bridge.js"></script>', 1)
            self.send(200, page.encode("utf-8"), "text/html; charset=utf-8")
        elif route == "/hero/hero_poi_editor.js":
            self.file(SCRIPT_DIR / "site_image_converter" / "hero_poi_editor.js")
        elif route.startswith("/static/"):
            self.file(safe_path(app.root / "static", route[len("/static/"):]))
        elif route.startswith("/images/"):
            self.file(safe_path(app.root / "static", route.lstrip("/")))
        elif route.startswith("/pdfs/"):
            self.file(safe_path(app.root / "static", route.lstrip("/")))
        elif route == "/social":
            query = parse_qs(parsed.query)
            url = query.get("url", [""])[0]
            if query.get("download") == ["1"]:
                if not url:
                    raise ToolError("Enter a page URL before exporting.")
                page = social_preview.render_page(url, social_preview.inspect_page(url))
                self.send(200, page.encode("utf-8"), "text/html; charset=utf-8", "ftsk-social-preview.html")
            else:
                try:
                    preview = social_preview.inspect_page(url) if url else None
                    page = social_preview.render_page(url, preview)
                except social_preview.PreviewError as exc:
                    LOGGER.warning("Social preview: %s", exc)
                    page = social_preview.render_page(url, error=str(exc))
                page = page.replace('action="/"', 'action="/social"')
                self.send(200, page.encode("utf-8"), "text/html; charset=utf-8")
        else:
            self.json(404, {"error": "Unknown route."})

    def do_POST(self) -> None:
        self.mutate("POST")

    def do_PUT(self) -> None:
        self.mutate("PUT")

    def do_DELETE(self) -> None:
        self.mutate("DELETE")

    def mutate(self, method: str) -> None:
        if self.server.render_only:
            self.reject("The isolated preview server is read-only.", mutation=True)
            return
        if not self.guard(mutation=True):
            return
        try:
            app = self.server.app
            parsed = urlsplit(self.path)
            route = parsed.path
            if method == "POST" and route in ("/api/workbench/uploads", "/api/upload"):
                filename = unquote(self.headers.get("X-Filename", "photo.jpg"))
                raw = self.body()
                result = app.stage(filename, raw) if route.endswith("uploads") else app.add_hero(filename, raw)
            elif method == "POST" and route in ("/api/workbench/convert", "/api/workbench/portrait"):
                result = app.convert(self.payload(), portrait=route.endswith("portrait"))
            elif method == "POST" and route == "/api/workbench/members/save":
                result = app.members.save(self.payload())
            elif method == "POST" and route == "/api/workbench/members/delete":
                result = app.members.delete(self.payload())
            elif method == "POST" and route == "/api/workbench/preview/start":
                result = app.start_preview()
            elif method == "POST" and route == "/api/workbench/preview/stop":
                app.stop_preview()
                result = app.preview_status()
            elif method == "POST" and route == "/api/workbench/content/template":
                payload = self.payload()
                result = app.content.template(payload.get("template", ""), payload.get("path", ""))
            elif method == "POST" and route == "/api/workbench/content/validate":
                payload = self.payload()
                result = app.content.validate(payload.get("path", ""), payload.get("source"), payload.get("changes"))
            elif method == "POST" and route == "/api/workbench/content/compose":
                payload = self.payload()
                from content_workbench import patched_source, parse_frontmatter, split_source
                source = patched_source(payload.get("source"), payload.get("changes", {}))
                frontmatter, body, newline = split_source(source)
                result = {"source": source, "frontmatter": frontmatter, "body": body, "newline": newline,
                          "metadata": parse_frontmatter(frontmatter)}
            elif method == "POST" and route == "/api/workbench/content/pdf":
                filename = unquote(self.headers.get("X-Filename", "document.pdf"))
                folder = unquote(self.headers.get("X-Folder", ""))
                with app.lock:
                    result = app.content.upload_pdf(filename, folder, self.body())
            elif method == "POST" and route == "/api/workbench/content/preview":
                result = app.start_content_preview(self.payload(), app.render_origin)
            elif method == "POST" and route == "/api/workbench/content/save":
                with app.lock:
                    result = app.content.save(self.payload())
            elif method == "POST" and route == "/api/workbench/content/delete-plan":
                payload = self.payload()
                with app.lock:
                    result = app.content.deletion_plan(payload.get("path", ""), payload.get("revision", ""))
            elif method == "POST" and route == "/api/workbench/content/delete":
                with app.lock:
                    result = app.content.delete(self.payload())
            elif method == "POST" and route == "/api/workbench/jobs":
                result = app.start_job(str(self.payload().get("action", "")))
            elif method == "PUT" and route == "/api/config":
                payload = self.payload()
                with app.lock:
                    result = app.save_hero(payload.get("images"))
            elif method == "DELETE" and route == "/api/image":
                path = parse_qs(parsed.query).get("path", [""])[0]
                result = app.delete_hero(path)
            elif method == "DELETE" and route.startswith("/api/workbench/uploads/"):
                app.remove_upload(route.split("/")[-1])
                result = {"removed": True}
            else:
                self.json(404, {"error": "Unknown action."})
                return
            self.json(200, result)
        except ConflictError as exc:
            LOGGER.warning("%s %s: %s", method, self.path, exc)
            self.json(409, {"error": str(exc)})
        except (ToolError, ValueError, TypeError, KeyError, OSError, yaml.YAMLError) as exc:
            LOGGER.warning("%s %s: %s", method, self.path, exc)
            self.json(400, {"error": str(exc)})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    app = Workbench()
    try:
        server = WorkbenchServer(("127.0.0.1", args.port), app)
    except OSError as exc:
        app.close()
        parser.exit(1, f"ERROR: Cannot start workbench: {exc}\n")
    url = f"http://127.0.0.1:{args.port}/"
    print(f"FTSK Site Workbench: {url}\nLocal-only. Ctrl+C stops owned processes and removes temporary uploads.", flush=True)
    if not args.no_browser and not webbrowser.open(url):
        LOGGER.warning("Could not open a browser; open the printed URL.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping workbench.")
    finally:
        server.server_close()
        app.close()


if __name__ == "__main__":
    main()
