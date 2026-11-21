"""Runtime transitions use disposable editors and never install dependencies."""

import json
import hashlib
import os
import py_compile
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

from tools.workbench.launcher import (
    PUBLIC_PORT_ADAPTER, RuntimeErrorMessage, RuntimeServer, Supervisor, checkout_version,
    prepare_environment, requirements_files, run_setup,
)


EDITOR = """
import argparse, json, secrets, subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from .app import VERSION

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int)
parser.add_argument('--no-browser', action='store_true')
args = parser.parse_args()
token = secrets.token_hex(16)
root = Path.cwd()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def reply(self, status, body, mime='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path == '/':
            self.reply(200, ('<html><head></head><body>' + VERSION + '</body></html>').encode(), 'text/html')
        else:
            state = json.loads((root / 'status.json').read_text())
            if state.get('git_repository'):
                state['git']['branch'] = subprocess.run(['git', 'branch', '--show-current'], capture_output=True, text=True, check=True).stdout.strip()
            state['token'] = token
            self.reply(200, json.dumps(state).encode())
    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))) or b'{}')
        origin = self.headers.get('Origin')
        expected = 'http://127.0.0.1:' + str(args.port)
        if self.headers.get('X-Workbench-Token') != token or origin != expected:
            self.reply(403, b'{}')
        else:
            if self.path == '/api/workbench/git/action' and payload.get('action') == 'checkout':
                subprocess.run(['git', 'switch', payload['branch']], check=True, capture_output=True)
            (root / 'mutation.txt').write_text('accepted')
            self.reply(200, b'{}')
    def do_DELETE(self):
        state = json.loads((root / 'status.json').read_text())
        state['uploads'] = []
        (root / 'status.json').write_text(json.dumps(state))
        self.reply(200, b'{}')

server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
    (root / ('stopped-' + VERSION)).write_text('graceful')
"""


