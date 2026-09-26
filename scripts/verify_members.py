"""
Validates data/members.yaml (the canonical member roster) and every trip
report/course article's `participants:` front matter, so data bugs are caught
before a Hugo build even runs (see .github/workflows/ci.yml).

Run locally with `python scripts/verify_members.py` from the repo root.
Exits non-zero (and prints every problem found, not just the first) if any
check fails.
"""

import re
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
MEMBERS_PATH = REPO_ROOT / "data" / "members.yaml"
STATIC_DIR = REPO_ROOT / "static"
CONTENT_GLOBS = ["content/turak/**/*.md", "content/tanfolyamok/**/*.md"]

ALLOWED_MEMBER_KEYS = {"name", "nickname", "role", "image", "modal_image", "bio"}
PAREN_SUFFIX = re.compile(r"\s*\([^)]*\)\s*$")


def fail(problems, message):
    problems.append(message)


def load_members(problems):
    if not MEMBERS_PATH.exists():
        fail(problems, f"{MEMBERS_PATH} does not exist")
        return []

    try:
        data = yaml.safe_load(MEMBERS_PATH.read_text(encoding="utf-8-sig"))
    except yaml.YAMLError as exc:
        fail(problems, f"{MEMBERS_PATH} is not valid YAML: {exc}")
        return []

    groups = (data or {}).get("groups")
    if not isinstance(groups, list) or not groups:
        fail(problems, f"{MEMBERS_PATH}: top-level `groups` must be a non-empty list")
        return []

    members = []
    for group in groups:
        label = group.get("label") if isinstance(group, dict) else None
        if not label:
            fail(problems, f"{MEMBERS_PATH}: a group is missing its `label`")
            continue

        group_members = group.get("members")
        if not isinstance(group_members, list) or not group_members:
            fail(problems, f"{MEMBERS_PATH}: group {label!r} has no `members`")
            continue

        for entry in group_members:
            if not isinstance(entry, dict):
                fail(problems, f"{MEMBERS_PATH}: group {label!r} has a non-mapping member entry: {entry!r}")
                continue

            extra_keys = set(entry) - ALLOWED_MEMBER_KEYS
            if extra_keys:
                fail(
                    problems,
                    f"{MEMBERS_PATH}: member {entry.get('name')!r} in {label!r} has unknown field(s) "
                    f"{sorted(extra_keys)} - typo? allowed fields are {sorted(ALLOWED_MEMBER_KEYS)}",
                )

            name = entry.get("name")
            if not isinstance(name, str) or not name.strip():
                fail(problems, f"{MEMBERS_PATH}: group {label!r} has a member with a missing/empty `name`")
                continue

            for field in ("nickname", "role", "image", "modal_image", "bio"):
                value = entry.get(field)
                if value is not None and not isinstance(value, str):
                    fail(
                        problems,
                        f"{MEMBERS_PATH}: member {name!r} field `{field}` must be a string, got {type(value).__name__}",
                    )

            if PAREN_SUFFIX.search(name):
                fail(
                    problems,
                    f"{MEMBERS_PATH}: member `name` {name!r} still has a \"(...)\" suffix baked in - "
                    "move it to the `nickname` or `role` field instead",
                )
            nickname = entry.get("nickname")
            if isinstance(nickname, str) and PAREN_SUFFIX.search(nickname):
                fail(problems, f"{MEMBERS_PATH}: member {name!r} `nickname` {nickname!r} should not itself contain \"(...)\"")

            members.append({"name": name, "nickname": nickname, "group": label})

    return members


def check_duplicates(members, problems):
    seen_names = {}
    seen_nicknames = {}
    for m in members:
        name_key = m["name"].strip().lower()
        if name_key in seen_names:
            fail(
                problems,
                f"Duplicate member name {m['name']!r} in groups {seen_names[name_key]!r} and {m['group']!r} - "
                "participant-card lookups would be ambiguous",
            )
        else:
            seen_names[name_key] = m["group"]

        if m["nickname"]:
            nick_key = m["nickname"].strip().lower()
            if nick_key in seen_nicknames:
                fail(
                    problems,
                    f"Duplicate nickname {m['nickname']!r} used by members in {seen_nicknames[nick_key]!r} "
                    f"and {m['group']!r} - participant-card lookups would be ambiguous",
                )
            else:
                seen_nicknames[nick_key] = m["group"]

            if nick_key in seen_names:
                fail(
                    problems,
                    f"Nickname {m['nickname']!r} (used by a member in {m['group']!r}) collides with another "
                    "member's plain `name` - participant-card lookups would be ambiguous",
                )


def check_images_exist(problems):
    data = yaml.safe_load(MEMBERS_PATH.read_text(encoding="utf-8-sig")) or {}
    for group in data.get("groups", []):
        for entry in group.get("members", []) or []:
            if not isinstance(entry, dict):
                continue
            for field in ("image", "modal_image"):
                path = entry.get(field)
                if not path:
                    continue
                relative = path.lstrip("/")
                if not (STATIC_DIR / relative).is_file():
                    fail(
                        problems,
                        f"Member {entry.get('name')!r} `{field}` points to a missing file: "
                        f"static/{relative}",
                    )


def check_content_participants(problems):
    for pattern in CONTENT_GLOBS:
        for path in sorted(REPO_ROOT.glob(pattern)):
            text = path.read_text(encoding="utf-8-sig")
            if not text.startswith("---"):
                continue
            end = text.find("\n---", 3)
            if end == -1:
                continue
            front_matter_text = text[3:end]
            try:
                front_matter = yaml.safe_load(front_matter_text) or {}
            except yaml.YAMLError as exc:
                fail(problems, f"{path.relative_to(REPO_ROOT)}: front matter is not valid YAML: {exc}")
                continue

            participants = front_matter.get("participants")
            if participants is None:
                continue

            rel = path.relative_to(REPO_ROOT)
            if not isinstance(participants, list) or not participants:
                fail(problems, f"{rel}: `participants` must be a non-empty list when present")
                continue

            seen = set()
            for entry in participants:
                if not isinstance(entry, str) or not entry.strip():
                    fail(problems, f"{rel}: `participants` entries must be non-empty strings, got {entry!r}")
                    continue
                key = entry.strip().lower()
                if key in seen:
                    fail(problems, f"{rel}: duplicate `participants` entry {entry!r}")
                seen.add(key)


def main():
    problems = []
    members = load_members(problems)
    if members:
        check_duplicates(members, problems)
        check_images_exist(problems)
    check_content_participants(problems)

    if problems:
        print(f"FAILED - {len(problems)} problem(s) found:\n")
        for p in problems:
            print(f" - {p}")
        return 1

    print(f"OK - {len(members)} members across all groups, all checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
