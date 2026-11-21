"""Stable, standard-library-only supervisor for checkout-specific editors."""

import argparse
import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from http.client import HTTPConnection, HTTPException
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import webbrowser
from collections import deque

LOGGER = logging.getLogger("site_workbench.runtime")
ROOT = Path(__file__).resolve().parents[2]
PROTOCOL = 1
MAX_REQUEST = 30 * 1024 * 1024
SOURCE_SUFFIXES = {".py", ".js", ".css", ".html", ".json"}
PUBLIC_PORT_ADAPTER = """
import importlib, importlib.util, os
if importlib.util.find_spec('tools.workbench.site_workbench') is not None:
    legacy = importlib.import_module('tools.workbench.site_workbench')
    original_init = legacy.WorkbenchServer.__init__
    def public_port_init(server, *args, **kwargs):
        original_init(server, *args, **kwargs)
        if not server.render_only:
            server.app.workbench_port = int(os.environ['FTSK_WORKBENCH_PUBLIC_PORT'])
    legacy.WorkbenchServer.__init__ = public_port_init
"""


class RuntimeErrorMessage(ValueError):
    pass


def digest_files(root, paths):
    digest = hashlib.sha256()
    for relative in sorted(set(paths)):
        path = root / relative
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise RuntimeErrorMessage(f"Linked editor source is not supported: {relative}")
        digest.update(relative.encode("utf-8") + b"\0")
        digest.update(path.read_bytes() if path.is_file() else b"<missing>")
        digest.update(b"\0")
    return digest.hexdigest()


def requirements_files(root, relative="scripts/requirements-dev.txt", seen=None):
    seen = set() if seen is None else seen
    path = root / relative
    if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink():
        raise RuntimeErrorMessage("Python requirement includes must stay inside this checkout.")
    relative = path.relative_to(root).as_posix()
    if relative in seen:
        return seen
    seen.add(relative)
    if not path.is_file():
        raise RuntimeErrorMessage(f"Required editor dependency file is missing: {relative}")
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\s*(?:-r\s*|--requirement[= ]+|-c\s*|--constraint[= ]+)(\S+)", line)
        if match:
            included = (path.parent / match[1]).resolve()
            if not included.is_relative_to(root.resolve()):
                raise RuntimeErrorMessage("Python requirement includes must stay inside this checkout.")
            requirements_files(root, str(included.relative_to(root)), seen)
    return seen


def checkout_version(root):
    manifest = root / "tools" / "workbench" / "version.json"
    version = "legacy (unversioned)"
    if manifest.is_file():
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeErrorMessage("Editor version.json is not valid JSON. Ask the maintainer to repair it.") from exc
        if (not isinstance(data, dict) or not isinstance(data.get("version"), str) or
                not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", data["version"]) or
                type(data.get("launcher_protocol")) is not int):
            raise RuntimeErrorMessage("Invalid editor version.json. Ask the maintainer to repair the editor version metadata.")
        if data["launcher_protocol"] != PROTOCOL:
            raise RuntimeErrorMessage("This editor needs a different launcher. Close the editor and open site_editor.bat from this checkout to update the launcher.")
        version = data["version"]
    paths = ["site_editor.bat", "scripts/build_workbench_editors.js", "package.json", "package-lock.json",
             ".hugo-version", "scripts/requirements-dev.txt", "scripts/deploy_requirements.txt"]
    paths.extend(path.relative_to(root).as_posix() for path in (root / "tools").rglob("*")
                 if path.is_file() and path.suffix in SOURCE_SUFFIXES and "__pycache__" not in path.parts)
    paths.extend(requirements_files(root))
    if not (root / "tools" / "workbench" / "__main__.py").is_file():
        raise RuntimeErrorMessage("This checkout does not contain a site editor. Switch back using your Git application, then click Retry.")
    return {"version": version, "fingerprint": digest_files(root, paths)}


def tool(root, name):
    found = shutil.which(name)
    if found:
        return found
    filename = name + (".exe" if os.name == "nt" and name == "node" else ".cmd" if os.name == "nt" else "")
    matches = sorted((root / ".tools" / "node").glob(f"*/*/{filename}"))
    if not matches:
        raise RuntimeErrorMessage(f"{name} was not found. Double-click setup-dev-env.bat, then click Retry.")
    return str(matches[-1])


