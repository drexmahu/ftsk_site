"""Safe editing, deletion and true Hugo preview regressions."""

import json
import shutil
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

from content_workbench import ContentError, ConflictError, parse_frontmatter, patched_source, split_source
from test_site_workbench import Fixture, HTTPTests

SOURCE = """---
# Original comment
title: Original title # inline title note
date: 2026-08-14T00:00:00Z
participants:
  - First Name
# Before custom field
custom:
  nested: "preserve these quotes"
seo:
  page_description: Old description
  no_index: false
draft: true
---

## Original text

![Image](/images/hero/one.webp)
"""


class ContentFixture(Fixture):
    def setUp(self):
        super().setUp()
        (self.root / "content" / "turak").mkdir(parents=True)
        (self.root / "content" / "turak" / "fixture.md").write_bytes(SOURCE.encode("utf-8"))
        self.service = self.app.content
        self.document = self.service.read("turak/fixture.md")

    def payload(self, **overrides):
        return {"path": self.document["path"], "original": self.document["path"],
                "revision": self.document["revision"], "source": self.document["source"], **overrides}


class SourceTests(ContentFixture):
    def test_no_op_is_exact_and_date_stays_text(self):
        self.assertEqual(patched_source(SOURCE, {"title": "Original title"}), SOURCE)
        self.assertEqual(parse_frontmatter(split_source(SOURCE)[0])["date"], "2026-08-14T00:00:00Z")
        saved = self.service.save(self.payload())
        self.assertEqual(saved["source"], SOURCE)
        self.assertEqual(saved["revision"], self.document["revision"])

    def test_changed_blocks_preserve_unknowns_comments_and_body(self):
        patched = patched_source(SOURCE, {"title": "New: title", "participants": ["One", "Two"],
                                         "seo": {"page_description": "New\nDescription", "no_index": True},
                                         "aliases": ["/old-path/"]})
        meta = parse_frontmatter(split_source(patched)[0])
        self.assertEqual(meta["title"], "New: title")
        self.assertEqual(meta["participants"], ["One", "Two"])
        self.assertEqual(meta["seo"]["page_description"], "New\nDescription")
        self.assertEqual(meta["aliases"], ["/old-path/"])
        self.assertIn('# Before custom field\ncustom:\n  nested: "preserve these quotes"', patched)
        self.assertIn("# inline title note", patched)
        self.assertEqual(split_source(patched)[1], split_source(SOURCE)[1])

    def test_crlf_roundtrip_and_block_scalar(self):
        source = "---\r\ntitle: Original\r\ndescription: |-\r\n  line one\r\n  line two\r\ndraft: true\r\n---\r\n\r\nBody\r\n"
        result = patched_source(source, {"title": "Changed", "draft": False})
        self.assertNotIn("\n", result.replace("\r\n", ""))
        self.assertIn("description: |-\r\n  line one\r\n  line two", result)
        self.assertEqual(split_source(result)[1], "\r\nBody\r\n")

    def test_rejects_duplicate_alias_nonfinite_and_bad_source(self):
        for source in ("title: a\ntitle: b", "title: a\nseo: {x: 1, x: 2}",
                       "title: a\nx: &anchor [1]\ny: *anchor", "title: a\nx: .nan"):
            with self.subTest(source=source), self.assertRaises(ContentError):
                parse_frontmatter(source)
        with self.assertRaises(ContentError):
            split_source("No frontmatter")

    def test_invalid_known_fields_and_missing_images(self):
        for changes in ({"title": ""}, {"date": "2026-99-01"}, {"participants": "Name"},
                        {"draft": "false"}, {"article_image_width": 0},
                        {"featuredImg": {"image_path": "/images/missing.webp"}},
                        {"milestones": [{"label": "Test", "date": "nonsense"}]},
                        {"faq": [{"question": "Q", "answer": ""}]}):
            with self.subTest(changes=changes), self.assertRaises(ContentError):
                self.service.validate(self.document["path"], SOURCE, changes)

    def test_create_move_collision_and_revision_conflict(self):
        new = self.service.save({"path": "turak/new/index.md", "source": SOURCE, "original": ""})
        self.assertTrue((self.root / "content" / "turak" / "new" / "index.md").is_file())
        with self.assertRaises(ConflictError):
            self.service.save({"path": new["path"], "source": SOURCE, "original": ""})
        moved = self.service.save(self.payload(path="turak/moved.md"))
        self.assertEqual(moved["path"], "turak/moved.md")
        self.assertFalse((self.root / "content" / self.document["path"]).exists())
        self.assertTrue((self.root / "static" / "images" / "hero" / "one.webp").exists())
        with self.assertRaises(ConflictError):
            self.service.save(self.payload())

    def test_external_changes_do_not_get_overwritten(self):
        file = self.root / "content" / self.document["path"]
        file.write_text(SOURCE + "\nExternal edit\n", encoding="utf-8")
        with self.assertRaises(ConflictError):
            self.service.save(self.payload())
        self.assertIn("External edit", file.read_text(encoding="utf-8"))

    def test_full_field_roundtrip_and_unknown_metadata(self):
        fields = {
            "title": "Full metadata", "date": "2026-08-14", "author": "First Name",
            "participants": ["First Name", "Guest"], "categories": ["Túra"],
            "article_image_width": 75, "draft": True, "current": False,
            "slug": "unique-slug", "url": "/custom-trip/", "aliases": ["/old-trip/"],
            "publishDate": "2026-10-01", "expiryDate": "2030-01-01",
            "thumbImg": {"image_path": "/images/hero/one.webp", "custom": "keep"},
            "featuredImg": {"image_path": "/images/hero/two.webp"},
            "seo": {"page_description": "Description", "canonical_url": "https://example.test/trip/",
                    "featured_image": "/images/hero/one.webp", "author_twitter_handle": "@example",
                    "open_graph_type": "article", "no_index": True, "custom": "keep"},
            "milestones": [{"label": "Phase", "date": "2027-06-01", "estimated": True, "custom": 12}],
            "contacts": [{"name": "Contact", "role": "Leader", "email": "test@example.test", "phone": "+361234567"}],
            "flyer_images": [{"image_path": "/images/hero/one.webp"}],
            "faq": [{"question": "Question?", "answer": "**Answer**"}],
        }
        saved = self.service.save(self.payload(changes=fields))
        reopened = self.service.read(saved["path"])
        for field, value in fields.items():
            with self.subTest(field=field):
                self.assertEqual(reopened["metadata"][field], value)
        self.assertEqual(reopened["metadata"]["custom"], {"nested": "preserve these quotes"})
        self.assertEqual(reopened["body"], self.document["body"])

    def test_failed_atomic_save_leaves_original_and_cleans_temporary(self):
        with patch("content_workbench.os.fsync", side_effect=OSError("Fixture disk failure")), self.assertRaises(OSError):
            self.service.save(self.payload(changes={"title": "Changed"}))
        self.assertEqual((self.root / "content" / self.document["path"]).read_bytes(), SOURCE.encode("utf-8"))
        self.assertFalse(list((self.root / "content" / "turak").glob(".workbench-*.tmp")))

    def test_creation_race_does_not_delete_competing_file(self):
        destination = self.root / "content" / "turak" / "race.md"
        original_open = Path.open

        def competing_create(path, mode="r", *args, **kwargs):
            if path == destination and mode == "xb":
                with original_open(path, "wb") as stream:
                    stream.write(b"Someone else's file")
            return original_open(path, mode, *args, **kwargs)

        with patch.object(Path, "open", competing_create), self.assertRaises(FileExistsError):
            self.service.save({"path": "turak/race.md", "original": "", "source": SOURCE})
        self.assertEqual(destination.read_bytes(), b"Someone else's file")

    def test_paths_and_linked_content_rejected(self):
        for path in ("../secrets.md", "turak/../../bad.md", "C:/test.md", "turak/test.html", "a\\b.md"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.service.path(path)

    def test_templates_come_from_documented_examples(self):
        (self.root / "docs").mkdir()
        repository = Path(__file__).resolve().parent.parent
        shutil.copy2(repository / "docs" / "BLOGPOST_TEMPLATES.md", self.root / "docs" / "BLOGPOST_TEMPLATES.md")
        for kind, target in (("trip", "turak/new.md"), ("pdf", "turak/legacy-new.md"),
                             ("course", "tanfolyamok/new.md"), ("course-report", "tanfolyamok/old.md"),
                             ("page", "new.md")):
            document = self.service.template(kind, target)
            self.assertTrue(document["metadata"]["draft"])
        with self.assertRaises(ContentError):
            self.service.template("pdf", "turak/not-legacy.md")

    def test_pdf_upload_collision_validation_and_library(self):
        raw = b"%PDF-1.4\nFixture"
        first = self.service.upload_pdf("report.pdf", "turak/fixture", raw)
        second = self.service.upload_pdf("report.pdf", "turak/fixture", raw)
        self.assertEqual(first["url"], "/pdfs/turak/fixture/report.pdf")
        self.assertEqual(second["url"], "/pdfs/turak/fixture/report-2.pdf")
        self.assertEqual(self.service.asset_path(first["url"]).read_bytes(), raw)
        for filename, folder, data in (("report.txt", "turak", raw), ("report.pdf", "../data", raw),
                                       ("report.pdf", "turak", b"Not a PDF")):
            with self.subTest(filename=filename, folder=folder), self.assertRaises(ContentError):
                self.service.upload_pdf(filename, folder, data)
        assets = self.service.assets("hero")
        self.assertEqual(len(assets["files"]), 2)
        self.assertEqual(assets["folder"], "hero")

    def test_preview_job_and_status_share_snapshot_identifier(self):
        identifier = "a" * 24
        info = {"identifier": identifier, "page": {"warnings": []}}
        with patch.object(self.service, "prepare_preview", return_value=(identifier, info)), \
                patch("site_workbench.threading.Thread"):
            job = self.app.start_content_preview(self.payload(), "http://127.0.0.1:8879")
        self.assertEqual(job["preview_id"], identifier)
        self.assertEqual(self.service.preview["id"], identifier)
        self.assertEqual(self.service.preview["state"], "building")


class DeletionTests(ContentFixture):
    def setUp(self):
        super().setUp()
        self.config.unlink()

    def test_plan_shared_assets_and_selective_deletion(self):
        shared = self.root / "data" / "example.yaml"
        shared.write_text("image: /images/hero/one.webp\n", encoding="utf-8")
        file = self.root / "content" / self.document["path"]
        file.write_text(SOURCE + "\n![Other](/images/hero/two.webp)\n", encoding="utf-8")
        page = self.service.read(self.document["path"])
        plan = self.service.deletion_plan(page["path"], page["revision"])
        one = next(asset for asset in plan["assets"] if asset["url"].endswith("one.webp"))
        two = next(asset for asset in plan["assets"] if asset["url"].endswith("two.webp"))
        self.assertEqual(one["references"], ["data/example.yaml"])
        payload = {"path": page["path"], "revision": page["revision"], "confirm": page["path"]}
        with self.assertRaises(ConflictError):
            self.service.delete({**payload, "assets": [one]})
        result = self.service.delete({**payload, "assets": [two]})
        self.assertEqual(result["assets"], [two["url"]])
        self.assertFalse(file.exists())
        self.assertTrue((self.root / "static" / "images" / "hero" / "one.webp").exists())
        self.assertFalse((self.root / "static" / "images" / "hero" / "two.webp").exists())

    def test_changed_asset_unknown_asset_and_confirmation(self):
        plan = self.service.deletion_plan(self.document["path"], self.document["revision"])
        asset = plan["assets"][0]
        payload = {"path": plan["path"], "revision": plan["revision"], "confirm": plan["path"]}
        with self.assertRaises(ContentError):
            self.service.delete({**payload, "confirm": "wrong"})
        with self.assertRaises(ContentError):
            self.service.delete({**payload, "assets": [{"url": "/images/hero/two.webp"}]})
        (self.root / "static" / "images" / "hero" / "one.webp").write_bytes(b"changed")
        with self.assertRaises(ConflictError):
            self.service.delete({**payload, "assets": [asset]})
        self.assertTrue((self.root / "content" / plan["path"]).exists())

    def test_keep_all_assets(self):
        self.service.delete({"path": self.document["path"], "revision": self.document["revision"],
                             "confirm": self.document["path"], "assets": []})
        self.assertTrue((self.root / "static" / "images" / "hero" / "one.webp").exists())

    def test_delete_failure_rolls_back_page_and_assets(self):
        plan = self.service.deletion_plan(self.document["path"], self.document["revision"])
        asset = plan["assets"][0]
        original_replace = Path.replace

        def fail_asset(path, target):
            if path.name == "one.webp":
                raise OSError("Test failure")
            return original_replace(path, target)

        with patch.object(Path, "replace", fail_asset), self.assertRaises(OSError):
            self.service.delete({"path": plan["path"], "revision": plan["revision"],
                                 "confirm": plan["path"], "assets": [asset]})
        self.assertTrue((self.root / "content" / plan["path"]).is_file())


@unittest.skipUnless(shutil.which("hugo"), "Hugo is required for real unsaved preview tests.")
class PreviewTests(ContentFixture):
    def setUp(self):
        super().setUp()
        (self.root / ".hugo-version").write_text("0.166.0")
        (self.root / "config.toml").write_text('baseURL="https://example.test/"\n[module]\n[[module.mounts]]\nsource="content"\ntarget="content"\n')
        layouts = self.root / "layouts" / "_default"
        layouts.mkdir(parents=True)
        (layouts / "single.html").write_text('<html><head><title>{{ .Title }}</title></head><body>{{ .Content }}</body></html>')
        (layouts / "list.html").write_text("<html>List</html>")
        self.app.job["state"] = "running"

    def test_unsaved_render_actual_slug_and_original_untouched(self):
        page = self.payload(changes={"title": "Unsaved title", "slug": "custom-preview"})
        identifier, info = self.service.prepare_preview(page, "http://127.0.0.1:8879")
        self.service.build_preview(info)
        self.assertEqual(self.service.preview["state"], "ready")
        self.assertEqual(self.service.preview["id"], identifier)
        self.assertEqual(self.service.preview["url"], f"http://127.0.0.1:8879/render/{identifier}/turak/custom-preview/")
        html = self.service.rendered_file(f"/render/{identifier}/turak/custom-preview/").read_text()
        self.assertIn("Unsaved title", html)
        self.assertIn("Original text", html)
        self.assertEqual((self.root / "content" / self.document["path"]).read_bytes(), SOURCE.encode("utf-8"))
        self.assertFalse((self.root / "public").exists())

    def test_failed_shortcode_preview_is_explicit(self):
        _, info = self.service.prepare_preview(self.payload(source=SOURCE + "\n{{< unknown >}}\n"), "http://127.0.0.1:8879")
        self.app.execute_job("content-preview", info)
        self.assertEqual(self.app.job["state"], "failed")
        self.assertEqual(self.service.preview["state"], "failed")
        self.assertEqual(self.service.preview["url"], "")

    def test_duplicate_url_preview_fails_instead_of_rendering_wrong_page(self):
        (self.root / "content" / "turak" / "other.md").write_text(
            patched_source(SOURCE, {"slug": "duplicate"}), encoding="utf-8")
        _, info = self.service.prepare_preview(self.payload(changes={"slug": "duplicate"}), "http://127.0.0.1:8879")
        self.app.execute_job("content-preview", info)
        self.assertEqual(self.service.preview["state"], "failed")
        self.assertIn("same Hugo URL", self.service.preview["error"])


class ContentHTTPTests(HTTPTests):
    def setUp(self):
        super().setUp()
        (self.root / "content" / "turak").mkdir(parents=True)
        (self.root / "content" / "turak" / "fixture.md").write_bytes(SOURCE.encode("utf-8"))

    def test_content_save_read_conflict_and_delete(self):
        headers = {"X-Workbench-Token": self.app.token}
        status, body, _ = self.request("/api/workbench/content/page?path=turak%2Ffixture.md")
        self.assertEqual(status, 200)
        page = json.loads(body)
        payload = {"path": page["path"], "original": page["path"], "revision": page["revision"],
                   "source": page["source"], "changes": {"title": "Changed"}}
        status, body, _ = self.request("/api/workbench/content/save", "POST", json.dumps(payload), headers)
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)["metadata"]["title"], "Changed")
        self.assertEqual(self.request("/api/workbench/content/save", "POST", json.dumps(payload), headers)[0], 409)

    def test_render_origin_is_separate_read_only_and_cannot_reach_editor(self):
        port = self.app.render_server.server_port
        self.assertNotEqual(port, self.server.server_port)
        identifier = "a" * 24
        rendered = self.app.scratch / ("render-" + identifier) / "public"
        rendered.mkdir(parents=True)
        (rendered / "index.html").write_text("<html>Preview</html>")
        self.app.content.renderings[identifier] = rendered
        connection = HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            for route in ("/api/workbench/status", "/api/config", "/workbench/app.js", "/"):
                connection.request("GET", route)
                response = connection.getresponse()
                self.assertEqual(response.status, 404, response.read())
            connection.request("POST", "/api/workbench/content/save", body="{}",
                               headers={"X-Workbench-Token": self.app.token})
            response = connection.getresponse()
            self.assertEqual(response.status, 403, response.read())
            connection.request("GET", f"/render/{identifier}/")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertIn(b"Preview", response.read())
            csp = response.getheader("Content-Security-Policy")
            self.assertIn(f"http://127.0.0.1:{self.server.server_port}", csp)
            self.assertIn("https://fonts.googleapis.com", csp)
        finally:
            connection.close()
        self.assertEqual(self.request(f"/render/{identifier}/")[0], 404)
        self.assertEqual(self.request("/api/workbench/status", headers={"Origin": self.app.render_origin})[0], 403)

    def test_pdf_upload_size_and_route(self):
        headers = {"X-Workbench-Token": self.app.token, "X-Filename": "test.pdf", "X-Folder": "turak/fixture"}
        status, body, _ = self.request("/api/workbench/content/pdf", "POST", b"%PDF-1.4\nFixture", headers)
        self.assertEqual(status, 200, body)
        self.assertEqual(self.request(json.loads(body)["url"])[0], 200)
        self.assertEqual(self.request("/api/workbench/content/pdf", "POST", None,
                                     {**headers, "Content-Length": str(30 * 1024 * 1024 + 1)})[0], 400)


if __name__ == "__main__":
    unittest.main()
