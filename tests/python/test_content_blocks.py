"""Native section dispatch and build-comparison regressions."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

from scripts.compare_site_builds import compare, html_tokens

ROOT = Path(__file__).resolve().parents[2]


class BuildComparisonTests(unittest.TestCase):
    def test_only_bookshop_markers_and_nonverbatim_indentation_are_ignored(self):
        original = b'<!--bookshop-live name(page)-->\n<section>\n<h1>Same title</h1>\n</section>'
        updated = b'<section><h1>Same title</h1></section>'
        self.assertEqual(html_tokens(original), html_tokens(updated))
        self.assertEqual(html_tokens(b"<h1>\r\nSame title</h1>"),
                         html_tokens(b"<h1>\nSame title</h1>"))
        for changed in (
            b'<section><h1>Different title</h1></section>',
            b'<section class="changed"><h1>Same title</h1></section>',
            b'<section><h1>Same title</h1></section><!--important comment-->',
        ):
            self.assertNotEqual(html_tokens(original), html_tokens(changed))
        for tag in ("pre", "textarea", "script", "style"):
            self.assertNotEqual(html_tokens(f"<{tag}> </{tag}>".encode()),
                                html_tokens(f"<{tag}></{tag}>".encode()))
        self.assertNotEqual(html_tokens(b"<span>One</span> <span>Two</span>"),
                            html_tokens(b"<span>One</span><span>Two</span>"))

    def test_assets_and_output_inventory_are_compared_exactly(self):
        with tempfile.TemporaryDirectory() as folder:
            before, after = Path(folder) / "before", Path(folder) / "after"
            before.mkdir()
            after.mkdir()
            (before / "style.css").write_bytes(b"original")
            (after / "style.css").write_bytes(b"changed")
            (before / "missing.html").write_bytes(b"<h1>Missing</h1>")
            (after / "new.html").write_bytes(b"<h1>New</h1>")
            problems, count = compare(before, after)
            self.assertEqual(count, 2)
            self.assertEqual(len(problems), 3)


@unittest.skipUnless(shutil.which("hugo"), "Hugo is required for native section rendering.")
class ContentBlocksTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="ftsk-sections-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "content").mkdir()
        (self.root / "data").mkdir()
        (self.root / "layouts").mkdir()
        shutil.copytree(ROOT / "layouts" / "partials", self.root / "layouts" / "partials")
        (self.root / "layouts" / "index.html").write_text(
            '<main>{{ partial "content-blocks.html" . }}</main>', encoding="utf-8")
        (self.root / "config.toml").write_text(
            'baseURL="https://example.test/subpath/"\ndisableKinds=["taxonomy","term","RSS","sitemap"]\n',
            encoding="utf-8")
        self.content = {"title": "Sections", "content_blocks": [
            {"_bookshop_name": "global/header", "title": "First", "description": "**Bold** text"},
            {"_bookshop_name": "global/cta", "title": "Second", "data_gated": "tanfolyam",
             "link": {"text": "Contact", "url": "/kapcsolat/"}},
            {"_bookshop_name": "global/richtext", "title": "Third", "content": "Kept *story*"},
        ]}
        (self.root / "data" / "tanfolyam.yaml").write_text("active: true\n", encoding="utf-8")

    def build(self):
        self.root.joinpath("content", "_index.md").write_text(
            "---\n" + yaml.safe_dump(self.content, allow_unicode=True, sort_keys=False) + "---\n",
            encoding="utf-8")
        # Plain Hugo must not try to resolve any Go module or npm dependency.
        env = {**os.environ, "GOPROXY": "off", "GOSUMDB": "off"}
        return subprocess.run([shutil.which("hugo"), "--source", str(self.root)],
                              capture_output=True, text=True, env=env, check=False)

    def test_native_sections_keep_order_markdown_links_and_data_gating(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        html = self.root.joinpath("public", "index.html").read_text(encoding="utf-8")
        self.assertLess(html.index("First"), html.index("Second"))
        self.assertLess(html.index("Second"), html.index("Third"))
        self.assertIn("<strong>Bold</strong>", html)
        self.assertIn("<em>story</em>", html)
        self.assertIn('href="/subpath/kapcsolat/"', html)
        self.assertNotIn("bookshop-live", html)
        self.root.joinpath("data", "tanfolyam.yaml").write_text("active: false\n", encoding="utf-8")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        html = self.root.joinpath("public", "index.html").read_text(encoding="utf-8")
        self.assertNotIn("Second", html)
        self.assertIn("Third", html)

    def test_invalid_and_unknown_sections_fail_explicitly(self):
        for blocks, error in (
            ([{"_bookshop_name": "unknown/section"}], "unknown content section"),
            ([{"title": "Missing name"}], "unknown content section"),
            (["not a mapping"], "must be a mapping"),
            ({"_bookshop_name": "global/header"}, "must be a list"),
            ({}, "must be a list"),
            ("", "must be a list"),
            (False, "must be a list"),
            (0, "must be a list"),
            ([{"_bookshop_name": 42}], "needs a section name"),
            ([{"_bookshop_name": "../../url"}], "unknown content section"),
        ):
            with self.subTest(blocks=blocks):
                self.content["content_blocks"] = blocks
                result = self.build()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(error, result.stdout + result.stderr)

    def test_pages_without_sections_render_without_inventing_content(self):
        for blocks in (None, []):
            with self.subTest(blocks=blocks):
                if blocks is None:
                    self.content.pop("content_blocks")
                else:
                    self.content["content_blocks"] = blocks
                result = self.build()
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                html = self.root.joinpath("public", "index.html").read_bytes()
                self.assertEqual(html_tokens(html), [("start", "main", []), ("end", "main")])

    def test_no_external_site_renderer_dependencies_remain(self):
        package = json.loads(ROOT.joinpath("package.json").read_text(encoding="utf-8"))
        self.assertFalse(package.get("dependencies"))
        self.assertLessEqual(set(package.get("devDependencies", {})), {"esbuild", "monaco-editor"})
        self.assertFalse(ROOT.joinpath("go.mod").exists())
        config = ROOT.joinpath("config.toml").read_text(encoding="utf-8")
        self.assertNotIn("[[module.imports]]", config)
        self.assertNotIn("bookshop", config)
        for name in ("list", "single"):
            layout = ROOT.joinpath("layouts", "_default", f"{name}.html").read_text(encoding="utf-8")
            self.assertIn('partial "content-blocks.html"', layout)
            self.assertNotIn("bookshop", layout)


if __name__ == "__main__":
    unittest.main()
