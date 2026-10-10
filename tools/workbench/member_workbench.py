"""Permanent people and independent membership editing with reference protection."""

import copy
import os
import tempfile
from difflib import SequenceMatcher
from pathlib import Path
import yaml

from tools.workbench.content_workbench import ConflictError, ContentError, local_asset_urls, parse_frontmatter, revision, split_source, patched_source
from tools.workbench.member_documents import MemberDocuments
from tools.workbench.people_registry import PROFILE_FIELDS, PERSON_ID, contact_lists, identity_keys, match_key, member_image_folder, page_references, person_index, registry_data, resolve_legacy, validate_social_links, validate_category_hint
from tools.workbench.participant_roles import assignment_roles, role_labels

FIELDS = (*PROFILE_FIELDS, "id", "aliases", "needs_review", "role", "roles")
class MemberService:
    def __init__(self, app, path_guard) -> None:
        self.app = app
        self.root = app.root
        self.guard = path_guard
        self.documents = MemberDocuments(self.root, path_guard)

    def read(self) -> tuple[Path, bytes, dict]:
        path = self.guard(self.root / "data", "people.yaml")
        raw = path.read_bytes()
        return path, raw, registry_data(raw, self.app.roles.read()[2])

    def image_path(self, value: str) -> Path:
        if not value.startswith("/images/"):
            raise ContentError("Member images must use a local /images/ URL.")
        if Path(value).suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
            raise ContentError("Member images must be JPG, PNG or WebP files.")
        return self.guard(self.root / "static", value.lstrip("/"))

    def reports(self) -> tuple[list[dict], list[str]]:
        entries, warnings, _ = self.scan_pages()
        return entries, warnings

    def scan_pages(self) -> tuple[list[dict], list[str], list[dict]]:
        entries, warnings, courses = [], [], []
        people = person_index(self.read()[2])
        roles = self.app.roles.read()[2]
        base = self.root / "content"
        for file in sorted(base.rglob("*.md")):
            relative = file.relative_to(self.root).as_posix()
            try:
                self.guard(base, file.relative_to(base).as_posix())
                frontmatter, _, _ = split_source(file.read_text(encoding="utf-8"))
                data = parse_frontmatter(frontmatter)
                context = {"path": relative, "title": data.get("title") or file.stem,
                           "section": file.relative_to(base).parts[0] if len(file.relative_to(base).parts) > 1 else "",
                           "date": data.get("date", ""), "draft": data.get("draft", False)}
                references = page_references(data, people, roles)
                assignments = {entry["person"] if isinstance(entry, dict) else entry:
                               entry if isinstance(entry, dict) else {}
                               for entry in data.get("participant_ids", [])}
                for entry in references:
                    if entry["field"] == "participant_ids":
                        assignment = assignments[entry["person"]]
                        entry["roles"] = assignment_roles(assignment, roles)
                        labels = {role["id"]: role["label"] for role in roles}
                        entry["role"] = ", ".join(labels[identifier] for identifier in entry["roles"]) or assignment.get("role", "")
                    entries.append({**context, **entry})
                names = data.get("participants", [])
                if not isinstance(names, list) or any(not isinstance(name, str) for name in names):
                    raise ContentError("Legacy participants must be a list of names.")
                for name in names:
                    entries.append({**context, "field": "participants", "name": name, "role": ""})
                if data.get("author"):
                    if not isinstance(data["author"], str):
                        raise ContentError("Legacy author must be text.")
                    entries.append({**context, "field": "author", "name": data["author"]})
                for location, contacts in contact_lists(data):
                    for contact in contacts:
                        if contact.get("name"):
                            entries.append({**context, "field": location, "name": contact["name"], "role": contact.get("role", "")})
                if context["section"] == "tanfolyamok" and file.stem != "_index":
                    courses.append(context)
            except (ContentError, OSError, UnicodeError) as exc:
                warnings.append(f"{relative}: {exc}")
        return entries, warnings, courses

    def catalog(self) -> dict:
        _, raw, data = self.read()
        definitions = self.app.roles.read()[2]
        reports, warnings, courses = self.scan_pages()
        people = copy.deepcopy(data["people"])
        lookup = {person["id"]: person for person in people}
        documents = self.documents.catalog(lookup)
        groups = [{"label": group["label"], "hint": group.get("hint", ""), "members": []} for group in data["groups"]]
        assigned = set()
        portrait_assignments = set()
        missing = []
        for person in people:
            person.update(original={"id": person["id"]}, references=[], membership=None)
            person["document"] = documents[person["id"]]
            assigned.update(local_asset_urls("---\n{}\n---\n" + person["document"]["body"]))
            for field in ("image", "modal_image"):
                value = person.get(field)
                if not value:
                    continue
                assigned.add(value)
                portrait_assignments.add(value)
                try:
                    if not self.image_path(value).is_file():
                        raise ContentError("File is missing.")
                except (ValueError, OSError) as exc:
                    missing.append({"name": person["name"], "field": field, "url": value, "error": str(exc)})
        for index, group in enumerate(data["groups"]):
            for entry in group["members"]:
                person = lookup[entry["person"]]
                label = role_labels(entry, definitions)
                person["membership"] = {"group": index, "label": group["label"], "role": label,
                                        "roles": assignment_roles(entry, definitions),
                                        "legacy_role": entry.get("role", "")}
                person["role"] = label
                groups[index]["members"].append(person)
        groups.append({"label": "Not current members",
                       "members": [person for person in people if person["membership"] is None]})
        unmatched, unmatched_authors, suggestions = [], [], []
        for report in reports:
            member = lookup.get(report.get("person")) if report.get("person") else resolve_legacy(
                {"people": people}, report["name"])
            if member is not None:
                member["references"].append(report)
            else:
                (unmatched if report["field"] == "participants" else unmatched_authors).append(report)
                scores = sorted(((max(SequenceMatcher(None, match_key(report["name"]), key).ratio()
                                      for key in identity_keys(person)), person) for person in people),
                                key=lambda item: item[0], reverse=True)
                suggestions.append({**report, "candidates": [
                    {"id": person["id"], "name": person["name"]} for score, person in scores[:3] if score >= .55]})
        categories = [
            {"id": f"membership:{index}", "label": group["label"], "hint": group.get("hint", ""), "kind": "membership",
             "people": [entry["person"] for entry in group["members"]]}
            for index, group in enumerate(data["groups"])
        ]
        for course in courses:
            field = "participant_ids" if any(
                report["path"] == course["path"] and report["field"] == "participant_ids"
                for report in reports) else "participants"
            participants = [person["id"] for person in people if any(
                reference["path"] == course["path"] and reference["field"] == field
                for reference in person["references"])]
            categories.append({"id": "course:" + course["path"], "label": course["title"],
                               "kind": "course", "path": course["path"], "date": course["date"],
                               "draft": course["draft"], "people": participants})
        categories.extend({**category, "id": "custom:" + category["id"], "kind": "custom"}
                          for category in data.get("categories", []))
        for person in people:
            person["categories"] = [{key: value for key, value in category.items() if key != "people"}
                                    for category in categories if person["id"] in category["people"]]
            person["course_participant"] = any(category["kind"] == "course" for category in person["categories"])
        portraits = []
        folder = self.root / "static" / "images" / "members"
        for file in sorted(folder.rglob("*")):
            if file.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
                continue
            url = "/images/members/" + file.relative_to(folder).as_posix()
            if url not in portrait_assignments and not file.name.endswith(("_thumb.webp", "_full.webp")):
                continue
            try:
                if self.image_path(url).is_file():
                    portraits.append(url)
            except (ValueError, OSError) as exc:
                warnings.append(f"{url}: {exc}")
        return {"revision": revision(raw), "people": people, "groups": groups, "categories": categories, "portraits": portraits,
                "role_catalog": self.app.roles.catalog(),
                "audit": {"missing_images": missing, "unassigned_portraits": [
                    url for url in portraits if url not in assigned],
                    "unmatched_participants": unmatched, "unmatched_authors": unmatched_authors,
                    "people_needing_review": [person for person in people if person.get("needs_review")],
                    "suggestions": suggestions, "warnings": warnings}}

    def checked(self, expected: object) -> tuple[Path, bytes, dict]:
        path = self.guard(self.root / "data", "people.yaml")
        try:
            raw = path.read_bytes()
        except FileNotFoundError as exc:
            raise ConflictError("The people registry was removed outside this editor. Restore it and reload; your draft has not been written.") from exc
        if not isinstance(expected, str) or revision(raw) != expected:
            raise ConflictError("The people registry changed outside this editor. Reload before saving/deleting; your draft has not been written.")
        return path, raw, registry_data(raw, self.app.roles.read()[2])

    def loose_image(self, url: object) -> Path:
        if not isinstance(url, str) or not url.startswith("/images/members/"):
            raise ContentError("Only portrait files under /images/members/ can be deleted here.")
        path = self.image_path(url)
        if not path.is_file():
            raise ConflictError(f"Portrait is missing or was removed. Reload the checks: {url}")
        return path

    def portrait_upload_plan(self, payload: dict) -> dict:
        with self.app.lock:
            data = self.read()[2]
            identifier = payload.get("person")
            folder = member_image_folder(identifier)
            files = []
            for suffix in ("_thumb.webp", "_full.webp"):
                url = f"/images/{folder}/{identifier}{suffix}"
                path = self.image_path(url)
                if path.exists() and not path.is_file():
                    raise ContentError(f"Portrait destination is not a file: {url}")
                if path.is_file():
                    references = self.portrait_external_references(data, identifier, path)
                    if references:
                        raise ConflictError(f"Replacing {url} would change other saved references: " + ", ".join(references))
                    files.append({"url": url, "revision": revision(path.read_bytes())})
            return {"person": identifier, "files": files}

    def portrait_external_references(self, data: dict, identifier: str, path: Path) -> list[str]:
        references = [value for value in self.app.content.references(path.name) if value != "data/people.yaml"]
        remaining = copy.deepcopy(data)
        for person in remaining["people"]:
            if person["id"] == identifier:
                for field in ("image", "modal_image"):
                    person.pop(field, None)
        if path.name.casefold() in yaml.safe_dump(remaining, allow_unicode=True).casefold():
            references.append("data/people.yaml (another profile or CV)")
        return references

    def assigned_portrait_plan(self, payload: dict) -> dict:
        with self.app.lock:
            _, _, data = self.checked(payload.get("revision"))
            index = self.locate(data, payload.get("original"))
            person = data["people"][index]
            files = []
            for url in dict.fromkeys(person.get(field) for field in ("image", "modal_image") if person.get(field)):
                path = self.loose_image(url)
                files.append({"url": url, "revision": revision(path.read_bytes()),
                              "references": self.portrait_external_references(data, person["id"], path)})
            if not files:
                raise ContentError("This person has no saved portrait files to delete.")
            return {"revision": payload["revision"], "original": payload["original"], "files": files}

    def delete_assigned_portraits(self, payload: dict) -> dict:
        with self.app.lock:
            if payload.get("confirm") is not True:
                raise ContentError("Confirm deleting this person's saved portrait files.")
            plan = self.assigned_portrait_plan(payload)
            if payload.get("files") != plan["files"]:
                raise ConflictError("Portrait files or references changed. Review deletion again.")
            if any(file["references"] for file in plan["files"]):
                raise ConflictError("These portrait files are used elsewhere. Remove their assignments only; keep shared files.")
            path, raw, data = self.checked(payload["revision"])
            person = data["people"][self.locate(data, payload["original"])]
            for field in ("image", "modal_image"):
                person.pop(field, None)
            with tempfile.TemporaryDirectory(dir=self.app.scratch, prefix="delete-assigned-") as staging:
                moved = []
                try:
                    for index, file in enumerate(plan["files"]):
                        image = self.loose_image(file["url"])
                        temporary = Path(staging) / str(index)
                        image.replace(temporary)
                        moved.append((image, temporary))
                    self.write(path, raw, data, payload["revision"])
                except (OSError, ContentError):
                    for image, temporary in reversed(moved):
                        temporary.replace(image)
                    raise
            return self.catalog()

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

    def locate(self, data: dict, original: object) -> int:
        if not isinstance(original, dict) or not isinstance(original.get("id"), str):
            raise ContentError("Choose a person from the current registry.")
        for index, person in enumerate(data["people"]):
            if person["id"] == original["id"]:
                return index
        raise ContentError("The selected person no longer exists. Reload the registry.")

    @staticmethod
    def serialized(raw: bytes, data: dict) -> bytes:
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
        return text.encode("utf-8")

    def write(self, path: Path, raw: bytes, data: dict, expected: str) -> None:
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".members-",
                                             suffix=".tmp", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(self.serialized(raw, data))
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
            if isinstance(member, dict) and {"cv", "cv_label", "cv_subtitle"} & member.keys():
                raise ContentError("CV content must be saved as a top-level document object backed by a member-cv Markdown page.")
            if not isinstance(member, dict) or set(member) - set(FIELDS):
                raise ContentError("Use the supported person fields: " + ", ".join(FIELDS))
            cleaned = {}
            if "roles" in member:
                assignment_roles(member, self.app.roles.read()[2])
            for field, value in member.items():
                if field == "show_profile_contacts":
                    if not isinstance(value, bool):
                        raise ContentError("show_profile_contacts must be true or false.")
                    cleaned[field] = value
                    continue
                if field == "social_links":
                    validate_social_links(value)
                    if value:
                        cleaned[field] = value
                    continue
                if field == "roles":
                    cleaned[field] = value
                    continue
                if field in ("aliases", "needs_review"):
                    if field == "aliases" and (not isinstance(value, list)
                                               or any(not isinstance(alias, str) for alias in value)):
                        raise ContentError("Aliases must be a list of names.")
                    if field == "needs_review" and not isinstance(value, bool):
                        raise ContentError("needs_review must be true or false.")
                    cleaned[field] = value
                    continue
                if not isinstance(value, str) or len(value) > (10000 if field == "bio" else 500):
                    raise ContentError(f"{field} must be text within its length limit.")
                if field != "bio" and any(ord(character) < 32 for character in value):
                    raise ContentError(f"{field} must be a single line without control characters.")
                if value.strip():
                    cleaned[field] = value.strip()
            target = payload.get("group")
            if target is not None and (type(target) is not int or not 0 <= target < len(data["groups"])):
                raise ContentError("Choose an existing membership group or no membership.")
            original = payload.get("original")
            old = None
            if original is not None:
                index = self.locate(data, original)
                old = data["people"][index]
                if cleaned.get("id", old["id"]) != old["id"]:
                    raise ContentError("Ordinary profile saves cannot change person IDs. Use the reviewed ID change workflow.")
                cleaned["id"] = old["id"]
            elif not cleaned.get("id"):
                raise ContentError("A new person needs a permanent ID, e.g. gyovai-tamas.")
            for field in ("image", "modal_image"):
                value = cleaned.get(field)
                if value and (old is None or value != old.get(field)):
                    if not self.image_path(value).is_file():
                        raise ContentError(f"{field} points to a missing image: {value}")
            role = cleaned.pop("role", "")
            roles = cleaned.pop("roles", None)
            chosen_categories = payload.get("categories")
            if "categories" in payload:
                known = {category["id"] for category in data.get("categories", [])}
                if (not isinstance(chosen_categories, list)
                        or any(not isinstance(value, str) or value not in known for value in chosen_categories)
                        or len(set(chosen_categories)) != len(chosen_categories)):
                    raise ContentError("Choose unique existing custom categories. Course groups are assigned from saved page roles.")
            updated = {key: value for key, value in (old or {}).items() if key not in FIELDS}
            if old and "social_links" not in member and old.get("social_links"):
                updated["social_links"] = old["social_links"]
            if old and "show_profile_contacts" not in member and "show_profile_contacts" in old:
                updated["show_profile_contacts"] = old["show_profile_contacts"]
            updated.update(cleaned)
            if old:
                # Old spellings remain resolvable for historical, name-only content.
                aliases = set(updated.get("aliases", []))
                for field in ("name", "nickname"):
                    if old.get(field) and old[field] != updated.get(field):
                        aliases.add(old[field])
                updated["aliases"] = sorted(aliases)
                data["people"][index] = updated
            else:
                data["people"].append(updated)
            identifier = updated["id"]
            if chosen_categories is not None:
                for category in data.get("categories", []):
                    if identifier in category["people"] and category["id"] not in chosen_categories:
                        category["people"].remove(identifier)
                    elif identifier not in category["people"] and category["id"] in chosen_categories:
                        category["people"].append(identifier)
            insertion = None
            for group_index, group in enumerate(data["groups"]):
                for member_index, entry in enumerate(group["members"]):
                    if entry["person"] == identifier:
                        if group_index == target:
                            insertion = member_index
                        group["members"].pop(member_index)
                        break
            if target is not None:
                entry = {"person": identifier}
                if roles is not None:
                    entry["roles"] = roles
                elif role:
                    entry["role"] = role
                members = data["groups"][target]["members"]
                members.insert(len(members) if insertion is None else insertion, entry)
            registry_data(yaml.safe_dump(data, allow_unicode=True, sort_keys=False).encode("utf-8"),
                          self.app.roles.read()[2])
            if "document" in payload:
                document_change = self.documents.save_change(person_index(data), identifier, payload["document"])
                changes = []
                if document_change:
                    changes.append(document_change)
                changes.append((path, raw, self.serialized(raw, data)))
                self.commit_identity_changes(changes, payload["revision"])
            else:
                self.write(path, raw, data, payload["revision"])
            result = self.catalog()
            result["selected"] = {"id": identifier}
            retained_images = {updated.get(field) for field in ("image", "modal_image")}
            result["replaced_portraits"] = list(dict.fromkeys(
                old[field] for field in ("image", "modal_image")
                if old and old.get(field) and old[field] not in retained_images))
            return result

    def delete(self, payload: dict) -> dict:
        with self.app.lock:
            path, raw, data = self.checked(payload.get("revision"))
            index = self.locate(data, payload.get("original"))
            if payload.get("confirm") is not True:
                raise ContentError("Confirm permanent deletion of this unused identity. Images are preserved.")
            identifier = data["people"][index]["id"]
            _, warnings = self.reports()
            if warnings:
                raise ConflictError("Cannot safely delete while reference checks fail: " + "; ".join(warnings))
            person = next(person for person in self.catalog()["people"] if person["id"] == identifier)
            if person["membership"] is not None or person["references"]:
                raise ConflictError("This person is a current member or has page references. Remove membership only, or merge identities; historical credits must be preserved.")
            del data["people"][index]
            for category in data.get("categories", []):
                category["people"] = [person for person in category["people"] if person != identifier]
            self.write(path, raw, data, payload["revision"])
            return self.catalog()

    def save_category(self, payload: dict) -> dict:
        with self.app.lock:
            path, raw, data = self.checked(payload.get("revision"))
            identifier, label, original = payload.get("id"), payload.get("label"), payload.get("original")
            categories = data.setdefault("categories", [])
            hint = payload.get("hint", "")
            validate_category_hint(hint)
            if original is None:
                category = {"id": identifier, "label": label, "people": []}
                if "hint" in payload:
                    category["hint"] = hint.strip()
                categories.append(category)
            else:
                category = next((entry for entry in categories if entry["id"] == original), None)
                if category is None:
                    raise ContentError("Choose an existing custom category to edit.")
                if identifier != original:
                    raise ContentError("Saved category IDs cannot be changed; edit the label instead.")
                category["label"] = label
                if "hint" in payload:
                    category["hint"] = hint.strip()
            encoded = self.serialized(raw, data)
            registry_data(encoded)
            self.write(path, raw, data, payload["revision"])
            return self.catalog()

    def save_group_hint(self, payload: dict) -> dict:
        with self.app.lock:
            path, raw, data = self.checked(payload.get("revision"))
            index = payload.get("group")
            if type(index) is not int or not 0 <= index < len(data["groups"]):
                raise ContentError("Choose an existing membership category.")
            hint = payload.get("hint")
            validate_category_hint(hint)
            data["groups"][index]["hint"] = hint.strip()
            self.write(path, raw, data, payload["revision"])
            return self.catalog()

    def convert_cv_image(self, payload: dict) -> dict:
        with self.app.lock:
            _, _, data = self.checked(payload.get("revision"))
            identifier = payload.get("person")
            if not isinstance(identifier, str) or identifier not in person_index(data):
                raise ContentError("Save and select a person before uploading CV images.")
            folder = member_image_folder(identifier)
            if "folder" in payload and payload["folder"] != folder:
                raise ContentError("CV images must go to this person's own folder.")
            return self.app.convert({**payload, "folder": folder, "name": f"{identifier}-cv"})

    def delete_category(self, payload: dict) -> dict:
        with self.app.lock:
            path, raw, data = self.checked(payload.get("revision"))
            identifier = payload.get("id")
            category = next((entry for entry in data.get("categories", []) if entry["id"] == identifier), None)
            if category is None:
                raise ContentError("Choose an existing custom category. Automatic groups cannot be deleted here.")
            if payload.get("confirm") is not True:
                raise ContentError("Confirm deletion of this empty custom category.")
            if category["people"]:
                raise ConflictError("Remove this category from its people and save them before deleting the category.")
            data["categories"].remove(category)
            self.write(path, raw, data, payload["revision"])
            return self.catalog()

    def merge_changes(self, data: dict, source: str, target: str, *, rename: bool = False) -> list[tuple[Path, bytes, bytes | None]]:
        changes = []
        people = person_index(data)
        definitions = self.app.roles.read()[2]
        discard_documents = set()
        if not rename:
            documents = self.documents.index(people)
            source_document, target_document = documents.get(source), documents.get(target)
            if (source_document and source_document["body"].strip()
                    and target_document and target_document["body"].strip()):
                raise ContentError("Both people have non-empty documents. Resolve them before merging identities.")
            if source_document and target_document:
                discard_documents.add(
                    target_document["path"] if source_document["body"].strip() else source_document["path"])
        for file in sorted((self.root / "content").rglob("*.md")):
            self.guard(self.root / "content", file.relative_to(self.root / "content").as_posix())
            raw = file.read_bytes()
            text = raw.decode("utf-8")
            meta = parse_frontmatter(split_source(text)[0])
            page_references(meta, people, definitions)
            relative = file.relative_to(self.root / "content").as_posix()
            if relative in discard_documents:
                changes.append((file, raw, None))
                continue
            patched = {}
            if meta.get("type") == "member-cv" and not meta.get("cv_preview") and meta.get("person") == source:
                patched["person"] = target
            if meta.get("author_id") == source:
                patched["author_id"] = target
            if not rename and meta.get("author") and (resolve_legacy(data, meta["author"]) or {}).get("id") == source:
                patched.update(author="", author_id=target)
            participants = meta.get("participant_ids", [])
            if not rename and meta.get("participants"):
                converted = []
                for name in meta["participants"]:
                    match = resolve_legacy(data, name)
                    if match is None:
                        if any((resolve_legacy(data, value) or {}).get("id") == source
                               for value in meta["participants"]):
                            raise ContentError(f"{file.name}: resolve all legacy participants before merging.")
                        break
                    converted.append(match["id"])
                else:
                    if source in converted:
                        participants = converted
                        patched["participants"] = []
            if any((entry.get("person") if isinstance(entry, dict) else entry) == source for entry in participants):
                updated, assigned_roles, positions = [], {}, {}
                for entry in participants:
                    identifier = entry.get("person") if isinstance(entry, dict) else entry
                    assignment = entry if isinstance(entry, dict) else {}
                    ids = assignment_roles(assignment, definitions)
                    role = ("roles", frozenset(ids)) if ids or not assignment.get("role") else ("role", assignment["role"])
                    identifier = target if identifier == source else identifier
                    if identifier in assigned_roles:
                        if assigned_roles[identifier] != role:
                            raise ContentError(f"{file.name}: merge would combine different participant roles. Clarify the assignments first.")
                        if "roles" in assignment:
                            updated[positions[identifier]] = {**assignment, "person": identifier}
                        continue
                    assigned_roles[identifier] = role
                    positions[identifier] = len(updated)
                    if isinstance(entry, dict):
                        updated.append({**entry, "person": identifier})
                    else:
                        updated.append(identifier)
                patched["participant_ids"] = updated
            updated_meta = copy.deepcopy(meta)
            for location, contacts in contact_lists(updated_meta):
                changed = False
                for contact in contacts:
                    if contact.get("person") == source:
                        contact["person"] = target
                        changed = True
                    elif not rename and contact.get("name") and (resolve_legacy(data, contact["name"]) or {}).get("id") == source:
                        contact.pop("name")
                        contact["person"] = target
                        changed = True
                if changed:
                    key = "content_blocks" if location.startswith("content_blocks.") else "contacts"
                    patched[key] = updated_meta[key]
            if patched:
                changes.append((file, raw, patched_source(text, patched).encode("utf-8")))
        return changes

    def rename_plan(self, payload: dict) -> dict:
        with self.app.lock:
            _, _, data = self.checked(payload.get("revision"))
            source, target = payload.get("source"), payload.get("target")
            people = person_index(data)
            if not isinstance(source, str) or source not in people:
                raise ContentError("Choose an existing person to change their ID.")
            if (not isinstance(target, str) or len(target) > 200
                    or not PERSON_ID.fullmatch(target) or target == source):
                raise ContentError("Choose a different lowercase hyphenated person ID, up to 200 characters.")
            if target in people:
                raise ContentError("That ID already belongs to another person. Use identity merge only if they are the same person.")
            _, warnings = self.reports()
            if warnings:
                raise ConflictError("Cannot safely change an ID while reference checks fail: " + "; ".join(warnings))
            changes = self.merge_changes(data, source, target, rename=True)
            files = []
            for path, raw, _ in changes:
                meta = parse_frontmatter(split_source(raw.decode("utf-8"))[0])
                files.append({"path": path.relative_to(self.root).as_posix(), "revision": revision(raw),
                              "fields": sorted({entry["field"] for entry in page_references(meta, people)
                                                if entry["person"] == source})})
            memberships = [{"group": group["label"], "role": role_labels(entry, self.app.roles.read()[2])}
                           for group in data["groups"] for entry in group["members"]
                           if entry["person"] == source]
            categories = [category["label"] for category in data.get("categories", []) if source in category["people"]]
            return {"revision": payload["revision"], "source": source, "target": target,
                    "files": files, "memberships": memberships, "categories": categories}

    def rename(self, payload: dict) -> dict:
        with self.app.lock:
            if payload.get("confirm") is not True:
                raise ContentError("Review and confirm the person ID change.")
            plan = self.rename_plan(payload)
            if (payload.get("files") != plan["files"] or payload.get("memberships") != plan["memberships"]
                    or payload.get("categories", []) != plan["categories"]):
                raise ConflictError("References changed since the ID change review. Review again.")
            path, raw, data = self.checked(payload["revision"])
            source, target = plan["source"], plan["target"]
            changes = self.merge_changes(data, source, target, rename=True)
            if [(file.relative_to(self.root).as_posix(), revision(before)) for file, before, _ in changes] != [
                    (file["path"], file["revision"]) for file in plan["files"]]:
                raise ConflictError("Page references changed during ID change preparation. Review again.")
            person_index(data)[source]["id"] = target
            for category in data.get("categories", []):
                category["people"] = [target if person == source else person for person in category["people"]]
            for group in data["groups"]:
                for entry in group["members"]:
                    if entry["person"] == source:
                        entry["person"] = target
            encoded = self.serialized(raw, data)
            registry_data(encoded)
            for _, _, updated in changes:
                page_references(parse_frontmatter(split_source(updated.decode("utf-8"))[0]), person_index(data))
            changes.append((path, raw, encoded))
            self.commit_identity_changes(changes, payload["revision"])
            result = self.catalog()
            result["selected"] = {"id": target}
            return result

    def merge_plan(self, payload: dict) -> dict:
        with self.app.lock:
            _, _, data = self.checked(payload.get("revision"))
            source, target = payload.get("source"), payload.get("target")
            people = person_index(data)
            if (not isinstance(source, str) or not isinstance(target, str)
                    or source == target or source not in people or target not in people):
                raise ContentError("Choose two different existing identities to merge.")
            changes = self.merge_changes(data, source, target)
            membership = {}
            for group in data["groups"]:
                for member in group["members"]:
                    membership[member["person"]] = group["label"]
            return {"revision": payload["revision"], "source": source, "target": target,
                    "files": [{"path": path.relative_to(self.root).as_posix(), "revision": revision(raw)}
                              for path, raw, _ in changes],
                    "profile_conflicts": [field for field in PROFILE_FIELDS
                                         if (field in people[source] and field in people[target]
                                             if field == "show_profile_contacts"
                                             else people[source].get(field) and people[target].get(field))
                                         and people[source][field] != people[target][field]],
                    "categories": [category["label"] for category in data.get("categories", [])
                                   if source in category["people"] or target in category["people"]],
                    "membership_note": "Target membership is kept; source membership is transferred only if the target is not a current member."}

    def merge(self, payload: dict) -> dict:
        with self.app.lock:
            if payload.get("confirm") is not True:
                raise ContentError("Review and confirm the identity merge.")
            plan = self.merge_plan(payload)
            if payload.get("files") != plan["files"]:
                raise ConflictError("Page references changed since the merge review. Review again.")
            path, raw, data = self.checked(payload["revision"])
            source, target = plan["source"], plan["target"]
            changes = self.merge_changes(data, source, target)
            people = person_index(data)
            old, kept = people[source], people[target]
            for field in PROFILE_FIELDS:
                if field == "show_profile_contacts":
                    # A merge must never broaden the target's publication consent.
                    continue
                if not kept.get(field) and old.get(field):
                    kept[field] = old[field]
            aliases = set(kept.get("aliases", [])) | set(old.get("aliases", []))
            aliases.update(value for value in (old["name"], old.get("nickname")) if value)
            aliases.difference_update(value for value in (kept["name"], kept.get("nickname")) if value)
            kept["aliases"] = sorted(aliases)
            kept["needs_review"] = kept.get("needs_review", False) or old.get("needs_review", False)
            for category in data.get("categories", []):
                category["people"] = list(dict.fromkeys(target if person == source else person
                                                       for person in category["people"]))
            target_member = any(entry["person"] == target for group in data["groups"] for entry in group["members"])
            for group in data["groups"]:
                members = []
                for entry in group["members"]:
                    if entry["person"] == source:
                        if target_member:
                            continue
                        entry["person"] = target
                    members.append(entry)
                group["members"] = members
            data["people"] = [person for person in data["people"] if person["id"] != source]
            encoded = self.serialized(raw, data)
            registry_data(encoded)
            for _, _, updated in changes:
                page_references(parse_frontmatter(split_source(updated.decode("utf-8"))[0]), person_index(data))
            changes.append((path, raw, encoded))
            self.commit_identity_changes(changes, payload["revision"])
            result = self.catalog()
            result["selected"] = {"id": target}
            return result

    def commit_identity_changes(self, changes: list[tuple[Path, bytes, bytes | None]], expected: str) -> None:
        # Stage every source and backup before replacing files; roll back handled failures.
        staged, replaced = [], []
        try:
            for file, before, after in changes:
                if after is not None:
                    file.parent.mkdir(parents=True, exist_ok=True)
                temporary_paths = []
                values = (() if before is None else (before,)) + (() if after is None else (after,))
                for value in values:
                    with tempfile.NamedTemporaryFile(dir=file.parent, prefix=".people-",
                                                     suffix=".tmp", delete=False) as stream:
                        temporary_paths.append(Path(stream.name))
                        staged.append(Path(stream.name))
                        stream.write(value)
                        stream.flush()
                        os.fsync(stream.fileno())
                backup = temporary_paths[0] if before is not None else None
                prepared = temporary_paths[-1] if after is not None else None
                current = file.read_bytes() if file.exists() else None
                if current != before:
                    raise ConflictError(f"{file.name} changed during identity update preparation.")
                replaced.append((file, before, after, backup, prepared, False))
            self.checked(expected)
            for index, (file, before, after, backup, prepared, _) in enumerate(replaced):
                current = file.read_bytes() if file.exists() else None
                if current != before:
                    raise ConflictError(f"{file.name} changed during identity update.")
                if after is None:
                    file.unlink()
                else:
                    assert prepared is not None
                    prepared.replace(file)
                replaced[index] = (file, before, after, backup, prepared, True)
        except (OSError, ContentError):
            for file, before, after, backup, prepared, committed in reversed(replaced):
                if committed:
                    if after is None:
                        if file.exists():
                            raise ConflictError(f"{file.name} changed externally during identity update rollback. Restore it from version control.")
                        assert backup is not None
                        backup.replace(file)
                    elif before is None:
                        if not file.exists() or file.read_bytes() != after:
                            raise ConflictError(f"{file.name} changed externally during identity update rollback. Restore it from version control.")
                        file.unlink()
                    else:
                        if file.read_bytes() != after:
                            raise ConflictError(f"{file.name} changed externally during identity update rollback. Restore it from version control.")
                        assert backup is not None
                        backup.replace(file)
            raise
        finally:
            for temporary in staged:
                temporary.unlink(missing_ok=True)
