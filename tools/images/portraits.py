from pathlib import Path
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heif", ".heic"}

# tools/images/ -> repo root -> static/images/members
DEFAULT_OUTPUT_FOLDER = Path(__file__).resolve().parents[2] / "static" / "images" / "members"


def make_full_image(image, max_width, max_height):
    """
    Fits image inside bounding box while preserving aspect ratio.
    Does not upscale.
    """

    result = image.copy()

    result.thumbnail(
        (max_width, max_height),
        Image.Resampling.LANCZOS,
    )

    return result


def process_image(
    source_path,
    output_dir,
    thumb_size,
    full_width,
    full_height,
    quality,
    log=print,
    manual_crop=None,
):
    log(f"\nProcessing: {source_path.name}")

    try:
        with Image.open(source_path) as original:
            # Correct orientation from phone/camera EXIF metadata.
            image = ImageOps.exif_transpose(original)

            # WebP works most predictably in RGB.
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGB")

            stem = source_path.stem

            # --------------------------------------------------
            # FULL / MODAL IMAGE
            # --------------------------------------------------

            full = make_full_image(
                image,
                full_width,
                full_height,
            )

            full_path = output_dir / f"{stem}_full.webp"

            # --------------------------------------------------
            # THUMBNAIL
            # --------------------------------------------------

            if manual_crop is not None:
                log("  Waiting for manual face crop")
                box = manual_crop(source_path, image.copy())
                if box is None:
                    log("  Skipped: manual crop was cancelled")
                    return False
                left, top, right, bottom = box
                if not (0 <= left < right <= image.width and 0 <= top < bottom <= image.height and right - left == bottom - top):
                    raise ValueError("Manual crop must be a square inside the source image")
                thumb = image.crop(box)
                log("  Face: manual crop selected")
            else:
                raise ValueError("Manual face selection is required. Choose each crop in the Site Workbench.")

            thumb = thumb.resize(
                (thumb_size, thumb_size),
                Image.Resampling.LANCZOS,
            )

            thumb_path = output_dir / f"{stem}_thumb.webp"

            full.save(full_path, "WEBP", quality=quality, method=6)
            thumb.save(
                thumb_path,
                "WEBP",
                quality=quality,
                method=6,
            )

            log(f"  Full : {full_path.name}")
            log(f"  Thumb: {thumb_path.name}")
            return True

    except Exception as exc:
        log(f"  ERROR: {exc}")
        return False


def process_folder(
    input_folder,
    output_folder,
    thumb_size=400,
    full_width=1400,
    full_height=1400,
    quality=85,
    log=print,
    on_progress=None,
    manual_crop=None,
):
    """
    Batch-processes every supported image in input_folder into output_folder.

    on_progress(index, total, filename), if given, is called before each image
    is processed (index is 1-based). Returns (processed, failed, images) where
    images is the sorted list of source files that were attempted. Skipped
    manual selections count as not processed in failed. manual_crop(path,
    oriented_image), if supplied, returns a square source-pixel box or None
    to skip. A manual selection callback is required; no automatic crop is made.
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

        ok = process_image(
            image_path,
            output_folder,
            thumb_size,
            full_width,
            full_height,
            quality,
            log=log,
            manual_crop=manual_crop,
        )
        if ok:
            processed += 1
        else:
            failed += 1

    return processed, failed, images
