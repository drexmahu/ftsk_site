"""Prepared image pixels and reviewed exports, only in disposable checkouts."""

import io
import os
import secrets
import subprocess

from PIL import Image

from test_site_workbench import Fixture, HTTPTests
from tools.workbench.content_workbench import ContentError, ConflictError


class ImageEditorTests(Fixture):
    def setUp(self):
        super().setUp()
        source = io.BytesIO()
        Image.new("RGB", (160, 120), (40, 80, 120)).save(source, "PNG")
        self.entry = self.app.stage("source.png", source.getvalue())
        self.service = self.app.images

    def preview(self, **changes):
        payload = {"id": self.entry["id"], "key": secrets.token_hex(16), "sequence": 1,
                   "context": {"kind": "photos", "folder": "gallery"}, "width": 160,
                   "height": 120, "quality": 100, "name": "test"}
        payload.update(changes)
        return self.service.preview(payload)

    def pixels(self, result):
        image = Image.open(self.service.previews[result["token"]]["file"])
        image.load()
        return image

    def test_unedited_preview_matches_existing_converter_and_saves_exact_bytes(self):
        result = self.preview()
        raw = self.service.previews[result["token"]]["file"].read_bytes()
        self.assertFalse((self.root / "static/images/gallery").exists(), "Preview creates no site folders or files")
        legacy = self.app.convert({"id": self.entry["id"], "folder": "other", "width": 160, "height": 120, "quality": 100})
        self.assertEqual(raw, (self.root / "static" / legacy["files"][0]["url"].lstrip("/")).read_bytes())
        saved = self.service.save({"token": result["token"]})
        destination = self.root / "static" / saved["files"][0]["url"].lstrip("/")
        self.assertEqual(destination.read_bytes(), raw)
        self.assertEqual(self.service.save({"token": result["token"]}), saved, "Retrying a lost response never creates another file")
        self.assertEqual(len(list(destination.parent.glob("*.webp"))), 1)

    def test_rectangle_circle_ellipse_and_resize_have_real_pixel_outputs(self):
        rectangle = self.preview(edit={"crop": [10, 20, 110, 100]}, width=64, height=64)
        self.assertEqual(self.pixels(rectangle).size, (64, 51))
        for shape, box, expected in (("circle", [10, 10, 110, 110], (100, 100)),
                                     ("ellipse", [0, 0, 160, 100], (160, 100))):
            image = self.pixels(self.preview(edit={"crop": box, "shape": shape}))
            self.assertEqual(image.size, expected)
            self.assertEqual(image.convert("RGBA").getpixel((0, 0))[3], 0)
            self.assertEqual(image.convert("RGBA").getpixel((expected[0] // 2, expected[1] // 2))[3], 255)
        small = self.pixels(self.preview(edit={"crop": [0, 0, 80, 80]}, width=6000, height=6000))
        self.assertEqual(small.size, (80, 80), "Resize never enlarges or stretches the crop")

    def test_brightness_colour_contrast_and_warmth_change_the_encoded_pixels(self):
        bright = self.pixels(self.preview(edit={"brightness": 200})).convert("RGB").getpixel((80, 60))
        self.assertGreater(bright[1], 150)
        grey = self.pixels(self.preview(edit={"saturation": 0})).convert("RGB").getpixel((80, 60))
        self.assertLess(max(grey) - min(grey), 4)
        warm = self.pixels(self.preview(edit={"warmth": 100})).convert("RGB").getpixel((80, 60))
        self.assertGreater(warm[0], warm[2])
        # A two-tone source distinguishes contrast changes from uniform brightness.
        source = Image.new("RGB", (160, 120), (40, 40, 40))
        source.paste((180, 180, 180), (80, 0, 160, 120))
        raw = io.BytesIO(); source.save(raw, "PNG")
        self.entry = self.app.stage("contrast.png", raw.getvalue())
        image = self.pixels(self.preview(edit={"contrast": 0})).convert("RGB")
        self.assertLess(abs(image.getpixel((20, 60))[0] - image.getpixel((140, 60))[0]), 3)

    def test_transparent_sources_keep_their_alpha_through_adjustments(self):
        source = Image.new("RGBA", (160, 120), (40, 80, 120, 100))
        source.putpixel((0, 0), (40, 80, 120, 0))
        raw = io.BytesIO()
        source.save(raw, "PNG")
        self.entry = self.app.stage("transparent.png", raw.getvalue())
        image = self.pixels(self.preview(edit={"brightness": 150})).convert("RGBA")
        self.assertEqual(image.getpixel((0, 0))[3], 0)
        self.assertEqual(image.getpixel((80, 60))[3], 100)
        self.assertGreater(image.getpixel((80, 60))[1], 110)

    def test_invalid_crops_controls_and_destinations_are_explicitly_rejected(self):
        for edit in ({"crop": [-1, 0, 100, 100]}, {"crop": [0, 0, 161, 120]},
                     {"shape": "circle", "crop": [0, 0, 160, 120]}, {"brightness": True},
                     {"warmth": 101}, {"shape": "triangle"}):
            with self.subTest(edit=edit), self.assertRaises(ValueError):
                self.preview(edit=edit)
        with self.assertRaises(ValueError):
            self.preview(context={"kind": "photos", "folder": "../outside"})
        with self.assertRaises(ContentError):
            self.preview(context={"kind": "unknown"})

    def test_versions_reserve_distinct_names_and_stale_previews_cannot_replace_newer_recipes(self):
        first, second = self.preview(), self.preview()
        self.assertNotEqual(first["url"], second["url"])
        key = secrets.token_hex(16)
        old = self.preview(key=key)
        new = self.preview(key=key, sequence=2, edit={"brightness": 120})
        self.assertEqual(new["url"], old["url"])
        with self.assertRaises(ConflictError):
            self.preview(key=key, sequence=1)
        with self.assertRaises(ConflictError):
            self.service.save({"token": old["token"]})
        self.assertIn(new["token"], self.service.previews)

    def test_existing_overwrite_requires_approval_and_unchanged_source(self):
        url = "/images/hero/one.webp"
        path = self.root / "static/images/hero/one.webp"
        previous = path.read_bytes()
        self.entry = self.service.open_existing({"url": url})
        result = self.preview(context={"kind": "photos", "folder": "hero"}, mode="overwrite", edit={"brightness": 50})
        with self.assertRaises(ConflictError):
            self.service.save({"token": result["token"]})
        self.assertEqual(path.read_bytes(), previous)
        path.write_bytes(b"external change")
        with self.assertRaises(ConflictError):
            self.service.save({"token": result["token"], "confirm_overwrite": True})
        self.assertEqual(path.read_bytes(), b"external change")
        path.write_bytes(previous)
        raw = self.service.previews[result["token"]]["file"].read_bytes()
        self.service.save({"token": result["token"], "confirm_overwrite": True})
        self.assertEqual(path.read_bytes(), raw)
        self.assertEqual(list(path.parent.glob(".image-*")), [])

    def test_page_owned_destinations_borrowed_images_and_branch_changes_stay_guarded(self):
        (self.root / "content").mkdir()
        context = {"kind": "page", "path": "turak/new-report.md"}
        result = self.preview(context=context)
        self.assertTrue(result["url"].startswith("/images/turak/new-report/"))
        self.app.git.run("switch", "-c", "other")
        with self.assertRaises(ConflictError):
            self.service.save({"token": result["token"]})
        self.entry = self.service.open_existing({"url": "/images/hero/one.webp"})
        with self.assertRaises(ContentError):
            self.preview(context=context, mode="overwrite")

    def test_collision_and_cancel_do_not_overwrite_or_leave_prepared_images(self):
        result = self.preview()
        destination = self.root / "static" / result["url"].lstrip("/")
        destination.parent.mkdir(parents=True)
        destination.write_bytes(b"someone else's file")
        with self.assertRaises(ConflictError):
            self.service.save({"token": result["token"]})
        self.assertEqual(destination.read_bytes(), b"someone else's file")
        self.service.finish({"ids": [self.entry["id"]], "remove": []})
        self.assertEqual(self.service.previews, {})
        self.assertIn(self.entry["id"], self.app.uploads)
        self.service.finish({"ids": [self.entry["id"]], "remove": [self.entry["id"]]})
        self.assertNotIn(self.entry["id"], self.app.uploads)

    def test_cv_exports_are_bound_to_the_selected_person_and_roster_revision(self):
        roster = self.root / "data/people.yaml"
        roster.write_text("people:\n- id: alice\n  name: Alice\ngroups:\n- label: Members\n  members: []\n")
        context = {"kind": "cv", "person": "alice", "revision": self.app.members.catalog()["revision"]}
        result = self.preview(context=context)
        self.assertTrue(result["url"].startswith("/images/members/alice/"))
        roster.write_text(roster.read_text().replace("Alice", "Changed"))
        with self.assertRaises(ConflictError):
            self.service.save({"token": result["token"]})
        self.assertFalse((self.root / "static/images/members/alice").exists())

    def test_linked_static_parent_is_rejected_before_preparing_or_saving_images(self):
        prepared = self.preview()
        static, moved = self.root / "static", self.root / "linked-static-target"
        static.rename(moved)
        if os.name == "nt":
            command = "New-Item -ItemType Junction -Path '{}' -Target '{}' -ErrorAction Stop | Out-Null".format(
                str(static).replace("'", "''"), str(moved).replace("'", "''"))
            subprocess.run(["powershell.exe", "-NoProfile", "-Command", command], check=True, capture_output=True)
            self.addCleanup(static.rmdir)
        else:
            static.symlink_to(moved, target_is_directory=True)
            self.addCleanup(static.unlink)
        with self.assertRaises(ValueError):
            self.preview()
        with self.assertRaises(ValueError):
            self.service.save({"token": prepared["token"]})
        self.assertFalse((moved / "images/gallery").exists())

    def test_overwrite_capability_and_owned_copies_use_server_destination_not_client_folder(self):
        (self.root / "content").mkdir()
        source = self.root / "static/images/hero/one.webp"
        original = source.read_bytes()
        self.entry = self.service.open_existing({"url": "/images/hero/one.webp"})
        page = {"kind": "page", "path": "turak/new-report.md", "folder": "hero"}
        copied = self.preview(context=page)
        self.assertFalse(copied["can_overwrite"])
        self.assertIn("another folder", copied["overwrite_reason"])
        saved = self.service.save({"token": copied["token"]})
        self.assertEqual(source.read_bytes(), original)
        self.assertTrue((self.root / "static/images/turak/new-report/test.webp").is_file())
        self.entry = self.service.open_existing({"url": saved["files"][0]["url"]})
        self.assertTrue(self.preview(context=page)["can_overwrite"])
        self.root.joinpath("data/people.yaml").write_text(
            "people:\n- id: alice\n  name: Alice\n- id: bob\n  name: Bob\ngroups:\n- label: Members\n  members: []\n")
        self.entry = self.service.open_existing({"url": "/images/hero/one.webp"})
        cv = {"kind": "cv", "person": "alice", "revision": self.app.members.catalog()["revision"], "folder": "members/bob"}
        copied = self.preview(context=cv)
        self.assertFalse(copied["can_overwrite"])
        self.service.save({"token": copied["token"]})
        self.assertTrue((self.root / "static/images/members/alice/test.webp").is_file())
        self.assertFalse((self.root / "static/images/members/bob").exists())
        with self.assertRaises(ContentError):
            self.preview(context=cv, mode="overwrite")


class ImageEditorHTTPTests(HTTPTests):
    def test_image_preparation_requires_tokens_and_preview_server_is_isolated(self):
        route = "/api/workbench/images/preview"
        self.assertEqual(self.request(route, "POST", b'{"id":"bad"}')[0], 403)
        self.server.render_only = True
        try:
            self.assertEqual(self.request(route, "POST", b'{"id":"bad"}',
                             {"X-Workbench-Token": self.app.token})[0], 403)
            self.assertEqual(self.request("/api/workbench/images/source/bad")[0], 404)
        finally:
            self.server.render_only = False
