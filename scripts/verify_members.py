"""Validate identities, current membership and every page's people references.

The historical command name is retained for CI and existing editor launchers.
Unresolved legacy credits and identities marked needs_review are advisory;
invalid canonical foreign keys, duplicate identities and missing images fail.
"""

import sys
from pathlib import Path

from tools.workbench.content_workbench import ContentError, parse_frontmatter, split_source
from tools.workbench.member_documents import MAX_BODY, validate_page
from tools.workbench.people_registry import contact_lists, page_references, person_index, registry_data, resolve_legacy
from tools.workbench.participant_roles import read_roles

REPO_ROOT = Path(__file__).resolve().parent.parent


def verify(root: Path) -> tuple[list[str], list[str], int]:
    problems, warnings = [], []
    path = root / "data" / "people.yaml"
    try:
        data = registry_data(path.read_bytes())
    except (OSError, UnicodeError, ContentError) as exc:
        return [f"data/people.yaml: {exc}"], [], 0
    people = person_index(data)
    try:
        roles = read_roles(root)
    except (OSError, UnicodeError, ContentError) as exc:
        return [f"data/participant_roles.yaml: {exc}"], [], len(people)
    try:
        registry_data(path.read_bytes(), roles)
    except (OSError, UnicodeError, ContentError) as exc:
        return [f"data/people.yaml: {exc}"], [], len(people)
    for person in data["people"]:
        if person.get("needs_review"):
            warnings.append(f"Clarify identity manually: {person['name']} [{person['id']}]")
        for field in ("image", "modal_image"):
            url = person.get(field)
            if not url:
                continue
            file = root / "static" / url.lstrip("/")
            if (not url.startswith("/images/") or "\\" in url or ":" in url or "?" in url or "#" in url
                    or any(part in ("", ".", "..") for part in url[1:].split("/"))
                    or not file.resolve().is_relative_to((root / "static" / "images").resolve())
                    or file.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp")
                    or not file.is_file()):
                problems.append(f"{person['id']}: invalid or missing {field}: {url}")
    member_documents = set()
    for file in sorted((root / "content").rglob("*.md")):
        relative = file.relative_to(root).as_posix()
        try:
            relative_content = file.relative_to(root / "content").as_posix()
            source = file.read_text(encoding="utf-8-sig")
            frontmatter, body, _ = split_source(source)
            meta = parse_frontmatter(frontmatter)
            if meta.get("type") == "member-cv":
                identifier, _ = validate_page(meta, relative_content, people)
                if len(body) > MAX_BODY:
                    raise ContentError(f"member-cv body exceeds {MAX_BODY} characters.")
                if identifier in member_documents:
                    raise ContentError(f"Multiple member-cv pages refer to person {identifier!r}.")
                member_documents.add(identifier)
            elif "person" in meta and not meta.get("cv_preview"):
                raise ContentError("person references are only valid on type: member-cv pages.")
            page_references(meta, people, roles)
            legacy = meta.get("participants", [])
            if (not isinstance(legacy, list) or any(not isinstance(name, str) or not name.strip() for name in legacy)
                    or len({name.casefold() for name in legacy}) != len(legacy)):
                raise ContentError("Legacy participants must be distinct, non-empty names.")
            author = meta.get("author", "")
            if not isinstance(author, str):
                raise ContentError("Legacy author must be text.")
            names = legacy + ([author] if author else []) + [
                contact["name"] for _, contacts in contact_lists(meta) for contact in contacts if contact.get("name")]
            for name in names:
                if resolve_legacy(data, name) is None:
                    warnings.append(f"{relative}: unresolved legacy credit {name!r}; use the workbench to clarify.")
                else:
                    warnings.append(f"{relative}: legacy name {name!r}; prefer permanent person IDs.")
        except (ContentError, OSError, UnicodeError) as exc:
            problems.append(f"{relative}: {exc}")
    return problems, warnings, len(people)


def main() -> int:
    problems, warnings, count = verify(REPO_ROOT)
    for warning in warnings:
        print(f"NOTE - {warning}")
    if problems:
        print(f"FAILED - {len(problems)} problem(s):")
        for problem in problems:
            print(f" - {problem}")
        return 1
    print(f"OK - {count} people; memberships, portraits and page references validated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
