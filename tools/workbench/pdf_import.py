"""Local PDF extraction and reviewed, page-owned image exports."""

import copy
import hashlib
import html
import json
import math
import re
import secrets
import shutil
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image
from tools.workbench.content_workbench import ContentError, ConflictError, MAX_SOURCE

MAX_PDF_BYTES = 64 * 1024 * 1024
MAX_PAGES = 200
MAX_IMAGES = 200
MAX_PIXELS = 25_000_000


def markdown_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00ad", "")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    # Imported text is not trusted HTML or executable Hugo shortcode source.
    return html.escape(text, quote=False).replace("{{", "&#123;&#123;").strip()


def image_regions(page) -> list[dict]:
    """Join adjacent, equal-width PDF image strips before rendering their region."""
    regions = []
    for obj in page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE], max_depth=10):
        meta = obj.get_metadata()
        bounds = obj.get_bounds()
        if meta.width * meta.height > MAX_PIXELS:
            raise ContentError("A PDF image exceeds 25 million pixels. Resize the source PDF first.")
        if not all(math.isfinite(value) for value in bounds):
            raise ContentError("PDF image has invalid coordinates.")
        left, bottom, right, top = bounds
        if right <= left or top <= bottom:
            continue
        regions.append({"bounds": bounds, "width": meta.width, "height": meta.height,
                        "object": obj, "parts": 1, "strip": meta.width > meta.height * 2,
                        "density": min(meta.width / (right - left), meta.height / (top - bottom))})
        if len(regions) > MAX_IMAGES:
            raise ContentError(f"A PDF page has more than {MAX_IMAGES} image objects.")
    regions.sort(key=lambda item: (-item["bounds"][3], item["bounds"][0]))
    merged = []
    for region in regions:
        left, bottom, right, top = region["bounds"]
        previous = next((item for item in reversed(merged)
                         if abs(item["bounds"][0] - left) < 0.5
                         and abs(item["bounds"][2] - right) < 0.5
                         and abs(item["bounds"][1] - top) < 0.5
                         and item["strip"] and region["strip"]
                         and abs(item["width"] - region["width"]) <= 1), None)
        if previous and not page.get_rotation():
            previous["bounds"] = (left, bottom, right, previous["bounds"][3])
            previous["height"] += region["height"]
            previous["parts"] += 1
            previous["density"] = min(previous["density"], region["density"])
        else:
            merged.append(region)
    return merged


