"""File-backed member CV documents and their registry-facing representation."""

import re
from pathlib import Path

import yaml

from tools.workbench.content_workbench import ConflictError, ContentError, parse_frontmatter, revision, split_source, patched_source
from tools.workbench.people_registry import PERSON_ID

DEFAULT_LABEL = "CV"
MAX_BODY = 100000
MAX_LINE = 500
_PATH = re.compile(r"[\w-]+(?:/[\w-]+)*\.md\Z")

def validate_author(value: object) -> str:
    if not isinstance(value, str) or len(value) > MAX_LINE or any(ord(character) < 32 for character in value):
        raise ContentError(f"Document author must be single-line text up to {MAX_LINE} characters.")
    return value.strip()


def validate_document_fields(body, label, subtitle) -> tuple[str, str, str]:
    if not isinstance(body, str) or len(body) > MAX_BODY:
        raise ContentError(f"Document body must be text up to {MAX_BODY} characters.")
    if not isinstance(label, str) or len(label) > MAX_LINE:
        raise ContentError(f"Document label must be text up to {MAX_LINE} characters.")
    if not isinstance(subtitle, str) or len(subtitle) > MAX_LINE:
        raise ContentError(f"Document subtitle must be text up to {MAX_LINE} characters.")
    for field, value in (("label", label), ("subtitle", subtitle)):
        if any(ord(character) < 32 for character in value):
            raise ContentError(f"Document {field} must be single-line text.")
    return body, label.strip() or DEFAULT_LABEL, subtitle.strip()


def validate_page(meta: dict, relative: str, people: dict[str, dict]) -> tuple[str, str]:
    if meta.get("type") != "member-cv":
        raise ContentError(f"{relative}: expected a member-cv page.")
    identifier = meta.get("person")
    if not isinstance(identifier, str) or not PERSON_ID.fullmatch(identifier):
        raise ContentError(f"{relative}: member-cv needs a valid person ID.")
    if identifier not in people:
        raise ContentError(f"{relative}: member-cv refers to unknown person {identifier!r}.")
    default_owner = re.fullmatch(r"tagok/([a-z0-9]+(?:-[a-z0-9]+)*)/index\.md", relative)
    if default_owner and default_owner.group(1) in people and default_owner.group(1) != identifier:
        raise ContentError(
            f"{relative}: path belongs to person {default_owner.group(1)!r}, not {identifier!r}."
        )
    label = meta.get("document_label", DEFAULT_LABEL)
    subtitle = meta.get("subtitle", "")
    validate_author(meta.get("document_author", ""))
    if not isinstance(label, str) or not isinstance(subtitle, str):
        raise ContentError(f"{relative}: document_label and subtitle must be text.")
    if len(label) > MAX_LINE or len(subtitle) > MAX_LINE:
        raise ContentError(f"{relative}: document_label and subtitle may contain at most {MAX_LINE} characters.")
    if any(ord(character) < 32 for character in label + subtitle):
        raise ContentError(f"{relative}: document_label and subtitle must be single-line text.")
    return identifier, label.strip() or DEFAULT_LABEL


