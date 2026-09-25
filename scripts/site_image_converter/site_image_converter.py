"""
Batch-converts arbitrary site photos (hero banners, galleries, features, ...)
into resized, web-ready .webp files - no cropping, aspect ratio preserved.

Companion to membership_image_converter.py, which additionally does square,
face-cropped thumbnails for member portraits. Use this one whenever you just
need a single resized copy of a photo for use somewhere on the site.

Run via run_gui.bat, or `py site_image_converter.py` / `python
site_image_converter.py` for the text-prompt version. Also supports
non-interactive use via command-line flags, e.g.:

    py site_image_converter.py --input ./photos --output ./out --quality 82
"""

import argparse
from pathlib import Path

from PIL import Image, ImageOps

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

# scripts/site_image_converter/ -> repo root -> static/images/hero
DEFAULT_OUTPUT_FOLDER = Path(__file__).resolve().parents[2] / "static" / "images" / "hero"


def ask(prompt, default):
    value = input(f"{prompt} [{default}]: ").strip()
    return value if value else default


def orientation_of(width, height):
    return "portrait" if height > width else "landscape"


def process_image(source_path, output_dir, max_width, max_height, quality, log=print):
    log(f"\nProcessing: {source_path.name}")

    try:
        with Image.open(source_path) as original:
            # Correct orientation from phone/camera EXIF metadata.
            image = ImageOps.exif_transpose(original)

            # WebP works most predictably in RGB.
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGB")

            # Fits inside the bounding box while preserving aspect ratio, no upscale.
            image.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)

            out_path = output_dir / f"{source_path.stem}.webp"
            image.save(out_path, "WEBP", quality=quality, method=6)

            width, height = image.size
            log(f"  Saved: {out_path.name} ({width}x{height}, {orientation_of(width, height)})")
            return out_path, width, height

    except Exception as exc:
        log(f"  ERROR: {exc}")
        return None


def process_folder(
    input_folder,
    output_folder,
    max_width=1600,
    max_height=1600,
    quality=82,
    log=print,
    on_progress=None,
):
    """
    Batch-processes every supported image in input_folder into output_folder.

    on_progress(index, total, filename), if given, is called before each image
    is processed (index is 1-based). Returns (processed, failed, images) where
    images is the sorted list of source files that were attempted.
    """

    input_folder = Path(input_folder).expanduser()
    output_folder = Path(output_folder).expanduser()

    if not input_folder.exists():
        raise FileNotFoundError(f"Input folder does not exist: {input_folder}")

    output_folder.mkdir(parents=True, exist_ok=True)

    images = sorted(
        p
        for p in input_folder.iterdir()
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
    )

    if not images:
        log("No supported images found.")
        return 0, 0, images

    log(f"Found {len(images)} image(s).")

    processed = 0
    failed = 0

    for index, image_path in enumerate(images, start=1):
        if on_progress:
            on_progress(index, len(images), image_path.name)

        result = process_image(image_path, output_folder, max_width, max_height, quality, log=log)
        if result:
            processed += 1
        else:
            failed += 1

    return processed, failed, images


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", help="Input folder with original photos")
    parser.add_argument("--output", help="Output folder for converted .webp files")
    parser.add_argument("--max-width", type=int, default=1600, help="Maximum output width in pixels")
    parser.add_argument("--max-height", type=int, default=1600, help="Maximum output height in pixels")
    parser.add_argument("--quality", type=int, default=82, help="WebP quality (1-100)")
    args = parser.parse_args()

    print()
    print("=" * 60)
    print(" SITE IMAGE WEB OPTIMIZER")
    print("=" * 60)
    print()

    if args.input:
        # Non-interactive: every value comes from flags/defaults, no prompts.
        input_folder = args.input
        output_folder = args.output or str(DEFAULT_OUTPUT_FOLDER)
        max_width = args.max_width
        max_height = args.max_height
        quality = args.quality
    else:
        print("Press ENTER to accept the defaults.")
        print()
        input_folder = ask("Input folder", "./site-images-source")
        output_folder = ask("Output folder", str(DEFAULT_OUTPUT_FOLDER))
        max_width = int(ask("Maximum output width", "1600"))
        max_height = int(ask("Maximum output height", "1600"))
        quality = int(ask("WebP quality (1-100)", "82"))

    if not (1 <= quality <= 100):
        print("WebP quality must be between 1 and 100.")
        return

    print()
    try:
        processed, failed, images = process_folder(
            input_folder,
            output_folder,
            max_width,
            max_height,
            quality,
        )
    except FileNotFoundError as exc:
        print(exc)
        return

    if not images:
        return

    print()
    print("=" * 60)
    print(f"DONE - processed {processed} of {len(images)} image(s)" + (f", {failed} failed" if failed else ""))
    print(f"Output: {Path(output_folder).expanduser().resolve()}")
    print("=" * 60)


if __name__ == "__main__":
    main()