def extract_pdf(raw: bytes, destination: Path) -> dict:
    if not raw or len(raw) > MAX_PDF_BYTES or not raw.startswith(b"%PDF-"):
        raise ContentError("Choose a valid, non-empty PDF up to 64 MiB.")
    pages, images, warnings = [], [], []
    hashes: dict[str, str] = {}
    total_text = 0
    total_bytes = 0
    try:
        with pdfium.PdfDocument(raw) as document:
            if not 1 <= len(document) <= MAX_PAGES:
                raise ContentError(f"PDF imports support 1–{MAX_PAGES} pages.")
            for index in range(len(document)):
                page = document[index]
                try:
                    textpage = page.get_textpage()
                    try:
                        text = markdown_text(textpage.get_text_bounded())
                    finally:
                        textpage.close()
                    total_text += len(text.encode("utf-8"))
                    if total_text > MAX_SOURCE // 2:
                        raise ContentError("Extracted text exceeds 1 MiB. Split the PDF into smaller documents.")
                    page_number = index + 1
                    if not text:
                        warnings.append(f"Page {page_number}: no embedded text. Scanned text needs OCR/manual transcription; OCR is not performed.")
                    page_images = []
                    width, height = page.get_size()
                    for image_number, region in enumerate(image_regions(page), 1):
                        left, bottom, right, top = region["bounds"]
                        left, bottom, right, top = max(0, left), max(0, bottom), min(width, right), min(height, top)
                        if right <= left or top <= bottom:
                            warnings.append(f"Page {page_number}, image {image_number}: outside the visible page; skipped.")
                            continue
                        if page.get_rotation() and region["parts"] > 1:
                            warnings.append(f"Page {page_number}: rotated page image regions need manual review.")
                            raise ContentError(f"Page {page_number} is rotated. Normalize page rotation before importing images.")
                        if region["parts"] == 1:
                            bitmap = region["object"].get_bitmap(render=False)
                        else:
                            scale = min(4, region["density"], 1600 / (right - left), 1600 / (top - bottom))
                            if scale <= 0 or width * height * scale * scale > MAX_PIXELS:
                                raise ContentError(f"Page {page_number}: rendering exceeds the 25 million pixel limit.")
                            bitmap = page.render(scale=scale, crop=(left, bottom, width - right, height - top))
                        try:
                            if bitmap.width * bitmap.height > MAX_PIXELS:
                                raise ContentError(f"Page {page_number}: extracted image exceeds 25 million pixels.")
                            image = bitmap.to_pil().convert("RGB")
                        finally:
                            # RGB conversion copies the pixels, so no PIL view survives buffer release.
                            bitmap.warn_on_close = False
                            bitmap.close()
                        image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                        # Ignore tiny decorations, not photographs or full-page scans.
                        if min(image.size) < 64:
                            warnings.append(f"Page {page_number}, image {image_number}: tiny decoration ({image.width}×{image.height}); skipped.")
                            continue
                        digest = hashlib.sha256(image.tobytes() + str(image.size).encode()).hexdigest()
                        if digest in hashes:
                            page_images.append(hashes[digest])
                            continue
                        if len(images) >= MAX_IMAGES:
                            raise ContentError(f"PDF imports support at most {MAX_IMAGES} distinct images.")
                        identifier = f"page-{page_number:03d}-image-{image_number:02d}"
                        image.save(destination / f"{identifier}.png", "PNG")
                        total_bytes += (destination / f"{identifier}.png").stat().st_size
                        if total_bytes > 120 * 1024 * 1024:
                            raise ContentError("Extracted images exceed 120 MiB. Split the PDF into smaller documents.")
                        hashes[digest] = identifier
                        page_images.append(identifier)
                        images.append({"id": identifier, "page": page_number, "number": image_number,
                                       "width": image.width, "height": image.height, "parts": region["parts"]})
                    pages.append({"number": page_number, "text": text, "images": page_images})
                finally:
                    page.close()
    except pdfium.PdfiumError as exc:
        raise ContentError(f"Cannot read PDF: {exc} It may be damaged, truncated or password-protected.") from exc
    if not images:
        warnings.append("No usable embedded photographs were found. No thumbnail can be extracted from this PDF.")
    warnings.append("Review reading order, headings, tables, page numbers, captions and image descriptions before saving. Text is extracted, not rewritten.")
    return {"pages": pages, "images": images, "warnings": warnings, "characters": total_text}


def compose_markdown(pages: list[dict], files: dict[str, dict]) -> str:
    sections = []
    for page in pages:
        content = [f'<!-- PDF page {page["number"]} -->', page["text"]]
        for identifier in dict.fromkeys(page["images"]):
            if identifier in files:
                file = files[identifier]
                alt = f'PDF: {page["number"]}. oldal, {file["number"]}. kép'
                content.append('{{< image src=' + json.dumps(file["url"], ensure_ascii=False)
                               + ' alt=' + json.dumps(alt, ensure_ascii=False) + ' >}}')
        sections.append("\n\n".join(item for item in content if item))
    return "\n\n".join(sections) + "\n"


