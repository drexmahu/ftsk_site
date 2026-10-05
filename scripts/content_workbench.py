"""File-backed content editing and isolated Hugo previews for Site Workbench."""

import copy
import csv
import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

import yaml
from yaml.nodes import MappingNode, SequenceNode

LOGGER = logging.getLogger("site_workbench.content")
MAX_SOURCE = 2 * 1024 * 1024
GUIDED = {"turak", "tanfolyamok"}
FIELDS = {
    "title", "date", "publishDate", "expiryDate", "draft", "author", "participants",
    "categories", "article_image_width", "thumbImg", "featuredImg", "seo", "current",
    "milestones", "contacts", "flyer_images", "faq", "slug", "url", "aliases",
}


class ContentError(ValueError):
    pass


class ConflictError(ContentError):
    pass


class FrontmatterLoader(yaml.SafeLoader):
    yaml_implicit_resolvers = copy.deepcopy(yaml.SafeLoader.yaml_implicit_resolvers)


for initial, resolvers in FrontmatterLoader.yaml_implicit_resolvers.items():
    FrontmatterLoader.yaml_implicit_resolvers[initial] = [
        resolver for resolver in resolvers if resolver[0] != "tag:yaml.org,2002:timestamp"
    ]


def unique_mapping(loader, node, deep=False):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, str) or key in result:
            raise ContentError("Frontmatter keys must be unique strings (including nested fields).")
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


FrontmatterLoader.add_constructor("tag:yaml.org,2002:map", unique_mapping)


