"""PDF imports are temporary, reviewable and use the existing site converter."""

import io
from unittest.mock import patch

from PIL import Image

from test_site_workbench import Fixture
from tools.workbench.content_workbench import ContentError, ConflictError
from tools.workbench.pdf_import import extract_pdf, markdown_text


def sample_pdf(text="A cave expedition report.", strips=False, images=True, duplicate=False, adjacent=False):
    pictures = []
    if images:
        for color in (("red", "blue") if strips or adjacent else ("red",)):
            image = Image.new("RGB", (600, 180 if strips else 360), color)
            buffer = io.BytesIO()
            image.save(buffer, "JPEG")
            pictures.append((image.size, buffer.getvalue()))
    commands = [b"BT /F1 12 Tf 20 740 Td (" + text.encode("ascii").replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)") + b") Tj ET"]
    resources = []
    for index, ((width, height), raw) in enumerate(pictures):
        resources.append(f"/Im{index} {6 + index} 0 R")
        commands.append(f"q 300 0 0 {height / 2} 20 {500 - index * height / 2} cm /Im{index} Do Q".encode())
    if duplicate and pictures:
        commands.append(b"q 299.9 0 0 179.8 20 200 cm /Im0 Do Q")
    stream = b"\n".join(commands)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> /XObject << {' '.join(resources)} >> >> /Contents 5 0 R >>").encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream",
    ]
    for (width, height), raw in pictures:
        objects.append(f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(raw)} >>\nstream\n".encode() + raw + b"\nendstream")
    result = b"%PDF-1.4\n"
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += f"{number} 0 obj\n".encode() + obj + b"\nendobj\n"
    start = len(result)
    result += f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode()
    result += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    return result + f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode()


