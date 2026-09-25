from pathlib import Path
from PIL import Image, ImageOps
import cv2
import numpy as np


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

# scripts/membership_image_converter/ -> repo root -> static/images/members
DEFAULT_OUTPUT_FOLDER = Path(__file__).resolve().parents[2] / "static" / "images" / "members"


def ask(prompt, default):
    value = input(f"{prompt} [{default}]: ").strip()
    return value if value else default


def check_opencv():
    """
    Raises a clear, actionable error if cv2.CascadeClassifier is unavailable.
    This can happen either because multiple opencv-*-python packages were
    installed at once (corrupting the shared cv2 namespace), or because
    OpenCV 5.0+ removed CascadeClassifier and the bundled haarcascade_*.xml
    files in favor of the DNN-based FaceDetectorYN.
    """

    if not hasattr(cv2, "CascadeClassifier"):
        raise RuntimeError(
            "OpenCV is installed but broken (cv2.CascadeClassifier is missing).\n"
            f"Detected opencv-python version: {cv2.__version__}\n"
            "OpenCV 5.0 removed CascadeClassifier and no longer ships the\n"
            "haarcascade_*.xml files this tool relies on. Re-run\n"
            "install_dependencies.bat (it now installs a pinned opencv-python<5)."
        )


def detect_largest_face(image):
    """
    Returns (x, y, w, h) of the largest detected face,
    or None if no face was found.
    """

    rgb = np.array(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    detector = cv2.CascadeClassifier(cascade_path)

    faces = detector.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(40, 40),
    )

    if len(faces) == 0:
        return None

    return max(faces, key=lambda f: f[2] * f[3])


def clamp(value, minimum, maximum):
    return max(minimum, min(value, maximum))


def make_face_crop(image, face, face_fraction=0.50):
    """
    Creates a square crop around the detected face.

    face_fraction:
        Approximate fraction of the resulting image occupied
        by the face width.

        0.40 = wider portrait
        0.50 = normal portrait
        0.60 = tighter portrait
    """

    img_w, img_h = image.size

    if face is None:
        # Fallback: center square crop
        side = min(img_w, img_h)
        left = (img_w - side) // 2
        top = (img_h - side) // 2
        return image.crop((left, top, left + side, top + side))

    x, y, w, h = face

    # Calculate desired square size based on face size.
    side = int(max(w, h) / face_fraction)

    # Never request a crop larger than the actual image.
    side = min(side, img_w, img_h)

    face_center_x = x + w / 2

    # Shift crop slightly downward relative to the face,
    # which puts the head slightly above center and leaves
    # more room for shoulders.
    crop_center_y = y + h / 2 + h * 0.20

    left = int(face_center_x - side / 2)
    top = int(crop_center_y - side / 2)

    left = clamp(left, 0, img_w - side)
    top = clamp(top, 0, img_h - side)

    return image.crop(
        (
            left,
            top,
            left + side,
            top + side,
        )
    )


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
    face_fraction,
    log=print,
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

            full.save(
                full_path,
                "WEBP",
                quality=quality,
                method=6,
            )

            # --------------------------------------------------
            # THUMBNAIL
            # --------------------------------------------------

            face = detect_largest_face(image)

            if face is None:
                log("  Face: not detected -> center crop")
            else:
                log("  Face: detected")

            thumb = make_face_crop(
                image,
                face,
                face_fraction,
            )

            thumb = thumb.resize(
                (thumb_size, thumb_size),
                Image.Resampling.LANCZOS,
            )

            thumb_path = output_dir / f"{stem}_thumb.webp"

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
    face_fraction=0.50,
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

    check_opencv()

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
            face_fraction,
            log=log,
        )
        if ok:
            processed += 1
        else:
            failed += 1

    return processed, failed, images


def main():
    print()
    print("=" * 60)
    print(" MEMBER IMAGE WEB OPTIMIZER")
    print("=" * 60)
    print()
    print("Press ENTER to accept the defaults.")
    print()

    input_folder = ask("Input folder", "./members-source")
    output_folder = ask("Output folder", str(DEFAULT_OUTPUT_FOLDER))
    thumb_size = int(ask("Thumbnail size in pixels", "400"))
    full_width = int(ask("Maximum full-image width", "1400"))
    full_height = int(ask("Maximum full-image height", "1400"))
    quality = int(ask("WebP quality (1-100)", "85"))
    face_fraction = float(ask("Face size in thumbnail (0.40 wide / 0.60 close)", "0.50"))

    print()
    try:
        processed, failed, images = process_folder(
            input_folder,
            output_folder,
            thumb_size,
            full_width,
            full_height,
            quality,
            face_fraction,
        )
    except (FileNotFoundError, RuntimeError) as exc:
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