def forward_output(process, log):
    def read():
        try:
            while line := process.stdout.readline(4096):
                log(line.rstrip("\r\n"))
        finally:
            process.stdout.close()
    thread = threading.Thread(target=read, name="site-editor-output", daemon=True)
    thread.start()
    return thread


def run_setup(args, root, log, owner=None):
    log("Preparing project-local dependencies: " + " ".join(map(str, args)))
    process = subprocess.Popen(args, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               encoding="utf-8", errors="replace",
                               env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"})
    output_thread = forward_output(process, log)
    if owner:
        with owner.lock:
            owner.setup_process = process
            if owner.closed:
                process.terminate()
    try:
        process.wait(timeout=600)
        if process.returncode:
            raise RuntimeErrorMessage("Project-local dependency preparation failed. See Technical details or the launcher window; run setup-dev-env.bat to repair tools, then click Retry.")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        output_thread.join(timeout=5)
        if output_thread.is_alive():
            LOGGER.warning("Dependency command output is still closing.")
        log(f"Command exited with status {process.returncode}.")
        if owner:
            with owner.lock:
                owner.setup_process = None


def prepare_environment(root, developer, log, owner=None):
    def progress(label, explanation, step=3):
        if owner:
            owner.update_progress(step, label, explanation)
    if developer:
        progress("Using developer tools", "Developer mode uses your current Python and existing editor assets. No dependencies are installed automatically.")
        log(f"Developer mode: Python {sys.executable}; dependency installation and asset preparation skipped.")
        return sys.executable
    progress("Checking Python tools", "Checking for local tools that match this editor. Missing tools will be prepared inside this project, not installed system-wide.")
    requirements = requirements_files(root)
    requirements_hash = digest_files(root, requirements)
    key = hashlib.sha256((requirements_hash + sys.version + sys.executable).encode()).hexdigest()
    folder = root / ".tools" / "site-editor-runtime" / "python" / key
    python = folder / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    ready = folder / "ready.json"
    if folder.is_symlink() or not folder.resolve().is_relative_to(root.resolve()):
        raise RuntimeErrorMessage("The editor environment must be a project-local, non-linked directory.")
    if not ready.is_file() or not python.is_file():
        folder.mkdir(parents=True, exist_ok=True)
        progress("Creating local Python environment", "Creating an isolated home for this editor's Python tools. Your system Python and saved site files are not changed.")
        run_setup([sys.executable, "-m", "venv", str(folder)], root, log, owner)
        progress("Installing Python packages", "Installing the Python packages this checkout needs. The first download may take a while; command output appears below.")
        run_setup([str(python), "-m", "pip", "install", "--force-reinstall",
                   "-r", str(root / "scripts" / "requirements-dev.txt")], root, log, owner)
        progress("Validating Python packages", "Checking that the installed packages work together before starting the editor.")
        run_setup([str(python), "-m", "pip", "check"], root, log, owner)
        if digest_files(root, requirements) != requirements_hash:
            raise RuntimeErrorMessage("Requirements changed during installation. Finish the checkout change, then click Retry.")
        ready.write_text(json.dumps({"requirements": key}) + "\n", encoding="utf-8")
    else:
        log(f"Reusing matching Python environment: {folder}")
    progress("Checking browser editor assets", "Checking the browser's editing tools. Only missing or outdated assets need a local rebuild.", 4)
    build = root / "scripts" / "build_workbench_editors.js"
    if build.is_file():
        inputs = ["package-lock.json", "tools/workbench/web/monaco-entry.js", "scripts/build_workbench_editors.js"]
        expected = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in inputs}
        output = root / ".tools" / "workbench-editor"
        outputs = ("editor.js", "editor.css", "editor.worker.js", "json.worker.js",
                   "css.worker.js", "html.worker.js", "ts.worker.js")
        try:
            actual = json.loads((output / "version.json").read_text(encoding="utf-8"))
        except FileNotFoundError:
            actual = None
        except json.JSONDecodeError as exc:
            LOGGER.warning("Rebuilding invalid local editor asset metadata: %s", exc)
            actual = None
        if actual != expected or not all((output / name).is_file() for name in outputs):
            node = tool(root, "node")
            npm = Path(tool(root, "npm")).resolve()
            npm_cli = npm.parent / "node_modules" / "npm" / "bin" / "npm-cli.js" if os.name == "nt" else npm
            if not npm_cli.is_file():
                raise RuntimeErrorMessage("npm's launcher is missing. Run setup-dev-env.bat, then click Retry.")
            progress("Installing browser editor packages", "Downloading the exact browser-editor dependencies recorded in this checkout. This may take longer on the first run.", 4)
            run_setup([node, str(npm_cli), "ci", "--no-audit", "--no-fund"], root, log, owner)
            progress("Building browser editor assets", "Building the code editor and its language workers so they match this checkout.", 4)
            run_setup([node, str(build)], root, log, owner)
            try:
                built = json.loads((output / "version.json").read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise RuntimeErrorMessage("The editor asset build did not produce valid version metadata. Check the launcher window before retrying.") from exc
            if built != expected or not all((output / name).is_file() for name in outputs):
                raise RuntimeErrorMessage("The editor asset build did not produce the required matching files. Check the launcher window before retrying.")
        else:
            log("Matching browser editor assets are already available.")
    progress("Checking site builder", "Verifying that the installed Hugo version matches this checkout before enabling site previews.", 5)
    hugo_pin = root / ".hugo-version"
    if hugo_pin.is_file():
        version = hugo_pin.read_text(encoding="utf-8").strip()
        pinned = root / ".tools" / "hugo" / version / ("hugo.exe" if os.name == "nt" else "hugo")
        executable = str(pinned) if pinned.is_file() else shutil.which("hugo")
        if not executable:
            raise RuntimeErrorMessage(f"Hugo {version} is not installed. Run setup-dev-env.bat, then click Retry.")
        log(f"Checking site builder: {executable} version")
        output = subprocess.run([executable, "version"], cwd=root, capture_output=True, text=True, timeout=30)
        if output.stdout:
            log(output.stdout.strip())
        if output.stderr:
            log(output.stderr.strip())
        if output.returncode or not re.search(r"\bv" + re.escape(version) + r"(?:\b|[+-])", output.stdout):
            raise RuntimeErrorMessage(f"This checkout requires Hugo {version}. Run setup-dev-env.bat, then click Retry.")
    return str(python)


class Supervisor:
    def __init__(self, root, developer=False):
        self.root = root.resolve()
        self.developer = developer
        self.lock = threading.RLock()
        self.condition = threading.Condition(self.lock)
        self.closed = False
        self.process = None
        self.output_thread = None
        self.setup_process = None
        self.prepared_python = None
        self.backend_port = 0
        self.public_port = 0
        self.active = 0
        self.generation = 0
        self.running_version = None
        self.target_version = None
        self.branch = None
        self.state = "starting"
        self.message = "Starting the matching site editor."
        self.logs = deque(maxlen=200)
        self.progress = {"step": 1, "total": 8, "label": "Checking editor version",
                         "explanation": "Identifying the editor shipped with this checkout and checking that existing work can stop safely."}
        self.stage_started = time.monotonic()
        self.token = secrets.token_urlsafe(32)
        self.restart_requested = False
        self.checkout_transition = False
        self.thread = None
        # Keep this bridge in memory; a legacy checkout may remove its source.
        self.bridge = (ROOT / "tools" / "workbench" / "web" / "runtime-bridge.js").read_bytes()

    def log(self, text):
        LOGGER.info("%s", text)
        with self.lock:
            for line in str(text).splitlines():
                line = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", line)
                line = f"[{time.strftime('%H:%M:%S')}] {line}"
                if len(line) > 2000:
                    marker = " ... [line truncated]"
                    line = line[:2000 - len(marker)] + marker
                self.logs.append(line)

    def update_progress(self, step, label, explanation):
        with self.lock:
            self.progress = {"step": step, "total": 8, "label": label, "explanation": explanation}
            self.stage_started = time.monotonic()
            self.log(f"[{step}/8] {label}")

    def metadata(self):
        with self.lock:
            return {"state": self.state, "message": self.message, "generation": self.generation,
                    "version": (self.running_version or {}).get("version", ""),
                    "target_version": (self.target_version or {}).get("version", ""),
                    "fingerprint": (self.running_version or {}).get("fingerprint", ""),
                    "developer": self.developer, "token": self.token,
                    "progress": {**self.progress, "elapsed_seconds": int(time.monotonic() - self.stage_started)},
                    "logs": list(self.logs)}

    def backend_status(self):
        connection = HTTPConnection("127.0.0.1", self.backend_port, timeout=10)
        try:
            connection.request("GET", "/api/workbench/status", headers={"Host": f"127.0.0.1:{self.backend_port}"})
            response = connection.getresponse()
            if response.status != 200:
                raise RuntimeErrorMessage(f"The editor did not become ready (HTTP {response.status}).")
            value = json.loads(response.read())
            if (not isinstance(value, dict) or not isinstance(value.get("git"), dict) or
                    not isinstance(value.get("job"), dict) or not isinstance(value.get("token"), str) or
                    not value["token"] or not isinstance(value.get("uploads"), list) or
                    value["job"].get("state") not in ("idle", "running", "passed", "failed") or
                    any(type(value["git"].get(name)) is not bool for name in ("available", "busy"))):
                raise RuntimeErrorMessage("This editor has an incompatible status API. Ask the maintainer to update this checkout.")
            git = value["git"]
            if git["available"] and (not isinstance(git.get("branch"), str) or
                                     any(type(git.get(name)) is not bool for name in ("rebase", "merge")) or
                                     not isinstance(git.get("conflicts"), list)):
                raise RuntimeErrorMessage("The editor's Git status is incomplete. Ask the maintainer to repair this checkout.")
            return value
        finally:
            connection.close()

    def restart_blocker(self, status, include_uploads=True):
        git = status["git"]
        if git["busy"] or status["job"]["state"] == "running":
            return "Waiting for active Git and build work to finish before restarting."
        if not git["available"]:
            return "Git state is unavailable. Restore the checkout with your Git application before restarting."
        if git["rebase"] or git["merge"] or git["conflicts"]:
            return "Finish or abort the paused Git operation before the editor can restart."
        if include_uploads and status["uploads"]:
            return "Remove queued uploads before restarting; temporary originals cannot survive a restart."
        return ""

    def refresh(self):
        try:
            target = checkout_version(self.root)
        except (OSError, ValueError) as exc:
            with self.lock:
                self.state = "blocked"
                self.message = str(exc)
            return
        with self.lock:
            self.target_version = target
            if self.state in {"starting", "restarting", "failed"}:
                return
            changed = self.running_version != target
            if changed or self.restart_requested or self.checkout_transition:
                if self.state == "development" and not self.restart_requested and not self.checkout_transition:
                    return
                self.state = "pending"
                self.message = "Editor source changed. Waiting for active work to finish before restarting."
            elif self.state in {"pending", "blocked", "development"}:
                self.state = "ready"
                self.message = ""

    def start(self):
        self.thread = threading.Thread(target=self.monitor, name="site-editor-supervisor", daemon=True)
        self.thread.start()

    def stop_child(self):
        process = self.process
        if process and process.poll() is None:
            try:
                process.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
            except OSError:
                LOGGER.warning("The editor did not accept a graceful stop; terminating its process.")
                process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        self.process = None
        output_thread = self.output_thread
        self.output_thread = None
        if output_thread:
            output_thread.join(timeout=5)
            if output_thread.is_alive():
                LOGGER.warning("Previous editor output is still closing.")

    def replace_child(self):
        with self.lock:
            self.state = "restarting" if self.generation else "starting"
            self.message = "Preparing the editor and its project-local dependencies. Keep this window open."
            self.logs.clear()
            self.update_progress(1, "Checking editor version", "Identifying the editor shipped with this checkout and waiting for active requests to finish safely.")
            while self.active and not self.closed:
                self.condition.wait(timeout=1)
        if self.closed:
            return
        process = self.process
        if process and process.poll() is None:
            # Requests are now gated; recheck work that could have started after monitoring.
            try:
                message = self.restart_blocker(self.backend_status())
            except (OSError, ValueError, HTTPException) as exc:
                LOGGER.warning("Waiting for a safe editor restart: %s", exc)
                message = "Waiting to verify that Git and active work have finished. Do not close the launcher during a Git operation."
            if message:
                with self.lock:
                    self.state = "pending"
                    self.message = message
                return
        self.update_progress(2, "Stopping previous editor", "Closing the previous editor if it is running. Saved files and Git checkpoints are not changed.")
        self.stop_child()
        target = checkout_version(self.root)
        self.log(f"Target editor: {target['version']} (source {target['fingerprint'][:12]}).")
        self.prepared_python = None
        python = prepare_environment(self.root, self.developer, self.log, self)
        self.prepared_python = Path(python)
        if self.closed:
            return
        if checkout_version(self.root) != target:
            raise RuntimeErrorMessage("The checkout changed while dependencies were preparing. Finish the Git operation, then click Retry.")
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        self.update_progress(6, "Starting matching editor", "Starting a fresh editor process with the matching tools. The browser address stays the same.")
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8",
               "FTSK_WORKBENCH_PUBLIC_PORT": str(self.public_port)}
        # Never reuse bytecode from a different checkout, even for same-sized files.
        bootstrap = (
            "import runpy, signal\n"
            "def stop(signum, frame):\n"
            "    raise KeyboardInterrupt()\n"
            "signal.signal(signal.SIGTERM, stop)\n"
            "signal.signal(getattr(signal, 'SIGBREAK', signal.SIGINT), stop)\n"
            "runpy.run_module('tools.workbench', run_name='__main__')\n"
        )
        # Keep preview CSP correct without requiring changes in legacy editors.
        bootstrap = PUBLIC_PORT_ADAPTER + bootstrap
        args = [python, "-B", "-X", "pycache_prefix=" + str(self.root / ".tools" / "site-editor-runtime" /
                                                        "bytecode" / secrets.token_hex(8)),
                "-c", bootstrap, "--port", str(port), "--no-browser"]
        with self.lock:
            if self.closed:
                return
            self.log(f"Launching tools.workbench: Python {python}; private port {port}; fresh bytecode and supervised bootstrap.")
            self.process = subprocess.Popen(args, cwd=self.root, env=env,
                                            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                            encoding="utf-8", errors="replace")
            self.output_thread = forward_output(self.process, self.log)
            process = self.process
            self.backend_port = port
        self.update_progress(7, "Connecting to editor", "Waiting for the new editor to respond and checking its Git status. Editing unlocks only after this check succeeds.")
        deadline = time.monotonic() + 45
        while not self.closed and time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeErrorMessage("The matching editor could not start. Read the launcher window, run setup-dev-env.bat if dependencies are missing, then click Retry.")
            try:
                status = self.backend_status()
                break
            except RuntimeErrorMessage:
                raise
            except (OSError, ValueError, HTTPException):
                time.sleep(.2)
        else:
            if self.closed:
                return
            raise RuntimeErrorMessage("The editor did not become responsive. Check the launcher window and click Retry.")
        if checkout_version(self.root) != target:
            raise RuntimeErrorMessage("Editor source changed during startup. Finish the Git operation, then click Retry.")
        with self.lock:
            self.running_version = target
            self.target_version = target
            self.branch = status["git"].get("branch")
            # Stay within JavaScript's exact integer range and invalidate tabs from prior launchers.
            self.generation = self.generation + 1 if self.generation else secrets.randbelow(2 ** 52) + 1
            self.restart_requested = False
            self.checkout_transition = False
            self.state = "ready"
            self.message = ""
            self.update_progress(8, "Editor ready", "The matching editor is running. Browser drafts remain protected before the page reconnects.")
        self.log(f"Site editor {target['version']} ready ({target['fingerprint'][:12]}).")

    def monitor(self):
        while not self.closed:
            try:
                if self.state in {"starting", "restarting"}:
                    self.replace_child()
                else:
                    self.refresh()
                    process = self.process
                    if process and process.poll() is not None and self.state not in {"blocked", "failed"}:
                        raise RuntimeErrorMessage("The editor stopped unexpectedly. Check the launcher window and click Retry.")
                    if self.state in {"pending", "development"}:
                        with self.lock:
                            active = self.active
                        if active:
                            time.sleep(.2)
                            continue
                        try:
                            status = self.backend_status()
                        except (OSError, ValueError, HTTPException) as exc:
                            LOGGER.warning("Waiting for a safe editor restart: %s", exc)
                            self.message = "Waiting to verify that Git and active work have finished. Do not close the launcher during a Git operation."
                            time.sleep(2 if self.state == "development" else .5)
                            continue
                        git = status["git"]
                        message = self.restart_blocker(status, include_uploads=(
                            self.running_version != self.target_version or self.restart_requested))
                        if message:
                            self.message = message
                        elif self.running_version == self.target_version and not self.restart_requested:
                            self.checkout_transition = False
                            self.branch = git.get("branch")
                            self.state = "ready"
                            self.message = ""
                        elif self.developer and git.get("branch") == self.branch and not self.restart_requested and not self.checkout_transition:
                            self.state = "development"
                            self.message = "Developer mode: source changed. Restart the editor when ready to load Python changes."
                        else:
                            self.replace_child()
            except (OSError, ValueError, subprocess.SubprocessError) as exc:
                LOGGER.exception("Editor runtime transition failed")
                self.log(f"ERROR: {exc}")
                with self.lock:
                    self.state = "failed"
                    self.message = str(exc)
                self.stop_child()
            time.sleep(2 if self.state == "development" else .5)

    def request_restart(self):
        with self.lock:
            if self.state in {"starting", "restarting"}:
                raise RuntimeErrorMessage("The editor is already starting. Wait for it to finish.")
            if self.state == "failed" and not self.developer and self.prepared_python:
                folder = self.prepared_python.parent.parent
                if folder.is_relative_to(self.root / ".tools" / "site-editor-runtime" / "python"):
                    (folder / "ready.json").unlink(missing_ok=True)
                    self.log("Retry will reprepare the failed editor's project-local Python environment.")
            self.restart_requested = True
            self.state = "pending" if self.process and self.process.poll() is None else "starting"

    def close(self):
        with self.lock:
            self.closed = True
            self.condition.notify_all()
            setup = self.setup_process
        if setup and setup.poll() is None:
            setup.terminate()
        self.stop_child()
        if self.thread:
            self.thread.join(timeout=15)


class RuntimeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, supervisor):
        self.supervisor = supervisor
        super().__init__(address, RuntimeHandler)
        supervisor.public_port = self.server_port


class RuntimeHandler(BaseHTTPRequestHandler):
    def reply(self, status, body, mime):
        self.response_started = True
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def json(self, status, data):
        if self.command != "GET" and not getattr(self, "request_body_read", False):
            length = self.headers.get("Content-Length", "0")
            if length.isdigit() and 0 < int(length) <= MAX_REQUEST:
                self.connection.settimeout(2)
                try:
                    self.rfile.read(int(length))
                except OSError as exc:
                    LOGGER.warning("Rejected runtime request body interrupted: %s", exc)
            self.request_body_read = True
        self.reply(status, json.dumps(data).encode(), "application/json; charset=utf-8")

    def maintenance(self):
        self.reply(200, b'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Starting site editor</title><script src="/workbench-runtime.js" data-generation="0" defer></script></head><body data-runtime-maintenance><h1>Starting the matching site editor</h1><p>Keep this window open. Your saved files and checkpoints stay in the checkout.</p></body></html>',
                   "text/html; charset=utf-8")

    def handle_request(self):
        supervisor = self.server.supervisor
        hosts = (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")
        origin = self.headers.get("Origin")
        if (self.headers.get("Host") not in hosts or
                origin and origin not in tuple(f"http://{host}" for host in hosts) or
                self.headers.get("Sec-Fetch-Site") == "cross-site"):
            self.json(403, {"error": "Use the local site editor address. Cross-origin requests are not allowed."})
            return
        route = urlsplit(self.path).path
        if self.command == "GET" and route == "/workbench-runtime.js":
            self.reply(200, supervisor.bridge, "text/javascript; charset=utf-8")
            return
        if route == "/api/workbench/runtime":
            if self.command == "GET":
                supervisor.refresh()
                self.json(200, supervisor.metadata())
            elif self.command == "POST":
                if not secrets.compare_digest(self.headers.get("X-Workbench-Runtime-Token", ""), supervisor.token):
                    self.json(403, {"error": "Reload this page before requesting an editor restart."})
                    return
                try:
                    supervisor.request_restart()
                    self.json(202, supervisor.metadata())
                except RuntimeErrorMessage as exc:
                    self.json(409, {"error": str(exc)})
            else:
                self.json(405, {"error": "Unsupported runtime operation."})
            return
        supervisor.refresh()
        with supervisor.lock:
            state = supervisor.state
            generation = self.headers.get("X-Workbench-Generation")
            if generation is not None and generation != str(supervisor.generation):
                self.json(409, {"error": "This browser is running a previous editor. Save draft copies, then reload.", "editor": supervisor.metadata()})
                return
            allowed = state in {"ready", "development"} or state == "pending" and (
                route in {"/api/workbench/status", "/api/workbench/git", "/api/workbench/git/action",
                          "/api/workbench/git/conflict", "/api/workbench/preview/stop"} or
                self.command in {"GET", "DELETE"} and route.startswith("/api/workbench/uploads/"))
            if not allowed:
                if self.command == "GET" and route == "/":
                    self.maintenance()
                else:
                    self.json(503, {"error": supervisor.message, "editor": supervisor.metadata()})
                return
            supervisor.active += 1
            port = supervisor.backend_port
        connection = HTTPConnection("127.0.0.1", port, timeout=180)
        try:
            length = self.headers.get("Content-Length", "0")
            if self.headers.get("Transfer-Encoding") or not length.isdigit() or int(length) > MAX_REQUEST:
                self.json(413, {"error": "Editor request is too large or has invalid Content-Length."})
                return
            self.connection.settimeout(30)
            body = self.rfile.read(int(length)) if int(length) else None
            self.request_body_read = True
            if body is not None and len(body) != int(length):
                self.json(400, {"error": "The editor request was interrupted."})
                return
            payload = None
            if route == "/api/workbench/git/action" and self.command == "POST":
                try:
                    payload = json.loads(body or b"{}")
                except json.JSONDecodeError:
                    self.json(400, {"error": "Expected a JSON Git operation."})
                    return
            if state == "pending" and route == "/api/workbench/git/action":
                if not isinstance(payload, dict) or payload.get("action") not in {"abort", "continue", "resolve", "terminal", "checkout", "fetch"}:
                    self.json(409, {"error": "Finish recovery or wait for the matching editor before starting new work."})
                    return
            if self.command == "POST" and route == "/api/workbench/git/action":
                if isinstance(payload, dict) and payload.get("action") in {
                        "checkout", "create", "create-main", "pull", "rebase", "rebase-main", "continue", "abort", "terminal"}:
                    with supervisor.lock:
                        supervisor.checkout_transition = True
                        if supervisor.state in {"ready", "development"}:
                            supervisor.state = "pending"
            headers = {key: value for key, value in self.headers.items()
                       if key.lower() not in {"host", "connection", "transfer-encoding"}}
            headers["Host"] = f"127.0.0.1:{port}"
            headers["Connection"] = "close"
            if origin:
                headers["Origin"] = f"http://127.0.0.1:{port}"
            connection.request(self.command, self.path, body=body, headers=headers)
            response = connection.getresponse()
            content = response.read()
            if self.command == "GET" and route == "/" and response.status == 200:
                supervisor.refresh()
                if supervisor.state not in {"ready", "development"}:
                    self.maintenance()
                    return
                bridge = f'<script src="/workbench-runtime.js" data-generation="{supervisor.generation}" defer></script>'.encode()
                content = content.replace(b"</head>", bridge + b"</head>", 1)
            if route == "/api/workbench/status" and response.status == 200 and supervisor.state == "ready":
                status = json.loads(content)
                with supervisor.lock:
                    supervisor.branch = status.get("git", {}).get("branch")
            self.response_started = True
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in {"content-length", "transfer-encoding", "connection", "server", "date"}:
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except (OSError, ValueError, HTTPException) as exc:
            LOGGER.warning("Editor request interrupted: %s", exc)
            if not getattr(self, "response_started", False):
                self.json(503, {"error": "The matching editor is restarting or unavailable. Keep this page open.", "editor": supervisor.metadata()})
        finally:
            connection.close()
            with supervisor.lock:
                supervisor.active -= 1
                supervisor.condition.notify_all()

    do_GET = handle_request
    do_POST = handle_request
    do_PUT = handle_request
    do_DELETE = handle_request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8879)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--dev", action="store_true", help="Use the current Python environment; restart source edits manually.")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    supervisor = Supervisor(ROOT, args.dev)
    try:
        server = RuntimeServer(("127.0.0.1", args.port), supervisor)
    except OSError as exc:
        parser.exit(1, f"Cannot open the editor address: {exc}\n")
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"FTSK Site Editor: {url}\nKeep this launcher open; Ctrl+C closes its editor.", flush=True)
    supervisor.start()
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        supervisor.close()
        server.server_close()


if __name__ == "__main__":
    main()
