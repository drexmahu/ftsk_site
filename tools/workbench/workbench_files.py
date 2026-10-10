"""Explicit, repository-bounded desktop file navigation."""

import os
import subprocess
from pathlib import Path
from urllib.parse import quote


def navigate_file(root: Path, payload: dict, guard) -> dict:
    if not isinstance(payload, dict) or set(payload) != {"path", "action"}:
        raise ValueError("Choose a repository file and an open or reveal action.")
    relative, action = payload["path"], payload["action"]
    if not isinstance(relative, str) or action not in ("open", "reveal"):
        raise ValueError("Choose a repository file and an open or reveal action.")
    path = guard(root, relative)
    if not path.is_file():
        raise ValueError("This file does not exist on disk. Save or export it first.")
    if os.name != "nt":
        raise ValueError("Desktop file navigation currently requires Windows.")
    if action == "open":
        os.startfile("vscode://file/" + quote(path.as_posix(), safe="/:"))
    else:
        subprocess.Popen(["explorer.exe", "/select,", str(path)], cwd=root)
    return {"path": relative, "action": action}