class PDFImportTests(Fixture):
    def inspect(self, **kwargs):
        return self.app.pdf_import.inspect("turak/archive.md", "report.pdf", sample_pdf(**kwargs))

    def test_inspection_is_temporary_and_exports_webp_to_page_owned_folder(self):
        result = self.inspect()
        self.assertIn("A cave expedition report.", result["markdown"])
        self.assertEqual(len(result["images"]), 1)
        self.assertFalse((self.root / "static" / "images" / "turak").exists())
        self.assertFalse((self.root / "content").exists())
        payload = {"id": result["id"], "path": result["path"], "images": [result["images"][0]["id"]], "width": 300}
        exported = self.app.pdf_import.export(payload)
        image = exported["images"][0]
        self.assertEqual((image["width"], image["height"]), (300, 180))
        self.assertTrue(image["url"].startswith("/images/turak/archive/pdf-page-"))
        with Image.open(self.app.content.asset_path(image["url"])) as converted:
            self.assertEqual(converted.format, "WEBP")
        self.assertEqual(exported["pdf_url"], "/pdfs/turak/archive/report.pdf")
        self.assertIn(image["url"], exported["markdown"])
        self.assertIn("PDF page 1", exported["markdown"])
        self.assertFalse((self.root / "content").exists(), "Import never saves/publishes a Markdown page")
        self.assertEqual(self.app.pdf_import.export(payload), exported, "A retried export must not duplicate files")
        self.assertEqual(self.app.uploads, {})
        self.app.pdf_import.discard(result["id"])
        self.assertTrue(self.app.content.asset_path(image["url"]).is_file(), "Discard only removes temporary extraction")

    def test_photo_strips_are_joined_in_visible_page_order(self):
        result = self.inspect(strips=True)
        self.assertEqual(len(result["images"]), 1)
        image = result["images"][0]
        self.assertEqual(image["parts"], 2)
        self.assertEqual((image["width"], image["height"]), (600, 360))
        with Image.open(self.app.pdf_import.preview(result["id"], image["id"])) as preview:
            self.assertGreater(preview.getpixel((200, 30))[0], 200)
            self.assertGreater(preview.getpixel((200, 300))[2], 200)

    def reviewed_photos(self, folder="turak/archive"):
        destination = self.root / "static" / "images" / folder
        destination.mkdir(parents=True, exist_ok=True)
        files = []
        for name, size in (("original.webp", (240, 180)), ("cropped.webp", (120, 120))):
            Image.new("RGB", size, "green").save(destination / name, "WEBP")
            files.append(f"/images/{folder}/{name}")
        return files

    def test_reviewed_variants_are_inserted_without_reconversion_or_duplicate_exports(self):
        result = self.inspect()
        files = self.reviewed_photos()
        identifier = result["images"][0]["id"]
        payload = {"id": result["id"], "path": result["path"], "images": [identifier],
                   "image_files": {identifier: files}, "keep_pdf": False}
        with patch.object(self.app, "convert", side_effect=AssertionError("Must not reconvert reviewed photos")):
            exported = self.app.pdf_import.export(payload)
            self.assertEqual(self.app.pdf_import.export(payload), exported)
        self.assertEqual([file["url"] for file in exported["images"]], files)
        self.assertEqual([(file["width"], file["height"]) for file in exported["images"]], [(240, 180), (120, 120)])
        self.assertTrue(all(file["id"] == identifier for file in exported["images"]))
        for url in files:
            self.assertEqual(exported["markdown"].count(url), 1)
        with self.assertRaises(ConflictError):
            self.app.pdf_import.export({**payload, "image_files": {identifier: files[:1]}})

    def test_reviewed_files_require_matching_sources_valid_webp_and_exact_owned_folder(self):
        result = self.inspect()
        identifier = result["images"][0]["id"]
        owned = self.reviewed_photos()
        elsewhere = self.reviewed_photos("turak/archive/nested")
        malformed = self.root / "static" / "images" / "turak" / "archive" / "bad.webp"
        malformed.write_bytes(b"not an image")
        wrong_type = malformed.with_suffix(".png")
        Image.new("RGB", (120, 120), "red").save(wrong_type, "PNG")
        payload = {"id": result["id"], "path": result["path"], "images": [identifier], "keep_pdf": False}
        for mapping in ({}, {"missing": owned}, {identifier: []}, {identifier: owned * 2},
                        {identifier: elsewhere}, {identifier: ["/images/turak/archive/bad.webp"]},
                        {identifier: ["/images/turak/archive/bad.png"]}, {identifier: [{}]}):
            with self.subTest(mapping=mapping), self.assertRaises(ValueError):
                self.app.pdf_import.export({**payload, "image_files": mapping})
        self.assertTrue(all(self.app.content.asset_path(url).is_file() for url in owned + elsewhere))

    def test_pdf_export_failure_keeps_already_reviewed_images_for_retry(self):
        result = self.inspect()
        files = self.reviewed_photos()
        identifier = result["images"][0]["id"]
        payload = {"id": result["id"], "path": result["path"], "images": [identifier],
                   "image_files": {identifier: files}}
        with patch.object(self.app.content, "upload_page_pdf", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(OSError, "disk full"):
                self.app.pdf_import.export(payload)
        self.assertTrue(all(self.app.content.asset_path(url).is_file() for url in files))
        self.assertEqual(len(self.app.pdf_import.export(payload)["images"]), 2)

    def test_repeated_photo_resources_are_deduplicated_without_black_render_bands(self):
        result = self.inspect(duplicate=True)
        self.assertEqual(len(result["images"]), 1)
        with Image.open(self.app.pdf_import.preview(result["id"], result["images"][0]["id"])) as preview:
            self.assertGreater(preview.getpixel((300, preview.height - 1))[0], 200)

    def test_adjacent_complete_photographs_are_not_joined(self):
        result = self.inspect(adjacent=True)
        self.assertEqual(len(result["images"]), 2)
        self.assertTrue(all(image["parts"] == 1 for image in result["images"]))

    def test_export_retry_reports_removed_assets_and_invalid_session_ids(self):
        result = self.inspect()
        payload = {"id": result["id"], "path": result["path"], "images": [result["images"][0]["id"]]}
        exported = self.app.pdf_import.export(payload)
        self.app.content.asset_path(exported["images"][0]["url"]).unlink()
        with self.assertRaisesRegex(ConflictError, "removed"):
            self.app.pdf_import.export(payload)
        with self.assertRaises(ContentError):
            self.app.pdf_import.export({"id": []})

    def test_text_only_and_scanned_pages_have_explicit_warnings(self):
        result = self.inspect(images=False)
        self.assertEqual(result["images"], [])
        self.assertTrue(any("No usable embedded" in message for message in result["warnings"]))
        scanned = self.inspect(text="")
        self.assertTrue(any("OCR" in message for message in scanned["warnings"]))
        exported = self.app.pdf_import.export({"id": result["id"], "path": result["path"], "images": [], "keep_pdf": False})
        self.assertIn("cave expedition", exported["markdown"])
        self.assertEqual(exported["pdf_url"], "")
        self.assertFalse((self.root / "static" / "pdfs").exists())

    def test_invalid_pdf_paths_selections_and_stale_destination_are_rejected(self):
        for raw in (b"not pdf", b"%PDF-1.4\ntruncated"):
            with self.subTest(raw=raw), self.assertRaises(ContentError):
                self.app.pdf_import.inspect("turak/archive.md", "report.pdf", raw)
        self.assertEqual(list(self.app.scratch.glob("pdf-*")), [])
        with self.assertRaises(ContentError):
            self.app.pdf_import.inspect("../bad.md", "report.pdf", sample_pdf())
        for url in ("https://example.test/a.pdf", "/images/hero/one.webp", "/pdfs/../private.pdf"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.app.pdf_import.inspect_asset({"path": "turak/archive.md", "url": url})
        result = self.inspect()
        payload = {"id": result["id"], "path": result["path"]}
        for selected in ("not-list", ["missing"], [result["images"][0]["id"]] * 2, [{}]):
            with self.subTest(selected=selected), self.assertRaises(ContentError):
                self.app.pdf_import.export({**payload, "images": selected})
        with self.assertRaises(ConflictError):
            self.app.pdf_import.export({**payload, "path": "turak/elsewhere.md"})
        with patch.object(self.app.git, "snapshot", return_value={"branch": "another"}), self.assertRaises(ConflictError):
            self.app.pdf_import.export(payload)
        with self.assertRaises(ContentError):
            self.app.pdf_import.preview(result["id"], "../original")

    def test_export_failure_rolls_back_new_files_without_touching_existing_files(self):
        result = self.inspect()
        folder = self.root / "static" / "images" / "turak" / "archive"
        folder.mkdir(parents=True)
        existing = folder / "pdf-page-001-image-01.webp"
        existing.write_bytes(b"keep")
        with patch.object(self.app.content, "upload_page_pdf", side_effect=OSError("disk full")), self.assertRaisesRegex(OSError, "disk full"):
            self.app.pdf_import.export({"id": result["id"], "path": result["path"], "images": [result["images"][0]["id"]]})
        self.assertEqual(existing.read_bytes(), b"keep")
        self.assertEqual(list(folder.iterdir()), [existing])
        self.assertEqual(self.app.uploads, {})

    def test_text_preserves_hungarian_but_cannot_inject_html_or_shortcodes(self):
        result = markdown_text('Árvíztűrő tükörfúrógép\r\n<script>bad</script>\n{{< unsafe >}}\x00')
        self.assertIn("Árvíztűrő tükörfúrógép", result)
        self.assertNotIn("<script>", result)
        self.assertNotIn("{{", result)
        self.assertNotIn("\x00", result)
        with patch("tools.workbench.pdf_import.MAX_PAGES", 0), self.assertRaises(ContentError):
            extract_pdf(sample_pdf(), self.app.scratch)

    def test_existing_pdf_is_borrowed_not_copied_or_overwritten(self):
        original = self.app.content.upload_pdf("report.pdf", "shared", sample_pdf())
        result = self.app.pdf_import.inspect_asset({"path": "turak/archive.md", "url": original["url"]})
        exported = self.app.pdf_import.export({"id": result["id"], "path": result["path"], "images": []})
        self.assertEqual(exported["pdf_url"], original["url"])
        self.assertEqual(list((self.root / "static" / "pdfs").rglob("*.pdf")), [self.app.content.asset_path(original["url"])])
