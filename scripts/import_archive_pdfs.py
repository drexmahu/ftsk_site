"""Review/extract legacy report photos using the same PDF API service and WebP converter."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

from tools.workbench.content_workbench import ContentError, local_asset_urls, patched_source, split_source
from tools.workbench.pdf_import import PDFImportService
from tools.workbench.site_workbench import REPO_ROOT, ToolError, Workbench


def contact_sheet(service: PDFImportService, result: dict, destination: Path) -> None:
    images = result["images"]
    if not images:
        return
    columns = 4
    sheet = Image.new("RGB", (columns * 260, ((len(images) + columns - 1) // columns) * 215), "#10212b")
    draw = ImageDraw.Draw(sheet)
    for index, image in enumerate(images):
        x, y = index % columns * 260, index // columns * 215
        with Image.open(service.preview(result["id"], image["id"])) as original:
            preview = original.copy()
            preview.thumbnail((244, 175))
            sheet.paste(preview, (x + (260 - preview.width) // 2, y + 8 + (175 - preview.height) // 2))
        draw.text((x + 8, y + 188), image["id"], fill="white")
    sheet.save(destination, "JPEG", quality=85)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Export photos and add archive covers/galleries; never replace the story or original PDF.")
    parser.add_argument("--review-dir", type=Path, help="Write private contact sheets and extraction metadata here.")
    parser.add_argument("--report", action="append", help="Limit to specific legacy report stems; repeat for multiple reports.")
    parser.add_argument("--cover", action="append", default=[], metavar="REPORT=IMAGE_ID", help="Choose a reviewed cover image; 'none' keeps the current cover.")
    parser.add_argument("--exclude", action="append", default=[], metavar="REPORT=IMAGE_ID", help="Skip a reviewed duplicate, illustration or unsuitable image.")
    args = parser.parse_args()
    overrides = {}
    for value in args.cover:
        if "=" not in value:
            parser.error("--cover needs REPORT=IMAGE_ID.")
        report, identifier = value.split("=", 1)
        overrides[report] = identifier
    exclusions: dict[str, set[str]] = {}
    for value in args.exclude:
        if "=" not in value:
            parser.error("--exclude needs REPORT=IMAGE_ID.")
        report, identifier = value.split("=", 1)
        exclusions.setdefault(report, set()).add(identifier)
    if args.review_dir:
        args.review_dir.mkdir(parents=True, exist_ok=True)
    app = Workbench(REPO_ROOT)
    failures = []
    try:
        if args.apply:
            app.git.assert_editable()
        reports = sorted((REPO_ROOT / "content" / "turak").glob("legacy-*.md"))
        if args.report:
            missing = set(args.report) - {file.stem for file in reports}
            if missing:
                parser.error(f"Unknown reports: {', '.join(sorted(missing))}")
            reports = [file for file in reports if file.stem in args.report]
        unused = (set(overrides) | set(exclusions)) - {file.stem for file in reports}
        if unused:
            parser.error(f"Image selections refer to reports outside this batch: {', '.join(sorted(unused))}")
        for file in reports:
            relative = file.relative_to(REPO_ROOT / "content").as_posix()
            document = app.content.read(relative)
            urls = [url for url in local_asset_urls(document["source"]) if url.startswith("/pdfs/")]
            if not urls:
                print(f"{file.stem}: no linked PDF; keeping this Markdown-only report.", flush=True)
                continue
            if len(urls) != 1:
                failures.append(f"{file.stem}: expected exactly one linked PDF.")
                continue
            result = None
            try:
                result = app.pdf_import.inspect_asset({"path": relative, "url": urls[0]})
                known = {image["id"] for image in result["images"]}
                if exclusions.get(file.stem, set()) - known:
                    raise ContentError("An excluded image ID is not present in this PDF.")
                images = [image for image in result["images"] if image["id"] not in exclusions.get(file.stem, set())]
                cover = overrides.get(file.stem)
                if cover is None:
                    cover = next((image["id"] for image in images if image["width"] >= 400 and image["width"] > image["height"]),
                                 images[0]["id"] if images else "none")
                if cover != "none" and cover not in {image["id"] for image in images}:
                    raise ContentError(f"Unknown cover image: {cover}")
                if args.review_dir:
                    contact_sheet(app.pdf_import, result, args.review_dir / f"{file.stem}.jpg")
                    (args.review_dir / f"{file.stem}.json").write_text(json.dumps({
                        "path": relative, "images": images, "cover": cover, "warnings": result["warnings"],
                    }, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"{file.stem}: {len(result['pages'])} pages, {len(images)} images, cover={cover}", flush=True)
                if not args.apply or not images:
                    continue
                if "pdf-page-" in document["source"]:
                    raise ContentError("This page already references extracted PDF images. Review it manually rather than importing duplicates.")
                exported = app.pdf_import.export({
                    "id": result["id"], "path": relative, "images": [image["id"] for image in images], "keep_pdf": False})
                changes = {}
                if cover != "none":
                    photo = next(image for image in exported["images"] if image["id"] == cover)
                    for field in ("thumbImg", "featuredImg"):
                        changes[field] = {**document["metadata"].get(field, {}), "image_path": photo["url"]}
                photos = [image for image in exported["images"] if image["id"] != cover]
                source = patched_source(document["source"], changes) if changes else document["source"]
                if photos:
                    snippets = []
                    for image in photos:
                        alt = f'Kép az eredeti beszámoló {image["page"]}. oldaláról'
                        snippets.append('{{< photo src=' + json.dumps(image["url"], ensure_ascii=False)
                                        + ' alt=' + json.dumps(alt, ensure_ascii=False) + ' >}}')
                    _, body, _ = split_source(source)
                    gallery = "\n\n## Képek az eredeti beszámolóból\n\n{{< gallery >}}\n" + "\n".join(snippets) + "\n{{< /gallery >}}\n"
                    source = source[:len(source) - len(body)] + body.rstrip() + gallery
                app.content.save({"path": relative, "original": relative, "revision": document["revision"], "source": source})
                print(f"  Saved {len(exported['images'])} WebP images; original story and PDF kept.", flush=True)
            except (ContentError, ToolError, OSError) as exc:
                failures.append(f"{file.stem}: {exc}")
                print(f"  ERROR: {exc}", flush=True)
            finally:
                if result:
                    app.pdf_import.discard(result["id"])
    finally:
        app.close()
    if failures:
        print("\nNeeds attention:\n" + "\n".join(failures), flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
