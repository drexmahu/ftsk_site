"""Keep the disposable legacy app complete and independent of the Hugo theme."""

import json
import re
import unittest
from pathlib import Path

from scripts.verify_site_links import PageReferences, verify_site

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "static"
ARCHIVE = STATIC / "barlangos-tortenelem"


class HistoryArchiveTests(unittest.TestCase):
    def test_static_archive_links_work_under_production_and_preview_prefixes(self):
        for base in ("https://www.ftsk.hu/", "https://example.test/pr-preview/pr-42/"):
            with self.subTest(base=base):
                _, errors = verify_site(STATIC, base)
                self.assertEqual(errors, [])

    def test_dynamic_activity_icons_and_tutorial_assets_are_present(self):
        data = json.loads((ARCHIVE / "json" / "data.json").read_text(encoding="utf-8"))
        self.assertEqual(len(data["activities"]), 601)
        self.assertEqual(len(data["caves"]), 131)
        for kind in [*data["activity_types"], "cave"]:
            self.assertTrue((ARCHIVE / "assets" / "img" / "activity" / f"{kind}.png").is_file(), kind)
        for number in range(1, 12):
            page = (ARCHIVE / "tutorial" / f"{number}.html").read_text(encoding="utf-8")
            for image in re.findall(r"url\(['\"]([^'\"]+)['\"]\)", page):
                self.assertTrue((ARCHIVE / image).is_file(), image)

    def test_runtime_is_local_and_credits_are_preserved(self):
        page = (ARCHIVE / "index.html").read_text(encoding="utf-8")
        parser = PageReferences()
        parser.feed(page)
        scripts = re.findall(r'<script\s+src="([^"]+)"', page)
        self.assertEqual(len(scripts), 8)
        for script in scripts:
            self.assertTrue((ARCHIVE / script).is_file(), script)
            self.assertFalse(script.startswith(("http", "//", "/")))
        self.assertNotIn("google-analytics", page)
        self.assertIn("Mészáros József", page)
        self.assertIn("$scope.actual >= 11", page)
        self.assertRegex(page, r"\$scope\.open = function \(\) \{\s*\$scope\.actual = 1;")
        self.assertIn("./json/data.json", page)
        self.assertTrue((STATIC / "FTSK" / "index.html").is_file())
        self.assertIn("/barlangos-tortenelem/", (ROOT / "content" / "linkek.md").read_text(encoding="utf-8"))
        self.assertNotIn("mindenki által szerkeszthető", (ARCHIVE / "tutorial" / "2.html").read_text(encoding="utf-8"))