class PDFImportService:
    def __init__(self, app) -> None:
        self.app = app
        self.sessions: dict[str, dict] = {}

    def inspect(self, relative: str, filename: str, raw: bytes, url: str = "") -> dict:
        folder = self.app.content.media_folder(relative)
        if not isinstance(filename, str) or Path(filename).suffix.lower() != ".pdf":
            raise ContentError("Choose a PDF filename.")
        if len(self.sessions) >= 5:
            raise ContentError("Five PDF imports are already staged. Discard one before importing another.")
        branch = self.app.git.snapshot()["branch"]
        identifier = secrets.token_hex(12)
        destination = self.app.scratch / f"pdf-{identifier}"
        destination.mkdir()
        try:
            result = extract_pdf(raw, destination)
            (destination / "original.pdf").write_bytes(raw)
        except (ContentError, OSError, ValueError):
            shutil.rmtree(destination)
            raise
        session = {**result, "id": identifier, "path": relative, "folder": folder,
                   "filename": Path(filename).name, "pdf_url": url,
                   "branch": branch, "exported": None}
        self.sessions[identifier] = session
        return {key: copy.deepcopy(value) for key, value in session.items() if key not in ("branch", "exported")} | {
            "markdown": compose_markdown(result["pages"], {}),
            "images": [{**image, "preview": f'/api/workbench/content/pdf-import/{identifier}/{image["id"]}.png'}
                       for image in result["images"]],
        }

    def inspect_asset(self, payload: dict) -> dict:
        url = payload.get("url", "")
        if not isinstance(url, str) or not url.startswith("/pdfs/"):
            raise ContentError("Choose an existing local /pdfs/... PDF, not an external URL.")
        file = self.app.content.asset_path(url)
        if file.suffix.lower() != ".pdf":
            raise ContentError("Choose a PDF file.")
        if file.stat().st_size > MAX_PDF_BYTES:
            raise ContentError("Choose a PDF up to 64 MiB.")
        return self.inspect(payload.get("path", ""), file.name, file.read_bytes(), url)

    def session(self, identifier: str) -> dict:
        if not isinstance(identifier, str) or identifier not in self.sessions:
            raise ContentError("PDF import expired or was discarded. Extract the PDF again.")
        return self.sessions[identifier]

    def preview(self, identifier: str, image_id: str) -> Path:
        session = self.session(identifier)
        if image_id not in {image["id"] for image in session["images"]}:
            raise ContentError("Unknown PDF image preview.")
        return self.app.scratch / f"pdf-{identifier}" / f"{image_id}.png"

    def discard(self, identifier: str) -> dict:
        self.session(identifier)
        shutil.rmtree(self.app.scratch / f"pdf-{identifier}")
        del self.sessions[identifier]
        return {"discarded": identifier}

    def export(self, payload: dict) -> dict:
        from tools.workbench.site_workbench import ToolError, integer

        session = self.session(payload.get("id", ""))
        if payload.get("path") != session["path"] or self.app.git.snapshot()["branch"] != session["branch"]:
            raise ConflictError("The page path or branch changed. Extract the PDF again for the current destination.")
        selected = payload.get("images", [])
        known = {image["id"]: image for image in session["images"]}
        if (not isinstance(selected, list) or any(not isinstance(item, str) or item not in known for item in selected)
                or len(selected) != len(set(selected))):
            raise ContentError("Choose distinct image IDs from this PDF extraction.")
        keep_pdf = payload.get("keep_pdf", True)
        if not isinstance(keep_pdf, bool):
            raise ContentError("keep_pdf must be true or false.")
        settings = {key: integer(payload.get(key, default), label, low, high)
                    for key, default, label, low, high in (
                        ("width", 1600, "Maximum width", 64, 6000),
                        ("height", 1600, "Maximum height", 64, 6000),
                        ("quality", 82, "Quality", 1, 100))}
        request = {"images": selected, "keep_pdf": keep_pdf, **settings}
        if session["exported"]:
            if session["exported"]["request"] != request:
                raise ConflictError("This extraction was already exported with different settings. Extract again to change the selection.")
            exported = session["exported"]["result"]
            urls = [image["url"] for image in exported["images"]]
            if exported["pdf_url"]:
                urls.append(exported["pdf_url"])
            try:
                for url in urls:
                    self.app.content.asset_path(url)
            except ContentError as exc:
                raise ConflictError("An exported file was removed. Extract the PDF again instead of retrying this export.") from exc
            return copy.deepcopy(session["exported"]["result"])
        written, converted = [], {}
        pdf_url = session["pdf_url"]
        try:
            for image_id in selected:
                raw = self.preview(session["id"], image_id).read_bytes()
                entry = self.app.stage(image_id + ".png", raw)
                try:
                    result = self.app.content.convert_page_images({
                        "path": session["path"], "id": entry["id"], "name": "pdf-" + image_id, **settings})
                    file = result["files"][0]
                    written.append(self.app.content.asset_path(file["url"]))
                    converted[image_id] = {**known[image_id], **file}
                finally:
                    self.app.remove_upload(entry["id"])
            if keep_pdf and not pdf_url:
                result = self.app.content.upload_page_pdf(
                    session["path"], session["filename"], (self.app.scratch / f'pdf-{session["id"]}' / "original.pdf").read_bytes())
                pdf_url = result["url"]
                written.append(self.app.content.asset_path(pdf_url))
            markdown = compose_markdown(session["pages"], converted)
            if keep_pdf and pdf_url:
                markdown += '\n{{< pdf src=' + json.dumps(pdf_url, ensure_ascii=False) + ' title="Eredeti PDF beszámoló" >}}\n'
            result = {"markdown": markdown, "images": list(converted.values()), "pdf_url": pdf_url,
                      "warnings": session["warnings"], "folder": session["folder"]}
        except (ContentError, ToolError, OSError, ValueError):
            for file in reversed(written):
                file.unlink(missing_ok=True)
            raise
        session["exported"] = {"request": request, "result": copy.deepcopy(result)}
        return result
