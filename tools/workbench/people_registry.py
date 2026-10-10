"""Shared schema and reference rules for the file-backed people registry."""

import re
import unicodedata
from urllib.parse import urlsplit

from tools.workbench.content_workbench import ContentError, parse_frontmatter

PERSON_FIELDS = ("name", "nickname", "bio", "image", "modal_image", "email", "phone")
PROFILE_FIELDS = (*PERSON_FIELDS, "social_links", "show_profile_contacts")
PERSON_ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
PAREN_SUFFIX = re.compile(r"\s*\([^)]*\)\s*$")


def member_image_folder(identifier) -> str:
    if not isinstance(identifier, str) or len(identifier) > 200 or not PERSON_ID.fullmatch(identifier):
        raise ContentError("Member image uploads require a valid lowercase hyphenated person ID.")
    return f"members/{identifier}"


def match_key(value: str) -> str:
    return unicodedata.normalize("NFC", PAREN_SUFFIX.sub("", value).strip()).casefold()


def identity_keys(person: dict) -> set[str]:
    return {match_key(value) for value in
            [person["name"], person.get("nickname", ""), *person.get("aliases", [])] if value}

def validate_social_links(links) -> None:
    if not isinstance(links, list) or len(links) > 20:
        raise ContentError("Social links must be a list of up to 20 web addresses.")
    seen = set()
    for link in links:
        if (not isinstance(link, str) or not link or len(link) > 2000
                or any(character.isspace() or ord(character) < 32 for character in link)
                or any(character in link for character in '<>"\\')):
            raise ContentError("Each social link must be a non-empty web address without spaces or control characters.")
        try:
            url = urlsplit(link)
            port = url.port
        except ValueError as exc:
            raise ContentError("Social link has an invalid host or port.") from exc
        if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.password is not None or port == 0:
            raise ContentError("Social links require a complete http:// or https:// address without credentials.")
        if link in seen:
            raise ContentError("Remove duplicate social links.")
        seen.add(link)


def registry_data(raw: bytes, roles: list[dict] | None = None) -> dict:
    data = parse_frontmatter(raw.decode("utf-8-sig"))
    people, groups = data.get("people"), data.get("groups")
    if not isinstance(people, list) or not isinstance(groups, list) or not groups:
        raise ContentError("People data needs a people list and a non-empty groups list.")
    ids, keys = set(), {}
    for person in people:
        if not isinstance(person, dict):
            raise ContentError("Each person must be a mapping.")
        identifier = person.get("id")
        if {"cv", "cv_label", "cv_subtitle"} & person.keys():
            raise ContentError(f"{identifier!r}: CV content belongs in a type: member-cv Markdown page, not the people registry.")
        if not isinstance(identifier, str) or not PERSON_ID.fullmatch(identifier) or identifier in ids:
            raise ContentError(f"Person IDs must be unique lowercase hyphenated identifiers: {identifier!r}")
        ids.add(identifier)
        if not isinstance(person.get("name"), str) or not person["name"].strip():
            raise ContentError(f"{identifier}: a non-empty name is required.")
        for field in PERSON_FIELDS:
            value = person.get(field)
            if value is not None and (not isinstance(value, str)
                                      or len(value) > (10000 if field == "bio" else 500)):
                raise ContentError(f"{identifier}: {field} must be text within its length limit.")
            if isinstance(value, str) and field != "bio" and any(ord(c) < 32 for c in value):
                raise ContentError(f"{identifier}: {field} must be a single line.")
        email, phone = person.get("email", ""), person.get("phone", "")
        validate_social_links(person.get("social_links", []))
        if "show_profile_contacts" in person and not isinstance(person["show_profile_contacts"], bool):
            raise ContentError(f"{identifier}: show_profile_contacts must be true or false.")
        if email and not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", email):
            raise ContentError(f"{identifier}: email must be a valid email address.")
        if phone and (not re.fullmatch(r"\+?[0-9 ()-]+", phone) or not re.search(r"[0-9]", phone)):
            raise ContentError(f"{identifier}: phone must contain digits and optional leading +, spaces, parentheses or hyphens.")
        aliases = person.get("aliases", [])
        if (not isinstance(aliases, list) or len(aliases) > 100
                or any(not isinstance(value, str) or not value.strip() or len(value) > 500
                       or any(ord(c) < 32 for c in value) for value in aliases)):
            raise ContentError(f"{identifier}: aliases must be a list of non-empty single-line names.")
        if "needs_review" in person and not isinstance(person["needs_review"], bool):
            raise ContentError(f"{identifier}: needs_review must be true or false.")
        if PAREN_SUFFIX.search(person["name"]) or PAREN_SUFFIX.search(person.get("nickname", "")):
            raise ContentError(f"{identifier}: put nicknames in nickname, not parentheses in the name.")
        if person.get("nickname") and match_key(person["nickname"]) == match_key(person["name"]):
            raise ContentError(f"{identifier}: nickname must differ from name.")
        for key in identity_keys(person):
            if key in keys and keys[key] != identifier:
                raise ContentError(f"Name/nickname/alias {key!r} belongs to both {keys[key]} and {identifier}. Reuse or merge the existing person.")
            keys[key] = identifier
    assigned, labels = set(), set()
    for group in groups:
        if (not isinstance(group, dict) or not isinstance(group.get("label"), str)
                or not group["label"].strip() or not isinstance(group.get("members"), list)):
            raise ContentError("Every membership group needs a label and a members list.")
        if group["label"] in labels:
            raise ContentError(f"Duplicate membership group: {group['label']}")
        labels.add(group["label"])
        validate_category_hint(group.get("hint", ""))
        for entry in group["members"]:
            if not isinstance(entry, dict) or set(entry) - {"person", "role", "roles"}:
                raise ContentError("Memberships contain only person and optional roles.")
            identifier = entry.get("person")
            if not isinstance(identifier, str) or identifier not in ids or identifier in assigned:
                raise ContentError(f"Unknown or duplicate current membership: {identifier!r}")
            from tools.workbench.participant_roles import assignment_roles
            assignment_roles(entry, roles)
            assigned.add(identifier)
    categories = data.get("categories", [])
    if not isinstance(categories, list):
        raise ContentError("Custom categories must be a list.")
    category_ids, category_labels = set(), set()
    for category in categories:
        if not isinstance(category, dict) or set(category) - {"id", "label", "hint", "people"}:
            raise ContentError("Custom categories contain only id, label, hint and people.")
        validate_category_hint(category.get("hint", ""))
        identifier, label = category.get("id"), category.get("label")
        if (not isinstance(identifier, str) or len(identifier) > 200
                or not PERSON_ID.fullmatch(identifier) or identifier in category_ids):
            raise ContentError("Custom category IDs must be unique lowercase hyphenated identifiers.")
        if (not isinstance(label, str) or not label.strip() or len(label) > 200
                or any(ord(c) < 32 for c in label) or label.strip().casefold() in category_labels):
            raise ContentError("Custom category labels must be unique non-empty single-line text, up to 200 characters.")
        category_ids.add(identifier)
        category_labels.add(label.strip().casefold())
        members = category.get("people")
        if (not isinstance(members, list) or any(not isinstance(value, str) or value not in ids for value in members)
                or len(set(members)) != len(members)):
            raise ContentError(f"{identifier}: category people must be unique existing person IDs.")
    return data


