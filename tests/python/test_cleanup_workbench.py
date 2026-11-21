"""Cleanup discovery/deletion operates only on disposable Git checkouts."""

import json
import os
import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

from test_site_workbench import Fixture, HTTPTests
from tools.workbench.content_workbench import ConflictError, ContentError
from tools.workbench.site_workbench import REPO_ROOT


class CleanupTests(Fixture):
    def setUp(self):
        super().setUp()
        self.service = self.app.cleanup
        self.generated = '<html><body><img src="/images/dynamic.webp"></body></html>'
        for name in ("dead.webp", "dynamic.webp", "processed.webp", "draft photo.webp"):
            (self.root / "static" / "images" / name).write_bytes(b"fixture image")
        (self.root / "static" / "unused.css").write_text("body { color: red; }")
        (self.root / "static" / ".nojekyll").write_text("")
        (self.root / "content").mkdir()
        (self.root / "content" / "draft.md").write_text(
            '---\ndraft: true\n---\n![Keep](/images/draft%20photo.webp)\n', encoding="utf-8")
        self.commit()

    def commit(self):
        for args in (("config", "user.name", "Cleanup fixture"),
                     ("config", "user.email", "fixture@example.test"),
                     ("config", "commit.gpgsign", "false"), ("config", "core.autocrlf", "false"),
                     ("add", "."), ("commit", "-m", "Fixture checkpoint")):
            subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True)

    def build(self, output, resources, cache):
        output.mkdir()
        (output / "index.html").write_text(self.generated, encoding="utf-8")
        resources.mkdir()
        (resources / "images").mkdir()
        (resources / "images" / "processed_hu_123.png").write_bytes(b"processed")

    def scan(self, build=None):
        with patch.object(self.service, "build", side_effect=build or self.build):
            self.service.scan()
        return self.service.catalog()["scan"]

    def delete(self, paths, **kwargs):
        return self.service.delete({"scan": self.service.report["id"], "paths": paths,
                                    "confirm": True, **kwargs})

    def test_discovery_preserves_drafts_dynamic_build_urls_and_processed_sources(self):
        report = self.scan()
        candidates = {item["path"] for item in report["files"]}
        self.assertIn("static/images/dead.webp", candidates)
        self.assertIn("static/unused.css", candidates)
        for path in ("static/images/draft photo.webp", "static/images/dynamic.webp",
                     "static/images/processed.webp", "static/images/hero/one.webp"):
            self.assertNotIn(path, candidates)
        result = self.delete(["static/images/dead.webp"])
        self.assertEqual(result["deleted"], ["static/images/dead.webp"])
        self.assertFalse((self.root / "static/images/dead.webp").exists())
        self.assertTrue(self.app.git.run("cat-file", "-e", result["checkpoint"] + ":static/images/dead.webp").returncode == 0)
        self.assertIsNone(self.service.report)

    def test_advanced_files_require_explicit_mode_and_infrastructure_stays_protected(self):
        self.scan()
        with self.assertRaisesRegex(ContentError, "advanced"):
            self.delete(["static/unused.css"])
        with self.assertRaisesRegex(ConflictError, "eligible"):
            self.delete(["static/.nojekyll"], advanced=True)
        result = self.delete(["static/unused.css"], advanced=True)
        self.assertEqual(result["deleted"], ["static/unused.css"])

    def test_untracked_modified_and_newly_staged_files_are_not_deletable(self):
        (self.root / "static/new.pdf").write_bytes(b"%PDF fixture")
        (self.root / "static/untracked.pdf").write_bytes(b"%PDF untracked")
        (self.root / "static/images/dead.webp").write_bytes(b"changed")
        self.app.git.run("add", "static/new.pdf")
        report = self.scan()
        candidates = {item["path"]: item for item in report["files"]}
        self.assertTrue(candidates["static/new.pdf"]["protected"])
        self.assertTrue(candidates["static/untracked.pdf"]["protected"])
        self.assertTrue(candidates["static/images/dead.webp"]["protected"])
        with self.assertRaises(ConflictError):
            self.delete(["static/new.pdf"])
        with self.assertRaises(ConflictError):
            self.delete(["static/untracked.pdf"])
        with self.assertRaises(ConflictError):
            self.delete(["static/images/dead.webp"])

    def test_changed_reference_branch_and_selected_file_invalidate_review_before_any_delete(self):
        self.scan()
        (self.root / "content/draft.md").write_text("![Now needed](/images/dead.webp)")
        with self.assertRaisesRegex(ConflictError, "checkout changed"):
            self.delete(["static/images/dead.webp", "static/unused.css"], advanced=True)
        self.assertTrue((self.root / "static/images/dead.webp").is_file())
        self.assertTrue((self.root / "static/unused.css").is_file())
        self.scan()
        self.app.git.run("switch", "-c", "another")
        with self.assertRaisesRegex(ConflictError, "checkout changed"):
            self.delete(["static/unused.css"], advanced=True)
        self.scan()
        (self.root / "static/unused.css").write_text("Changed after review")
        with self.assertRaisesRegex(ConflictError, "checkout changed"):
            self.delete(["static/unused.css"], advanced=True)

    def test_failed_or_changing_build_never_leaves_an_approved_scan(self):
        self.scan()
        with patch.object(self.service, "build", side_effect=ContentError("fixture build failed")):
            with self.assertRaisesRegex(ContentError, "build failed"):
                self.service.scan()
        self.assertIsNone(self.service.report)
        def changing(output, resources, cache):
            self.build(output, resources, cache)
            (self.root / "content/another.md").write_text("Added during the scan")
        with self.assertRaisesRegex(ConflictError, "changed during"):
            self.scan(changing)
        self.assertIsNone(self.service.report)

    def test_url_decoding_css_relative_paths_and_javascript_unicode_references(self):
        (self.root / "static/images/túra.webp").write_bytes(b"image")
        (self.root / "static/use.js").write_text('const url = "/images/t\\u00fara.webp";', encoding="utf-8")
        (self.root / "static/use.css").write_text('body{background:url("images/dead.webp?v=1")}')
        self.commit()
        candidates = {item["path"] for item in self.scan()["files"]}
        self.assertNotIn("static/images/túra.webp", candidates)
        self.assertNotIn("static/images/dead.webp", candidates)

    def test_dynamic_tutorials_and_interpolated_images_are_not_approved_for_deletion(self):
        tutorial = self.root / "static/archive/tutorial"
        tutorial.mkdir(parents=True)
        (tutorial / "10.html").write_text("<p>Tutorial</p>")
        (self.root / "static/archive/index.html").write_text(
            '<script>const page = "tutorial/" + current + ".html";</script>')
        motifs = self.root / "static/images/motifs"
        motifs.mkdir()
        (motifs / "bat-7.svg").write_text("<svg></svg>")
        (self.root / "static/animation.js").write_text('const bat = `/images/motifs/bat-${variant}.svg`;')
        self.commit()
        files = {item["path"]: item for item in self.scan()["files"]}
        for path in ("static/archive/tutorial/10.html", "static/images/motifs/bat-7.svg"):
            self.assertIn("dynamically", files[path]["protected"])
            with self.assertRaises(ConflictError):
                self.delete([path], advanced=True)

    def test_generic_editor_media_browsers_do_not_protect_every_image(self):
        (self.root / "tools").mkdir()
        (self.root / "tools/browser.js").write_text('const browse = "/images/" + selectedFile;')
        self.commit()
        files = {item["path"]: item for item in self.scan()["files"]}
        self.assertEqual(files["static/images/dead.webp"]["protected"], "")
        self.delete(["static/images/dead.webp"])

    def test_partial_filesystem_failure_reports_removed_files_and_invalidates_scan(self):
        self.scan()
        unlink = Path.unlink
        def fail_second(path, *args, **kwargs):
            if path.name == "unused.css":
                raise PermissionError("fixture file is locked")
            return unlink(path, *args, **kwargs)
        with patch.object(Path, "unlink", autospec=True, side_effect=fail_second):
            with self.assertRaisesRegex(ContentError, "Already deleted: static/images/dead.webp"):
                self.delete(["static/images/dead.webp", "static/unused.css"], advanced=True)
        self.assertIsNone(self.service.report)
        self.assertFalse((self.root / "static/images/dead.webp").exists())
        self.assertTrue((self.root / "static/unused.css").exists())

    def test_real_hugo_build_isolates_resources_and_protects_processed_images(self):
        version = (REPO_ROOT / ".hugo-version").read_text().strip()
        pinned = REPO_ROOT / ".tools" / "hugo" / version / ("hugo.exe" if os.name == "nt" else "hugo")
        executable = str(pinned) if pinned.is_file() else shutil.which("hugo")
        if not executable:
            self.skipTest("Hugo is not installed")
        (self.root / "layouts").mkdir()
        (self.root / "layouts/index.html").write_text(
            '<html><body>{{ with resources.Get "images/hero/one.webp" }}'
            '{{ $image := .Resize "20x" }}<img src="{{ $image.RelPermalink }}">'
            '{{ end }}</body></html>')
        (self.root / "config.toml").write_text(
            'baseURL = "https://www.ftsk.hu/"\n'
            '[[module.mounts]]\nsource = "content"\ntarget = "content"\n'
            '[[module.mounts]]\nsource = "layouts"\ntarget = "layouts"\n'
            '[[module.mounts]]\nsource = "static"\ntarget = "static"\n'
            '[[module.mounts]]\nsource = "static/images"\ntarget = "assets/images"\n')
        self.commit()
        with patch.object(self.app, "hugo_executable", return_value=executable):
            self.service.scan()
        self.assertFalse((self.root / "resources").exists(), "Discovery never populates the checkout's Hugo resource cache")
        candidates = {item["path"] for item in self.service.report["files"]}
        self.assertNotIn("static/images/hero/one.webp", candidates)


class CleanupHTTPTests(HTTPTests):
    def test_cleanup_delete_requires_token_working_branch_and_current_scan(self):
        response = self.request("/api/workbench/cleanup")
        self.assertEqual(response[0], 200)
        self.assertIsNone(json.loads(response[1])["scan"])
        self.assertEqual(self.request("/api/workbench/cleanup/delete", "POST",
                                      b'{"paths":["static/images/hero/one.webp"],"confirm":true}')[0], 403)
        self.app.git.run("switch", "-c", "main")
        response = self.request("/api/workbench/cleanup/delete", "POST",
                                b'{"paths":["static/images/hero/one.webp"],"confirm":true}',
                                {"X-Workbench-Token": self.app.token})
        self.assertEqual(response[0], 409)
        self.assertTrue((self.root / "static/images/hero/one.webp").is_file())
