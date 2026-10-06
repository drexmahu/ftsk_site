"""Guided Git regressions use local disposable repos, never the user's checkout/server."""

import json
import base64
import shutil
import subprocess
import tempfile
import threading
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import Mock, patch
from PIL import Image

from content_workbench import ContentError, ConflictError
from site_workbench import ToolError, WorkbenchServer
from test_site_workbench import Fixture


class GitTests(Fixture):
    def setUp(self):
        super().setUp()
        self.git = self.app.git
        self.git.run("config", "user.name", "Fixture editor")
        self.git.run("config", "user.email", "fixture@example.test")
        self.git.run("config", "commit.gpgsign", "false")
        self.git.run("config", "core.autocrlf", "false")
        self.shared = self.root / "shared.txt"
        self.shared.write_text("Original\n", encoding="utf-8")
        self.git.run("add", ".")
        self.git.run("commit", "-m", "Initial fixture")
        self.git.run("branch", "-m", "main")
        self.remote_dir = tempfile.TemporaryDirectory(prefix="ftsk-git-remote-")
        self.addCleanup(self.remote_dir.cleanup)
        self.remote = Path(self.remote_dir.name) / "server.git"
        subprocess.run(["git", "init", "--bare", "-b", "main", str(self.remote)], check=True, capture_output=True)
        self.git.run("remote", "add", "origin", str(self.remote))
        self.git.run("push", "-u", "origin", "main")
        self.git.run("switch", "-c", "working")

    def operation(self, action, **kwargs):
        state = self.git.snapshot()
        payload = {"action": action, "revision": state["revision"], "confirm": True, **kwargs}
        if action == "commit":
            self.git.review(payload)
        self.git.start(payload)
        self.git.thread.join(30)
        self.assertFalse(self.git.thread.is_alive(), "Git worker should finish")
        return self.git.snapshot()

    def commit(self, source, message="Local checkpoint"):
        self.shared.write_text(source, encoding="utf-8")
        result = self.operation("commit", paths=["shared.txt"], message=message)
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        return result

    def server_update(self, source):
        peer = Path(self.remote_dir.name) / "peer"
        subprocess.run(["git", "clone", str(self.remote), str(peer)], check=True, capture_output=True)
        for args in (["config", "user.name", "Server editor"], ["config", "user.email", "server@example.test"],
                     ["config", "commit.gpgsign", "false"], ["config", "core.autocrlf", "false"]):
            subprocess.run(["git", "-C", str(peer), *args], check=True, capture_output=True)
        (peer / "shared.txt").write_text(source, encoding="utf-8")
        for args in (["add", "."], ["commit", "-m", "Server checkpoint"], ["push", "origin", "main"]):
            subprocess.run(["git", "-C", str(peer), *args], check=True, capture_output=True)

    def test_main_and_detached_are_read_only_and_creation_carries_dirty_main_files(self):
        self.git.run("switch", "main")
        self.shared.write_text("Saved on main\n", encoding="utf-8")
        state = self.git.snapshot()
        self.assertFalse(state["editable"])
        self.assertIn("protected", state["reasons"][0])
        with self.assertRaises(ConflictError):
            self.git.assert_editable()
        result = self.operation("create", branch="course-2027")
        self.assertEqual(result["branch"], "course-2027")
        self.assertTrue(result["editable"])
        self.assertEqual(self.shared.read_text(), "Saved on main\n")
        self.commit("Saved on main\n")
        self.git.run("switch", "--detach", "HEAD")
        self.assertFalse(self.git.snapshot()["editable"])

    def test_checkout_requires_clean_files_and_rejects_invalid_targets(self):
        self.shared.write_text("Uncommitted\n", encoding="utf-8")
        with self.assertRaises(ConflictError):
            self.operation("checkout", branch="main")
        self.assertEqual(self.git.text("branch", "--show-current"), "working")
        self.assertEqual(self.shared.read_text(), "Uncommitted\n")
        with self.assertRaises(ContentError):
            self.operation("create", branch="--force")

    def test_snapshot_identifies_main_updates_missing_from_working_branch(self):
        before = self.git.snapshot()
        self.assertEqual(before["base_branch"], "origin/main")
        self.assertEqual(before["base_behind"], 0)
        self.server_update("New main checkpoint\n")
        self.assertEqual(self.git.snapshot()["base_behind"], 0, "Cached refs do not pretend to be live")
        result = self.operation("fetch")
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        self.assertEqual(result["base_behind"], 1)
        self.assertEqual(result["behind"], 0, "Main updates differ from upstream branch updates")
        self.assertEqual(self.shared.read_text(), "Original\n", "Fetch never updates working files")
        result = self.operation("rebase", target="origin/main")
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        self.assertEqual(result["base_behind"], 0)

    def test_graph_tracks_actual_fork_main_and_rebased_published_branch(self):
        original = self.git.snapshot()["head"]
        other = self.root / "working-only.txt"
        other.write_text("Working checkpoint\n", encoding="utf-8")
        self.git.run("add", "--", "working-only.txt")
        self.git.run("commit", "-m", "Working checkpoint")
        result = self.operation("push")
        old_work = result["head"]
        self.server_update("Main moves forward\n")
        cached = self.git.snapshot()["graph"]
        self.assertEqual(cached["main_only"], 0, "No network contact on snapshot")
        result = self.operation("fetch")
        graph = result["graph"]
        self.assertEqual(graph["forks"], [original])
        self.assertEqual((graph["main_only"], graph["work_only"]), (1, 1))
        lanes = {lane["id"]: lane for lane in graph["lanes"]}
        self.assertEqual(lanes["local-main"]["head"], original)
        self.assertNotEqual(lanes["main"]["head"], original)
        self.assertEqual(lanes["server"]["head"], old_work)
        nodes = {node["id"]: node for node in graph["nodes"]}
        self.assertEqual(nodes[old_work]["parents"], [original])
        self.assertEqual(nodes[lanes["main"]["head"]]["parents"], [original])
        self.assertIs(self.git.snapshot()["graph"], graph, "Polling reuses graph data when tips are unchanged")
        result = self.operation("rebase", target="origin/main", allow_published=True)
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        graph = result["graph"]
        lanes = {lane["id"]: lane for lane in graph["lanes"]}
        self.assertEqual(graph["forks"], [lanes["main"]["head"]])
        self.assertEqual((graph["main_only"], graph["work_only"]), (0, 1))
        self.assertNotEqual(lanes["work"]["head"], old_work)
        self.assertEqual(lanes["server"]["head"], old_work, "Rebasing never pretends the server branch was published")
        nodes = {node["id"]: node for node in graph["nodes"]}
        self.assertEqual(nodes[result["head"]]["parents"], [lanes["main"]["head"]])

    def test_graph_is_bounded_but_keeps_an_old_branch_point(self):
        fork = self.git.snapshot()["head"]
        for index in range(22):
            self.git.run("commit", "--allow-empty", "-m", f"Checkpoint {index}")
        graph = self.git.snapshot()["graph"]
        self.assertIn("work", graph["truncated"])
        self.assertIn(fork, {node["id"] for node in graph["nodes"]})
        self.assertEqual(graph["forks"], [fork])
        self.assertEqual(graph["work_only"], 22)
        self.assertLessEqual(len(graph["nodes"]), graph["limit"] * len(graph["lanes"]) + len(graph["forks"]))
        nodes = {node["id"]: node for node in graph["nodes"]}
        self.assertTrue(any(parent not in nodes for node in nodes.values() for parent in node["parents"]),
                        "Boundary ancestry remains explicit, not invented as a direct link to the old fork")

    def test_graph_without_origin_and_with_unrelated_history(self):
        self.git.run("remote", "remove", "origin")
        graph = self.git.snapshot()["graph"]
        self.assertEqual(graph["lanes"][0]["name"], "main")
        self.assertFalse(graph["lanes"][0]["remote"])
        self.git.run("switch", "--orphan", "unrelated")
        self.git.run("commit", "--allow-empty", "-m", "Separate root")
        result = self.git.snapshot()
        self.assertTrue(result["available"])
        self.assertEqual(result["graph"]["forks"], [])
        self.assertEqual(result["graph"]["main_only"], 1)
        self.assertEqual(result["graph"]["work_only"], 1)

    def test_fetch_all_prunes_every_remote_without_deleting_local_branches(self):
        head = self.git.snapshot()["head"]
        self.git.run("remote", "add", "backup", str(self.remote))
        subprocess.run(["git", "--git-dir", str(self.remote), "update-ref", "refs/heads/obsolete", head],
                       check=True, capture_output=True)
        self.git.run("branch", "obsolete", head)
        result = self.operation("fetch")
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        self.assertIn("fetch --all --prune", result["job"]["log"])
        names = {branch["name"] for branch in result["branches"]}
        self.assertTrue({"origin/obsolete", "backup/obsolete", "backup/main", "obsolete"} <= names)
        subprocess.run(["git", "--git-dir", str(self.remote), "update-ref", "-d", "refs/heads/obsolete"],
                       check=True, capture_output=True)
        result = self.operation("fetch")
        names = {branch["name"] for branch in result["branches"]}
        self.assertNotIn("origin/obsolete", names)
        self.assertNotIn("backup/obsolete", names)
        self.assertIn("obsolete", names, "Pruning never deletes local branches")
        self.assertEqual(result["head"], head)
        self.assertEqual(self.shared.read_text(), "Original\n")
        self.git.run("remote", "remove", "origin")
        result = self.operation("fetch")
        self.assertEqual(result["job"]["state"], "passed", "Fetch all works even when the configured remote is not origin")
        self.assertEqual(result["remotes"], ["backup"])

    def test_shared_working_branch_pull_replays_local_work_without_force(self):
        self.operation("push")
        local = self.root / "local-task.txt"
        local.write_text("Local task\n", encoding="utf-8")
        self.git.run("add", "--", local.name)
        self.git.run("commit", "-m", "Local unpublished task")
        peer = Path(self.remote_dir.name) / "collaborator"
        subprocess.run(["git", "clone", "-b", "working", str(self.remote), str(peer)], check=True, capture_output=True)
        for args in (["config", "user.name", "Teammate"], ["config", "user.email", "teammate@example.test"],
                     ["config", "commit.gpgsign", "false"]):
            subprocess.run(["git", "-C", str(peer), *args], check=True, capture_output=True)
        (peer / "teammate.txt").write_text("Teammate task\n", encoding="utf-8")
        for args in (["add", "."], ["commit", "-m", "Teammate checkpoint"], ["push"]):
            subprocess.run(["git", "-C", str(peer), *args], check=True, capture_output=True)
        result = self.operation("pull")
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        self.assertEqual((result["ahead"], result["behind"]), (1, 0))
        self.assertEqual(local.read_text(), "Local task\n")
        self.assertEqual((self.root / "teammate.txt").read_text(), "Teammate task\n")
        self.assertIn("rebase --no-autostash origin/working", result["job"]["log"])
        self.assertTrue(result["recovery"]["directory"])
        result = self.operation("push")
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        self.assertNotIn("--force", result["job"]["log"])

    def test_native_terminal_locks_workbench_until_exit_and_refreshes_history(self):
        release = threading.Event()
        process = Mock()
        process.wait.side_effect = lambda: (release.wait(), 0)[1]
        real_popen, real_which = subprocess.Popen, shutil.which
        state = self.git.snapshot()
        self.git.run("switch", "main")
        state = self.git.snapshot()
        try:
            with patch("git_workbench.shutil.which", side_effect=lambda name: "powershell.exe" if name == "powershell.exe" else real_which(name)), \
                    patch("git_workbench.subprocess.Popen", side_effect=lambda args, **kwargs:
                          process if args[0] == "powershell.exe" else real_popen(args, **kwargs)) as launch, \
                    patch("git_workbench.sys", Mock(platform="win32")), \
                    patch("git_workbench.subprocess.CREATE_NEW_CONSOLE", 16, create=True):
                result = self.git.start({"action": "terminal", "confirm": True, "revision": state["revision"]})
                self.assertTrue(result["manual_terminal"])
                self.assertTrue(result["busy"])
                self.assertFalse(result["editable"])
                native_call = next(call for call in launch.call_args_list if call.args[0][0] == "powershell.exe")
                args = native_call.args[0]
                self.assertEqual(args[:4], ["powershell.exe", "-NoLogo", "-NoProfile", "-NoExit"])
                script = base64.b64decode(args[-1]).decode("utf-16-le")
                self.assertIn("Set-Location -LiteralPath", script)
                self.assertIn(str(self.root), script)
                self.assertNotIn("git reset", script)
                self.assertEqual(native_call.kwargs["creationflags"], subprocess.CREATE_NEW_CONSOLE)
                with self.assertRaises(ConflictError):
                    self.git.assert_editable()
                with self.assertRaises(ConflictError):
                    self.git.start({"action": "fetch", "confirm": True, "revision": state["revision"]})
                with self.assertRaises(ToolError):
                    self.app.start_job("build")
                self.git.run("switch", "working")
        finally:
            release.set()
            if self.git.thread:
                self.git.thread.join(30)
        result = self.git.snapshot()
        self.assertFalse(result["manual_terminal"])
        self.assertFalse(result["busy"])
        self.assertEqual(result["branch"], "working")
        self.assertTrue(result["editable"])
        self.assertIn("not audited", result["job"]["log"])

    def test_native_terminal_launch_failure_is_explicit_and_never_locks_checkout(self):
        state = self.git.snapshot()
        real_popen, real_which = subprocess.Popen, shutil.which

        def launch(args, **kwargs):
            if args[0] == "powershell.exe":
                raise OSError("Fixture launch denied")
            return real_popen(args, **kwargs)

        with patch("git_workbench.shutil.which", side_effect=lambda name: "powershell.exe" if name == "powershell.exe" else real_which(name)), \
                patch("git_workbench.subprocess.Popen", side_effect=launch), \
                patch("git_workbench.sys", Mock(platform="win32")), \
                patch("git_workbench.subprocess.CREATE_NEW_CONSOLE", 16, create=True):
            with self.assertRaisesRegex(ContentError, "Cannot open.*Fixture launch denied"):
                self.git.start({"action": "terminal", "confirm": True, "revision": state["revision"]})
        self.assertFalse(self.git.busy)

    def test_native_terminal_is_rejected_off_windows(self):
        state = self.git.snapshot()
        with patch("git_workbench.sys", Mock(platform="linux")):
            with self.assertRaisesRegex(ContentError, "supported on Windows only"):
                self.git.start({"action": "terminal", "confirm": True, "revision": state["revision"]})
        self.assertFalse(self.git.busy)

    def test_native_terminal_nonzero_exit_unlocks_but_does_not_report_success(self):
        state = self.git.snapshot()
        self.git.cached = {**state, "manual_terminal": True}
        self.git.busy = True
        self.git.job = {"state": "running", "action": "terminal", "log": "", "error": ""}
        process = Mock()
        process.wait.return_value = 7
        self.git.wait_terminal(process)
        result = self.git.snapshot()
        self.assertFalse(result["busy"])
        self.assertFalse(result["manual_terminal"])
        self.assertEqual(result["job"]["state"], "failed")
        self.assertIn("code 7", result["job"]["error"])

    def test_review_commit_only_selected_files_and_first_nonforce_push(self):
        extra = self.root / "not-selected.txt"
        extra.write_text("Keep outside checkpoint\n", encoding="utf-8")
        self.git.run("add", "--", "not-selected.txt")
        result = self.commit("Checkpoint\n")
        self.assertEqual(result["changes"][0]["path"], "not-selected.txt")
        self.assertIn("not-selected.txt", self.git.text("diff", "--cached", "--name-only"))
        self.assertNotIn("not-selected.txt", self.git.text("ls-tree", "--name-only", "HEAD"))
        self.assertIn("Co-authored-by: Copilot", self.git.text("log", "-1", "--format=%B"))
        # Commit remaining file before push, never discard it.
        self.operation("commit", paths=["not-selected.txt"], message="Extra checkpoint")
        result = self.operation("push")
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        self.assertEqual(result["upstream"], "origin/working")
        self.assertEqual((result["ahead"], result["behind"]), (0, 0))
        self.assertIsNotNone(result["last_fetch"])

    def test_server_head_is_not_a_local_branch_and_protected_pull_only_fast_forwards(self):
        self.git.run("remote", "set-head", "origin", "main")
        result = self.git.snapshot()
        self.assertNotIn("origin", {branch["name"] for branch in result["branches"]})
        self.assertFalse(any(branch["name"] == "origin/HEAD" for branch in result["branches"]))
        self.git.run("switch", "main")
        self.server_update("Server update on protected main\n")
        result = self.operation("pull")
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        self.assertFalse(result["editable"])
        self.assertEqual(self.shared.read_text(), "Server update on protected main\n")
        self.shared.write_text("Unpublished main change\n", encoding="utf-8")
        self.git.run("add", "--", "shared.txt")
        self.git.run("commit", "-m", "Maintainer-only fixture change")
        with self.assertRaises(ConflictError):
            self.operation("pull")

    def test_commit_requires_review_and_stale_content_is_rejected(self):
        self.shared.write_text("First change\n", encoding="utf-8")
        payload = {"revision": self.git.snapshot()["revision"], "paths": ["shared.txt"],
                   "message": "Checkpoint", "action": "commit", "confirm": True}
        with self.assertRaises(ConflictError):
            self.git.start(payload)
        self.git.review(payload)
        self.shared.write_text("Second change\n", encoding="utf-8")
        with self.assertRaises(ConflictError):
            self.git.start(payload)
        self.assertEqual(self.git.text("log", "-1", "--format=%s"), "Initial fixture")

    def test_readable_review_text_images_binary_deletions_and_message_requirement(self):
        self.shared.write_text("Updated wording\n", encoding="utf-8")
        added = self.root / "new-article.md"
        added.write_text("New article\n", encoding="utf-8")
        image = self.root / "static" / "images" / "hero" / "one.webp"
        Image.new("RGB", (160, 120), "red").save(image)
        removed = self.root / "static" / "images" / "hero" / "two.webp"
        removed.unlink()
        binary = self.root / "new-file.bin"
        binary.write_bytes(b"\0binary")
        paths = ["shared.txt", "new-article.md", "static/images/hero/one.webp",
                 "static/images/hero/two.webp", "new-file.bin"]
        revision = self.git.snapshot()["revision"]
        review = self.git.review({"revision": revision, "paths": paths})
        files = {file["path"]: file for file in review["files"]}
        self.assertEqual(files["shared.txt"]["sections"][0]["lines"],
                         [{"kind": "removed", "text": "Original"}, {"kind": "added", "text": "Updated wording"}])
        self.assertEqual(files["new-article.md"]["status"], "added")
        self.assertEqual(files["new-article.md"]["sections"][0]["lines"][0]["text"], "New article")
        self.assertTrue(files[paths[2]]["before"].startswith("data:image/webp;base64,"))
        self.assertNotEqual(files[paths[2]]["before"], files[paths[2]]["after"])
        self.assertEqual(files[paths[3]]["status"], "removed")
        self.assertIsNone(files[paths[3]]["after"])
        self.assertEqual(files["new-file.bin"]["kind"], "file")
        self.assertTrue(files["new-file.bin"]["warning"])
        for message in ("", " \n\t "):
            with self.assertRaises(ContentError):
                self.git.start({"action": "commit", "revision": revision, "paths": paths, "message": message, "confirm": True})
        self.assertEqual(self.git.text("log", "-1", "--format=%s"), "Initial fixture")

    def test_readable_review_marks_truncated_text_and_oversized_images(self):
        added = self.root / "many-lines.txt"
        added.write_text("\n".join(["Line"] * 700), encoding="utf-8")
        image = self.root / "large.png"
        image.write_bytes(b"x" * 500001)
        review = self.git.review({"revision": self.git.snapshot()["revision"], "paths": ["many-lines.txt", "large.png"]})
        self.assertEqual(len(review["files"][0]["sections"][0]["lines"]), 600)
        self.assertIn("600", review["files"][0]["warning"])
        self.assertIsNone(review["files"][1]["after"])
        self.assertIn("too large", review["files"][1]["warning"])
        added.write_text("Long line " * 1000, encoding="utf-8")
        review = self.git.review({"revision": self.git.snapshot()["revision"], "paths": ["many-lines.txt"]})
        self.assertEqual(len(review["files"][0]["sections"][0]["lines"][0]["text"]), 2000)
        self.assertIn("shortened", review["files"][0]["warning"])

    def test_fetch_reports_server_updates_without_changing_working_files(self):
        self.git.run("switch", "main")
        self.server_update("Server changed\n")
        before = self.git.text("rev-parse", "HEAD")
        result = self.operation("fetch")
        self.assertEqual(result["behind"], 1)
        self.assertFalse(result["editable"])
        self.assertEqual(self.git.text("rev-parse", "HEAD"), before)
        self.assertEqual(self.shared.read_text(), "Original\n")
        self.assertIsNotNone(result["last_fetch"])

    def test_pull_rebase_fast_forwards_tracked_working_branch(self):
        self.git.run("branch", "--set-upstream-to", "origin/main", "working")
        self.server_update("Server changed\n")
        result = self.operation("pull")
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        self.assertEqual(self.shared.read_text(), "Server changed\n")
        self.assertEqual(result["behind"], 0)
        self.assertEqual(len(self.git.text("rev-list", "--merges", "HEAD").splitlines()), 0)

    def test_pull_does_not_rewrite_published_history_removed_by_fetch(self):
        self.commit("Published working checkpoint\n")
        self.operation("push")
        before = self.git.text("rev-parse", "HEAD")
        subprocess.run(["git", "--git-dir", str(self.remote), "update-ref", "refs/heads/working",
                        self.git.text("rev-parse", "main")], check=True, capture_output=True)
        result = self.operation("pull")
        self.assertEqual(result["job"]["state"], "failed")
        self.assertIn("already on the server", result["job"]["error"])
        self.assertEqual(self.git.text("rev-parse", "HEAD"), before)
        self.assertFalse(result["rebase"])

    def test_rebase_conflicts_can_be_read_resolved_and_continued(self):
        self.commit("Local change\n")
        self.server_update("Server change\n")
        self.operation("fetch")
        result = self.operation("rebase", target="origin/main")
        self.assertEqual(result["job"]["state"], "failed")
        self.assertTrue(result["rebase"])
        self.assertEqual(result["rebase_branch"], "working")
        self.assertEqual(result["conflicts"], ["shared.txt"])
        self.assertFalse(result["editable"])
        review = self.git.conflict({"revision": result["revision"], "path": "shared.txt"})
        self.assertIn("<<<<<<<", review["source"])
        with self.assertRaises(ContentError):
            self.operation("resolve", **review)
        result = self.operation("resolve", **{**review, "source": "Both intended changes\n"})
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        self.assertEqual(result["conflicts"], [])
        result = self.operation("continue")
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        self.assertFalse(result["rebase"])
        self.assertEqual(result["branch"], "working")
        self.assertEqual(self.shared.read_text(), "Both intended changes\n")
        self.assertEqual(self.git.text("rev-list", "--merges", "HEAD"), "")

    def test_abort_restores_original_branch_and_local_checkpoint(self):
        original = self.commit("Local change\n")["head"]
        self.server_update("Server change\n")
        self.operation("fetch")
        self.operation("rebase", target="origin/main")
        result = self.operation("abort")
        self.assertEqual(result["head"], original)
        self.assertEqual(result["branch"], "working")
        self.assertFalse(result["rebase"])
        self.assertEqual(self.shared.read_text(), "Local change\n")

    def test_rebase_refuses_published_history_rewrite(self):
        self.commit("Published change\n")
        self.operation("push")
        self.server_update("Different server change\n")
        self.operation("fetch")
        with self.assertRaises(ConflictError):
            self.operation("rebase", target="origin/main")
        self.assertFalse(self.git.snapshot()["rebase"])

    def published_rebase(self):
        note = self.root / "branch-note.txt"
        note.write_text("Published branch work\n", encoding="utf-8")
        Image.new("RGB", (160, 120), "blue").save(self.root / "static" / "images" / "hero" / "one.webp")
        self.operation("commit", paths=["branch-note.txt", "static/images/hero/one.webp"], message="Published branch work")
        original = self.operation("push")["head"]
        self.server_update("Main advanced\n")
        self.operation("fetch")
        result = self.operation("rebase", target="origin/main", allow_published=True)
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        self.assertNotEqual(result["head"], original)
        return original, result

    def leased_publish(self, result):
        return self.operation("push-lease", backup_id=result["recovery"]["id"],
                              expected_remote=result["recovery"]["expected_remote"],
                              branch_confirmation="working")

    def test_published_rebase_backup_restores_original_tree_and_exact_lease_survives_restart(self):
        original, result = self.published_rebase()
        record = result["recovery"]
        directory = self.root / record["directory"]
        self.assertEqual(record["original_head"], original)
        self.assertEqual(record["expected_remote"], original)
        for name in ("history.bundle", "commits.patch", "changes.patch", "recovery.json", "RESTORE.txt"):
            self.assertTrue((directory / name).is_file(), name)
        self.assertIn(b"Published branch work", (directory / "commits.patch").read_bytes())
        self.assertIn(b"GIT binary patch", (directory / "commits.patch").read_bytes())
        self.assertEqual(self.git.run("check-ignore", "-q", "--", record["directory"], check=False).returncode, 0)
        self.assertFalse(result["changes"], "Recovery files must not enter the commit picker")
        recovered = Path(self.remote_dir.name) / "recovered"
        subprocess.run(["git", "init", str(recovered)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(recovered), "fetch", str(directory / "history.bundle"),
                        f"{record['backup_ref']}:refs/heads/restored"], check=True, capture_output=True)
        tree = subprocess.run(["git", "-C", str(recovered), "show", "restored:shared.txt"],
                              check=True, capture_output=True, text=True).stdout
        self.assertEqual(tree, "Original\n")
        restored_head = subprocess.run(["git", "-C", str(recovered), "rev-parse", "restored"],
                                       check=True, capture_output=True, text=True).stdout.strip()
        self.assertEqual(restored_head, original)
        recovered_image = subprocess.run(["git", "-C", str(recovered), "show", "restored:static/images/hero/one.webp"],
                                         check=True, capture_output=True).stdout
        self.assertEqual(recovered_image, self.git.run("show", f"{original}:static/images/hero/one.webp", binary=True).stdout)
        self.app.git = self.git = type(self.git)(self.app)
        result = self.git.snapshot()
        self.assertTrue(result["lease_ready"], "Backup and explicit lease must persist across a restart")
        result = self.leased_publish(result)
        self.assertEqual(result["job"]["state"], "passed", result["job"])
        self.assertEqual((result["ahead"], result["behind"]), (0, 0))
        self.assertEqual(result["recovery"]["phase"], "published")
        self.assertEqual(json.loads((directory / "recovery.json").read_text())["phase"], "published")
        self.assertFalse(result["lease_ready"])
        self.assertTrue((directory / "history.bundle").exists())
        self.assertIn("--force-with-lease=refs/heads/working:" + original, result["job"]["log"])
        self.assertNotIn(" --force ", result["job"]["log"])

    def test_exact_lease_rejects_server_changes_even_after_fetch(self):
        original, result = self.published_rebase()
        replacement = self.git.text("rev-parse", "origin/main")
        subprocess.run(["git", "--git-dir", str(self.remote), "update-ref", "refs/heads/working", replacement],
                       check=True, capture_output=True)
        result = self.operation("fetch")
        self.assertEqual(result["recovery"]["expected_remote"], original)
        result = self.leased_publish(result)
        self.assertEqual(result["job"]["state"], "failed")
        self.assertIn("Fetch cannot reset this lease", result["job"]["error"])
        remote = subprocess.run(["git", "--git-dir", str(self.remote), "rev-parse", "refs/heads/working"],
                                check=True, capture_output=True, text=True).stdout.strip()
        self.assertEqual(remote, replacement, "Other editor's server update must survive")
        self.assertEqual(result["recovery"]["phase"], "ready")

    def test_leased_rebase_conflicts_abort_and_continue_keep_backup_and_original_lease(self):
        original = self.commit("Published branch change\n")["head"]
        self.operation("push")
        self.server_update("Main conflict\n")
        self.operation("fetch")
        result = self.operation("rebase", target="origin/main", allow_published=True)
        self.assertTrue(result["rebase"])
        self.assertEqual(result["recovery"]["phase"], "rebasing")
        backup = self.root / result["recovery"]["directory"]
        self.app.git = self.git = type(self.git)(self.app)
        result = self.operation("abort")
        self.assertEqual(result["head"], original)
        self.assertEqual(result["recovery"]["phase"], "aborted")
        self.assertFalse(result["lease_ready"])
        self.assertTrue((backup / "history.bundle").is_file())
        result = self.operation("rebase", target="origin/main", allow_published=True)
        review = self.git.conflict({"revision": result["revision"], "path": "shared.txt"})
        self.operation("resolve", **{**review, "source": "Both intended changes\n"})
        result = self.operation("continue")
        self.assertEqual(result["recovery"]["phase"], "ready")
        self.assertEqual(result["recovery"]["expected_remote"], original)
        self.assertTrue(result["lease_ready"])
        self.assertEqual(self.leased_publish(result)["job"]["state"], "passed")

    def test_force_lease_cannot_bypass_review_protection_or_missing_backup(self):
        with self.assertRaises(ConflictError):
            self.operation("push-lease", branch_confirmation="working")
        self.git.run("switch", "main")
        with self.assertRaises(ConflictError):
            self.operation("push-lease", branch_confirmation="main")
        self.git.run("switch", "working")
        original, result = self.published_rebase()
        with self.assertRaises(ContentError):
            self.operation("push-lease", backup_id=result["recovery"]["id"],
                           expected_remote=original, branch_confirmation="wrong")
        with self.assertRaises(ConflictError):
            self.operation("push-lease", backup_id="wrong", expected_remote=original,
                           branch_confirmation="working")
        with self.assertRaises(ConflictError):
            self.operation("pull")
        with self.assertRaises(ConflictError):
            self.operation("rebase", target="origin/main", allow_published=True)
        bundle = self.root / result["recovery"]["directory"] / "history.bundle"
        moved = bundle.with_suffix(".saved")
        bundle.rename(moved)
        self.assertFalse(self.git.snapshot()["lease_ready"], "Missing history recovery locks leased publication")
        with self.assertRaises(ConflictError):
            self.leased_publish(result)
        moved.rename(bundle)
        remote_url = self.git.text("remote", "get-url", "origin")
        self.git.run("remote", "set-url", "origin", str(Path(self.remote_dir.name) / "different.git"))
        self.assertFalse(self.git.snapshot()["lease_ready"], "Changing server disables the old lease")
        with self.assertRaises(ConflictError):
            self.leased_publish(result)
        self.git.run("remote", "set-url", "origin", remote_url)
        self.shared.write_text("Unsaved on disk\n", encoding="utf-8")
        with self.assertRaises(ConflictError):
            self.leased_publish(result)

    def test_backup_failure_prevents_rebase_and_server_change_requires_new_review(self):
        self.commit("Local change\n")
        original = self.git.text("rev-parse", "HEAD")
        with patch.object(self.git, "backup_rebase", side_effect=OSError("Fixture backup failure")):
            result = self.operation("rebase", target="main")
        self.assertEqual(result["job"]["state"], "failed")
        self.assertEqual(result["head"], original)
        self.assertFalse(result["rebase"])
        self.operation("push")
        self.server_update("New main not yet fetched\n")
        result = self.operation("rebase", target="origin/main", allow_published=True)
        self.assertEqual(result["job"]["state"], "failed")
        self.assertIn("server changed", result["job"]["error"])
        self.assertEqual(result["head"], original)
        self.assertIsNone(result["recovery"])

    def test_checkout_changes_during_backup_stop_rewrite_and_published_opt_in_is_scoped(self):
        self.commit("Local checkpoint\n")
        self.operation("push")
        with self.assertRaises(ContentError):
            self.operation("rebase", target="main", allow_published=True)
        self.git.run("branch", "--set-upstream-to", "origin/main", "working")
        with self.assertRaises(ConflictError):
            self.operation("rebase", target="origin/main", allow_published=True)
        original = self.git.text("rev-parse", "HEAD")
        self.git.run("branch", "base", original)
        backup = self.git.backup_rebase

        def changed_during_backup(*args, **kwargs):
            record = backup(*args, **kwargs)
            self.shared.write_text("External edit during backup\n", encoding="utf-8")
            return record

        with patch.object(self.git, "backup_rebase", side_effect=changed_during_backup):
            result = self.operation("rebase", target="base")
        self.assertEqual(result["job"]["state"], "failed")
        self.assertIn("checkout changed", result["job"]["error"])
        self.assertEqual(result["head"], original)
        self.assertFalse(result["rebase"])
        self.assertEqual(self.shared.read_text(), "External edit during backup\n")

    def test_push_refuses_server_divergence_and_never_forces(self):
        self.git.run("branch", "--set-upstream-to", "origin/main", "working")
        self.commit("Local change\n")
        self.server_update("Server change\n")
        self.operation("fetch")
        with self.assertRaises(ConflictError):
            self.operation("push")
        self.assertEqual(self.shared.read_text(), "Local change\n")

    def test_network_failure_is_reported_not_synced(self):
        self.git.run("remote", "set-url", "origin", str(Path(self.remote_dir.name) / "missing.git"))
        result = self.operation("fetch")
        self.assertEqual(result["job"]["state"], "failed")
        self.assertTrue(result["job"]["error"])
        self.assertIsNone(result["last_fetch"])

    def test_http_gate_blocks_every_editor_mutation_on_main_and_when_git_busy(self):
        server = WorkbenchServer(("127.0.0.1", 0), self.app)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(), thread.join(5)))

        def request(route, payload, token=True, branch=None):
            conn = HTTPConnection("127.0.0.1", server.server_port, timeout=10)
            headers = {"X-Workbench-Token": self.app.token} if token else {}
            if branch:
                headers["X-Workbench-Branch"] = branch
            conn.request("POST", route, body=json.dumps(payload), headers=headers)
            response = conn.getresponse()
            value = response.status, json.loads(response.read())
            conn.close()
            return value

        self.git.run("switch", "main")
        for route in ("members/save", "members/delete", "members/category-save", "members/merge",
                      "members/rename", "members/portrait-delete", "content/save", "content/delete",
                      "content/pdf", "portrait", "convert", "uploads"):
            status, response = request("/api/workbench/" + route, {})
            self.assertEqual(status, 409, (route, response))
            self.assertIn("protected", response["error"])
        self.assertEqual(request("/api/config", {})[0], 409)
        self.assertEqual(request("/api/upload", {})[0], 409)
        self.assertEqual(request("/api/workbench/git/action", {}, token=False)[0], 403)
        self.git.run("switch", "working")
        self.assertEqual(request("/api/workbench/members/save", {}, branch="main")[0], 409)
        self.git.cached = self.git.snapshot()
        self.git.busy = True
        self.addCleanup(lambda: setattr(self.git, "busy", False))
        self.assertEqual(request("/api/workbench/content/save", {})[0], 409)
        self.git.busy = False

    def test_busy_and_build_operations_exclude_each_other(self):
        self.app.job["state"] = "running"
        with self.assertRaises(ConflictError):
            self.operation("fetch")
        self.app.job["state"] = "idle"
        self.git.cached = self.git.snapshot()
        self.git.busy = True
        self.assertFalse(self.git.snapshot()["editable"])
        with self.assertRaises(ValueError):
            self.app.start_job("build")
        self.git.busy = False

    def test_confirmation_and_conflict_file_revision_are_required(self):
        with self.assertRaises(ContentError):
            self.git.start({"revision": self.git.snapshot()["revision"], "action": "fetch"})
        self.commit("Local change\n")
        self.server_update("Server change\n")
        self.operation("fetch")
        result = self.operation("rebase", target="origin/main")
        review = self.git.conflict({"revision": result["revision"], "path": "shared.txt"})
        self.shared.write_text("Outside change\n", encoding="utf-8")
        with self.assertRaises(ConflictError):
            self.operation("resolve", **{**review, "source": "Resolution\n"})

    def test_missing_git_fails_closed(self):
        with patch("git_workbench.shutil.which", return_value=None):
            state = self.git.snapshot()
            self.assertFalse(state["editable"])
            self.assertFalse(state["available"])
            self.assertIn("not installed", state["error"])
