"""Roster editing with optimistic concurrency and non-destructive reference checks."""

import copy
import os
import re
import tempfile
from pathlib import Path

import yaml

from content_workbench import ConflictError, ContentError, parse_frontmatter, revision, split_source

FIELDS = ("name", "nickname", "role", "bio", "image", "modal_image")
PAREN_SUFFIX = re.compile(r"\s*\([^)]*\)\s*$")
PARTICIPANT_PARENTHESES = re.compile(r"\s*\([^)]*\)")


def match_key(value: str) -> str:
    return PAREN_SUFFIX.sub("", value).strip().lower()


def roster_data(raw: bytes) -> dict:
    data = parse_frontmatter(raw.decode("utf-8-sig"))
    groups = data.get("groups")
    if not isinstance(groups, list) or not groups:
        raise ContentError("Member data must contain a non-empty groups list.")
    for group in groups:
        if (not isinstance(group, dict) or not isinstance(group.get("label"), str)
                or not group["label"].strip() or not isinstance(group.get("members"), list)):
            raise ContentError("Each member group needs a label and a members list.")
        for member in group["members"]:
            if (not isinstance(member, dict) or not isinstance(member.get("name"), str)
                    or not member["name"].strip()):
                raise ContentError("Every roster entry needs a non-empty name.")
            if any(member.get(field) is not None and not isinstance(member[field], str)
                   for field in FIELDS):
                raise ContentError("Member fields must be text.")
    return data


