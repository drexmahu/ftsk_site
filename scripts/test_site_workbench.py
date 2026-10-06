"""Workbench regressions run against disposable site fixtures, never the checkout."""

import io
import json
import subprocess
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image
import pillow_heif

import site_workbench as workbench


def photo(size=(160, 120), orientation=None):
    image = Image.new("RGB", size, "red")
    for x in range(size[0] // 2, size[0]):
        for y in range(size[1]):
            image.putpixel((x, y), (0, 0, 255))
    output = io.BytesIO()
    exif = Image.Exif()
    if orientation:
        exif[274] = orientation
    image.save(output, "JPEG", quality=100, exif=exif)
    return output.getvalue()


class Fixture(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="ftsk-workbench-test-")
        self.root = Path(self.directory.name)
        subprocess.run(["git", "init", "-b", "fixture", str(self.root)],
                       check=True, capture_output=True)
        (self.root / "data").mkdir()
        (self.root / "data" / "people.yaml").write_text(
            "people: []\ngroups:\n- label: Members\n  members: []\n", encoding="utf-8")
        hero = self.root / "static" / "images" / "hero"
        hero.mkdir(parents=True)
        for name in ("one.webp", "two.webp"):
            Image.new("RGB", (160, 120), "green").save(hero / name)
        self.config = self.root / "data" / "hero_images.yaml"
        self.config.write_text(
            '# Keep this header\nimages:\n- path: "/images/hero/one.webp"\n'
            '  poi: {x: 33, y: 42}\n- path: "/images/hero/two.webp"\n',
            encoding="utf-8",
        )
        self.app = workbench.Workbench(self.root)
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(self.app.close)

    def stage(self, name="test.jpg", **kwargs):
        return self.app.stage(name, photo(**kwargs))


class ImageTests(Fixture):
    def test_heif_primary_image_photo_portrait_and_standalone_exports(self):
        output = io.BytesIO()
        Image.new("RGB", (160, 120), "red").save(
            output, "HEIF", save_all=True,
            append_images=[Image.new("RGB", (80, 120), "blue")], primary_index=1)
        for extension in (".heic", ".HEIF"):
            with self.subTest(extension=extension):
                entry = self.app.stage("phone" + extension, output.getvalue())
                self.assertEqual((entry["width"], entry["height"]), (80, 120))
                with Image.open(self.app.scratch / entry["id"] / "preview.jpg") as preview:
                    self.assertGreater(preview.getpixel((40, 60))[2], 200)
                photo_file = self.app.convert({
                    "id": entry["id"], "folder": "turak/phone", "width": 90, "height": 90,
                })["files"][0]
                self.assertEqual((photo_file["width"], photo_file["height"]), (60, 90))
                portrait = self.app.convert({
                    "id": entry["id"], "folder": "members", "thumb": 64,
                    "crop": [0, 0, 80, 80],
                }, portrait=True)
                self.assertEqual(len(portrait["files"]), 2)
        source = self.root / "phone.heic"
        source.write_bytes(output.getvalue())
        destination = self.root / "standalone"
        destination.mkdir()
        result = workbench.photos.process_image(source, destination, 60, 60, 82, log=lambda _: None)
        self.assertEqual(result[1:], (40, 60))
        self.assertTrue(workbench.portraits.process_image(
            source, destination, 64, 60, 60, 82, log=lambda _: None,
            manual_crop=lambda _path, image: (0, 0, image.width, image.width)))
        with Image.open(destination / "phone_thumb.webp") as thumbnail:
            self.assertEqual(thumbnail.size, (64, 64))
            self.assertGreater(thumbnail.getpixel((32, 32))[2], 200)

    def test_heif_corrupt_and_pixel_limits_remain_protected(self):
        with self.assertRaisesRegex(workbench.ToolError, "Cannot decode image"):
            self.app.stage("broken.heic", b"not a HEIF image")
        output = io.BytesIO()
        Image.new("RGB", (160, 120), "red").save(output, "HEIF")
        with patch.object(workbench, "MAX_PIXELS", 10):
            with self.assertRaisesRegex(workbench.ToolError, "25 million pixels"):
                self.app.stage("large.heif", output.getvalue())
        self.assertEqual(self.app.uploads, {})
        with patch.object(Image, "open", side_effect=EOFError("Truncated HEIF")):
            with self.assertRaisesRegex(workbench.ToolError, "Cannot decode image"):
                self.app.stage("truncated.heic", output.getvalue())

    def test_heif_rotation_and_high_bit_depth(self):
        exif = Image.Exif()
        exif[274] = 6
        source = pillow_heif.from_bytes("RGB", (160, 120), bytes([255, 0, 0]) * 160 * 120)
        source.info["exif"] = exif.tobytes()
        output = io.BytesIO()
        source.save(output)
        entry = self.app.stage("rotated.heic", output.getvalue())
        self.assertEqual((entry["width"], entry["height"]), (120, 160))
        hdr = pillow_heif.from_bytes("RGB;16", (16, 16), bytes([255, 255, 0, 0, 0, 0]) * 16 * 16)
        output = io.BytesIO()
        hdr.save(output, bit_depth=10)
        entry = self.app.stage("high-bit-depth.heif", output.getvalue())
        result = self.app.convert({"id": entry["id"], "folder": "gallery"})["files"][0]
        with Image.open(self.root / "static" / result["url"].lstrip("/")) as image:
            self.assertEqual(image.mode, "RGB")
            self.assertEqual(image.size, (16, 16))
            self.assertGreater(image.getpixel((8, 8))[0], 200)

    def test_exif_orientation_and_preview(self):
        entry = self.stage(orientation=6)
        self.assertEqual((entry["width"], entry["height"]), (120, 160))
        with Image.open(self.app.scratch / entry["id"] / "preview.jpg") as image:
            self.assertEqual(image.size, (120, 160))

    def test_rejects_corrupt_unsupported_oversized_and_full_queue(self):
        with self.assertRaises(workbench.ToolError):
            self.app.stage("test.jpg", b"not an image")
        with self.assertRaises(workbench.ToolError):
            self.app.stage("test.svg", photo())
        with patch.object(workbench, "MAX_UPLOAD", 10):
            with self.assertRaises(workbench.ToolError):
                self.stage()
        with patch.object(workbench, "MAX_PIXELS", 10):
            with self.assertRaises(workbench.ToolError):
                self.stage()
        self.app.uploads = {str(index): {} for index in range(100)}
        with self.assertRaises(workbench.ToolError):
            self.stage()

    def test_conversion_preserves_ratio_and_existing_file(self):
        entry = self.stage("same.jpg")
        payload = {"id": entry["id"], "folder": "turak/trip", "width": 80, "height": 80}
        first = self.app.convert(payload)["files"][0]
        original = (self.root / "static" / first["url"].lstrip("/")).read_bytes()
        second = self.app.convert(payload)["files"][0]
        self.assertEqual((first["width"], first["height"]), (80, 60))
        self.assertEqual(first["url"], "/images/turak/trip/same.webp")
        self.assertEqual(second["url"], "/images/turak/trip/same-2.webp")
        self.assertEqual((self.root / "static" / first["url"].lstrip("/")).read_bytes(), original)
        self.app.remove_upload(entry["id"])
        self.assertFalse((self.app.scratch / entry["id"]).exists())
        with self.assertRaises(workbench.ToolError):
            self.app.upload(entry["id"])

    def test_never_upscales_site_photo(self):
        entry = self.stage()
        file = self.app.convert({"id": entry["id"], "folder": "hero"})["files"][0]
        self.assertEqual((file["width"], file["height"]), (160, 120))

    def test_custom_filename_unicode_destination_and_collision(self):
        entry = self.stage()
        payload = {"id": entry["id"], "folder": "turak/túra/photos", "name": "01-cave"}
        first = self.app.convert(payload)["files"][0]
        second = self.app.convert(payload)["files"][0]
        self.assertEqual(first["url"], "/images/turak/túra/photos/01-cave.webp")
        self.assertEqual(second["url"], "/images/turak/túra/photos/01-cave-2.webp")
        for name in ("../escape", "a/b", "file:stream"):
            with self.subTest(name=name), self.assertRaises(workbench.ToolError):
                self.app.convert({**payload, "name": name})

    def test_portrait_uses_exact_manual_square(self):
        entry = self.stage()
        payload = {"id": entry["id"], "folder": "members", "thumb": 64, "crop": [80, 20, 160, 100]}
        result = self.app.convert(payload, portrait=True)
        self.assertEqual(len(result["files"]), 2)
        thumb = result["files"][0]
        self.assertEqual((thumb["width"], thumb["height"]), (64, 64))
        with Image.open(self.root / "static" / thumb["url"].lstrip("/")) as image:
            r, g, b = image.convert("RGB").getpixel((32, 32))
            self.assertGreater(b, 220)
            self.assertLess(r + g, 30)
        self.assertEqual((result["files"][1]["width"], result["files"][1]["height"]), (160, 120))

    def test_portrait_requires_valid_crop(self):
        entry = self.stage()
        for crop in (None, [0, 0, 100, 80], [-1, 0, 79, 80], [80, 80, 160, 160], [0, 0, 0, 0]):
            with self.subTest(crop=crop), self.assertRaises(workbench.ToolError):
                self.app.convert({"id": entry["id"], "folder": "members", "crop": crop}, portrait=True)
        self.assertFalse(list((self.root / "static" / "images" / "members").glob("*.webp")))

    def test_invalid_settings_and_paths(self):
        entry = self.stage()
        for settings in ({"folder": "../data"}, {"folder": "C:/temp"}, {"width": True},
                         {"height": 0}, {"quality": 101}, {"folder": 4}):
            with self.subTest(settings=settings), self.assertRaises(workbench.ToolError):
                self.app.convert({"id": entry["id"], **settings})
        for path in ("../secret", "/absolute", "file:stream", "hero\\one.webp", "hero//one.webp"):
            with self.subTest(path=path), self.assertRaises(workbench.ToolError):
                workbench.safe_path(self.root, path)

    def test_symlink_is_rejected(self):
        link = self.root / "linked"
        try:
            link.symlink_to(self.root / "data", target_is_directory=True)
        except OSError as error:
            self.skipTest(f"Symlinks unavailable: {error}")
        with self.assertRaises(workbench.ToolError):
            workbench.safe_path(self.root, "linked/hero_images.yaml")

    def test_pair_write_failure_rolls_back(self):
        entry = self.stage()
        original = Path.open

        def fail_full(path, mode="r", *args, **kwargs):
            if mode == "xb" and path.name.endswith("_full.webp"):
                raise OSError("Fixture write failure")
            return original(path, mode, *args, **kwargs)

        with patch.object(Path, "open", fail_full), self.assertRaises(OSError):
            self.app.convert({"id": entry["id"], "folder": "members", "crop": [0, 0, 100, 100]}, portrait=True)
        self.assertFalse(list((self.root / "static" / "images" / "members").glob("*.webp")))


class HeroAndProcessTests(Fixture):
    def test_save_preserves_header_and_poi(self):
        config = self.app.load_hero()
        config["images"][0]["mobile"] = {"focus": "20% 30%", "duration": 9}
        saved = self.app.save_hero(config["images"])
        self.assertEqual(saved["header"], "# Keep this header\n")
        self.assertEqual(saved["images"][0]["poi"], {"x": 33, "y": 42})
        self.assertEqual(saved["images"][0]["mobile"], {"focus": "20% 30%", "duration": 9})

    def test_invalid_config_does_not_mutate_file(self):
        original = self.config.read_bytes()
        for entries in ([], [{"path": "/images/hero/missing.webp"}],
                        [{"path": "/images/hero/one.webp", "poi": {"x": float("nan"), "y": 2}}],
                        [{"path": "/images/hero/one.webp", "start": {"zoom": float("nan")}}],
                        [{"path": "/images/hero/one.webp", "start": []}],
                        [{"path": "/images/hero/one.webp"}] * 2):
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                self.app.save_hero(entries)
            self.assertEqual(self.config.read_bytes(), original)

    def test_remove_keeps_file_and_requires_last_slide(self):
        self.app.delete_hero("/images/hero/one.webp")
        self.assertTrue((self.root / "static" / "images" / "hero" / "one.webp").exists())
        with self.assertRaises(workbench.ToolError):
            self.app.delete_hero("/images/hero/two.webp")
        self.assertEqual(len(self.app.load_hero()["images"]), 1)

    def test_hero_upload_and_failed_conversion_cleanup(self):
        result = self.app.add_hero("new.jpg", photo())
        self.assertEqual(result["new_path"], "/images/hero/new.webp")
        self.assertEqual(len(result["images"]), 3)
        self.assertEqual(self.app.uploads, {})
        with patch.object(self.app, "convert", side_effect=workbench.ToolError("conversion failure")):
            with self.assertRaises(workbench.ToolError):
                self.app.add_hero("failed.jpg", photo())
        self.assertEqual(self.app.uploads, {})

    def test_external_server_is_not_started_or_stopped(self):
        with patch.object(self.app, "preview_status", return_value={"responsive": True, "owned": False}), \
                patch.object(workbench.subprocess, "Popen") as popen:
            self.app.start_preview()
            self.app.stop_preview()
            popen.assert_not_called()

    def test_only_owned_preview_is_stopped(self):
        process = Mock()
        process.poll.return_value = None
        self.app.preview = process
        self.app.stop_preview()
        process.terminate.assert_called_once()
        process.wait.assert_called_once_with(timeout=5)
        self.assertIsNone(self.app.preview)

    def test_job_whitelist_and_explicit_failure(self):
        with self.assertRaises(workbench.ToolError):
            self.app.start_job("deploy")
        with patch.object(self.app, "run_command", side_effect=workbench.ToolError("fixture failure")):
            self.app.execute_job("members")
        self.assertEqual(self.app.job["state"], "failed")
        self.assertIn("fixture failure", self.app.job["log"])


class HTTPTests(Fixture):
    def setUp(self):
        super().setUp()
        self.server = workbench.WorkbenchServer(("127.0.0.1", 0), self.app)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)

    def request(self, path, method="GET", body=None, headers=None):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = (response.status, response.read(), response.getheaders())
        connection.close()
        return result

    def test_index_assets_hero_bridge_and_config(self):
        for path in ("/", "/workbench/app.js", "/workbench/style.css", "/api/config"):
            self.assertEqual(self.request(path)[0], 200, path)
        status, body, headers = self.request("/hero/hero_focus_picker.html")
        self.assertEqual(status, 200)
        self.assertIn(b"/workbench/hero-bridge.js", body)
        self.assertIn("Content-Security-Policy", dict(headers))

    def test_request_guards(self):
        for headers in ({"Host": "evil.example"}, {"Origin": "https://evil.example"},
                        {"Sec-Fetch-Site": "cross-site"}):
            self.assertEqual(self.request("/api/workbench/status", headers=headers)[0], 403)
        self.assertEqual(self.request("/api/workbench/uploads", "POST", photo())[0], 403)
        self.assertEqual(self.request("/api/workbench/uploads", "POST", photo(),
                                      {"X-Workbench-Token": "wrong"})[0], 403)

    def test_upload_convert_and_delete_routes(self):
        token = json.loads(self.request("/api/workbench/status")[1])["token"]
        headers = {"X-Workbench-Token": token, "X-Filename": "route.jpg"}
        status, body, _ = self.request("/api/workbench/uploads", "POST", photo(), headers)
        self.assertEqual(status, 200)
        identifier = json.loads(body)["id"]
        self.assertEqual(self.request(f"/api/workbench/uploads/{identifier}")[0], 200)
        payload = json.dumps({"id": identifier, "folder": "hero"})
        status, body, _ = self.request("/api/workbench/convert", "POST", payload, headers)
        self.assertEqual(status, 200, body)
        url = json.loads(body)["files"][0]["url"]
        self.assertEqual(self.request(url)[0], 200)
        self.assertEqual(self.request(f"/api/workbench/uploads/{identifier}", "DELETE", headers=headers)[0], 200)

    def test_heif_upload_preview_conversion_and_corrupt_response(self):
        output = io.BytesIO()
        Image.new("RGB", (160, 120), "blue").save(output, "HEIF")
        headers = {"X-Workbench-Token": self.app.token, "X-Filename": "phone.heic"}
        status, body, _ = self.request("/api/workbench/uploads", "POST", output.getvalue(), headers)
        self.assertEqual(status, 200, body)
        identifier = json.loads(body)["id"]
        status, body, _ = self.request(f"/api/workbench/uploads/{identifier}")
        self.assertEqual(status, 200)
        with Image.open(io.BytesIO(body)) as preview:
            self.assertEqual(preview.format, "JPEG")
        status, body, _ = self.request("/api/workbench/convert", "POST",
                                      json.dumps({"id": identifier, "folder": "gallery"}), headers)
        self.assertEqual(status, 200, body)
        self.assertTrue(json.loads(body)["files"][0]["url"].endswith(".webp"))
        status, body, _ = self.request("/api/workbench/uploads", "POST", b"broken HEIF", headers)
        self.assertEqual(status, 400)
        self.assertIn("Cannot decode image", json.loads(body)["error"])

    def test_bad_payload_traversal_and_unknown_routes(self):
        headers = {"X-Workbench-Token": self.app.token}
        for body in ("[]", "{broken", "{}"):
            self.assertEqual(self.request("/api/workbench/convert", "POST", body, headers)[0], 400)
        self.assertEqual(self.request("/static/../data/hero_images.yaml")[0], 400)
        self.assertEqual(self.request("/workbench/%2e%2e/site_workbench.py")[0], 400)
        self.assertEqual(self.request("/missing")[0], 404)


if __name__ == "__main__":
    unittest.main()
