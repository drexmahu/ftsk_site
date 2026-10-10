"""Move assigned flat portraits into ID folders without re-encoding images."""

import argparse
import hashlib
import os
from pathlib import Path
import tempfile

from tools.workbench.people_registry import member_image_folder, registry_data
from tools.workbench.participant_roles import read_roles

ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {".md", ".yaml", ".yml", ".toml", ".json", ".html", ".js", ".css", ".scss", ".xml", ".svg"}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plan(root: Path) -> tuple[list[dict], list[tuple[Path, bytes, bytes]]]:
    registry = root / "data" / "people.yaml"
    people = registry_data(registry.read_bytes(), read_roles(root))["people"]
    moves, replacements, owners = [], {}, {}
    for person in people:
        for field, suffix in (("image", "_thumb.webp"), ("modal_image", "_full.webp")):
            old = person.get(field, "")
            if not old.startswith("/images/members/") or "/" in old[len("/images/members/"):]:
                continue
            if old in owners:
                raise ValueError(f"Shared portrait requires manual review: {old}")
            owners[old] = person["id"]
            if not old.endswith(suffix):
                raise ValueError(f"Portrait is not a standard WebP {field}: {old}")
            new = f"/images/{member_image_folder(person['id'])}/{person['id']}{suffix}"
            source, target = root / "static" / old.lstrip("/"), root / "static" / new.lstrip("/")
            if not source.is_file() or source.is_symlink():
                raise ValueError(f"Missing or linked portrait: {source}")
            if target.exists():
                raise ValueError(f"Destination already exists; nothing overwritten: {target}")
            if not target.resolve().is_relative_to((root / "static" / "images" / "members").resolve()):
                raise ValueError(f"Destination escapes member images: {target}")
            moves.append({"source": source, "target": target, "sha256": digest(source)})
            replacements[old.encode()] = new.encode()
    edits = []
    for name in ("content", "data", "layouts", "assets", "static", "docs"):
        for path in sorted((root / name).rglob("*")):
            if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            before = path.read_bytes()
            after = before
            for old, new in replacements.items():
                after = after.replace(old, new)
            if after != before:
                if path.is_symlink():
                    raise ValueError(f"Linked reference file requires manual review: {path}")
                edits.append((path, before, after))
    return moves, edits


def write_atomic(path: Path, content: bytes) -> None:
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".portrait-migration-", delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(content)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def apply(moves: list[dict], edits: list[tuple[Path, bytes, bytes]]) -> None:
    for move in moves:
        if digest(move["source"]) != move["sha256"] or move["target"].exists():
            raise ValueError(f"Portrait changed since planning: {move['source']}")
    for path, before, _ in edits:
        if path.read_bytes() != before:
            raise ValueError(f"Reference file changed since planning: {path}")
    created, directories, written, removed = [], [], [], []
    try:
        for move in moves:
            target = move["target"]
            if not target.parent.exists():
                target.parent.mkdir()
                directories.append(target.parent)
            with target.open("xb") as stream:
                created.append(target)
                stream.write(move["source"].read_bytes())
            if digest(target) != move["sha256"]:
                raise ValueError(f"Image copy verification failed: {target}")
        for path, before, after in edits:
            write_atomic(path, after)
            written.append((path, before))
        for move in moves:
            move["source"].unlink()
            removed.append(move)
    except Exception:
        for move in removed:
            with move["source"].open("xb") as stream:
                stream.write(move["target"].read_bytes())
        for path, before in reversed(written):
            write_atomic(path, before)
        for target in reversed(created):
            target.unlink()
        for directory in reversed(directories):
            directory.rmdir()
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Apply after reviewing the dry run.")
    options = parser.parse_args()
    moves, edits = plan(ROOT)
    for move in moves:
        print(f"{move['source'].relative_to(ROOT)} -> {move['target'].relative_to(ROOT)}")
    print(f"{len(moves)} portraits; {len(edits)} reference files.")
    if options.apply:
        apply(moves, edits)
        print("Migration verified and written; image bytes preserved.")
    else:
        print("Dry run only. Use --apply to write.")


if __name__ == "__main__":
    main()