def validate_category_hint(value) -> None:
    if (not isinstance(value, str) or len(value) > 1000
            or any(ord(character) < 32 for character in value)):
        raise ContentError("Category hint must be single-line text, up to 1000 characters.")


def person_index(data: dict) -> dict[str, dict]:
    return {person["id"]: person for person in data["people"]}


def resolve_legacy(data: dict, name: str) -> dict | None:
    key = match_key(name)
    return next((person for person in data["people"] if key in identity_keys(person)), None)


def contact_lists(meta: dict) -> list[tuple[str, list]]:
    lists = [("contacts", meta.get("contacts", []))]
    blocks = meta.get("content_blocks", [])
    if not isinstance(blocks, list):
        raise ContentError("content_blocks must be a list.")
    for index, block in enumerate(blocks):
        if isinstance(block, dict) and block.get("_bookshop_name") in ("contact/info", "global/richtext"):
            lists.append((f"content_blocks.{index}.contacts", block.get("contacts", [])))
    return lists


def page_references(meta: dict, people: dict[str, dict], roles: list[dict] | None = None) -> list[dict]:
    """Validate canonical foreign keys; legacy text is deliberately not an ID."""
    references = []

    def add(identifier, field):
        if not isinstance(identifier, str) or identifier not in people:
            raise ContentError(f"{field}: unknown person ID {identifier!r}. Choose an existing person.")
        references.append({"person": identifier, "field": field, "name": people[identifier]["name"]})

    if meta.get("type") == "member-cv" and not meta.get("cv_preview"):
        add(meta.get("person"), "person")
    if meta.get("author_id"):
        add(meta["author_id"], "author_id")
        if meta.get("author"):
            raise ContentError("Use author_id or legacy author, not both.")
    elif "author_id" in meta and not isinstance(meta["author_id"], str):
        raise ContentError("author_id must be text (or an empty string).")
    participants = meta.get("participant_ids", [])
    if not isinstance(participants, list):
        raise ContentError("participant_ids must be a list of person IDs or person/role mappings.")
    seen = set()
    for entry in participants:
        identifier = entry
        if isinstance(entry, dict):
            if set(entry) - {"person", "role", "roles"}:
                raise ContentError("Participant assignments contain only person and optional roles.")
            identifier = entry.get("person")
            from tools.workbench.participant_roles import assignment_roles
            assignment_roles(entry, roles)
        add(identifier, "participant_ids")
        if identifier in seen:
            raise ContentError(f"participant_ids: duplicate person {identifier}.")
        seen.add(identifier)
    if participants and meta.get("participants"):
        raise ContentError("Use participant_ids or legacy participants, not both.")
    for location, contacts in contact_lists(meta):
        if not isinstance(contacts, list):
            raise ContentError(f"{location} must be a list of mappings.")
        for contact in contacts:
            if not isinstance(contact, dict):
                raise ContentError(f"{location} must be a list of mappings.")
            if "person" in contact:
                add(contact["person"], location)
                references[-1]["role"] = contact.get("role", "")
                if contact.get("name"):
                    raise ContentError("A contact uses person or legacy name, not both.")
            elif not isinstance(contact.get("name"), str) or not contact["name"].strip():
                raise ContentError("Each contact needs a person ID (or a legacy name).")
            for field in ("role", "email", "phone"):
                if field in contact and (not isinstance(contact[field], str) or len(contact[field]) > 500
                                         or any(ord(c) < 32 for c in contact[field])):
                    raise ContentError(f"Contact {field} must be single-line text, up to 500 characters.")
    return references