def revision(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def split_source(source: str) -> tuple[str, str, str]:
    if not isinstance(source, str) or len(source.encode("utf-8")) > MAX_SOURCE:
        raise ContentError("Markdown must be text, up to 2 MiB.")
    match = re.match(r"\A(?:\ufeff)?---[ \t]*(\r?\n)(.*?)^---[ \t]*(?:\r?\n|\Z)", source, re.M | re.S)
    if not match:
        raise ContentError("Use YAML frontmatter between two --- lines at the beginning of the file.")
    return match.group(2), source[match.end():], match.group(1)


def parse_frontmatter(frontmatter: str) -> dict:
    try:
        tree = yaml.compose(frontmatter, Loader=FrontmatterLoader)
        visited = set()

        def visit(node, depth=0):
            if node is None:
                return
            if depth > 60:
                raise ContentError("Frontmatter nesting is too deep.")
            if id(node) in visited:
                raise ContentError("YAML aliases are not supported in the content editor; expand them first.")
            visited.add(id(node))
            if len(visited) > 20_000:
                raise ContentError("Frontmatter is too complex.")
            if isinstance(node, MappingNode):
                for key, value in node.value:
                    visit(key, depth + 1)
                    visit(value, depth + 1)
            elif isinstance(node, SequenceNode):
                for item in node.value:
                    visit(item, depth + 1)

        visit(tree)
        data = yaml.load(frontmatter, Loader=FrontmatterLoader)
    except (yaml.YAMLError, RecursionError) as exc:
        raise ContentError(f"Invalid YAML frontmatter: {exc}") from exc
    if not isinstance(data, dict):
        raise ContentError("Frontmatter must be a YAML mapping.")
    try:
        json.dumps(data, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ContentError("Frontmatter must contain finite, JSON-compatible values.") from exc
    return data


def patched_source(source: str, changes: dict) -> str:
    """Replace only changed top-level blocks, leaving other fields/source untouched."""
    frontmatter, _, newline = split_source(source)
    data = parse_frontmatter(frontmatter)
    if not isinstance(changes, dict) or set(changes) - FIELDS:
        raise ContentError("Unknown guided field. Edit custom fields in source mode.")
    changed = {key: value for key, value in changes.items() if key not in data or data[key] != value}
    if not changed:
        return source
    tree = yaml.compose(frontmatter, Loader=FrontmatterLoader)
    assert isinstance(tree, MappingNode)
    blocks = {}
    def semantic_end(node):
        if isinstance(node, MappingNode) and node.value:
            return semantic_end(node.value[-1][1])
        if isinstance(node, SequenceNode) and node.value:
            return semantic_end(node.value[-1])
        return node.end_mark.index

    for key, value in tree.value:
        start = key.start_mark.index
        end = semantic_end(value)
        blocks[key.value] = (start, end)
    edits = []
    additions = []
    for key, value in changed.items():
        serialized = yaml.safe_dump({key: value}, allow_unicode=True, sort_keys=False, width=1000).replace("\n", newline)
        if key in blocks:
            start, end = blocks[key]
            ending = newline if frontmatter[start:end].endswith(newline) else ""
            edits.append((start, end, serialized.rstrip("\r\n") + ending))
        else:
            additions.append(serialized)
    for start, end, value in sorted(edits, reverse=True):
        frontmatter = frontmatter[:start] + value + frontmatter[end:]
    if additions:
        frontmatter = frontmatter.rstrip("\r\n") + newline + "".join(additions)
    match = re.match(r"\A(?:\ufeff)?---[ \t]*\r?\n", source)
    assert match
    original_frontmatter = split_source(source)[0]
    result = source[:match.end()] + frontmatter + source[match.end() + len(original_frontmatter):]
    parse_frontmatter(frontmatter)
    return result


class ContentService:
    def __init__(self, app, path_guard) -> None:
        self.app = app
        self.root = app.root
        self.guard = path_guard
        self.renderings: dict[str, Path] = {}
        self.preview = {"state": "idle", "url": "", "path": "", "revision": "", "warnings": []}

    def path(self, relative: str) -> Path:
        if not isinstance(relative, str) or not re.fullmatch(r"[\w-]+(?:/[\w-]+)*\.md", relative):
            raise ContentError("Use a path under content/, e.g. turak/2026-trip.md or turak/trip/index.md. No spaces, dots or traversal in names.")
        return self.guard(self.root / "content", relative)

    def read(self, relative: str) -> dict:
        file = self.path(relative)
        if not file.is_file():
            raise ContentError("This Markdown page does not exist.")
        raw = file.read_bytes()
        source = raw.decode("utf-8")
        result = {"path": relative, "source": source, "revision": revision(raw),
                  "guided": self.guided(relative), "bytes": len(raw)}
        try:
            frontmatter, body, newline = split_source(source)
            result.update(frontmatter=frontmatter, body=body, newline=newline,
                          metadata=parse_frontmatter(frontmatter), error="")
        except ContentError as exc:
            result.update(frontmatter="", body=source, newline="\n", metadata={}, error=str(exc))
        return result

    @staticmethod
    def guided(relative: str) -> bool:
        return relative.split("/")[0] in GUIDED and Path(relative).name != "_index.md"

    def pages(self) -> list[dict]:
        result = []
        for file in sorted((self.root / "content").rglob("*.md")):
            relative = file.relative_to(self.root / "content").as_posix()
            page = self.read(relative)
            meta = page["metadata"]
            result.append({"path": relative, "title": meta.get("title", file.stem),
                           "date": meta.get("date", ""), "draft": meta.get("draft", False),
                           "current": meta.get("current", False), "guided": page["guided"],
                           "error": page["error"], "revision": page["revision"],
                           "section": relative.split("/")[0] if "/" in relative else "pages"})
        return result

    def catalog(self) -> dict:
        tags_file = self.root / "data" / "blog-tags.yaml"
        members_file = self.root / "data" / "members.yaml"
        tags = yaml.safe_load(tags_file.read_text(encoding="utf-8")) if tags_file.exists() else []
        members_data = yaml.safe_load(members_file.read_text(encoding="utf-8")) if members_file.exists() else {}
        members = []
        for group in (members_data or {}).get("groups", []):
            for member in group.get("members", []):
                name = member["name"]
                if member.get("nickname"):
                    name += f' ({member["nickname"]})'
                members.append(name)
        folders = {"gallery", "turak", "tanfolyamok"}
        base = self.root / "static" / "images"
        if base.exists():
            for folder in base.rglob("*"):
                if folder.is_dir():
                    self.guard(base, folder.relative_to(base).as_posix())
                    folders.add(folder.relative_to(base).as_posix())
        return {"pages": self.pages(), "categories": tags, "members": members,
                "folders": sorted(folders), "templates": [
                    {"id": "trip", "name": "Trip / research / expedition", "section": "turak"},
                    {"id": "pdf", "name": "Archived PDF report (legacy- filename)", "section": "turak"},
                    {"id": "course", "name": "Current course announcement", "section": "tanfolyamok"},
                    {"id": "course-report", "name": "Archived course report", "section": "tanfolyamok"},
                    {"id": "page", "name": "Other Markdown page (source mode)", "section": ""},
                ]}

    def template(self, kind: str, relative: str) -> dict:
        self.path(relative)
        if kind not in ("trip", "pdf", "course", "course-report", "page"):
            raise ContentError("Unknown content template.")
        if kind in ("trip", "pdf") and relative.split("/")[0] != "turak":
            raise ContentError("Trip templates belong under turak/.")
        if kind.startswith("course") and relative.split("/")[0] != "tanfolyamok":
            raise ContentError("Course templates belong under tanfolyamok/.")
        if kind == "pdf" and not Path(relative).stem.startswith("legacy-"):
            raise ContentError("Archived PDF report filenames need the legacy- prefix.")
        blocks = re.findall(r"```markdown\r?\n(.*?)```", (self.root / "docs" / "BLOGPOST_TEMPLATES.md").read_text(encoding="utf-8"), re.S)
        index = {"trip": 0, "pdf": 1, "course": 2, "course-report": 3}.get(kind)
        if index is None:
            source = '---\ntitle: "New page"\ndraft: true\nseo:\n  page_description: ""\n  no_index: false\n---\n\nWrite your page here.\n'
        else:
            source = blocks[index]
        frontmatter, body, newline = split_source(source)
        return {"path": relative, "source": source, "frontmatter": frontmatter, "body": body,
                "newline": newline, "metadata": parse_frontmatter(frontmatter), "revision": "",
                "guided": self.guided(relative), "error": ""}

    def validate(self, relative: str, source: str, changes: dict | None = None) -> dict:
        self.path(relative)
        if changes:
            source = patched_source(source, changes)
        frontmatter, body, newline = split_source(source)
        meta = parse_frontmatter(frontmatter)
        warnings = []
        if not isinstance(meta.get("title"), str) or not meta["title"].strip():
            raise ContentError("A non-empty title is required.")
        for key in ("draft", "current"):
            if key in meta and not isinstance(meta[key], bool):
                raise ContentError(f"{key} must be true or false, not quoted text.")
        for key in ("date", "publishDate", "expiryDate"):
            value = meta.get(key)
            if value:
                self.date(value, key)
        if self.guided(relative) and not meta.get("date"):
            raise ContentError("Trip and course pages require a date.")
        for key in ("author", "slug", "url"):
            if key in meta and meta[key] is not None and not isinstance(meta[key], str):
                raise ContentError(f"{key} must be text.")
        for key in ("participants", "categories", "aliases"):
            if key in meta and (not isinstance(meta[key], list) or not all(isinstance(item, str) for item in meta[key])):
                raise ContentError(f"{key} must be a list of text values.")
        if "article_image_width" in meta:
            value = meta["article_image_width"]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 10 <= value <= 100:
                raise ContentError("article_image_width must be a number from 10 to 100.")
        for key in ("thumbImg", "featuredImg", "seo"):
            value = meta.get(key)
            if value is not None and not isinstance(value, dict):
                raise ContentError(f"{key} must be a mapping.")
        seo = meta.get("seo") or {}
        if "no_index" in seo and not isinstance(seo["no_index"], bool):
            raise ContentError("seo.no_index must be true or false.")
        for key in ("page_description", "canonical_url", "featured_image", "author_twitter_handle", "open_graph_type"):
            if seo.get(key) is not None and not isinstance(seo[key], str):
                raise ContentError(f"seo.{key} must be text.")
        for url in ((meta.get("thumbImg") or {}).get("image_path"), (meta.get("featuredImg") or {}).get("image_path"),
                    seo.get("featured_image")):
            if url:
                self.asset_path(url)
        for key in ("faq", "milestones", "contacts", "flyer_images"):
            items = meta.get(key, [])
            if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
                raise ContentError(f"{key} must be a list of mappings.")
            for item in items:
                required = {"faq": ("question", "answer"), "milestones": ("label",), "contacts": ("name",),
                            "flyer_images": ("image_path",)}[key]
                for field in required:
                    if not isinstance(item.get(field), str) or not item[field].strip():
                        raise ContentError(f"{key}: each entry needs {field}.")
                if key == "milestones":
                    if item.get("date"):
                        self.date(item["date"], "Milestone date")
                    if "estimated" in item and not isinstance(item["estimated"], bool):
                        raise ContentError("Milestone estimated must be true or false.")
                if key == "flyer_images":
                    self.asset_path(item["image_path"])
        if "KITÖLTENDŐ" in source or "2000-01-01" in str(meta.get("date", "")):
            warnings.append("Template placeholders remain. Replace or remove them before publishing.")
        if not seo.get("page_description"):
            warnings.append("SEO description is empty; the site-wide description will be used.")
        if self.guided(relative):
            if not (meta.get("featuredImg") or {}).get("image_path"):
                warnings.append("No featured image; choose a banner photo before publishing.")
            if not (meta.get("thumbImg") or {}).get("image_path"):
                warnings.append("No card thumbnail; list/related cards may have a missing image.")
        if meta.get("current") and relative.startswith("tanfolyamok/"):
            for page in self.pages():
                if page["path"] != relative and page["section"] == "tanfolyamok" and page["current"] and not page["draft"]:
                    warnings.append(f'Another published course is current: {page["path"]}. Only one should be current.')
        if not meta.get("draft", False):
            warnings.append("This page is not a draft. Saving changes affects the next production build.")
        return {"path": relative, "source": source, "frontmatter": frontmatter, "body": body, "newline": newline,
                "metadata": meta, "guided": self.guided(relative), "warnings": warnings}

    @staticmethod
    def date(value, label):
        if not isinstance(value, str):
            raise ContentError(f"{label} must be an ISO date or date-time.")
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ContentError(f"{label} must be a real ISO date, e.g. 2026-08-14 or 2026-08-14T00:00:00Z.") from exc

    def check_revision(self, relative: str, expected: str) -> Path:
        file = self.path(relative)
        if not file.is_file() or revision(file.read_bytes()) != expected:
            raise ConflictError("The file changed outside this editor or was deleted. Reload it before saving/deleting; your draft has not been written.")
        return file

    def save(self, payload: dict) -> dict:
        target = payload.get("path", "")
        original = payload.get("original", "")
        validated = self.validate(target, payload.get("source"), payload.get("changes"))
        destination = self.path(target)
        if original:
            source = self.check_revision(original, payload.get("revision", ""))
            if target != original and destination.exists():
                raise ConflictError("Destination already exists. Choose another content path.")
        else:
            source = None
            if destination.exists():
                raise ConflictError("A page already exists at this path. Open it or choose another filename.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        raw = validated["source"].encode("utf-8")
        if source == destination:
            if source.read_bytes() != raw:
                temporary = None
                try:
                    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".workbench-", suffix=".tmp", delete=False) as stream:
                        temporary = Path(stream.name)
                        stream.write(raw)
                        stream.flush()
                        os.fsync(stream.fileno())
                    self.check_revision(original, payload.get("revision", ""))
                    temporary.replace(destination)
                finally:
                    if temporary:
                        temporary.unlink(missing_ok=True)
        else:
            written = False
            try:
                with destination.open("xb") as stream:
                    written = True
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                if source:
                    self.check_revision(original, payload.get("revision", ""))
                    source.unlink()
            except (OSError, ConflictError):
                if written:
                    destination.unlink(missing_ok=True)
                raise
        page = self.read(target)
        page["warnings"] = validated["warnings"]
        if original and target != original:
            page["warnings"].append("Page moved. Images/PDFs were not moved; update incoming links and consider an aliases entry for the previous URL.")
        return page

    def asset_path(self, url: str) -> Path:
        if not isinstance(url, str) or not url.startswith(("/images/", "/pdfs/")) or "?" in url or "#" in url:
            raise ContentError("Use a local /images/... or /pdfs/... file URL.")
        path = self.guard(self.root / "static", unquote(url.lstrip("/")))
        if not path.is_file():
            raise ContentError(f"Asset does not exist: {url}")
        if path.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".pdf"):
            raise ContentError("This asset type is not supported.")
        return path

    def assets(self, folder: str = "") -> dict:
        base = self.root / "static" / "images"
        target = self.guard(base, folder) if folder else base
        if not target.is_dir():
            return {"folder": folder, "files": [], "folders": []}
        files = []
        folders = []
        for path in sorted(target.iterdir()):
            relative = path.relative_to(base).as_posix()
            self.guard(base, relative)
            if path.is_dir():
                folders.append(relative)
            elif path.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"):
                files.append({"url": "/images/" + quote(relative, safe="/"), "name": path.name, "bytes": path.stat().st_size})
        return {"folder": folder, "folders": folders, "files": files}

    def upload_pdf(self, filename: str, folder: str, raw: bytes) -> dict:
        if not re.fullmatch(r"[\w-]+(?:/[\w-]+)*", folder):
            raise ContentError("Choose a relative PDF folder, e.g. turak/legacy-trip.")
        if Path(filename).suffix.lower() != ".pdf" or not raw.startswith(b"%PDF-"):
            raise ContentError("Choose a PDF file with a valid PDF header.")
        target = self.guard(self.root / "static" / "pdfs", folder)
        target.mkdir(parents=True, exist_ok=True)
        stem = re.sub(r"[^\w-]+", "-", Path(filename).stem).strip("-") or "report"
        name = stem
        number = 1
        while (target / (name + ".pdf")).exists():
            number += 1
            name = f"{stem}-{number}"
        file = self.guard(self.root / "static" / "pdfs", f"{folder}/{name}.pdf")
        written = False
        try:
            with file.open("xb") as stream:
                written = True
                stream.write(raw)
        except OSError:
            if written:
                file.unlink(missing_ok=True)
            raise
        return {"url": "/pdfs/" + quote(f"{folder}/{name}.pdf", safe="/"), "bytes": len(raw)}

    def references(self, url: str, exclude: str = "") -> list[str]:
        result = []
        needle = unquote(url).casefold()
        for folder, patterns in (("content", ("*.md", "*.html")),
                                 ("data", ("*.yaml", "*.yml", "*.json", "*.toml")),
                                 ("assets", ("*.scss", "*.css", "*.js", "*.json")),
                                 ("static", ("*.js", "*.css", "*.html", "*.json")),
                                 ("layouts", ("*.html",)),
                                 ("component-library", ("*.html", "*.yaml", "*.yml", "*.json")),
                                 ("config", ("*.toml", "*.yaml", "*.yml", "*.json"))):
            base = self.root / folder
            for pattern in patterns:
                for file in base.rglob(pattern):
                    relative = file.relative_to(self.root).as_posix()
                    self.guard(base, file.relative_to(base).as_posix())
                    if relative == "content/" + exclude:
                        continue
                    text = unquote(file.read_text(encoding="utf-8"))
                    if needle in text.casefold():
                        result.append(relative)
        for pattern in ("*.toml", "*.yaml", "*.yml", "*.json"):
            for file in self.root.glob(pattern):
                self.guard(self.root, file.name)
                if needle in unquote(file.read_text(encoding="utf-8")).casefold():
                    result.append(file.name)
        return sorted(set(result))

    def deletion_plan(self, relative: str, expected: str) -> dict:
        file = self.check_revision(relative, expected)
        text = file.read_text(encoding="utf-8")
        urls = set(re.findall(r"/(?:images|pdfs)/[^\s\"'<>()[\]{}]+", text))
        assets = []
        for url in sorted(urls):
            url = url.rstrip(",;")
            try:
                path = self.asset_path(url)
                references = self.references(url, exclude=relative)
                assets.append({"url": url, "bytes": path.stat().st_size, "revision": revision(path.read_bytes()),
                               "references": references, "missing": False})
            except (ContentError, ValueError) as exc:
                assets.append({"url": url, "missing": True, "error": str(exc), "references": []})
        return {"path": relative, "revision": expected, "assets": assets,
                "incoming": self.references("/" + relative.removesuffix(".md").removesuffix("/index") + "/", exclude=relative)}

    def delete(self, payload: dict) -> dict:
        relative = payload.get("path", "")
        if payload.get("confirm") != relative:
            raise ContentError("Type the complete content path to confirm deletion.")
        file = self.check_revision(relative, payload.get("revision", ""))
        selected = payload.get("assets", [])
        if not isinstance(selected, list) or not all(isinstance(item, dict) for item in selected):
            raise ContentError("Select asset URLs and revisions from the deletion plan.")
        plan = self.deletion_plan(relative, payload["revision"])
        allowed = {item["url"]: item for item in plan["assets"] if not item["missing"]}
        paths = [file]
        seen = set()
        for item in selected:
            url = item.get("url")
            if url not in allowed or url in seen:
                raise ContentError("Only assets linked by this page may be deleted, once each.")
            seen.add(url)
            asset = allowed[url]
            if asset["references"]:
                raise ConflictError(f"Asset is used elsewhere and cannot be deleted here: {url}")
            if item.get("revision") != asset["revision"]:
                raise ConflictError(f"Asset changed since the deletion dialog opened: {url}")
            paths.append(self.asset_path(url))
        # Move into temporary staging first: rollback all files if any move fails.
        with tempfile.TemporaryDirectory(dir=self.app.scratch, prefix="delete-") as staging:
            moved = []
            try:
                for index, path in enumerate(paths):
                    temporary = Path(staging) / str(index)
                    path.replace(temporary)
                    moved.append((path, temporary))
            except OSError:
                for path, temporary in reversed(moved):
                    temporary.replace(path)
                raise
        return {"deleted": relative, "assets": sorted(seen),
                "message": "Files deleted. Restore tracked files manually with Git if necessary; untracked files are not recoverable with Git."}

    def prepare_preview(self, payload: dict, origin: str) -> tuple[str, dict]:
        page = self.validate(payload.get("path", ""), payload.get("source"), payload.get("changes"))
        original = payload.get("original", "")
        if original:
            self.check_revision(original, payload.get("revision", ""))
        destination = self.path(page["path"])
        if destination.exists() and page["path"] != original:
            raise ConflictError("Preview destination already belongs to another page.")
        identifier = secrets.token_hex(12)
        directory = self.app.scratch / ("render-" + identifier)
        directory.mkdir()
        content = directory / "content"
        content.mkdir()
        for file in (self.root / "content").rglob("*"):
            relative = file.relative_to(self.root / "content").as_posix()
            self.guard(self.root / "content", relative)
            if file.is_file():
                target = content / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file, target)
        if original and page["path"] != original:
            (content / original).unlink()
        target = content / page["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(page["source"].encode("utf-8"))
        mounts = [{"source": str(content), "target": "content"}]
        for folder in ("data", "layouts", "i18n", "archetypes", "assets", "static"):
            if (self.root / folder).exists():
                mounts.append({"source": str(self.root / folder), "target": folder})
        mounts.append({"source": str(self.root / "static" / "images"), "target": "assets/images"})
        config = {"baseURL": origin + f"/render/{identifier}/", "module": {"mounts": mounts}}
        override = directory / "override.json"
        override.write_text(json.dumps(config), encoding="utf-8")
        info = {"identifier": identifier, "directory": directory, "override": override, "page": page,
                "config": str(self.root / "config.toml") + "," + str(override)}
        return identifier, info

    def build_preview(self, info: dict) -> None:
        page = info["page"]
        self.preview = {"state": "building", "id": info["identifier"], "url": "", "path": page["path"],
                        "revision": revision(page["source"].encode("utf-8")), "warnings": page["warnings"]}
        output = info["directory"] / "public"
        executable = self.app.hugo_executable()
        environment = {"HUGO_PAGES_PREVIEWS": "true"}
        self.app.run_command([executable, "--config", info["config"], "--destination", str(output),
                              "--buildDrafts", "--buildFuture", "--buildExpired", "--noBuildLock"],
                             "Unsaved content preview (isolated content and output)", environment)
        manifest = info["directory"] / "manifest.csv"
        self.app.run_command([executable, "list", "all", "--config", info["config"], "--noBuildLock"],
                             "Resolve the actual Hugo page URL", environment, manifest)
        url = ""
        lines = manifest.read_text(encoding="utf-8-sig").splitlines()
        header = next((index for index, line in enumerate(lines) if line.startswith("path,slug,title,")), None)
        if header is None:
            raise ContentError("Hugo returned no readable content manifest; see the preview log.")
        pages = list(csv.DictReader(lines[header:]))
        for row in pages:
            # Hugo uses the mounted source's absolute path in its CSV.
            candidate = row["path"].replace("\\", "/")
            if candidate.endswith("/content/" + page["path"]) or candidate == "content/" + page["path"]:
                url = row["permalink"]
                break
        if not url:
            raise ContentError("Hugo did not generate this page. Check frontmatter build/output settings and the build log.")
        if sum(row["permalink"] == url for row in pages) != 1:
            raise ContentError("Another page has the same Hugo URL. Choose a unique slug or URL before previewing.")
        prefix = f'/render/{info["identifier"]}/'
        path = unquote(urlsplit(url).path)
        if not path.startswith(prefix):
            raise ContentError("The page URL is outside this isolated preview (check url frontmatter).")
        relative = path[len(prefix):]
        html = self.guard(output, relative + "index.html" if path.endswith("/") else relative)
        if not html.is_file():
            raise ContentError("Hugo generated no HTML output at this page URL.")
        with self.app.lock:
            self.renderings[info["identifier"]] = output
            self.preview.update(state="ready", url=url)
            while len(self.renderings) > 3:
                old = next(iter(self.renderings))
                old_output = self.renderings.pop(old)
                shutil.rmtree(old_output.parent)

    def rendered_file(self, route: str) -> Path:
        parts = route.split("/", 3)
        if len(parts) < 4 or parts[2] not in self.renderings:
            raise ContentError("This preview expired. Render it again.")
        relative = parts[3]
        if not relative or relative.endswith("/"):
            relative += "index.html"
        return self.guard(self.renderings[parts[2]], unquote(relative))
