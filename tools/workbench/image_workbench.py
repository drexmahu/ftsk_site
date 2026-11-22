"""Reviewed WebP previews: the exact prepared bytes become the saved output."""

import io
import re
import secrets
import tempfile
from pathlib import Path
from urllib.parse import quote

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageOps

from tools.workbench.content_workbench import ContentError, ConflictError, revision
from tools.workbench.people_registry import member_image_folder, person_index


def output_stem(default, name):
    stem = name or default
    if isinstance(stem, str) and re.fullmatch(r"[\w-]+\.(?i:jpg|jpeg|png|webp|heif|heic)", stem):
        stem = stem.rsplit(".", 1)[0]
    if not isinstance(stem, str) or not re.fullmatch(r"[\w-]+", stem):
        raise ContentError("Output name must use letters, numbers, hyphens or underscores; an image extension is optional.")
    return stem


def render_image(source, box, shape, brightness, contrast, saturation, warmth, width, height, quality,
                 rotate=0, flip=False):
    with Image.open(source) as original:
        image = original.convert("RGBA")
    # Flip first, then rotate clockwise: the crop box is expressed in this transformed image.
    if flip:
        image = ImageOps.mirror(image)
    if rotate:
        image = image.transpose({90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180,
                                 270: Image.Transpose.ROTATE_90}[rotate])
    image = image.crop(box)
    alpha = image.getchannel("A")
    rgb = image.convert("RGB")
    rgb = ImageEnhance.Brightness(rgb).enhance(brightness / 100)
    rgb = ImageEnhance.Contrast(rgb).enhance(contrast / 100)
    rgb = ImageEnhance.Color(rgb).enhance(saturation / 100)
    if warmth:
        red, green, blue = rgb.split()
        offset = round(warmth * 0.5)
        red = red.point([max(0, min(255, value + offset)) for value in range(256)])
        blue = blue.point([max(0, min(255, value - offset)) for value in range(256)])
        rgb = Image.merge("RGB", (red, green, blue))
    image = rgb.convert("RGBA")
    image.putalpha(alpha)
    image.thumbnail((width, height), Image.Resampling.LANCZOS)
    if shape != "rectangle":
        # Supersampled masks keep circular/elliptical edges smooth, even before resizing.
        mask = Image.new("L", (image.width * 2, image.height * 2))
        ImageDraw.Draw(mask).ellipse((0, 0, mask.width - 1, mask.height - 1), fill=255)
        mask = mask.resize(image.size, Image.Resampling.LANCZOS)
        image.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
    if image.getchannel("A").getextrema() == (255, 255):
        image = image.convert("RGB")
    stream = io.BytesIO()
    image.save(stream, "WEBP", quality=quality, method=6)
    return stream.getvalue(), image.size


