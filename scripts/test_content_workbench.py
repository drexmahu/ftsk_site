"""Safe editing, deletion and true Hugo preview regressions."""

import json
import shutil
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

from content_workbench import ContentError, ConflictError, local_asset_urls, remove_asset_reference, parse_frontmatter, patched_source, split_source
from test_site_workbench import Fixture, HTTPTests
from site_workbench import ToolError

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
    def test_page_owned_media_destinations_are_derived_and_cannot_be_overridden(self):
        for relative, expected in (("tanfolyamok/tanfolyam-2022.md", "tanfolyamok/tanfolyam-2022"),
                                   ("turak/trip/index.md", "turak/trip"),
                                   ("tanfolyamok/_index.md", "tanfolyamok"),
                                   ("turak/túra.md", "turak/túra")):
            with self.subTest(relative=relative):
                self.assertEqual(self.service.media_folder(relative), expected)
        for relative in ("", "../hero.md", "turak/../hero.md", "not-a-page.pdf"):
            with self.subTest(relative=relative), self.assertRaises(ContentError):
                self.service.media_folder(relative)
        entry = self.stage()
        result = self.service.convert_page_images({"path": "tanfolyamok/tanfolyam-2022.md", "id": entry["id"]})
        self.assertTrue(result["files"][0]["url"].startswith("/images/tanfolyamok/tanfolyam-2022/"))
        with self.assertRaises(ContentError):
            self.service.convert_page_images({"path": "tanfolyamok/tanfolyam-2022.md", "folder": "hero", "id": entry["id"]})
        with self.assertRaises(ContentError):
            self.service.convert_page_images({"path": "tanfolyamok/tanfolyam-2022.md", "folder": "tanfolyamok/tanfolyam-2022/photos", "id": entry["id"]})
        pdf = self.service.upload_page_pdf("turak/trip/index.md", "report.pdf", b"%PDF-1.4\nFixture")
        self.assertEqual(pdf["url"], "/pdfs/turak/trip/report.pdf")
        with self.assertRaises(ContentError):
            self.service.upload_page_pdf("turak/trip/index.md", "wrong.pdf", b"%PDF-1.4\nFixture", "hero")
        self.assertTrue((self.root / "static" / "images" / "hero" / "one.webp").is_file())

    def test_page_media_includes_links_outside_folder_and_unassigned_files(self):
        (self.root / "static" / "images" / "hero" / "unused.webp").write_bytes(b"fixture")
        pdf = self.service.upload_pdf("report.pdf", "turak/fixture", b"%PDF-1.4\nFixture")["url"]
        source = self.document["source"] + f'\n{{{{< pdf src="{pdf}" >}}}}\n![Gone](/images/missing.webp)\n'
        result = self.service.page_media(source, "hero", "turak/fixture")
        files = {item["url"]: item for item in result["files"]}
        self.assertTrue(files["/images/hero/one.webp"]["linked"])
        self.assertTrue(files["/images/missing.webp"]["missing"])
        self.assertTrue(files[pdf]["linked"])
        self.assertFalse(files["/images/hero/unused.webp"]["linked"])
        self.assertEqual(files["/images/hero/unused.webp"]["references"], [])
        self.assertIn("content/turak/fixture.md", files["/images/hero/one.webp"]["references"])
        self.assertIn("data/hero_images.yaml", files["/images/hero/two.webp"]["references"])
        self.assertEqual(len(files["/images/hero/unused.webp"]["revision"]), 64)

    def test_reference_removal_is_draft_only_and_preserves_other_fields_and_story(self):
        source = ('---\r\ntitle: Course # keep comment\r\n'
                  'featuredImg: {image_path: /images/poster.webp, width: 60}\r\n'
                  'thumbImg: {image_path: /images/other.webp}\r\n'
                  'seo: {featured_image: /images/poster.webp, page_description: Keep}\r\n'
                  'flyer_images:\r\n- image_path: /images/poster.webp\r\n- image_path: /images/other.webp\r\n'
                  'custom: Keep\r\n---\r\n'
                  'Before\r\n{{< image src="/images/poster.webp" alt="Poster" >}}\r\n'
                  '{{< media src="/images/poster.webp" >}}\r\nKeep the story\r\n{{< /media >}}\r\n'
                  '{{< gallery >}}\r\n{{< photo src="/images/poster.webp" >}}\r\n'
                  '{{< photo src="/images/other.webp" >}}\r\n{{< /gallery >}}\r\n'
                  '![Poster](/images/poster.webp "Caption")\r\nAfter\r\n')
        result = remove_asset_reference(source, "/images/poster.webp")
        self.assertFalse(result["remaining"])
        frontmatter, body, newline = split_source(result["source"])
        meta = parse_frontmatter(frontmatter)
        self.assertEqual(meta["featuredImg"], {"width": 60})
        self.assertEqual(meta["seo"], {"page_description": "Keep"})
        self.assertEqual(meta["flyer_images"], [{"image_path": "/images/other.webp"}])
        self.assertEqual(meta["custom"], "Keep")
        self.assertIn("# keep comment", frontmatter)
        self.assertIn("Keep the story", body)
        self.assertIn('{{< photo src="/images/other.webp" >}}', body)
        self.assertIn("Before", body)
        self.assertIn("After", body)
        self.assertEqual(newline, "\r\n")
        self.assertNotIn("\n", result["source"].replace("\r\n", ""))
        self.assertEqual(self.service.read("turak/fixture.md")["source"], self.document["source"])

    def test_reference_removal_keeps_custom_and_code_examples_for_manual_review(self):
        body = ('```markdown\n{{< image src="/images/example.webp" >}}\n```\n'
                '`![example](/images/example.webp)`\n'
                '<img src="/images/example.webp" alt="custom HTML">\n')
        source = "---\ntitle: Example\ncustom: /images/example.webp\n---\n" + body
        result = remove_asset_reference(source, "/images/example.webp")
        self.assertEqual(result["source"], source)
        self.assertEqual(result["removed"], [])
        self.assertTrue(result["remaining"])
        unterminated = "---\ntitle: Example\n---\n```\n![example](/images/example.webp)\n"
        self.assertEqual(remove_asset_reference(unterminated, "/images/example.webp")["source"], unterminated)
        deceptive = '---\ntitle: Example\n---\n{{< image alt="Example src=\'/images/example.webp\'" src="/images/other.webp" >}}\n'
        self.assertEqual(remove_asset_reference(deceptive, "/images/example.webp")["source"], deceptive)

    def test_reference_removal_and_discovery_handle_pdf_and_encoded_urls(self):
        source = ('---\ntitle: PDF\nflyer_images: [{image_path: "/images/a b.webp"}]\n---\n'
                  '[Report](/pdfs/report.pdf#page=2)\n{{< pdf src="/pdfs/report.pdf" title="Report" >}}\n'
                  '![Flyer](/images/a%20b.webp)\n')
        self.assertIn("/pdfs/report.pdf", local_asset_urls(source))
        self.assertIn("/images/a%20b.webp", local_asset_urls(source))
        result = remove_asset_reference(source, "/pdfs/report.pdf")
        self.assertFalse(result["remaining"])
        self.assertNotIn("Report", split_source(result["source"])[1])
        image = remove_asset_reference(result["source"], "/images/a%20b.webp")
        self.assertEqual(parse_frontmatter(split_source(image["source"])[0])["flyer_images"], [])
        self.assertNotIn("![Flyer]", image["source"])

    def test_asset_deletion_blocks_saved_draft_and_stale_references(self):
        file = self.root / "static" / "images" / "hero" / "unused.webp"
        file.write_bytes(b"fixture")
        url = "/images/hero/unused.webp"
        asset = next(item for item in self.service.page_media(self.document["source"], "hero", "")["files"] if item["url"] == url)
        payload = {"url": url, "revision": asset["revision"], "confirm": url, "source": self.document["source"]}
        with self.assertRaises(ContentError):
            self.service.delete_asset({**payload, "confirm": "wrong"})
        with self.assertRaises(ConflictError):
            self.service.delete_asset({**payload, "source": self.document["source"] + f'\n![Draft]({url})\n'})
        shared = self.root / "data" / "shared.yaml"
        shared.write_text(f"image: {url}\n", encoding="utf-8")
        with self.assertRaises(ConflictError):
            self.service.delete_asset(payload)
        shared.unlink()
        file.write_bytes(b"changed")
        with self.assertRaises(ConflictError):
            self.service.delete_asset(payload)
        self.assertTrue(file.is_file())
        refreshed = next(item for item in self.service.page_media(self.document["source"], "hero", "")["files"] if item["url"] == url)
        self.assertEqual(self.service.delete_asset({**payload, "revision": refreshed["revision"]}), {"deleted": url})
        self.assertFalse(file.exists())
        self.assertTrue((self.root / "content" / "turak" / "fixture.md").is_file())
        with self.assertRaises(ConflictError):
            self.service.delete_asset({"url": "/images/hero/two.webp", "confirm": "/images/hero/two.webp",
                                       "revision": "", "source": self.document["source"]})
        for url in ("/images/../data/people.yaml", "/pdfs/../../data/people.yaml", "https://example.test/image.webp"):
            with self.subTest(url=url), self.assertRaises((ContentError, ToolError)):
                self.service.delete_asset({**payload, "url": url, "confirm": url})

    def test_global_contact_assignments_compose_save_and_validate_nested_ids(self):
        import copy
        self.app.members.save({"revision": self.app.members.catalog()["revision"], "original": None,
                               "group": None, "member": {"id": "contact", "name": "Contact", "email": "contact@example.test"}})
        source = "---\ntitle: Contact\ncontent_blocks:\n- _bookshop_name: contact/hero\n  title: Keep hero\n" \
                 "- _bookshop_name: contact/info\n  address: {address: Keep address}\n  contacts: []\n---\nKeep body\n"
        path = self.root / "content" / "kapcsolat.md"
        path.write_text(source, encoding="utf-8")
        document = self.service.read("kapcsolat.md")
        blocks = copy.deepcopy(document["metadata"]["content_blocks"])
        blocks[1]["contacts"] = [{"person": "contact", "role": "organizer"}]
        updated = patched_source(source, {"content_blocks": blocks})
        self.service.save({"path": "kapcsolat.md", "original": "kapcsolat.md",
                           "revision": document["revision"], "source": updated})
        saved = self.service.read("kapcsolat.md")
        self.assertEqual(saved["metadata"]["content_blocks"], blocks)
        self.assertEqual(saved["body"], "Keep body\n")
        self.assertNotIn("contact@example.test", saved["source"])
        blocks[1]["contacts"][0]["person"] = "unknown"
        with self.assertRaises(ContentError):
            self.service.validate("kapcsolat.md", patched_source(updated, {"content_blocks": blocks}))

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

    def test_patching_flow_collections_replaces_closing_delimiters(self):
        source = "---\ntitle: Flow\nparticipant_ids: [alice, bob] # Keep note\nseo: {no_index: false}\n---\nBody\n"
        result = patched_source(source, {"participant_ids": ["bob"], "seo": {"no_index": True}})
        meta = parse_frontmatter(split_source(result)[0])
        self.assertEqual(meta["participant_ids"], ["bob"])
        self.assertEqual(meta["seo"], {"no_index": True})
        self.assertIn("# Keep note", result)
        self.assertEqual(split_source(result)[1], "Body\n")

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
                    "social_image": "/images/hero/two.webp", "social_title": "Share title",
                    "social_description": "Share description",
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

    def test_social_overrides_validation_and_removal_preserve_other_seo(self):
        for field in ("social_title", "social_description", "social_image"):
            with self.subTest(field=field), self.assertRaises(ContentError):
                self.service.validate(self.document["path"], SOURCE, {"seo": {field: ["invalid"]}})
        for path in ("/images/missing.webp", "https://example.test/image.webp", "/pdfs/report.pdf"):
            with self.subTest(path=path), self.assertRaises(ContentError):
                self.service.validate(self.document["path"], SOURCE, {"seo": {"social_image": path}})
        source = ('---\ntitle: Test\nseo:\n  featured_image: /images/hero/one.webp\n'
                  '  social_image: /images/hero/one.webp\n  social_title: Keep title\n'
                  '  social_description: Keep description\n  custom: Keep custom\n---\nBody\n')
        result = remove_asset_reference(source, "/images/hero/one.webp")
        meta = parse_frontmatter(split_source(result["source"])[0])
        self.assertEqual(meta["seo"], {"social_title": "Keep title",
                                     "social_description": "Keep description", "custom": "Keep custom"})

    def test_featured_image_width_validation_and_independent_roundtrip(self):
        for value in (0, 9.99, 100.01, True, "75", [], {}):
            with self.subTest(value=value), self.assertRaisesRegex(ContentError, "featuredImg.width"):
                self.service.validate(self.document["path"], SOURCE, {"featuredImg": {"width": value}})
        for value in (10, 62.5, 100, None):
            with self.subTest(value=value):
                saved = self.service.save(self.payload(changes={
                    "featuredImg": {"image_path": "/images/hero/two.webp", "width": value},
                    "thumbImg": {"image_path": "/images/hero/one.webp"}, "article_image_width": 75,
                    "seo": {"featured_image": "/images/hero/one.webp", "no_index": False}}))
                self.document = self.service.read(saved["path"])
                self.assertEqual(self.document["metadata"]["featuredImg"]["width"], value)
                self.assertEqual(self.document["metadata"]["featuredImg"]["image_path"], "/images/hero/two.webp")
                self.assertEqual(self.document["metadata"]["thumbImg"]["image_path"], "/images/hero/one.webp")
                self.assertEqual(self.document["metadata"]["article_image_width"], 75)
                self.assertEqual(self.document["metadata"]["seo"]["featured_image"], "/images/hero/one.webp")
                self.assertEqual(self.document["body"], split_source(SOURCE)[1])

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
        pdfs = self.service.assets("turak/fixture", "pdfs")
        self.assertEqual([file["url"] for file in pdfs["files"]], [second["url"], first["url"]])
        self.assertIn("turak", self.service.assets("", "pdfs")["folders"])
        for folder, kind in (("../images", "pdfs"), ("", "unknown")):
            with self.subTest(folder=folder, kind=kind), self.assertRaises((ContentError, ToolError)):
                self.service.assets(folder, kind)

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

    def test_page_media_routes_remove_draft_and_delete_unused_file_only(self):
        headers = {"X-Workbench-Token": self.app.token}
        file = self.root / "static" / "images" / "hero" / "unused.webp"
        file.write_bytes(b"fixture")
        url = "/images/hero/unused.webp"
        status, body, _ = self.request("/api/workbench/content/page-media", "POST", json.dumps({
            "source": SOURCE, "folder": "hero", "pdf_folder": ""
        }), headers)
        self.assertEqual(status, 200, body)
        asset = next(item for item in json.loads(body)["files"] if item["url"] == url)
        status, body, _ = self.request("/api/workbench/content/remove-reference", "POST", json.dumps({
            "source": SOURCE, "url": "/images/hero/one.webp"
        }), headers)
        self.assertEqual(status, 200, body)
        self.assertNotIn("![Image]", json.loads(body)["source"])
        self.assertTrue((self.root / "static" / "images" / "hero" / "one.webp").is_file())
        self.assertEqual((self.root / "content" / "turak" / "fixture.md").read_bytes(), SOURCE.encode("utf-8"))
        payload = {"url": url, "confirm": url, "revision": asset["revision"], "source": SOURCE}
        self.assertEqual(self.request("/api/workbench/content/delete-asset", "POST", json.dumps(payload))[0], 403)
        status, body, _ = self.request("/api/workbench/content/delete-asset", "POST", json.dumps(payload), headers)
        self.assertEqual(status, 200, body)
        self.assertFalse(file.exists())
        self.assertTrue((self.root / "content" / "turak" / "fixture.md").is_file())

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
        headers = {"X-Workbench-Token": self.app.token, "X-Filename": "test.pdf", "X-Content-Path": "turak/fixture.md"}
        status, body, _ = self.request("/api/workbench/content/pdf", "POST", b"%PDF-1.4\nFixture", headers)
        self.assertEqual(status, 200, body)
        self.assertEqual(self.request(json.loads(body)["url"])[0], 200)
        status, listing, _ = self.request("/api/workbench/assets?kind=pdfs&folder=turak/fixture")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(listing)["files"][0]["url"], json.loads(body)["url"])
        self.assertEqual(self.request("/api/workbench/assets?kind=unknown")[0], 400)
        self.assertEqual(self.request("/api/workbench/assets?kind=pdfs&folder=../images")[0], 400)
        self.assertEqual(self.request("/api/workbench/content/pdf", "POST", None,
                                     {**headers, "Content-Length": str(30 * 1024 * 1024 + 1)})[0], 400)
        self.assertEqual(self.request("/api/workbench/content/pdf", "POST", b"%PDF-1.4\nFixture",
                                     {**headers, "X-Folder": "hero"})[0], 400)
        self.assertEqual(self.request("/api/workbench/content/pdf", "POST", b"%PDF-1.4\nFixture",
                                     {"X-Workbench-Token": self.app.token})[0], 400)

    def test_page_image_conversion_route_enforces_owned_folder(self):
        entry = self.stage()
        headers = {"X-Workbench-Token": self.app.token}
        payload = {"path": "tanfolyamok/tanfolyam-2022.md", "id": entry["id"]}
        status, body, _ = self.request("/api/workbench/content/convert", "POST", json.dumps(payload), headers)
        self.assertEqual(status, 200, body)
        self.assertTrue(json.loads(body)["files"][0]["url"].startswith("/images/tanfolyamok/tanfolyam-2022/"))
        self.assertEqual(self.request("/api/workbench/content/convert", "POST", json.dumps({**payload, "folder": "hero"}), headers)[0], 400)


if __name__ == "__main__":
    unittest.main()