class MemberService:
    def __init__(self, app, path_guard) -> None:
        self.app = app
        self.root = app.root
        self.guard = path_guard

    def read(self) -> tuple[Path, bytes, dict]:
        path = self.guard(self.root / "data", "members.yaml")
        raw = path.read_bytes()
        return path, raw, roster_data(raw)

    def image_path(self, value: str) -> Path:
        if not value.startswith("/images/"):
            raise ContentError("Member images must use a local /images/ URL.")
        if Path(value).suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
            raise ContentError("Member images must be JPG, PNG or WebP files.")
        return self.guard(self.root / "static", value.lstrip("/"))

    def reports(self) -> tuple[list[dict], list[str]]:
        entries, warnings = [], []
        for section in ("turak", "tanfolyamok"):
            base = self.root / "content" / section
            for file in sorted(base.rglob("*.md")):
                relative = file.relative_to(self.root).as_posix()
                try:
                    self.guard(base, file.relative_to(base).as_posix())
                    frontmatter, _, _ = split_source(file.read_text(encoding="utf-8"))
                    data = parse_frontmatter(frontmatter)
                    names = data.get("participants", [])
                    if not isinstance(names, list) or any(not isinstance(name, str) for name in names):
                        raise ContentError("Participants must be a list of names.")
                    for name in names:
                        entries.append({"path": relative, "field": "participants", "name": name})
                    if data.get("author"):
                        if not isinstance(data["author"], str):
                            raise ContentError("Author must be text.")
                        entries.append({"path": relative, "field": "author", "name": data["author"]})
                except (ContentError, OSError, UnicodeError) as exc:
                    warnings.append(f"{relative}: {exc}")
        return entries, warnings

    def catalog(self) -> dict:
        _, raw, data = self.read()
        reports, warnings = self.reports()
        keys, duplicate_keys = {}, {}
        groups = copy.deepcopy(data["groups"])
        assigned = set()
        missing = []
        for group_index, group in enumerate(groups):
            for index, member in enumerate(group["members"]):
                member["original"] = {"group": group_index, "index": index}
                member["references"] = []
                for value in (member["name"], member.get("nickname")):
                    if value:
                        key = match_key(value)
                        if key in duplicate_keys and duplicate_keys[key] is not member:
                            warnings.append(f"Ambiguous member name/nickname: {value}")
                        duplicate_keys[key] = member
                        keys.setdefault(value, member)
                for field in ("image", "modal_image"):
                    value = member.get(field)
                    if not value:
                        continue
                    assigned.add(value)
                    try:
                        if not self.image_path(value).is_file():
                            raise ContentError("File is missing.")
                    except (ValueError, OSError) as exc:
                        missing.append({"name": member["name"], "field": field,
                                        "url": value, "error": str(exc)})
        unmatched, unmatched_authors = [], []
        for report in reports:
            member = keys.get(PARTICIPANT_PARENTHESES.sub("", report["name"]))
            if member is not None:
                member["references"].append(report)
            elif report["field"] == "participants":
                unmatched.append(report)
            else:
                unmatched_authors.append(report)
        portraits = []
        folder = self.root / "static" / "images" / "members"
        for file in sorted(folder.rglob("*")):
            if file.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
                continue
            url = "/images/members/" + file.relative_to(folder).as_posix()
            try:
                if self.image_path(url).is_file():
                    portraits.append(url)
            except (ValueError, OSError) as exc:
                warnings.append(f"{url}: {exc}")
        return {"revision": revision(raw), "groups": groups, "portraits": portraits,
                "audit": {"missing_images": missing, "unassigned_portraits": [
                    url for url in portraits if url not in assigned],
                    "unmatched_participants": unmatched, "unmatched_authors": unmatched_authors,
                    "warnings": warnings}}

    def checked(self, expected: object) -> tuple[Path, bytes, dict]:
        path = self.guard(self.root / "data", "members.yaml")
        try:
            raw = path.read_bytes()
        except FileNotFoundError as exc:
            raise ConflictError("The roster was removed outside this editor. Restore the file and reload; your draft has not been written.") from exc
        if not isinstance(expected, str) or revision(raw) != expected:
            raise ConflictError("The roster changed outside this editor. Reload before saving/deleting; your draft has not been written.")
        return path, raw, roster_data(raw)

    def loose_image(self, url: object) -> Path:
        if not isinstance(url, str) or not url.startswith("/images/members/"):
            raise ContentError("Only portrait files under /images/members/ can be deleted here.")
        path = self.image_path(url)
        if not path.is_file():
            raise ConflictError(f"Portrait is missing or was removed. Reload the checks: {url}")
        return path

    def portrait_deletion_plan(self, payload: dict) -> dict:
        with self.app.lock:
            self.checked(payload.get("revision"))
            urls = payload.get("urls")
            if (not isinstance(urls, list) or not urls or len(urls) > 1000
                    or any(not isinstance(url, str) for url in urls) or len(set(urls)) != len(urls)):
                raise ContentError("Select between 1 and 1000 distinct portrait URLs.")
            files = []
            for url in urls:
                path = self.loose_image(url)
                # Basename matching also catches relative paths and is deliberately conservative.
                references = self.app.content.references(path.name)
                raw = path.read_bytes()
                files.append({"url": url, "bytes": len(raw), "revision": revision(raw),
                              "references": references})
            return {"revision": payload["revision"], "files": files}

    def delete_portraits(self, payload: dict) -> dict:
        with self.app.lock:
            if payload.get("confirm") is not True:
                raise ContentError("Confirm permanent deletion of the selected portrait files.")
            files = payload.get("files")
            if not isinstance(files, list) or not files or any(not isinstance(file, dict) for file in files):
                raise ContentError("Select portrait files from the deletion review.")
            plan = self.portrait_deletion_plan({
                "revision": payload.get("revision"), "urls": [file.get("url") for file in files],
            })
            paths = []
            for requested, current in zip(files, plan["files"]):
                if current["references"]:
                    raise ConflictError(f"Portrait is referenced and cannot be deleted: {current['url']} — "
                                        + ", ".join(current["references"]))
                if requested.get("revision") != current["revision"]:
                    raise ConflictError(f"Portrait changed since the deletion review: {current['url']}")
                paths.append(self.loose_image(current["url"]))
            self.checked(payload["revision"])
            with tempfile.TemporaryDirectory(dir=self.app.scratch, prefix="delete-portraits-") as staging:
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
            return {"deleted": [file["url"] for file in plan["files"]], "catalog": self.catalog()}

    def locate(self, data: dict, original: object) -> tuple[int, int]:
        if not isinstance(original, dict):
            raise ContentError("Choose a member from the current roster.")
        group, index = original.get("group"), original.get("index")
        if (type(group) is not int or type(index) is not int or group < 0 or index < 0
                or group >= len(data["groups"])
                or index >= len(data["groups"][group]["members"])):
            raise ContentError("The selected member no longer exists. Reload the roster.")
        return group, index

    def write(self, path: Path, raw: bytes, data: dict, expected: str) -> None:
        source = raw.decode("utf-8-sig")
        header = []
        for line in source.splitlines(keepends=True):
            if line.strip() and not line.lstrip().startswith("#"):
                break
            header.append(line)
        newline = "\r\n" if "\r\n" in source else "\n"
        body = yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=1000)
        text = "".join(header) + body.replace("\n", newline)
        if raw.startswith(b"\xef\xbb\xbf"):
            text = "\ufeff" + text
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".members-",
                                             suffix=".tmp", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(text.encode("utf-8"))
                stream.flush()
                os.fsync(stream.fileno())
            self.checked(expected)
            temporary.replace(path)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)

    def save(self, payload: dict) -> dict:
        with self.app.lock:
            path, raw, data = self.checked(payload.get("revision"))
            member = payload.get("member")
            if not isinstance(member, dict) or set(member) - set(FIELDS):
                raise ContentError("Use the supported member fields: " + ", ".join(FIELDS))
            cleaned = {}
            for field, value in member.items():
                if not isinstance(value, str) or len(value) > (10000 if field == "bio" else 500):
                    raise ContentError(f"{field} must be text within its length limit.")
                if field != "bio" and any(ord(character) < 32 for character in value):
                    raise ContentError(f"{field} must be a single line without control characters.")
                if value.strip():
                    cleaned[field] = value.strip()
            if not cleaned.get("name"):
                raise ContentError("Member name is required.")
            for field in ("name", "nickname"):
                if cleaned.get(field) and PAREN_SUFFIX.search(cleaned[field]):
                    raise ContentError(f"Keep parenthesized nicknames/roles out of {field}.")
            if cleaned.get("nickname") and match_key(cleaned["nickname"]) == match_key(cleaned["name"]):
                raise ContentError("Nickname must differ from the member's plain name.")
            target = payload.get("group")
            if type(target) is not int or not 0 <= target < len(data["groups"]):
                raise ContentError("Choose an existing member group.")
            original = payload.get("original")
            old = None
            if original is not None:
                group, index = self.locate(data, original)
                old = data["groups"][group]["members"].pop(index)
            new_keys = {match_key(cleaned[key]) for key in ("name", "nickname") if cleaned.get(key)}
            for current_group in data["groups"]:
                for current in current_group["members"]:
                    if any(match_key(current[key]) in new_keys for key in ("name", "nickname")
                           if current.get(key)):
                        raise ContentError("This name/nickname belongs to another member.")
            for field in ("image", "modal_image"):
                value = cleaned.get(field)
                if value and (old is None or value != old.get(field)):
                    if not self.image_path(value).is_file():
                        raise ContentError(f"{field} points to a missing image: {value}")
            # Keep custom existing attributes while editing only the supported fields.
            updated = {key: value for key, value in (old or {}).items() if key not in FIELDS}
            updated.update(cleaned)
            insertion = index if original is not None and group == target else len(data["groups"][target]["members"])
            data["groups"][target]["members"].insert(insertion, updated)
            self.write(path, raw, data, payload["revision"])
            result = self.catalog()
            result["selected"] = {"group": target, "index": insertion}
            return result

    def delete(self, payload: dict) -> dict:
        with self.app.lock:
            path, raw, data = self.checked(payload.get("revision"))
            group, index = self.locate(data, payload.get("original"))
            if payload.get("confirm") is not True:
                raise ContentError("Confirm removal of the roster entry. Reports and images are preserved.")
            del data["groups"][group]["members"][index]
            self.write(path, raw, data, payload["revision"])
            return self.catalog()