class RuntimeFixture(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="ftsk-editor-runtime-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.editor = self.root / "tools" / "workbench"
        self.editor.mkdir(parents=True)
        (self.root / "tools" / "__init__.py").write_text("")
        (self.editor / "__init__.py").write_text("")
        (self.editor / "__main__.py").write_text(EDITOR)
        (self.editor / "app.py").write_text("VERSION = 'one'\n")
        (self.editor / "version.json").write_text(json.dumps({"version": "1.0.0", "launcher_protocol": 1}))
        (self.root / "scripts").mkdir()
        (self.root / "scripts" / "requirements-dev.txt").write_text("-r nested.txt\n")
        (self.root / "scripts" / "nested.txt").write_text("ExamplePackage\n")
        self.write_status()

    def write_status(self, **git):
        (self.root / "status.json").write_text(json.dumps({
            "git": {"available": True, "branch": "main", "busy": False,
                    "rebase": False, "merge": False, "conflicts": [], **git},
            "job": {"state": "idle"}, "uploads": [],
        }))

    def prepare_git_branches(self):
        def git(*args):
            return subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True)
        git("init", "-b", "main")
        git("config", "user.name", "Runtime fixture")
        git("config", "user.email", "fixture@example.test")
        git("config", "commit.gpgsign", "false")
        git("config", "core.autocrlf", "false")
        (self.root / ".gitignore").write_text("__pycache__/\nstatus.json\nstopped-*\nmutation.txt\n")
        git("add", ".")
        git("commit", "-m", "Current editor")
        git("switch", "-c", "older-editor")
        (self.editor / "app.py").write_text("VERSION = 'two'\n")
        (self.editor / "version.json").unlink()
        git("add", ".")
        git("commit", "-m", "Legacy editor")
        git("switch", "main")
        status = json.loads((self.root / "status.json").read_text())
        status["git_repository"] = True
        (self.root / "status.json").write_text(json.dumps(status))
        return git

    def start_runtime(self):
        self.supervisor = Supervisor(self.root, developer=True)
        self.server = RuntimeServer(("127.0.0.1", 0), self.supervisor)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.addCleanup(self.close_runtime)
        self.supervisor.start()
        self.wait(lambda: self.supervisor.state in {"ready", "failed"})
        self.assertEqual(self.supervisor.state, "ready", self.supervisor.message)

    def close_runtime(self):
        self.supervisor.close()
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(5)

    def wait(self, predicate, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(.05)
        self.fail("Runtime did not reach expected state: " + str(self.supervisor.metadata()))

    def request(self, method, path, headers=None, body=None):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request(method, path, body, headers or {})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()


class VersionTests(RuntimeFixture):
    def test_site_builder_failure_preserves_actual_version_and_diagnostics(self):
        (self.root / ".hugo-version").write_text("0.160.0")
        logs = []
        result = subprocess.CompletedProcess(["hugo", "version"], 0, "hugo v0.150.0", "fixture diagnostic")
        with patch("tools.workbench.launcher.run_setup"), \
                patch("tools.workbench.launcher.shutil.which", return_value="fixture-hugo"), \
                patch("tools.workbench.launcher.subprocess.run", return_value=result):
            with self.assertRaisesRegex(RuntimeErrorMessage, "requires Hugo 0.160.0"):
                prepare_environment(self.root, False, logs.append)
        self.assertIn("hugo v0.150.0", logs)
        self.assertIn("fixture diagnostic", logs)

    def test_command_output_is_live_and_runtime_log_is_bounded(self):
        supervisor = Supervisor(self.root)
        self.addCleanup(supervisor.close)
        supervisor.update_progress(3, "Installing packages", "Preparing project-local tools.")
        received = threading.Event()
        release = self.root / "release-command"
        errors = []

        def log(text):
            supervisor.log(text)
            if text == "LIVE OUTPUT":
                received.set()

        def command():
            try:
                run_setup([sys.executable, "-c",
                           "import pathlib,time\nprint('LIVE OUTPUT',flush=True)\n"
                           f"while not pathlib.Path({str(release)!r}).exists(): time.sleep(.05)\n"],
                          self.root, log, supervisor)
            except Exception as exc:
                errors.append(exc)

        worker = threading.Thread(target=command)
        worker.start()
        try:
            self.assertTrue(received.wait(5), "Output must arrive before the command exits")
            self.assertTrue(worker.is_alive())
            metadata = supervisor.metadata()
            self.assertEqual(metadata["progress"]["step"], 3)
            self.assertEqual(metadata["progress"]["explanation"], "Preparing project-local tools.")
            self.assertGreaterEqual(metadata["progress"]["elapsed_seconds"], 0)
            self.assertTrue(any("LIVE OUTPUT" in line for line in metadata["logs"]))
        finally:
            release.write_text("finish")
            worker.join(10)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])
        self.assertIsNone(supervisor.setup_process)
        for index in range(205):
            supervisor.log(f"\x1b[31m{index}: " + "x" * 3000 + "\x1b[0m")
        logs = supervisor.metadata()["logs"]
        self.assertEqual(len(logs), 200)
        self.assertTrue(all(len(line) <= 2000 and "\x1b" not in line for line in logs))
        self.assertIn("204:", logs[-1])
        self.assertIn("[line truncated]", logs[-1])

    def test_same_version_detects_python_support_and_nested_requirements_but_not_content(self):
        initial = checkout_version(self.root)
        (self.root / "page.md").write_text("A content edit")
        self.assertEqual(checkout_version(self.root), initial)
        (self.root / "tools" / "helper.py").write_text("changed = True\n")
        changed = checkout_version(self.root)
        self.assertNotEqual(changed["fingerprint"], initial["fingerprint"])
        self.assertEqual(changed["version"], initial["version"])
        (self.root / "scripts" / "nested.txt").write_text("AnotherPackage\n")
        self.assertNotEqual(checkout_version(self.root)["fingerprint"], changed["fingerprint"])
        (self.editor / "version.json").unlink()
        self.assertEqual(checkout_version(self.root)["version"], "legacy (unversioned)")

    def test_metadata_and_requirement_traversal_fail_explicitly(self):
        for manifest in ({"version": "1.0.0", "launcher_protocol": 2},
                         {"version": "bad", "launcher_protocol": 1}, ["bad"]):
            (self.editor / "version.json").write_text(json.dumps(manifest))
            with self.subTest(manifest=manifest), self.assertRaises(RuntimeErrorMessage):
                checkout_version(self.root)
        (self.root / "scripts" / "nested.txt").write_text("-r requirements-dev.txt\n")
        self.assertEqual(requirements_files(self.root), {"scripts/requirements-dev.txt", "scripts/nested.txt"})
        (self.root / "scripts" / "nested.txt").write_text("-r ../../outside.txt\n")
        with self.assertRaises(RuntimeErrorMessage):
            requirements_files(self.root)

    def test_dependencies_are_isolated_cached_and_not_marked_ready_after_failure(self):
        calls = []
        def fake_setup(args, root, log, owner):
            calls.append(args)
            if "venv" in args:
                folder = Path(args[-1])
                executable = folder / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
                executable.parent.mkdir(parents=True, exist_ok=True)
                executable.write_text("fixture")
        with patch("tools.workbench.launcher.run_setup", side_effect=fake_setup):
            first = prepare_environment(self.root, False, lambda text: None)
            self.assertTrue(Path(first).is_relative_to(self.root / ".tools"))
            self.assertEqual(len(calls), 3)
            self.assertEqual(prepare_environment(self.root, False, lambda text: None), first)
            self.assertEqual(len(calls), 3, "Unchanged requirements reuse their own environment")
            (self.root / "scripts" / "nested.txt").write_text("OtherPackage\n")
            second = prepare_environment(self.root, False, lambda text: None)
            self.assertNotEqual(first, second)
        (self.root / "scripts" / "nested.txt").write_text("BrokenPackage\n")
        before = list((self.root / ".tools").rglob("ready.json"))
        with patch("tools.workbench.launcher.run_setup", side_effect=RuntimeErrorMessage("fixture install failure")):
            with self.assertRaisesRegex(RuntimeErrorMessage, "fixture install failure"):
                prepare_environment(self.root, False, lambda text: None)
        self.assertEqual(list((self.root / ".tools").rglob("ready.json")), before)
        supervisor = Supervisor(self.root)
        supervisor.state = "failed"
        supervisor.prepared_python = Path(first)
        supervisor.request_restart()
        self.assertFalse((Path(first).parent.parent / "ready.json").exists(),
                         "Explicit retry reparses a failed managed environment rather than reusing a broken cache")
        self.assertTrue(Path(first).is_file(), "Retry does not delete an environment directory")

    def test_asset_rebuild_must_produce_complete_matching_outputs(self):
        build = self.root / "scripts" / "build_workbench_editors.js"
        build.write_text("// fixture")
        (self.editor / "web").mkdir()
        (self.editor / "web" / "monaco-entry.js").write_text("// fixture")
        (self.root / "package-lock.json").write_text("{}")
        output = self.root / ".tools" / "workbench-editor"
        output.mkdir(parents=True)
        (output / "version.json").write_text("invalid cache")
        npm_cli = self.root / "bin" / "node_modules" / "npm" / "bin" / "npm-cli.js"
        npm_cli.parent.mkdir(parents=True)
        npm_cli.write_text("// fixture")
        (self.root / "bin" / ("npm.cmd" if os.name == "nt" else "npm")).write_text("// fixture")
        complete = False
        def fake_setup(args, _root, _log, _owner):
            if "venv" in args:
                executable = Path(args[-1]) / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
                executable.parent.mkdir(parents=True, exist_ok=True)
                executable.write_text("fixture")
            elif args[-1] == str(build):
                inputs = ["package-lock.json", "tools/workbench/web/monaco-entry.js", "scripts/build_workbench_editors.js"]
                hashes = {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest() for name in inputs}
                (output / "version.json").write_text(json.dumps(hashes))
                if complete:
                    for name in ("editor.js", "editor.css", "editor.worker.js", "json.worker.js",
                                 "css.worker.js", "html.worker.js", "ts.worker.js"):
                        (output / name).write_text("fixture")
        def fake_tool(_root, name):
            return str(self.root / "bin" / ("npm.cmd" if os.name == "nt" else "npm")) if name == "npm" else sys.executable
        with patch("tools.workbench.launcher.run_setup", side_effect=fake_setup), \
                patch("tools.workbench.launcher.tool", side_effect=fake_tool):
            with self.assertRaisesRegex(RuntimeErrorMessage, "required matching files"):
                prepare_environment(self.root, False, lambda _text: None)
            complete = True
            self.assertTrue(Path(prepare_environment(self.root, False, lambda _text: None)).is_file())


