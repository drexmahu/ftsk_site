"""One-time, reviewable migration from names/member profiles to permanent IDs."""

import argparse
import copy
import re
import unicodedata
from pathlib import Path

import yaml

from tools.workbench.content_workbench import parse_frontmatter, patched_source, split_source
from tools.workbench.people_registry import PAREN_SUFFIX, page_references, person_index, registry_data, resolve_legacy

# These are the only shortened identities explicitly confirmed by the editor.
DISPLAY_NAMES = {
    "Kalotai Zsófia": "Kalotai Zsófi",
    "Rehány Nikolett": "Rehány Niki",
    "Sándor Ágnes": "Sándor Ági",
    "Sas Dorottya": "Sas Dóri",
}


def identifier(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")


def plan(root: Path) -> tuple[dict, list[tuple[Path, bytes, bytes]]]:
    legacy = root / "data" / "members.yaml"
    if (root / "data" / "people.yaml").exists():
        raise ValueError("people.yaml already exists. Migration must not overwrite a registry.")
    roster = parse_frontmatter(legacy.read_text(encoding="utf-8-sig"))
    registry = {"people": [], "groups": []}
    for group in roster["groups"]:
        membership = {"label": group["label"], "members": []}
        for entry in group["members"]:
            person = copy.deepcopy(entry)
            person["id"] = identifier(person["name"])
            role = person.pop("role", "")
            if person["name"] in DISPLAY_NAMES:
                person["aliases"] = [person["name"]]
                person["name"] = DISPLAY_NAMES[person["name"]]
            registry["people"].append(person)
            assignment = {"person": person["id"]}
            if role:
                assignment["role"] = role
            membership["members"].append(assignment)
        registry["groups"].append(membership)

    def find(name: str) -> str:
        person = resolve_legacy(registry, name)
        if person:
            return person["id"]
        clean = PAREN_SUFFIX.sub("", name).strip()
        nickname = PAREN_SUFFIX.search(name)
        person = {"id": identifier(clean), "name": clean, "needs_review": True}
        if nickname:
            person["nickname"] = nickname.group().strip()[1:-1].strip()
        if person["id"] in person_index(registry):
            raise ValueError(f"Ambiguous ID for {name!r}; resolve explicitly before migrating.")
        registry["people"].append(person)
        return person["id"]

    changes = []
    for path in sorted((root / "content").rglob("*.md")):
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        meta = parse_frontmatter(split_source(text)[0])
        fields = {}
        author = meta.get("author")
        # A joint credit is not an invented person; retain it as legacy text.
        if author and " és " not in author:
            fields.update(author_id=find(author), author="")
        if meta.get("participants"):
            fields.update(participant_ids=[find(name) for name in meta["participants"]], participants=[])
        if meta.get("contacts"):
            contacts = copy.deepcopy(meta["contacts"])
            for contact in contacts:
                if contact.get("name"):
                    contact["person"] = find(contact.pop("name"))
            fields["contacts"] = contacts
        if fields:
            updated = patched_source(text, fields).encode("utf-8")
            if split_source(updated.decode())[1] != split_source(text)[1]:
                raise ValueError(f"Migration would alter article body: {path}")
            changes.append((path, raw, updated))
    encoded = yaml.safe_dump(registry, allow_unicode=True, sort_keys=False, width=1000).encode("utf-8")
    registry_data(encoded)
    for path, _, updated in changes:
        page_references(parse_frontmatter(split_source(updated.decode())[0]), person_index(registry))
    return registry, changes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write the reviewed migration.")
    options = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    registry, changes = plan(root)
    print(f"{len(registry['people'])} permanent identities; {len(changes)} page migrations.")
    for person in registry["people"]:
        if person.get("needs_review"):
            print(f"Clarify manually: {person['name']} [{person['id']}]")
    if options.apply:
        for path, before, _ in changes:
            if path.read_bytes() != before:
                raise ValueError(f"{path} changed since migration planning.")
        destination = root / "data" / "people.yaml"
        with destination.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write("# Permanent identities and independent current-membership assignments.\n")
            yaml.safe_dump(registry, stream, allow_unicode=True, sort_keys=False, width=1000)
        for path, _, updated in changes:
            path.write_bytes(updated)
        print("Migration written. Remove the obsolete members.yaml after verification.")
    else:
        print("Dry run only. Use --apply after reviewing the identities above.")


if __name__ == "__main__":
    main()
