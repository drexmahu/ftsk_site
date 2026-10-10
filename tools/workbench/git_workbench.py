"""Guarded, rebase-only Git workflows for the local publishing workbench."""

import hashlib
import base64
import json
import logging
import os
import re
import shutil
import stat
import subprocess
import sys
import threading
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from tools.workbench.content_workbench import ConflictError, ContentError

LOGGER = logging.getLogger("site_workbench.git")
PROTECTED = {"main", "master"}


class GitService:
    def __init__(self, app):
        self.app = app
        self.root = app.root
        self.busy = False
        self.cached = {}
        self.last_fetch = None
        self.job = {"state": "idle", "action": "", "log": "", "error": ""}
        self.thread = None
        self.commit_plan = None
        self.repository_dir = None
        self.graph_key = None
        self.graph_cache = None

    def run(self, *args, check=True, network=False, binary=False):
        executable = shutil.which("git")
        if not executable:
            raise ContentError("Git is not installed. Install Git for Windows, then restart Workbench.")
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never",
               "GIT_EDITOR": "true", "GIT_SEQUENCE_EDITOR": "true"}
        try:
            result = subprocess.run(
                [executable, "--no-pager", "-c", "core.quotepath=false", *args],
                cwd=self.root, env=env, capture_output=True, encoding=None if binary else "utf-8",
                errors=None if binary else "replace", timeout=120 if network else 30,
            )
        except subprocess.TimeoutExpired as exc:
            raise ContentError("Git timed out. Refresh the state before retrying; check your network and Git credentials.") from exc
        if check and result.returncode:
            error = result.stderr or result.stdout
            if binary:
                error = error.decode("utf-8", errors="replace")
            raise ContentError(error.strip() or f"Git failed (exit {result.returncode}).")
        return result

    def text(self, *args):
        return self.run(*args).stdout.strip()

    def checkpoint(self, payload):
        if self.busy:
            raise ConflictError("Wait for the Git operation or recovery terminal to finish before inspecting history.")
        state = self.snapshot()
        identifier = payload.get("id")
        if (not isinstance(identifier, str) or not re.fullmatch(r"[0-9a-f]{40,64}", identifier)
                or identifier not in {item["id"] for item in state.get("graph", {}).get("nodes", [])}):
            raise ContentError("Choose a checkpoint in the current graph. Refresh if its history has changed.")
        metadata = self.text("show", "-s", "--format=%H%x00%P%x00%an%x00%aI%x00%B", identifier, "--").split("\0", 4)
        sha, parents, author, date, message = metadata
        parent_list = parents.split()
        args = ("diff", "--name-status", "-z", "--no-renames", parent_list[0], sha, "--") if parent_list else (
            "diff-tree", "--root", "--no-commit-id", "--name-status", "-z", "-r", "--no-renames", sha, "--")
        entries = self.run(*args).stdout.rstrip("\0").split("\0")
        files = [{"status": entries[index], "path": entries[index + 1]}
                 for index in range(0, len(entries) - 1, 2)]
        return {"id": sha, "parents": parent_list, "author": author, "date": date,
                "message": message[:10000], "message_truncated": len(message) > 10000,
                "files": files[:500], "file_count": len(files), "files_truncated": len(files) > 500,
                "comparison": "Changes against the first parent." if parent_list else "Files in this initial checkpoint."}

    def git_path(self, name):
        if self.repository_dir:
            return self.repository_dir / name
        return Path(self.text("rev-parse", "--path-format=absolute", "--git-path", name))

    def file(self, name):
        path = self.root / name
        if not path.resolve().is_relative_to(self.root):
            raise ContentError("Git file is outside this checkout.")
        if any(item.is_symlink() or (item.exists() and
               getattr(item.lstat(), "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT)
               for item in (path, *path.parents) if item.is_relative_to(self.root)):
            raise ContentError("Linked files cannot be edited or committed from Workbench.")
        return path

    def fingerprint(self, changes, head, branch, refs):
        digest = hashlib.sha256(json.dumps([head, branch, refs, changes], sort_keys=True).encode())
        index = self.git_path("index")
        if index.is_file():
            digest.update(index.read_bytes())
        for entry in changes:
            path = self.file(entry["path"])
            if path.is_file():
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(chunk)
        return digest.hexdigest()

    def recovery_path(self, branch):
        name = hashlib.sha256(branch.encode("utf-8")).hexdigest() + ".json"
        return self.file(f".workbench-backups/{name}")

    def recovery(self, branch):
        if not branch:
            return None
        path = self.recovery_path(branch)
        if not path.exists():
            return None
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError) as exc:
            raise ContentError(f"Cannot read rebase recovery record: {path}. Ask the maintainer to review it.") from exc
        if (not isinstance(record, dict) or record.get("branch") != branch or
                not all(isinstance(record.get(key), str) for key in
                        ("id", "directory", "original_head", "expected_remote", "remote_url", "phase", "result_head"))):
            raise ContentError("Invalid rebase recovery record. Ask the maintainer to review the local backup.")
        return record

    def save_recovery(self, record):
        for path in (self.file(record["directory"] + "/recovery.json"), self.recovery_path(record["branch"])):
            temporary = path.with_suffix(".tmp")
            self.file(str(temporary.relative_to(self.root)))
            temporary.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
            temporary.replace(path)

    def backup_rebase(self, state, target, leased=False):
        folder = self.file(".workbench-backups")
        folder.mkdir(exist_ok=True)
        if self.text("ls-files", "--", ".workbench-backups"):
            raise ContentError("Recovery backups must not be tracked. Ask the maintainer to remove them from version control.")
        if self.run("check-ignore", "-q", "--", ".workbench-backups/probe", check=False).returncode:
            exclude = Path(self.text("rev-parse", "--path-format=absolute", "--git-path", "info/exclude"))
            exclude.parent.mkdir(parents=True, exist_ok=True)
            with exclude.open("a", encoding="utf-8") as stream:
                stream.write("\n/.workbench-backups/\n")
            if self.run("check-ignore", "-q", "--", ".workbench-backups/probe", check=False).returncode:
                raise ContentError("Cannot exclude recovery backups from Git. Rebase was not started.")
        identifier = uuid.uuid4().hex
        directory = folder / identifier
        directory.mkdir()
        ref = f"refs/workbench-backups/{identifier}"
        base = self.text("merge-base", "HEAD", target)
        record = {"id": identifier, "directory": str(directory.relative_to(self.root)),
                  "branch": state["branch"], "original_head": state["head"], "base": base,
                  "target": target, "target_head": self.text("rev-parse", target), "backup_ref": ref,
                  "expected_remote": state["upstream_head"] if leased else "",
                  "remote_url": self.text("remote", "get-url", "origin") if leased else "",
                  "phase": "preparing", "result_head": "", "created": datetime.now(timezone.utc).isoformat()}
        self.command("update-ref", ref, state["head"])
        self.command("bundle", "create", str(directory / "history.bundle"), ref)
        self.command("bundle", "verify", str(directory / "history.bundle"))
        patches = self.run("format-patch", "--binary", "--full-index", "--stdout", f"{base}..{state['head']}", binary=True).stdout
        (directory / "commits.patch").write_bytes(patches)
        (directory / "changes.patch").write_bytes(self.run(
            "diff", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", base, state["head"], binary=True).stdout)
        record["phase"] = "rebasing"
        (directory / "RESTORE.txt").write_text(
            f"Original branch: {state['branch']}\nOriginal commit: {state['head']}\n"
            f"Local backup reference: {ref}\n\n"
            f"Inspect safely by creating a NEW branch (do not reset your current work):\n"
            f"git branch recovery-{identifier[:8]} {ref}\n\n"
            f"If the reference is missing, recover from the bundle:\n"
            f'git fetch "{directory / "history.bundle"}" {ref}:refs/heads/recovery-{identifier[:8]}\n\n'
            "commits.patch preserves the original branch commits; changes.patch preserves the binary-capable tree difference.\n"
            "The bundle also retains the full original history, including merges and binary files.\n"
            "These backups are local/private. Never add them to Git or share them without reviewing their contents.\n",
            encoding="utf-8")
        self.save_recovery(record)
        with self.app.lock:
            self.job["log"] += f"\nRecovery backup saved: {directory}"
        return record

    def finish_rebase(self, branch, phase="ready"):
        record = self.recovery(branch)
        if record and record["phase"] == "rebasing":
            record.update(phase=phase, result_head=self.text("rev-parse", "HEAD") if phase == "ready" else "")
            self.save_recovery(record)

    def lease_ready(self, record, branch, head, upstream, remote, rebase, changes):
        return bool(record and record["phase"] == "ready" and record["expected_remote"] and
                    branch not in PROTECTED and upstream == f"origin/{branch}" and remote and
                    not rebase and not changes and record["result_head"] and
                    self.file(record["directory"] + "/history.bundle").is_file() and
                    self.file(record["directory"] + "/changes.patch").is_file() and
                    self.text("remote", "get-url", "origin") == record["remote_url"] and
                    self.run("merge-base", "--is-ancestor", record["result_head"], head, check=False).returncode == 0)

    def assert_reviewed_checkout(self, state):
        if (self.text("rev-parse", "HEAD") != state["head"] or
                self.text("branch", "--show-current") != state["branch"] or
                self.text("status", "--porcelain", "--untracked-files=all")):
            raise ConflictError("The checkout changed during this operation. Refresh and review again; no history rewrite was started.")

    def history_graph(self, head, branch, branches, base, rebase_branch):
        refs = {item["name"]: item for item in branches}
        main = base or next((name for name in ("main", "master") if name in refs), "")
        working = rebase_branch or branch
        work_head = refs[working]["head"] if working in refs else head
        main_head = refs[main]["head"] if main else ""
        lanes = []
        if main:
            lanes.append({"id": "main", "name": main, "head": main_head, "remote": refs[main]["remote"]})
            local_main = main.removeprefix("origin/")
            if main.startswith("origin/") and local_main in refs:
                lanes.append({"id": "local-main", "name": local_main, "head": refs[local_main]["head"], "remote": False})
        if work_head:
            lanes.append({"id": "work", "name": working or "Detached checkout", "head": work_head, "remote": False})
        upstream = refs.get(working, {}).get("upstream", "")
        if upstream in refs and upstream != main:
            lanes.append({"id": "server", "name": upstream, "head": refs[upstream]["head"], "remote": True})
        if rebase_branch and head and head != work_head:
            lanes.append({"id": "replay", "name": "Paused rebase checkout", "head": head, "remote": False})
        shallow_file = self.git_path("shallow")
        shallow_stamp = (shallow_file.stat().st_mtime_ns, shallow_file.stat().st_size) if shallow_file.exists() else None
        key = (tuple((lane["id"], lane["name"], lane["head"]) for lane in lanes), shallow_stamp)
        if key == self.graph_key:
            return self.graph_cache
        limit = 18
        nodes = {}
        truncated = []
        for lane in lanes:
            lines = self.run("log", "--topo-order", f"-{limit + 1}", "--format=%H%x09%P%x09%s", lane["head"], "--").stdout.splitlines()
            if len(lines) > limit:
                truncated.append(lane["id"])
            for line in lines[:limit]:
                commit, parents, subject = line.split("\t", 2)
                item = nodes.setdefault(commit, {"id": commit, "parents": parents.split(), "subject": subject, "lanes": []})
                item["lanes"].append(lane["id"])
        forks, main_only, work_only = [], 0, 0
        if main_head and work_head:
            common = self.run("merge-base", "--all", main_head, work_head, check=False)
            if common.returncode not in (0, 1):
                raise ContentError(common.stderr.strip() or "Cannot identify the shared branch history.")
            forks = common.stdout.splitlines()
            for commit in forks:
                if commit not in nodes:
                    line = self.run("show", "-s", "--format=%H%x09%P%x09%s", commit, "--").stdout.rstrip("\n")
                    sha, parents, subject = line.split("\t", 2)
                    nodes[sha] = {"id": sha, "parents": parents.split(), "subject": subject, "lanes": ["main", "work"]}
            counts = self.text("rev-list", "--left-right", "--count", f"{main_head}...{work_head}").split()
            main_only, work_only = map(int, counts)
        result = {"lanes": lanes, "nodes": list(nodes.values()), "forks": forks,
                  "main_only": main_only, "work_only": work_only, "limit": limit, "truncated": truncated,
                  "shallow": self.text("rev-parse", "--is-shallow-repository") == "true"}
        self.graph_key, self.graph_cache = key, result
        return result

    def snapshot(self):
        if self.busy:
            return {**self.cached, "busy": True, "editable": False, "job": dict(self.job)}
        try:
            locations = self.run("rev-parse", "--show-toplevel", "--absolute-git-dir").stdout.splitlines()
            top = Path(locations[0]).resolve()
            if top != self.root:
                raise ContentError("Workbench must run at the root of its own Git checkout.")
            self.repository_dir = Path(locations[1])
            raw = self.run("status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all").stdout.split("\0")
            changes, headers, conflicts = [], {}, []
            index = 0
            while index < len(raw) and raw[index]:
                entry = raw[index]
                if entry.startswith("# "):
                    key, value = entry[2:].split(" ", 1)
                    headers[key] = value
                    index += 1
                    continue
                if entry.startswith("? "):
                    item = {"status": "??", "path": entry[2:]}
                elif entry.startswith("u "):
                    values = entry.split(" ", 10)
                    item = {"status": values[1], "path": values[10]}
                    conflicts.append(item["path"])
                else:
                    values = entry.split(" ", 9 if entry.startswith("2 ") else 8)
                    item = {"status": values[1].replace(".", " "), "path": values[-1]}
                if entry.startswith("2 "):
                    index += 1
                    item["from"] = raw[index]
                changes.append(item)
                index += 1
            branch = headers.get("branch.head", "")
            if branch == "(detached)":
                branch = ""
            head = headers.get("branch.oid", "")
            if head == "(initial)":
                head = ""
            upstream = headers.get("branch.upstream", "")
            ahead, behind = map(lambda value: abs(int(value)), headers.get("branch.ab", "+0 -0").split())
            refs = self.run("for-each-ref", "--format=%(refname)%09%(objectname)%09%(upstream:short)",
                            "refs/heads", "refs/remotes").stdout
            branches = []
            for line in refs.splitlines():
                ref, commit, tracking = line.split("\t")
                remote_ref = ref.startswith("refs/remotes/")
                name = ref.removeprefix("refs/remotes/" if remote_ref else "refs/heads/")
                if not (remote_ref and ref.endswith("/HEAD")):
                    branches.append({"name": name, "head": commit, "upstream": tracking,
                                     "remote": remote_ref})
            rebase_dir = next((self.git_path(name) for name in ("rebase-merge", "rebase-apply")
                               if self.git_path(name).exists()), None)
            rebase = rebase_dir is not None
            rebase_branch = (rebase_dir / "head-name").read_text(encoding="utf-8").strip().removeprefix(
                "refs/heads/") if rebase_dir else ""
            merge = self.git_path("MERGE_HEAD").exists()
            remotes = self.text("remote").splitlines()
            remote = "origin" in remotes
            history = []
            if head:
                for line in self.text("log", "-12", "--format=%h%x09%s").splitlines():
                    short, subject = line.split("\t", 1)
                    history.append({"id": short, "subject": subject})
            reasons = []
            base = next((item["name"] for item in branches if item["name"] in ("origin/main", "origin/master")), "")
            base_behind = 0
            if head and base:
                base_behind = int(self.text("rev-list", "--count", f"{head}..{base}"))
            if not branch:
                reasons.append("No working branch is checked out. Select a branch.")
            if branch in PROTECTED:
                reasons.append(f"{branch} is protected. Create or switch to a working branch to edit.")
            if rebase or merge:
                reasons.append("A Git history operation is unfinished. Resolve it in the Git dashboard first.")
            elif conflicts:
                reasons.append("Unresolved index conflicts exist. Ask the maintainer to resolve them.")
            result = {
                "available": True, "branch": branch, "head": head, "upstream": upstream,
                "ahead": ahead, "behind": behind, "changes": changes, "branches": branches,
                "base_branch": base, "base_behind": base_behind,
                "remote": remote, "remotes": remotes, "manual_terminal": self.busy and self.job["action"] == "terminal",
                "rebase": rebase, "rebase_branch": rebase_branch, "merge": merge, "conflicts": conflicts,
                "upstream_exists": upstream in {item["name"] for item in branches},
                "upstream_head": next((item["head"] for item in branches if item["name"] == upstream), ""),
                "history": history, "last_fetch": self.last_fetch, "busy": False,
                "graph": self.history_graph(head, branch, branches, base, rebase_branch),
                "editable": not reasons, "reasons": reasons, "job": dict(self.job),
                "revision": self.fingerprint(changes, head, branch, refs),
            }
            record = self.recovery(rebase_branch or branch)
            result["recovery"] = {key: value for key, value in record.items() if key != "remote_url"} if record else None
            result["lease_ready"] = self.lease_ready(record, branch, head, upstream, remote, rebase, changes)
            result["revision"] = hashlib.sha256((result["revision"] + json.dumps(record, sort_keys=True)).encode()).hexdigest()
            self.cached = result
            return result
        except (ContentError, OSError, subprocess.SubprocessError) as exc:
            LOGGER.warning("Git state unavailable: %s", exc)
            return {"available": False, "editable": False, "busy": False,
                    "reasons": [str(exc)], "error": str(exc), "job": dict(self.job)}

    def assert_editable(self):
        state = self.snapshot()
        if not state.get("editable"):
            raise ConflictError("Editing is locked: " + " ".join(state.get("reasons") or
                                ["A Git operation is running. Wait until it finishes."]))

    def checked(self, payload):
        state = self.snapshot()
        if self.busy or not state.get("available"):
            raise ConflictError("Git is busy or unavailable. Refresh before trying again.")
        if payload.get("revision") != state["revision"]:
            raise ConflictError("Files, commits or branches changed since this review. Refresh and review again.")
        return state

    def review_file(self, path, entry, image_budget):
        file = self.file(path)
        status = "removed" if not file.exists() else "added" if entry["status"] == "??" or "A" in entry["status"] else "changed"
        item = {"path": path, "status": status, "kind": "text", "sections": [], "warning": ""}
        mime = {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg", ".gif": "image/gif"}.get(file.suffix.lower())
        if mime:
            item["kind"] = "image"
            for side in ("before", "after"):
                item[side] = None
                if status == ("added" if side == "before" else "removed"):
                    continue
                size = int(self.text("cat-file", "-s", f"HEAD:{path}")) if side == "before" else file.stat().st_size
                if size > min(500000, image_budget):
                    item["warning"] = "Image preview omitted because it is too large. Inspect the full image before committing."
                    continue
                raw = self.run("show", f"HEAD:{path}", binary=True).stdout if side == "before" else file.read_bytes()
                image_budget -= len(raw)
                item[side] = f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
            return item, image_budget
        if entry["status"] == "??":
            with file.open("rb") as stream:
                raw = stream.read(100001)
            if len(raw) > 100000 or b"\0" in raw:
                item.update(kind="file", warning="This file is binary or too large to preview. Open it in its usual viewer before committing.")
            else:
                item["sections"] = [{"lines": [{"kind": "added", "text": line}
                    for line in raw.decode("utf-8", errors="replace").splitlines()]}]
        else:
            diff = self.text("diff", "--no-ext-diff", "--no-textconv", "--unified=3", "HEAD", "--", path)
            section = None
            for line in diff.splitlines():
                if line.startswith("@@ "):
                    section = {"lines": []}
                    item["sections"].append(section)
                elif section is not None and line[:1] in {" ", "+", "-"}:
                    section["lines"].append({"kind": {" ": "same", "+": "added", "-": "removed"}[line[0]], "text": line[1:]})
            if any(line.startswith("Binary files ") for line in diff.splitlines()):
                item.update(kind="file", warning="This file cannot be shown as text. Open it in its usual viewer before committing.")
            elif not item["sections"]:
                item["warning"] = "The file's properties changed, or its content matches the previous checkpoint. See technical details for the exact change."
        shown = 0
        for section in item["sections"]:
            remaining = max(0, 600 - shown)
            if len(section["lines"]) > remaining:
                item["warning"] = "Only the first 600 changed/context lines are shown. Review the full file before committing."
            section["lines"] = section["lines"][:remaining]
            shown += len(section["lines"])
        item["sections"] = [section for section in item["sections"] if section["lines"]]
        return item, image_budget

    def review(self, payload):
        with self.app.lock:
            state = self.checked(payload)
            if not state["editable"]:
                raise ConflictError("Choose an editable working branch before reviewing a checkpoint.")
            paths = self.selected_paths(payload, state)
            diff = self.text("diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", *paths) if state["head"] else ""
            previews = []
            files = []
            image_budget = 2 * 1024 * 1024
            text_budget = 150000
            for path in paths:
                entry = next(change for change in state["changes"] if change["path"] == path)
                item, image_budget = self.review_file(path, entry, image_budget)
                for section in item["sections"]:
                    visible = []
                    for line in section["lines"]:
                        if text_budget <= 0:
                            item["warning"] = "The preview is shortened because the selected content is too large. Review the full file before committing."
                            break
                        text = line["text"][:min(2000, text_budget)]
                        if len(text) < len(line["text"]):
                            item["warning"] = "Some long text is shortened in this preview. Review the full file before committing."
                        visible.append({**line, "text": text})
                        text_budget -= max(1, len(text))
                    section["lines"] = visible
                item["sections"] = [section for section in item["sections"] if section["lines"]]
                files.append(item)
                if entry["status"] == "??":
                    with self.file(path).open("rb") as stream:
                        raw = stream.read(100001)
                    if len(raw) <= 100000 and b"\0" not in raw:
                        previews.append(f"New file: {path}\n{raw.decode('utf-8', errors='replace')}")
                    else:
                        previews.append(f"New binary/large file: {path} ({self.file(path).stat().st_size} bytes)")
            self.commit_plan = {"revision": state["revision"], "paths": paths}
            return {"revision": state["revision"], "paths": paths,
                    "diff": (diff + "\n" + "\n\n".join(previews))[:150000], "files": files,
                    "note": "Before is the previous checkpoint; After is what this checkpoint will save. Nothing is sent to the server yet. Large technical previews may be truncated."}

    def selected_paths(self, payload, state):
        paths = payload.get("paths")
        known = {change["path"] for change in state["changes"]}
        if (not isinstance(paths, list) or not paths or any(not isinstance(path, str) or path not in known for path in paths)
                or len(set(paths)) != len(paths)):
            raise ContentError("Select existing changed files to include in this checkpoint.")
        for path in paths:
            self.file(path)
        if any(change.get("from") for change in state["changes"] if change["path"] in paths):
            raise ContentError("Renamed files need Git's full rename review outside this limited editor.")
        return paths

    def validate_operation(self, action, payload, state):
        recovery = action in {"continue", "abort", "resolve"}
        if action not in {"fetch", "checkout", "create", "pull", "rebase", "commit", "push", "push-lease", "continue", "abort", "resolve", "terminal"}:
            raise ContentError("Unknown Git operation.")
        if self.app.job["state"] == "running":
            raise ConflictError("Wait for the current build or check to finish before changing Git state.")
        if action == "terminal":
            if sys.platform != "win32":
                raise ContentError("Opening a native recovery terminal is supported on Windows only. Open your own terminal at the checkout.")
            return
        if state["merge"]:
            raise ConflictError("An external merge is unfinished. Workbench is rebase-only; resolve the merge outside the tool.")
        record = self.recovery(state["branch"])
        if action in {"pull", "rebase"} and record and record["phase"] == "ready" and record["expected_remote"]:
            raise ConflictError("Publish the already rebased branch with its recorded lease before starting another rebase. If publication is rejected, ask the maintainer to reconcile the server changes using the saved backup.")
        if state["rebase"] != recovery and (state["rebase"] or recovery):
            raise ConflictError("Finish or abort the current rebase before starting another operation.")
        protected_update = (action == "pull" and state["branch"] in PROTECTED and
                            state["upstream"] == f"origin/{state['branch']}" and
                            state["ahead"] == 0 and not state["conflicts"])
        if action not in {"fetch", "checkout", "create"} and not recovery and not state["editable"] and not protected_update:
            raise ConflictError("This operation is blocked on protected or detached branches.")
        if action in {"checkout", "pull", "rebase", "push", "push-lease"} and state["changes"]:
            raise ConflictError("Saved files are not committed. Create a checkpoint first; Workbench never stashes or discards them automatically.")
        if action == "create" and (state["changes"] and state["branch"] not in PROTECTED):
            raise ConflictError("Commit your current branch's changes before creating another branch.")
        if action == "checkout":
            target = payload.get("branch")
            if target not in {branch["name"] for branch in state["branches"]} or target == "origin/HEAD":
                raise ContentError("Select an existing local or server branch.")
        if action == "create":
            target = payload.get("branch")
            if (not isinstance(target, str) or target.startswith(("-", "origin/")) or target in PROTECTED or
                    self.run("check-ref-format", "--branch", target, check=False).returncode):
                raise ContentError("Choose a valid working branch name, e.g. course-2027-update.")
            if target in {branch["name"] for branch in state["branches"]}:
                raise ContentError("That branch already exists. Switch to it instead.")
            if not state["head"]:
                raise ContentError("The checkout needs its first commit before branches can be created.")
        if action == "fetch" and not state.get("remotes"):
            raise ContentError("No server remote is configured. Ask the site maintainer to configure one.")
        if action in {"pull", "push", "push-lease"} and not state["remote"]:
            raise ContentError("No origin server is configured. Ask the site maintainer to configure it.")
        if action == "pull" and not state["upstream"].startswith("origin/"):
            raise ContentError("This branch has no tracked origin branch. Send its first checkpoint to the server first.")
        if action == "pull" and not state["upstream_exists"]:
            raise ContentError("The tracked server branch is missing from the last fetch. Ask the maintainer before recreating it.")
        if action == "rebase":
            target = payload.get("target")
            if target not in {branch["name"] for branch in state["branches"]} or target == state["branch"]:
                raise ContentError("Choose an existing different branch to use as the new base.")
            if payload.get("allow_published") is True:
                if target not in {"origin/main", "origin/master"}:
                    raise ContentError("Published working branches can only be rebased onto origin/main or origin/master.")
                if state["upstream"] != f"origin/{state['branch']}" or not state["upstream_exists"]:
                    raise ConflictError("Track this working branch's own origin branch before rewriting published history.")
                if self.run("merge-base", "--is-ancestor", state["upstream_head"], "HEAD", check=False).returncode:
                    raise ConflictError("Your branch is missing server checkpoints. Fetch and pull with rebase before rebasing onto main.")
            else:
                self.assert_unpublished(target)
        if action == "commit":
            self.selected_paths(payload, state)
            if self.commit_plan != {"revision": state["revision"], "paths": payload["paths"]}:
                raise ConflictError("Review exactly these selected files before creating a checkpoint.")
            message = payload.get("message")
            if not isinstance(message, str) or not message.strip() or len(message) > 2000 or "\0" in message:
                raise ContentError("Describe what changed in a short checkpoint message.")
            if state["conflicts"]:
                raise ConflictError("Resolve all conflicting files before creating a checkpoint.")
        if action == "push" and state["behind"]:
            raise ConflictError("The server has different history. After a backed-up rebase, use the separately reviewed force-with-lease action; otherwise fetch and pull first.")
        if action == "push-lease":
            record = self.recovery(state["branch"])
            if not state["lease_ready"]:
                raise ConflictError("Force-with-lease is only available after a backed-up Workbench rebase of this published working branch.")
            if payload.get("backup_id") != record["id"] or payload.get("expected_remote") != record["expected_remote"]:
                raise ConflictError("Review the recovery backup and exact server checkpoint again before publishing rewritten history.")
            if payload.get("branch_confirmation") != state["branch"]:
                raise ContentError("Type the working branch's exact name to confirm publishing rewritten history.")
        if action in {"continue", "abort", "resolve"} and not state["rebase"]:
            raise ContentError("There is no active rebase to recover.")
        if action == "continue" and state["conflicts"]:
            raise ConflictError("Resolve each conflicting file before continuing the rebase.")
        if action == "resolve":
            if payload.get("path") not in state["conflicts"]:
                raise ContentError("Select a currently conflicting file.")
            raw = self.file(payload["path"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != payload.get("file_revision"):
                raise ConflictError("Conflict file changed. Read and review it again.")
            source = payload.get("source")
            if not isinstance(source, str) or len(source.encode("utf-8")) > 2 * 1024 * 1024 or "\0" in source:
                raise ContentError("Resolution must be UTF-8 text, up to 2 MiB.")
            if any(line.startswith(("<<<<<<<", "=======", ">>>>>>>")) for line in source.splitlines()):
                raise ContentError("Remove all conflict markers and keep the intended content before accepting this resolution.")

    def assert_unpublished(self, target, known_heads=()):
        rewritten = set(self.text("rev-list", "HEAD", f"^{target}").splitlines())
        published = set(self.text("rev-list", "--remotes=origin", *known_heads).splitlines())
        if rewritten & published:
            raise ConflictError("This rebase would rewrite checkpoints already on the server. Choose origin/main and explicitly approve the backed-up rebase and later force-with-lease publication.")

    def conflict(self, payload):
        with self.app.lock:
            state = self.checked(payload)
            if payload.get("path") not in state["conflicts"]:
                raise ContentError("Select a currently conflicting file.")
            path = self.file(payload["path"])
            if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
                raise ContentError("Missing or large conflict files require maintainer assistance; you can safely abort the rebase.")
            raw = path.read_bytes()
            if b"\0" in raw:
                raise ContentError("Binary conflicts require maintainer assistance; you can safely abort the rebase.")
            try:
                source = raw.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ContentError("This conflict is not UTF-8 text. Ask the maintainer or abort the rebase.") from exc
            return {"path": payload["path"], "source": source, "file_revision": hashlib.sha256(raw).hexdigest()}

    def start(self, payload):
        with self.app.lock:
            state = self.checked(payload)
            action = payload.get("action")
            if payload.get("confirm") is not True:
                raise ContentError("Review and explicitly confirm this Git operation.")
            self.validate_operation(action, payload, state)
            if self.app.closed:
                raise ConflictError("Workbench is shutting down.")
            if action == "terminal":
                return self.start_terminal(state)
            self.cached = state
            self.busy = True
            self.job = {"state": "running", "action": action, "target": payload.get("target", ""),
                        "log": f"Starting {action}…", "error": ""}
            self.thread = threading.Thread(target=self.execute, args=(action, dict(payload), state), daemon=True)
            self.thread.start()
            return self.snapshot()

    def start_terminal(self, state):
        executable = shutil.which("powershell.exe")
        if not executable:
            raise ContentError("Windows PowerShell was not found. Open a terminal manually at this checkout.")
        folder = str(self.root).replace("'", "''")
        script = (f"Set-Location -LiteralPath '{folder}'; "
                  "Write-Host 'FTSK advanced Git recovery - this is the real checkout.' -ForegroundColor Yellow; "
                  "Write-Host 'Workbench is locked until you exit this terminal. Manual commands bypass GUI safeguards.'; "
                  "Write-Host 'Use git status to inspect. Close child editors and type exit when finished.'")
        encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
        try:
            process = subprocess.Popen([executable, "-NoLogo", "-NoProfile", "-NoExit", "-EncodedCommand", encoded],
                                       cwd=self.root, creationflags=subprocess.CREATE_NEW_CONSOLE)
        except OSError as exc:
            raise ContentError(f"Cannot open the recovery terminal: {exc}") from exc
        self.cached = {**state, "manual_terminal": True}
        self.busy = True
        self.job = {"state": "running", "action": "terminal", "log": "Native recovery terminal open. Workbench is locked.",
                    "error": ""}
        self.thread = threading.Thread(target=self.wait_terminal, args=(process,), daemon=True)
        self.thread.start()
        return self.snapshot()

    def wait_terminal(self, process):
        code = process.wait()
        with self.app.lock:
            self.busy = False
            self.job.update(state="passed" if code == 0 else "failed",
                            error="" if code == 0 else f"Recovery terminal exited with code {code}. Inspect Git state before continuing.",
                            log=f"Recovery terminal closed (exit {code}). Manual command results are in the terminal, not audited by Workbench.")
            self.commit_plan = None
            self.cached = self.snapshot()

    def command(self, *args, network=False):
        with self.app.lock:
            self.job["log"] += "\nGit: " + " ".join(args)
        result = self.run(*args, check=False, network=network)
        with self.app.lock:
            self.job["log"] = (self.job["log"] + "\n" + result.stdout + result.stderr)[-60000:]
        if result.returncode:
            raise ContentError((result.stderr or result.stdout).strip() or "Git operation failed.")

    def fetch_remotes(self):
        self.command("fetch", "--all", "--prune", network=True)
        self.last_fetch = datetime.now(timezone.utc).isoformat()

    def execute(self, action, payload, state):
        try:
            if action == "fetch":
                self.fetch_remotes()
            elif action == "checkout":
                target = payload["branch"]
                if next(branch["remote"] for branch in state["branches"] if branch["name"] == target):
                    local = target.split("/", 1)[1]
                    if local in {branch["name"] for branch in state["branches"] if not branch["remote"]}:
                        self.command("switch", local)
                    else:
                        self.command("switch", "--track", "-c", local, target)
                else:
                    self.command("switch", target)
            elif action == "create":
                self.command("switch", "-c", payload["branch"])
            elif action == "pull":
                self.fetch_remotes()
                if state["branch"] in PROTECTED and self.run(
                        "merge-base", "--is-ancestor", "HEAD", state["upstream"], check=False).returncode:
                    raise ConflictError("The protected branch cannot fast-forward to the server. Ask the maintainer to review its history.")
                self.assert_unpublished(state["upstream"],
                                        [branch["head"] for branch in state["branches"] if branch["remote"]])
                if state["branch"] not in PROTECTED:
                    self.backup_rebase(state, state["upstream"])
                self.command("rebase", "--no-autostash", state["upstream"])
                self.finish_rebase(state["branch"])
            elif action == "rebase":
                if payload.get("allow_published") is True:
                    self.fetch_remotes()
                    if (self.text("rev-parse", state["upstream"]) != state["upstream_head"] or
                            self.text("rev-parse", payload["target"]) != next(
                                branch["head"] for branch in state["branches"] if branch["name"] == payload["target"])):
                        raise ConflictError("The server changed since confirmation. Review its updated branches and confirm again.")
                self.assert_reviewed_checkout(state)
                record = self.backup_rebase(state, payload["target"], leased=payload.get("allow_published") is True)
                self.assert_reviewed_checkout(state)
                self.command("rebase", "--no-autostash", record["target_head"])
                self.finish_rebase(state["branch"])
            elif action == "commit":
                paths = payload["paths"]
                self.command("add", "--", *paths)
                message = payload["message"].strip() + "\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
                self.command("commit", "--only", "-m", message, "--", *paths)
                self.commit_plan = None
            elif action == "push":
                # Git itself rejects non-fast-forward races with server updates.
                self.command("push", "--set-upstream", "origin", f"HEAD:refs/heads/{state['branch']}", network=True)
                self.last_fetch = datetime.now(timezone.utc).isoformat()
                record = self.recovery(state["branch"])
                if record and record["phase"] == "ready":
                    record["phase"] = "published"
                    self.save_recovery(record)
            elif action == "push-lease":
                record = self.recovery(state["branch"])
                self.command("bundle", "verify", str(self.file(record["directory"] + "/history.bundle")))
                self.assert_reviewed_checkout(state)
                if self.text("remote", "get-url", "origin") != record["remote_url"]:
                    raise ConflictError("Origin changed since the backed-up rebase. Ask the maintainer to review the server configuration.")
                self.command("push", "--set-upstream",
                             f"--force-with-lease=refs/heads/{state['branch']}:{record['expected_remote']}",
                             "origin", f"{state['head']}:refs/heads/{state['branch']}", network=True)
                self.last_fetch = datetime.now(timezone.utc).isoformat()
                record["phase"] = "published"
                self.save_recovery(record)
            elif action == "continue":
                self.command("rebase", "--continue")
                self.finish_rebase(state["rebase_branch"])
            elif action == "abort":
                self.command("rebase", "--abort")
                self.finish_rebase(state["rebase_branch"], "aborted")
            elif action == "resolve":
                path = self.file(payload["path"])
                if hashlib.sha256(path.read_bytes()).hexdigest() != payload["file_revision"]:
                    raise ConflictError("Conflict file changed before resolution. Review it again.")
                temporary = None
                try:
                    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".git-resolution-", delete=False) as stream:
                        temporary = Path(stream.name)
                        stream.write(payload["source"].encode("utf-8"))
                    temporary.replace(path)
                finally:
                    if temporary and temporary.exists():
                        temporary.unlink()
                self.command("add", "--", payload["path"])
            with self.app.lock:
                self.job.update(state="passed")
        except (ContentError, OSError, subprocess.SubprocessError) as exc:
            LOGGER.warning("Git operation failed: %s", exc)
            message = str(exc)
            if action == "push-lease" and "(stale info)" in message:
                message = ("The server branch changed or was deleted after your rebase was reviewed. "
                           "Your saved history was NOT force-overwritten. Keep the recovery backup and ask the maintainer "
                           "to combine the new server changes with your rebased work. Fetch cannot reset this lease. "
                           "The technical Git response is in the operation details.")
            with self.app.lock:
                self.job.update(state="failed", error=message)
        finally:
            with self.app.lock:
                self.busy = False
                self.cached = self.snapshot()