class ImageService:
    def __init__(self, app, guard, integer):
        self.app, self.guard, self.integer = app, guard, integer
        self.previews = {}
        self.saved = {}

    def folder(self, context, entry):
        if not isinstance(context, dict):
            raise ContentError("Choose an image destination.")
        kind = context.get("kind")
        if kind == "photos":
            folder = context.get("folder")
        elif kind == "page":
            folder = self.app.content.media_folder(context.get("path", ""))
        elif kind == "cv":
            _, _, data = self.app.members.checked(context.get("revision"))
            person = context.get("person")
            if not isinstance(person, str) or person not in person_index(data):
                raise ContentError("Save and select a person before preparing CV photos.")
            folder = member_image_folder(person)
        else:
            raise ContentError("Unknown image destination.")
        if kind == "photos" and entry.get("source_url") and isinstance(folder, str):
            parent = self.app.content.asset_path(entry["source_url"]).parent
            source_folder = "" if parent == self.app.root / "static/images" else parent.relative_to(self.app.root / "static/images").as_posix()
            if folder == source_folder:
                return folder, self.guard(self.app.root, "static/images" + ("/" + folder if folder else ""))
        if not isinstance(folder, str):
            raise ContentError("Choose an output folder.")
        target = self.app.destination(folder, create=False)
        return folder, self.guard(self.app.root, target.relative_to(self.app.root).as_posix())

    def open_existing(self, payload):
        url = payload.get("url")
        if not isinstance(url, str) or not url.startswith("/images/"):
            raise ContentError("Choose an existing site image.")
        path = self.app.content.asset_path(url)
        raw = path.read_bytes()
        entry = self.app.stage(path.name, raw)
        entry.update(source_url=url, source_revision=revision(raw),
                     source_folder=path.parent.relative_to(self.app.root / "static/images").as_posix(),
                     source_webp=path.suffix.lower() == ".webp",
                     references=self.app.content.references(url)[:30])
        return dict(entry)

    @staticmethod
    def replaces_anywhere(context):
        """Media pages assemble photos borrowed from other pages, so they may replace a borrowed WebP."""
        return context.get("kind") == "page" and str(context.get("path", "")).startswith("media/")

    def discard(self, token):
        record = self.previews.pop(token, None)
        if record:
            record["file"].unlink(missing_ok=True)

    def discard_upload(self, identifier):
        for token, record in list(self.previews.items()):
            if record["id"] == identifier:
                self.discard(token)
        self.saved = {token: record for token, record in self.saved.items() if record["id"] != identifier}

    def finish(self, payload):
        identifiers, remove = payload.get("ids"), payload.get("remove")
        if (not isinstance(identifiers, list) or not isinstance(remove, list) or len(identifiers) > 100 or
                any(not isinstance(item, str) for item in identifiers + remove) or
                len(set(identifiers)) != len(identifiers) or len(set(remove)) != len(remove) or not set(remove).issubset(identifiers)):
            raise ContentError("Invalid temporary image cleanup request.")
        for identifier in identifiers:
            self.app.upload(identifier)
        for identifier in identifiers:
            if identifier in remove:
                self.app.remove_upload(identifier)
            else:
                self.discard_upload(identifier)
        return {"removed": remove}

    def preview(self, payload):
        entry = self.app.upload(str(payload.get("id", "")))
        context = payload.get("context")
        _, target = self.folder(context, entry)
        key = payload.get("key")
        if not isinstance(key, str) or not re.fullmatch(r"[a-zA-Z0-9-]{8,100}", key):
            raise ContentError("Image version key is invalid. Reopen the image editor.")
        sequence = self.integer(payload.get("sequence"), "Preview sequence", 1, 1_000_000)
        previous = next((record for record in self.previews.values() if record["key"] == key), None)
        if previous and (previous["id"] != entry["id"] or previous["context"] != context):
            raise ConflictError("This image version belongs to another destination.")
        if previous and previous["sequence"] >= sequence:
            raise ConflictError("A newer image preview already exists.")
        if len(self.previews) >= 200 and not previous:
            raise ContentError("Too many prepared images. Remove versions or close the editor before continuing.")
        width = self.integer(payload.get("width"), "Maximum width", 64, 6000)
        height = self.integer(payload.get("height"), "Maximum height", 64, 6000)
        quality = self.integer(payload.get("quality"), "WebP quality", 1, 100)
        edit = payload.get("edit", {})
        if not isinstance(edit, dict):
            raise ContentError("Image adjustments must be an object.")
        rotate, flip = edit.get("rotate", 0), edit.get("flip", False)
        if rotate not in (0, 90, 180, 270) or isinstance(rotate, bool) or not isinstance(flip, bool):
            raise ContentError("Rotate in quarter turns (0, 90, 180 or 270) and flip with true or false.")
        # Crop coordinates belong to the flipped and rotated image.
        full_width, full_height = (entry["height"], entry["width"]) if rotate in (90, 270) else (entry["width"], entry["height"])
        box = edit.get("crop", [0, 0, full_width, full_height])
        if not isinstance(box, list) or len(box) != 4:
            raise ContentError("Choose a crop inside the source image.")
        left, top, right, bottom = [self.integer(value, "Crop coordinate", 0, max(full_width, full_height)) for value in box]
        if not (0 <= left < right <= full_width and 0 <= top < bottom <= full_height):
            raise ContentError("Crop must be inside the EXIF-corrected source image.")
        shape = edit.get("shape", "rectangle")
        if shape not in ("rectangle", "circle", "ellipse"):
            raise ContentError("Choose a rectangle, circle or ellipse crop.")
        if shape == "circle" and right - left != bottom - top:
            raise ContentError("A circular crop needs a square selection.")
        brightness, contrast, saturation = [self.integer(edit.get(name, 100), name.title(), 0, 200)
                                            for name in ("brightness", "contrast", "saturation")]
        warmth = self.integer(edit.get("warmth", 0), "Warmth", -100, 100)
        mode = payload.get("mode", "copy")
        if mode not in ("copy", "overwrite"):
            raise ContentError("Choose a new copy or replacement.")
        stem = output_stem(entry["stem"], payload.get("name"))
        anywhere = self.replaces_anywhere(context)
        can_overwrite = bool(entry.get("source_webp") and
                             (anywhere or self.app.root / "static/images" / entry["source_folder"] == target))
        overwrite_reason = ("" if can_overwrite else
                            "This image belongs to another folder. Save a copy in this destination." if entry.get("source_webp") else
                            "Only existing WebP files can be replaced. This source is saved as a new WebP copy.")
        expected = ""
        if mode == "overwrite":
            url = entry.get("source_url", "")
            destination = self.app.content.asset_path(url) if url else None
            if (not destination or destination.suffix.lower() != ".webp" or
                    (destination.parent != target and not anywhere)):
                raise ContentError("Only a WebP in this destination's own folder can be replaced. Save a copy of borrowed images instead.")
            if any(record is not previous and record["destination"] == destination and
                   record["result"]["mode"] == "overwrite" for record in self.previews.values()):
                raise ConflictError("Only one prepared version can replace this WebP. Save other versions as new copies.")
            expected = entry["source_revision"]
            if revision(destination.read_bytes()) != expected:
                raise ConflictError("The source WebP changed. Reopen it before preparing a replacement.")
        else:
            destination = target / (stem + ".webp")
            reserved = {record["destination"] for record in self.previews.values() if record is not previous}
            index = 1
            while destination.exists() or destination in reserved:
                index += 1
                destination = target / f"{stem}-{index}.webp"
        destination = self.guard(self.app.root, destination.relative_to(self.app.root).as_posix())
        branch = self.app.git.text("symbolic-ref", "--short", "HEAD")
        raw, size = render_image(self.app.scratch / entry["id"] / (entry["stem"] + ".png"),
                                 (left, top, right, bottom), shape, brightness, contrast, saturation,
                                 warmth, width, height, quality, rotate, flip)
        token = secrets.token_hex(16)
        file = self.app.scratch / entry["id"] / ("prepared-" + token + ".webp")
        file.write_bytes(raw)
        url = "/images/" + quote(destination.relative_to(self.app.root / "static/images").as_posix(), safe="/")
        result = {"token": token, "url": url, "width": size[0], "height": size[1], "bytes": len(raw),
                  "preview": "/api/workbench/images/preview/" + token, "mode": mode,
                  "can_overwrite": can_overwrite, "overwrite_reason": overwrite_reason}
        self.previews[token] = {"id": entry["id"], "key": key, "sequence": sequence, "context": dict(context),
                                "destination": destination, "expected": expected, "file": file, "result": result,
                                "branch": branch}
        if previous:
            self.discard(previous["result"]["token"])
        return result

    def save(self, payload):
        token = payload.get("token")
        if isinstance(token, str) and token in self.saved:
            record = self.saved[token]
            self.folder(record["context"], self.app.upload(record["id"]))
            destination = self.guard(self.app.root, record["destination"].relative_to(self.app.root).as_posix())
            if self.app.git.text("symbolic-ref", "--short", "HEAD") != record["branch"] or revision(destination.read_bytes()) != record["saved_revision"]:
                raise ConflictError("The previously saved image or branch changed. Review the file before retrying.")
            return record["saved_result"]
        if not isinstance(token, str) or token not in self.previews:
            raise ConflictError("The prepared image expired. Refresh its preview before saving.")
        record = self.previews[token]
        if self.app.git.text("symbolic-ref", "--short", "HEAD") != record["branch"]:
            raise ConflictError("The working branch changed after preview. Reopen the image editor.")
        entry = self.app.upload(record["id"])
        _, target = self.folder(record["context"], entry)
        destination = self.guard(self.app.root, record["destination"].relative_to(self.app.root).as_posix())
        overwrite = record["result"]["mode"] == "overwrite"
        if destination.parent != target and not (overwrite and self.replaces_anywhere(record["context"])):
            raise ConflictError("The image destination changed. Reopen the editor.")
        if overwrite and payload.get("confirm_overwrite") is not True:
            raise ConflictError("Review and explicitly approve replacing the existing WebP.")
        raw = record["file"].read_bytes()
        if not overwrite:
            target.mkdir(parents=True, exist_ok=True)
        if overwrite:
            if revision(destination.read_bytes()) != record["expected"]:
                raise ConflictError("The existing WebP changed after preview. Reopen it; nothing was replaced.")
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".image-", suffix=".tmp", delete=False) as stream:
                    temporary = Path(stream.name)
                    stream.write(raw)
                self.guard(self.app.root, destination.relative_to(self.app.root).as_posix())
                if revision(destination.read_bytes()) != record["expected"]:
                    raise ConflictError("The WebP changed during saving; nothing was replaced.")
                temporary.replace(destination)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
        else:
            created = False
            try:
                with destination.open("xb") as stream:
                    created = True
                    stream.write(raw)
            except FileExistsError as exc:
                raise ConflictError("A file appeared at the reviewed output path. Refresh the preview; nothing was overwritten.") from exc
            except OSError:
                if created:
                    destination.unlink()
                raise
        result = {"files": [{key: record["result"][key] for key in ("url", "width", "height", "bytes")}],
                  "log": "Saved the exact reviewed WebP preview.", "replaced": overwrite}
        record.update(saved_result=result, saved_revision=revision(raw))
        self.saved[token] = record
        self.discard(token)
        return result
