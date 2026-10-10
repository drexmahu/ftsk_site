"""Shared file-backed role vocabulary for membership and page assignments."""

import os
import re
import tempfile
import unicodedata
from pathlib import Path

import yaml

from tools.workbench.content_workbench import ConflictError, ContentError, parse_frontmatter, revision, split_source


def role_key(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip()).casefold()


def role_data(raw: bytes) -> list[dict]:
    data = parse_frontmatter(raw.decode("utf-8-sig"))
    roles = data.get("roles")
    if not isinstance(roles, list):
        raise ContentError("Participant role data needs a roles list.")
    ids, labels = set(), set()
    for role in roles:
        if not isinstance(role, dict) or set(role) - {"id", "label", "aliases", "exempt_from_guest", "automatic_when"}:
            raise ContentError("Role fields are id, label, aliases, exempt_from_guest and automatic_when.")
        identifier = role.get("id")
        if (not isinstance(identifier, str) or len(identifier) > 100
                or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", identifier) or identifier in ids):
            raise ContentError("Role IDs must be unique lowercase hyphenated identifiers, up to 100 characters.")
        aliases = role.get("aliases", [])
        if not isinstance(aliases, list) or len(aliases) > 100:
            raise ContentError("Role aliases must be a list of at most 100 labels.")
        names = [role.get("label"), *aliases]
        for name in names:
            if (not isinstance(name, str) or not name.strip() or len(name) > 200
                    or any(ord(char) < 32 for char in name)):
                raise ContentError("Role names and aliases must be non-empty single-line text, up to 200 characters.")
            key = role_key(name)
            if key in labels:
                raise ContentError(f"Duplicate role name or alias: {name}.")
            labels.add(key)
        if not isinstance(role.get("exempt_from_guest", False), bool):
            raise ContentError("exempt_from_guest must be true or false.")
        if "automatic_when" in role:
            rule = role["automatic_when"]
            if (not isinstance(rule, dict) or not rule
                    or set(rule) - {"current_member", "course_participant"}
                    or any(not isinstance(value, bool) for value in rule.values())):
                raise ContentError("automatic_when needs current_member and/or course_participant boolean conditions.")
        ids.add(identifier)
    for member in (False, True):
        for course in (False, True):
            matches = automatic_roles(roles, member, course)
            if len(matches) > 1:
                raise ContentError(f"Automatic rules overlap: {', '.join(role['id'] for role in matches)}. Narrow their conditions.")
    return roles


def automatic_roles(roles: list[dict], current_member: bool, course_participant: bool) -> list[dict]:
    facts = {"current_member": current_member, "course_participant": course_participant}
    return [role for role in roles if role.get("automatic_when") and
            all(facts[key] == value for key, value in role["automatic_when"].items())]


def read_roles(root) -> list[dict]:
    path = root / "data" / "participant_roles.yaml"
    return role_data(path.read_bytes()) if path.exists() else []


def assignment_roles(entry: dict, roles: list[dict] | None = None) -> list[str]:
    if "roles" in entry:
        if "role" in entry:
            raise ContentError("Use roles (a list of global role IDs) or legacy role text, not both.")
        values = entry["roles"]
        if (not isinstance(values, list) or any(not isinstance(value, str) or not value for value in values)
                or len(values) != len(set(values))):
            raise ContentError("Participant roles must be a list of distinct global role IDs.")
        if roles is not None:
            unknown = set(values) - {role["id"] for role in roles}
            if unknown:
                raise ContentError(f"Unknown participant role IDs: {', '.join(sorted(unknown))}. Choose a configured role.")
        return values
    value = entry.get("role", "")
    if not isinstance(value, str) or len(value) > 500 or any(ord(char) < 32 for char in value):
        raise ContentError("Legacy participant role must be single-line text, up to 500 characters.")
    if not value or roles is None:
        return []
    lookup = {role_key(name): role["id"] for role in roles
              for name in [role["label"], *role.get("aliases", [])]}
    parts = [role_key(part) for part in value.split(",")]
    if any(part not in lookup for part in parts):
        return []
    return list(dict.fromkeys(lookup[part] for part in parts))


def role_labels(entry: dict, roles: list[dict]) -> str:
    ids = assignment_roles(entry, roles)
    labels = {role["id"]: role["label"] for role in roles}
    return ", ".join(labels[identifier] for identifier in ids) if "roles" in entry else entry.get("role", "")


class RoleService:
    def __init__(self, app, guard):
        self.app, self.root, self.guard = app, app.root, guard

    def read(self):
        path = self.guard(self.root / "data", "participant_roles.yaml")
        raw = path.read_bytes() if path.exists() else b"roles: []\n"
        return path, raw, role_data(raw)

    def catalog(self):
        _, raw, roles = self.read()
        references, warnings, fingerprints = [], [], [raw]
        from tools.workbench.people_registry import registry_data
        people_path = self.guard(self.root / "data", "people.yaml")
        people_raw = people_path.read_bytes()
        fingerprints.append(people_raw)
        registry = registry_data(people_raw, roles)
        for group in registry["groups"]:
            for entry in group["members"]:
                ids = assignment_roles(entry, roles)
                for identifier in ids:
                    references.append({"id": identifier, "person": entry["person"], "kind": "membership",
                                       "path": "data/people.yaml", "title": group["label"]})
                if entry.get("role") and not ids:
                    warnings.append(f"data/people.yaml: {entry['person']}: unconfigured legacy role {entry['role']!r}; choose configured roles in the person editor.")
        for file in sorted((self.root / "content").rglob("*.md")):
            relative = file.relative_to(self.root).as_posix()
            try:
                self.guard(self.root / "content", file.relative_to(self.root / "content").as_posix())
                source = file.read_bytes()
                fingerprints.extend([relative.encode(), source])
                meta = parse_frontmatter(split_source(source.decode("utf-8-sig"))[0])
                entries = meta.get("participant_ids", [])
                if not isinstance(entries, list):
                    raise ContentError("participant_ids must be a list.")
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    ids = assignment_roles(entry, roles)
                    for identifier in ids:
                        references.append({"id": identifier, "person": entry.get("person"), "kind": "page",
                                           "path": relative, "title": meta.get("title", file.stem)})
                    if entry.get("role") and not ids:
                        warnings.append(f"{relative}: unconfigured legacy role {entry['role']!r}; choose configured roles in the page editor.")
            except (ContentError, OSError, UnicodeError) as exc:
                warnings.append(f"{relative}: {exc}")
        return {"roles": roles, "references": references, "warnings": warnings,
                "revision": revision(b"\0".join(fingerprints))}

    def mutate(self, payload, delete=False):
        with self.app.lock:
            catalog = self.catalog()
            if payload.get("revision") != catalog["revision"]:
                raise ConflictError("Role definitions, people or saved pages changed. Reload roles before continuing.")
            path, _, roles = self.read()
            identifier, original = payload.get("id"), payload.get("original")
            old = next((role for role in roles if role["id"] == original), None)
            if original and old is None:
                raise ContentError("The selected role no longer exists.")
            if original and identifier != original:
                raise ContentError("Existing role IDs are permanent. Edit the label instead.")
            if delete:
                if not old or payload.get("confirm") is not True:
                    raise ContentError("Choose a role and explicitly confirm deletion.")
                if old.get("automatic_when"):
                    raise ContentError("Disable and save this role's automatic rule before deleting it.")
                if catalog["warnings"]:
                    raise ContentError("Deletion is blocked until page scan warnings are resolved; usage cannot be safely established.")
                uses = [entry for entry in catalog["references"] if entry["id"] == identifier]
                if uses:
                    raise ContentError("This role is assigned to current members or on saved pages. Remove those assignments before deleting it.")
                roles.remove(old)
            else:
                role = {"id": identifier, "label": payload.get("label"),
                        "aliases": payload.get("aliases", []),
                        "exempt_from_guest": payload.get("exempt_from_guest", False)}
                rule = payload.get("automatic_when", old.get("automatic_when") if old else None)
                if rule is not None:
                    role["automatic_when"] = rule
                if (old and isinstance(role["label"], str) and isinstance(role["aliases"], list)
                        and all(isinstance(name, str) for name in role["aliases"])):
                    role["aliases"] = [name for name in role["aliases"] if role_key(name) != role_key(role["label"])]
                role_data(yaml.safe_dump({"roles": [role]}, allow_unicode=True).encode("utf-8"))
                if old:
                    # Retain the previous name so existing legacy assignments still resolve.
                    if role_key(old["label"]) != role_key(role["label"] or ""):
                        if role_key(old["label"]) not in {role_key(name) for name in role["aliases"]}:
                            role["aliases"] = [*role["aliases"], old["label"]]
                    roles[roles.index(old)] = role
                else:
                    roles.append(role)
            raw = yaml.safe_dump({"roles": roles}, allow_unicode=True, sort_keys=False).encode("utf-8")
            role_data(raw)
            if not delete:
                new_keys = {role_key(name) for name in [role["label"], *role["aliases"]]}
                old_keys = {role_key(name) for name in [old["label"], *old.get("aliases", [])]} if old else set()
                if old_keys - new_keys:
                    raise ContentError("Keep existing aliases so historical page assignments continue to resolve.")
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".roles-", suffix=".tmp", delete=False) as stream:
                    temporary = Path(stream.name)
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                if payload["revision"] != self.catalog()["revision"]:
                    raise ConflictError("Roles, people or saved pages changed during saving. Reload and try again.")
                temporary.replace(path)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
            return self.app.members.catalog()
