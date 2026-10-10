"""Desktop navigation tests mock launches and use disposable repository files."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from tools.workbench.site_workbench import safe_path, ToolError
from tools.workbench.workbench_files import navigate_file


class FileNavigationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="ftsk-file-navigation-")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.relative = "content/person with spaces.md"
        (self.root / "content").mkdir()
        (self.root / self.relative).write_text("Document", encoding="utf-8")

    @unittest.skipUnless(os.name == "nt", "Windows desktop navigation")
    def test_open_text_and_image_as_vscode_uri(self):
        for name in (self.relative, "portrait.webp", "content/\u00e1rv\u00edz.md"):
            (self.root / name).write_bytes(b"fixture")
            with patch("tools.workbench.workbench_files.os.startfile") as launch:
                navigate_file(self.root, {"path": name, "action": "open"}, safe_path)
                uri = launch.call_args.args[0]
                self.assertTrue(uri.startswith("vscode://file/"))
                self.assertNotIn(" ", uri)
                self.assertTrue(uri.endswith(quote(name, safe="/:")))

    @unittest.skipUnless(os.name == "nt", "Windows desktop navigation")
    def test_reveal_selects_exact_file_without_shell(self):
        with patch("tools.workbench.workbench_files.subprocess.Popen") as launch:
            navigate_file(self.root, {"path": self.relative, "action": "reveal"}, safe_path)
            launch.assert_called_once_with(
                ["explorer.exe", "/select,", str(self.root / self.relative)], cwd=self.root)

    def test_invalid_or_missing_files_never_launch(self):
        for path in ("../outside.md", str(self.root / self.relative), "content\\person.md",
                     "https://example.test/file", "missing.md"):
            with self.subTest(path=path), patch("tools.workbench.workbench_files.subprocess.Popen") as launch:
                with self.assertRaises((ValueError, ToolError)):
                    navigate_file(self.root, {"path": path, "action": "reveal"}, safe_path)
                launch.assert_not_called()
        with self.assertRaises(ValueError):
            navigate_file(self.root, {"path": self.relative, "action": "delete"}, safe_path)

    @unittest.skipUnless(os.name == "nt", "Windows desktop navigation")
    def test_launch_failure_is_not_reported_as_success(self):
        with patch("tools.workbench.workbench_files.os.startfile", side_effect=OSError("VS Code protocol is unavailable")):
            with self.assertRaisesRegex(OSError, "protocol is unavailable"):
                navigate_file(self.root, {"path": self.relative, "action": "open"}, safe_path)