class MemberDocuments:
    def __init__(self, root: Path, path_guard) -> None:
        self.root = root
        self.guard = path_guard

    @staticmethod
    def default_path(identifier: str) -> str:
        if not isinstance(identifier, str) or not PERSON_ID.fullmatch(identifier):
            raise ContentError("Member documents require a valid lowercase hyphenated person ID.")
        return f"tagok/{identifier}/index.md"

    def path(self, relative: str) -> Path:
        if not isinstance(relative, str) or not _PATH.fullmatch(relative):
            raise ContentError("Member document paths must be Markdown paths relative to content/.")
        return self.guard(self.root / "content", relative)

    def index(self, people: dict[str, dict]) -> dict[str, dict]:
        documents = {}
        base = self.root / "content"
        for file in sorted(base.rglob("*.md")):
            relative = file.relative_to(base).as_posix()
            guarded = self.path(relative)
            if not guarded.is_file():
                continue
            raw = guarded.read_bytes()
            source = raw.decode("utf-8")
            try:
                frontmatter, body, _ = split_source(source)
            except ContentError:
                continue
            try:
                meta = parse_frontmatter(frontmatter)
            except ContentError as exc:
                if re.search(r"(?m)^type:\s*[\"']?member-cv(?:[\"']?)\s*(?:#.*)?$", frontmatter) \
                        or re.search(r"(?m)^person\s*:", frontmatter):
                    raise ContentError(f"{relative}: invalid member document frontmatter: {exc}") from exc
                continue
            if meta.get("type") != "member-cv":
                if "person" in meta and not meta.get("cv_preview"):
                    raise ContentError(f"{relative}: person references are only valid on type: member-cv pages.")
                continue
            identifier, label = validate_page(meta, relative, people)
            subtitle = meta.get("subtitle", "")
            if len(body) > MAX_BODY:
                raise ContentError(f"{relative}: document body exceeds {MAX_BODY} characters.")
            if identifier in documents:
                raise ContentError(f"Multiple member-cv pages refer to person {identifier!r}.")
            documents[identifier] = {
                "path": relative,
                "revision": revision(raw),
                "body": body,
                "label": label,
                "subtitle": subtitle.strip(),
                "author": validate_author(meta.get("document_author", "")),
                "source": source,
                "raw": raw,
            }
        return documents

    def catalog(self, people: dict[str, dict]) -> dict[str, dict]:
        existing = self.index(people)
        for identifier in people:
            if identifier in existing:
                continue
            default_file = self.path(self.default_path(identifier))
            if default_file.exists():
                raise ContentError(
                    f"{self.default_path(identifier)} exists but is not the member-cv page for {identifier!r}."
                )
        return {
            identifier: {
                "path": existing[identifier]["path"] if identifier in existing else self.default_path(identifier),
                "revision": existing[identifier]["revision"] if identifier in existing else "",
                "body": existing[identifier]["body"] if identifier in existing else "",
                "label": existing[identifier]["label"] if identifier in existing else DEFAULT_LABEL,
                "subtitle": existing[identifier]["subtitle"] if identifier in existing else "",
                "author": existing[identifier]["author"] if identifier in existing else "",
            }
            for identifier in people
        }

    def save_change(self, people: dict[str, dict], identifier: str, payload: object) -> tuple[Path, bytes | None, bytes | None] | None:
        if not isinstance(payload, dict) or set(payload) - {"path", "revision", "body", "label", "subtitle", "author"}:
            raise ContentError("Document must contain path, revision, body, and optional label, subtitle and author.")
        if not {"path", "revision", "body"} <= set(payload):
            raise ContentError("Document path, revision, and body are required.")
        documents = self.index(people)
        current = documents.get(identifier)
        expected_path = current["path"] if current else self.default_path(identifier)
        relative = payload["path"]
        if relative != expected_path:
            raise ContentError(f"{identifier}: document path must remain {expected_path!r}.")
        if not isinstance(payload["revision"], str):
            raise ConflictError("A document revision is required; reload before saving.")
        expected_revision = current["revision"] if current else ""
        if payload["revision"] != expected_revision:
            raise ConflictError("The member document changed outside this editor or is missing. Reload it before saving.")
        body, label, subtitle = validate_document_fields(
            payload["body"], payload.get("label", current["label"] if current else DEFAULT_LABEL),
            payload.get("subtitle", current["subtitle"] if current else ""),
        )
        author = validate_author(payload.get("author", current["author"] if current else ""))
        file = self.path(relative)
        before = current["raw"] if current else None
        if before is None and file.exists():
            raise ConflictError("A file already exists at the new member document path; it was not overwritten.")
        if not body.strip():
            if current is None:
                return None
            return file, before, None
        changes = {"type": "member-cv", "person": identifier,
                   "document_label": label, "subtitle": subtitle, "document_author": author}
        if current:
            updated = patched_source(current["source"], changes)
            _, old_body, _ = split_source(updated)
            prefix = updated[:-len(old_body)] if old_body else updated
            updated = prefix + body
        else:
            metadata = {"type": "member-cv", "person": identifier, "document_label": label}
            if subtitle:
                metadata["subtitle"] = subtitle
            if author:
                metadata["document_author"] = author
            frontmatter = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False).rstrip()
            updated = f"---\n{frontmatter}\n---\n{body}"
        after = updated.encode("utf-8")
        return file, before, after


__all__ = ["DEFAULT_LABEL", "MAX_BODY", "MAX_LINE", "MemberDocuments", "validate_document_fields", "validate_page"]
