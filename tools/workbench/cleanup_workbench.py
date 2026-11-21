"""Conservative static-file discovery with checkout-bound, Git-backed deletion."""

import hashlib
import html
import json
import logging
import posixpath
import re
import secrets
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import unquote, quote

from tools.workbench.content_workbench import ContentError, ConflictError, revision

LOGGER = logging.getLogger("site_workbench.cleanup")
IMAGES = {".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".avif", ".heic", ".heif", ".bmp", ".ico"}
MEDIA = IMAGES | {".pdf", ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".mp4",
         ".webm", ".mov", ".avi", ".zip", ".7z", ".rar", ".tar", ".gz", ".doc",
         ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".epub"}
TEXT = {".md", ".html", ".htm", ".xml", ".css", ".scss", ".sass", ".js", ".mjs",
        ".json", ".map", ".yaml", ".yml", ".toml", ".txt", ".csv", ".py", ".ps1",
        ".bat", ".svg"}
ROOTS = ("content", "data", "layouts", "assets", "config", "i18n", "archetypes",
         "static", "tools", "scripts", "docs")
INFRASTRUCTURE = {".nojekyll", ".htaccess", "robots.txt", "CNAME", "_redirects",
                  "_headers", "web.config", "crossdomain.xml"}


def normalized(text):
    text = re.sub(r"\\u([0-9a-fA-F]{4})", lambda match: chr(int(match[1], 16)), text)
    return html.unescape(unquote(text.replace("\\/", "/"))).casefold()


def file_revision(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def dynamic_prefixes(text):
    literals = []
    for match in re.finditer(r"""(['"`])([^'"`\r\n]+)\1(\s*\+)?""", text):
        value = match[2]
        marker = re.search(r"\$\{|{{|%[sd]|[*?]", value)
        if marker:
            value = value[:marker.start()]
        elif not match[3]:
            continue
        path = re.search(r"((?:/?[\w.-]+/)+[\w.-]*)$", value)
        if path:
            literals.append(path[1])
    return set(literals)


class CleanupService:
    def __init__(self, app, guard):
        self.app = app
        self.root = app.root
        self.guard = guard
        self.report = None
        # Safety snapshots hold app.lock; progress must remain readable independently.
        self.progress_lock = threading.Lock()
        self.progress = {"state": "idle"}
        self.phase_started = time.monotonic()

    def start_progress(self):
        self.set_phase(1, "Checking saved files",
                       "Reading the checkout and fingerprinting saved files. This creates a safety snapshot; nothing is deleted.")

    def set_phase(self, step, label, explanation):
        with self.progress_lock:
            self.progress = {"state": "running", "step": step, "steps": 5, "label": label,
                             "explanation": explanation, "completed": 0, "total": None, "current": "", "error": ""}
            self.phase_started = time.monotonic()

    def update_counts(self, completed, total, current=""):
        with self.progress_lock:
            self.progress.update(completed=completed, total=total, current=current)

    def finish_progress(self, state, error=""):
        with self.progress_lock:
            self.progress.update(state=state, error=error, elapsed_seconds=int(time.monotonic() - self.phase_started))

    def progress_status(self):
        with self.progress_lock:
            progress = dict(self.progress)
            if progress["state"] == "running":
                progress["elapsed_seconds"] = int(time.monotonic() - self.phase_started)
        job = self.app.job
        progress["log"] = job["log"] if job["action"] == "cleanup-scan" else ""
        return progress

    def snapshot(self, progress=False):
        git = self.app.git.snapshot()
        if self.app.git.busy or not git.get("available") or not git.get("head"):
            raise ConflictError("Cleanup needs an available Git checkout with at least one checkpoint and no active Git operation.")
        changed = {item["path"] for item in git["changes"]}
        changed.update(item["from"] for item in git["changes"] if "from" in item)
        committed = {}
        for entry in self.app.git.run("ls-tree", "-r", "-z", "HEAD", "--", "static").stdout.split("\0"):
            if entry:
                metadata, path = entry.split("\t", 1)
                mode, kind, identifier = metadata.split()
                if kind == "blob" and mode in ("100644", "100755"):
                    committed[path] = identifier
        files, sources = [], {}
        digest = hashlib.sha256()
        digest.update(json.dumps([git["head"], git["branch"], sorted(changed)]).encode("utf-8"))
        paths = set()
        for name in ROOTS:
            base = self.guard(self.root, name)
            if base.is_dir():
                paths.update(path for path in base.rglob("*")
                             if path.is_file() and "__pycache__" not in path.parts and
                             (name == "static" or path.suffix.lower() in TEXT))
        paths.update(path for path in self.root.iterdir()
                     if path.is_file() and (path.suffix.lower() in TEXT or path.name == ".hugo-version"))
        ordered = sorted(paths)
        if progress:
            self.update_counts(0, len(ordered))
        for index, path in enumerate(ordered, 1):
            relative = path.relative_to(self.root).as_posix()
            self.guard(self.root, relative)
            raw = path.read_bytes() if path.suffix.lower() in TEXT else None
            fingerprint = revision(raw) if raw is not None else file_revision(path)
            digest.update(relative.encode("utf-8") + b"\0" + fingerprint.encode() + b"\0")
            if raw is not None:
                try:
                    sources[relative] = normalized(raw.decode("utf-8-sig"))
                except UnicodeDecodeError as exc:
                    raise ContentError(f"Cannot safely scan non-UTF-8 source {relative}. Convert it to UTF-8 before cleanup.") from exc
            if relative.startswith("static/"):
                reason = ""
                if any(part.startswith(".") for part in path.relative_to(self.root / "static").parts) or path.name in INFRASTRUCTURE:
                    reason = "Publishing infrastructure is protected."
                elif relative not in committed:
                    reason = "Not saved in the current Git checkpoint. Commit this file before cleanup."
                elif relative in changed:
                    reason = "Uncommitted file changes. Commit this file before cleanup."
                files.append({"path": relative, "url": "/static/" + quote(relative[7:], safe="/"),
                              "name": path.name, "bytes": len(raw) if raw is not None else path.stat().st_size,
                              "revision": fingerprint,
                              "media": path.suffix.lower() in MEDIA and "fonts" not in path.relative_to(self.root / "static").parts,
                              "kind": "image" if path.suffix.lower() in IMAGES and "fonts" not in path.relative_to(self.root / "static").parts else
                                      "pdf" if path.suffix.lower() == ".pdf" else "file",
                              "protected": reason, "blob": committed.get(relative)})
            if progress:
                self.update_counts(index, len(ordered), relative)
        return {"fingerprint": digest.hexdigest(), "branch": git["branch"], "head": git["head"],
                "files": files, "sources": sources}

    def build(self, destination, resources, cache):
        self.app.run_command(
            [self.app.hugo_executable(), "--destination", str(destination),
             "--cacheDir", str(cache),
             "--baseURL", "https://www.ftsk.hu/", "--buildDrafts", "--buildFuture",
             "--buildExpired", "--noBuildLock"],
            "Cleanup discovery: fresh site build, including drafts, future and expired pages",
            {"HUGO_RESOURCEDIR": str(resources)},
        )
        if not (destination / "index.html").is_file():
            raise ContentError("Cleanup build produced no home page. No files can be marked unused.")

    def scan(self):
        self.start_progress()
        with self.app.lock:
            self.report = None
            before = self.snapshot(progress=True)
        with tempfile.TemporaryDirectory(prefix="ftsk-cleanup-") as folder:
            work = Path(folder)
            output, resources = work / "public", work / "resources"
            self.set_phase(2, "Building a fresh site",
                           "Hugo is building all pages, including drafts, future and expired reports. Image processing can take time; the existing public folder is not used.")
            self.build(output, resources, work / "cache")
            self.set_phase(3, "Reading built-page references",
                           "Inspecting the fresh pages and generated image paths to catch references that only appear after a build.")
            generated = {}
            generated_paths = [path for path in output.rglob("*") if path.is_file() and path.suffix.lower() in TEXT]
            self.update_counts(0, len(generated_paths))
            for index, path in enumerate(generated_paths, 1):
                relative = path.relative_to(output).as_posix()
                # A copied static file is already scanned as source; it cannot reference itself.
                if "static/" + relative not in before["sources"]:
                    generated["Built site: " + relative] = normalized(path.read_text(encoding="utf-8-sig"))
                self.update_counts(index, len(generated_paths), relative)
            self.update_counts(0, None, "Hugo image pipeline and dynamic references")
            generated["Hugo image pipeline"] = normalized("\n".join(
                path.relative_to(resources).as_posix() for path in resources.rglob("*") if path.is_file()))
            dynamic = []
            for source, text in before["sources"].items():
                # Editor browsers/importers can address any media file; that is not site usage.
                if source.split("/", 1)[0] not in {"static", "layouts", "assets", "content", "data"}:
                    continue
                for prefix in dynamic_prefixes(text):
                    public = posixpath.normpath(prefix).lstrip("/")
                    if public.startswith("static/"):
                        public = public[7:]
                    relative = posixpath.normpath(posixpath.join(posixpath.dirname(source), prefix))
                    dynamic.append((source, "static/" + public, relative))
            unused, used = [], 0
            self.set_phase(4, "Checking each static file",
                           "Comparing images, PDFs and downloads with saved sources and the fresh build. Possible dynamic references stay protected.")
            self.update_counts(0, len(before["files"]))
            for index, item in enumerate(before["files"], 1):
                name = item["name"].casefold()
                processed = str(Path(item["path"][7:]).with_suffix("")).replace("\\", "/").casefold() + "_hu_"
                references = [source for source, text in before["sources"].items()
                              if source != item["path"] and name in text]
                references.extend(source for source, text in generated.items()
                                  if name in text or processed in text)
                if references:
                    used += 1
                else:
                    uncertain = [source for source, public, relative in dynamic
                                 if source != item["path"] and
                                 (item["path"].casefold().startswith((public, relative)) or
                                  "/" + public[7:].lstrip("./") in item["path"].casefold())]
                    if uncertain and not item["protected"]:
                        item["protected"] = "Possible dynamically constructed reference in " + uncertain[0] + ". Review manually; not approved for deletion."
                    unused.append(item)
                self.update_counts(index, len(before["files"]), item["path"])
        self.set_phase(5, "Verifying the checkout has not changed",
                       "Rechecking file fingerprints and Git state before approving any candidates. Changes during discovery invalidate the scan.")
        with self.app.lock:
            after = self.snapshot(progress=True)
            if after["fingerprint"] != before["fingerprint"]:
                raise ConflictError("Files or the branch changed during discovery. Run a new scan; nothing was deleted.")
            self.report = {"id": secrets.token_hex(16), "fingerprint": before["fingerprint"],
                           "branch": before["branch"], "head": before["head"], "files": unused,
                           "checked": len(before["files"]), "used": used}
        self.finish_progress("passed")

    def catalog(self):
        report = self.report
        return {"scan": {key: value for key, value in report.items() if key != "fingerprint"} if report else None,
                "job": dict(self.app.job)}

    def delete(self, payload):
        self.app.git.assert_editable()
        if self.app.job["state"] == "running" or self.app.uploads:
            raise ConflictError("Wait for active work and remove queued uploads before deleting files.")
        report = self.report
        if not report or payload.get("scan") != report["id"]:
            raise ConflictError("This cleanup scan expired. Scan again and review the files.")
        selected = payload.get("paths")
        if (not isinstance(selected, list) or not selected or len(selected) > 1000 or
                any(not isinstance(path, str) for path in selected) or len(set(selected)) != len(selected)):
            raise ContentError("Select between 1 and 1000 distinct files from the cleanup results.")
        if payload.get("confirm") is not True:
            raise ContentError("Review and confirm deleting the selected files.")
        entries = {item["path"]: item for item in report["files"]}
        for relative in selected:
            item = entries.get(relative)
            if not item or item["protected"]:
                raise ConflictError(f"File is not an eligible unused file: {relative}. Scan and review again.")
            if not item["media"] and payload.get("advanced") is not True:
                raise ContentError("Enable advanced mode to review non-media static files.")
        if self.snapshot()["fingerprint"] != report["fingerprint"]:
            raise ConflictError("The checkout changed since discovery. Scan again before deleting.")
        paths = []
        for relative in selected:
            item = entries[relative]
            path = self.guard(self.root, relative)
            if file_revision(path) != item["revision"]:
                raise ConflictError(f"{relative} changed since discovery. Scan again.")
            if self.app.git.text("hash-object", "--path=" + relative, relative) != item["blob"]:
                raise ConflictError(f"{relative} does not match its committed Git copy. Commit changes before deleting.")
            paths.append((relative, path))
        deleted = []
        self.report = None
        self.finish_progress("idle")
        try:
            for relative, path in paths:
                if file_revision(path) != entries[relative]["revision"]:
                    raise ConflictError(f"Deletion stopped; {relative} changed. Already deleted: {', '.join(deleted) or 'none'}. Review Git and scan again.")
                path.unlink()
                deleted.append(relative)
        except OSError as exc:
            LOGGER.exception("Cleanup deletion interrupted")
            raise ContentError(f"Deletion stopped: {exc}. Already deleted: {', '.join(deleted) or 'none'}. Review Git and scan again.") from exc
        return {"deleted": deleted, "bytes": sum(entries[path]["bytes"] for path in deleted),
                "checkpoint": report["head"]}