class SupervisorTests(RuntimeFixture):
    def test_branch_switch_restarts_legacy_same_size_source_without_stale_bytecode(self):
        source = self.editor / "app.py"
        git = self.prepare_git_branches()
        stamp = source.stat()
        py_compile.compile(str(source))
        self.start_runtime()
        old_process = self.supervisor.process
        old_generation = self.supervisor.generation
        status, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(f'data-generation="{old_generation}"'.encode(), body)
        git("switch", "older-editor")
        os.utime(source, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        self.wait(lambda: self.supervisor.state == "ready" and self.supervisor.generation > old_generation)
        self.assertIsNotNone(old_process.poll(), "Old editor must exit before the replacement is used")
        self.assertTrue((self.root / "stopped-one").is_file(), "Owned editor receives graceful shutdown")
        self.assertEqual(self.supervisor.running_version["version"], "legacy (unversioned)")
        self.assertIn(b"two", self.request("GET", "/")[1])
        self.assertEqual(self.request("GET", "/api/workbench/status",
                                     {"X-Workbench-Generation": str(old_generation)})[0], 409)
        self.assertIn(b"runtime-heading", self.request("GET", "/workbench-runtime.js")[1],
                      "The supervisor's bridge survives legacy checkout removal")

    def test_editor_checkout_request_restarts_after_the_git_response_finishes(self):
        self.prepare_git_branches()
        self.start_runtime()
        generation = self.supervisor.generation
        token = json.loads(self.request("GET", "/api/workbench/status")[1])["token"]
        status, _ = self.request("POST", "/api/workbench/git/action", {
            "Origin": f"http://127.0.0.1:{self.server.server_port}",
            "X-Workbench-Token": token,
            "X-Workbench-Generation": str(generation),
        }, json.dumps({"action": "checkout", "branch": "older-editor"}))
        self.assertEqual(status, 200)
        self.wait(lambda: self.supervisor.state == "ready" and self.supervisor.generation > generation)
        self.assertIn(b"two", self.request("GET", "/")[1])

    def test_launcher_sessions_use_distinct_browser_generations(self):
        self.start_runtime()
        other = Supervisor(self.root, developer=True)
        other.public_port = self.server.server_port
        self.addCleanup(other.close)
        other.start()
        self.wait(lambda: other.state in {"ready", "failed"})
        self.assertEqual(other.state, "ready", other.message)
        self.assertNotEqual(other.generation, self.supervisor.generation,
                            "Reopening the launcher must invalidate previously loaded tabs")

    def test_developer_edits_warn_until_explicit_restart_and_proxy_keeps_authentication(self):
        self.start_runtime()
        generation = self.supervisor.generation
        token = json.loads(self.request("GET", "/api/workbench/status")[1])["token"]
        origin = f"http://127.0.0.1:{self.server.server_port}"
        self.assertEqual(self.request("POST", "/api/test", {"Origin": origin, "X-Workbench-Token": token}, b"{}")[0], 200)
        self.assertEqual(self.request("POST", "/api/test", {"Origin": "https://foreign.example"}, b"{}")[0], 403)
        self.assertEqual(self.request("POST", "/api/workbench/runtime", {}, None)[0], 403)
        (self.editor / "app.py").write_text("VERSION = 'two'\n")
        self.wait(lambda: self.supervisor.state == "development")
        self.assertEqual(self.supervisor.generation, generation)
        self.assertIn(b"one", self.request("GET", "/")[1])
        self.assertEqual(self.request("POST", "/api/workbench/runtime",
                                     {"X-Workbench-Runtime-Token": self.supervisor.token})[0], 202)
        self.wait(lambda: self.supervisor.state == "ready" and self.supervisor.generation > generation)
        self.assertIn(b"two", self.request("GET", "/")[1])
        self.assertEqual(self.request("POST", "/api/test", {"Origin": origin, "X-Workbench-Token": token}, b"{}")[0], 403,
                         "Tokens from the previous editor cannot mutate its replacement")

    def test_pending_restarts_wait_for_git_recovery_and_queued_uploads(self):
        self.start_runtime()
        generation = self.supervisor.generation
        self.write_status(branch="other", busy=True)
        (self.editor / "app.py").write_text("VERSION = 'two'\n")
        self.wait(lambda: self.supervisor.state == "pending")
        self.assertEqual(self.supervisor.generation, generation)
        self.assertEqual(self.request("POST", "/api/workbench/git/action", {}, b'{"action":"push"}')[0], 409)
        self.write_status(branch="other", rebase=True)
        self.wait(lambda: "paused Git" in self.supervisor.message)
        self.assertEqual(self.supervisor.generation, generation)
        self.write_status(branch="other")
        state = json.loads((self.root / "status.json").read_text())
        state["uploads"] = [{"id": "queued"}]
        (self.root / "status.json").write_text(json.dumps(state))
        self.wait(lambda: "queued uploads" in self.supervisor.message)
        self.assertEqual(self.supervisor.generation, generation)
        self.assertEqual(self.request("DELETE", "/api/workbench/uploads/queued")[0], 200)
        self.wait(lambda: self.supervisor.state == "ready" and self.supervisor.generation > generation)

    def test_start_failure_keeps_recovery_page_and_retry_starts_matching_source(self):
        self.start_runtime()
        generation = self.supervisor.generation
        (self.editor / "__main__.py").write_text("raise RuntimeError('fixture startup failure')\n")
        self.write_status(branch="broken")
        self.wait(lambda: self.supervisor.state == "failed")
        self.wait(lambda: any("fixture startup failure" in line for line in self.supervisor.metadata()["logs"]))
        failure = json.loads(self.request("GET", "/api/workbench/runtime")[1])
        self.assertEqual(failure["progress"]["step"], 7)
        self.assertTrue(any("fixture startup failure" in line for line in failure["logs"]))
        self.assertEqual(self.request("GET", "/")[0], 200)
        self.assertIn(b"data-runtime-maintenance", self.request("GET", "/")[1])
        self.assertEqual(self.request("GET", "/api/workbench/status")[0], 503)
        (self.editor / "__main__.py").write_text(EDITOR)
        self.assertEqual(self.request("POST", "/api/workbench/runtime",
                                     {"X-Workbench-Runtime-Token": self.supervisor.token})[0], 202)
        self.wait(lambda: self.supervisor.state == "ready" and self.supervisor.generation > generation)
        ready = json.loads(self.request("GET", "/api/workbench/runtime")[1])
        self.assertEqual(ready["progress"]["step"], 8)
        self.assertFalse(any("fixture startup failure" in line for line in ready["logs"]),
                         "Retry must start a fresh log history")

    def test_transient_status_failure_never_terminates_an_unverified_git_worker(self):
        self.start_runtime()
        original = self.supervisor.process
        generation = self.supervisor.generation
        with patch.object(self.supervisor, "backend_status", side_effect=OSError("fixture status timeout")):
            self.write_status(branch="other")
            (self.editor / "app.py").write_text("VERSION = 'two'\n")
            self.wait(lambda: "Waiting to verify" in self.supervisor.message)
            self.assertIsNone(original.poll())
            self.assertEqual(self.supervisor.generation, generation)
        self.wait(lambda: self.supervisor.state == "ready" and self.supervisor.generation > generation)

    def test_incomplete_status_never_terminates_an_unverified_git_worker(self):
        self.start_runtime()
        original = self.supervisor.process
        generation = self.supervisor.generation
        (self.root / "status.json").write_text(json.dumps({"git": {}, "job": {}, "uploads": []}))
        (self.editor / "app.py").write_text("VERSION = 'two'\n")
        self.wait(lambda: self.supervisor.generation > generation or "Waiting to verify" in self.supervisor.message)
        self.assertEqual(self.supervisor.generation, generation)
        self.assertIsNone(original.poll())
        self.write_status(branch="other")
        self.wait(lambda: self.supervisor.state == "ready" and self.supervisor.generation > generation)

    def test_restart_rechecks_for_jobs_started_after_the_initial_safe_snapshot(self):
        self.start_runtime()
        original = self.supervisor.process
        generation = self.supervisor.generation
        backend_status = self.supervisor.backend_status
        checked = False

        def status_then_start_job():
            nonlocal checked
            status = backend_status()
            if not checked:
                checked = True
                self.write_status(branch="other", busy=True)
            return status

        self.write_status(branch="other")
        with patch.object(self.supervisor, "backend_status", side_effect=status_then_start_job):
            (self.editor / "app.py").write_text("VERSION = 'two'\n")
            self.wait(lambda: self.supervisor.generation > generation or
                      "Waiting for active Git" in self.supervisor.message)
            self.assertTrue(checked)
            self.assertEqual(self.supervisor.generation, generation)
            self.assertIsNone(original.poll())
            self.write_status(branch="other")
            self.wait(lambda: self.supervisor.state == "ready" and self.supervisor.generation > generation)


class PreviewCompatibilityTests(RuntimeFixture):
    def test_current_and_legacy_preview_csp_authorizes_only_the_public_editor(self):
        import tools.workbench.site_workbench as workbench
        original_init = workbench.WorkbenchServer.__init__
        def legacy_init(server, address, app, render_only=False):
            original_init(server, address, app, render_only)
            if not render_only:
                app.workbench_port = server.server_port
        for legacy in (False, True):
            with self.subTest(legacy=legacy), patch.dict(os.environ, {"FTSK_WORKBENCH_PUBLIC_PORT": "18770"}):
                app = workbench.Workbench(self.root)
                server = None
                try:
                    with patch.object(workbench.WorkbenchServer, "__init__", legacy_init if legacy else original_init):
                        exec(PUBLIC_PORT_ADAPTER, {})
                        server = workbench.WorkbenchServer(("127.0.0.1", 0), app)
                    identifier = "a" * 24
                    rendered = app.scratch / "public"
                    rendered.mkdir()
                    (rendered / "index.html").write_text("<html>Preview</html>")
                    app.content.renderings[identifier] = rendered
                    connection = HTTPConnection("127.0.0.1", app.render_server.server_port, timeout=5)
                    try:
                        connection.request("GET", f"/render/{identifier}/")
                        response = connection.getresponse()
                        self.assertEqual(response.status, 200, response.read())
                        csp = response.getheader("Content-Security-Policy")
                        self.assertIn("http://127.0.0.1:18770", csp)
                        self.assertNotIn(f"http://127.0.0.1:{server.server_port}", csp)
                    finally:
                        connection.close()
                finally:
                    app.close()
                    if server:
                        server.server_close()


if __name__ == "__main__":
    unittest.main()
