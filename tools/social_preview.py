"""Inspect URL metadata and render local, approximate social sharing cards."""

import argparse
import base64
import html
import io
import logging
import warnings
import webbrowser
from dataclasses import dataclass, field
from html.parser import HTMLParser
from http.client import HTTPException
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen

from PIL import Image, UnidentifiedImageError

LOGGER = logging.getLogger("social_preview")
DEFAULT_PORT = 8878
TIMEOUT = 10
MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000


class PreviewError(ValueError):
    pass


def validate_url(value: str) -> str:
    value = value.strip()
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise PreviewError(f"Invalid URL: {exc}") from exc
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise PreviewError("Enter a complete http:// or https:// URL.")
    if parsed.username is not None or parsed.password is not None:
        raise PreviewError("URLs containing credentials are not supported.")
    if port == 0 or any(ord(char) < 32 for char in value):
        raise PreviewError("Invalid URL port or control character.")
    return value


@dataclass
class Response:
    url: str
    content_type: str
    charset: str
    body: bytes


def fetch(url: str, limit: int) -> Response:
    request = Request(validate_url(url), headers={"User-Agent": "FTSK-Social-Preview/1.0"})
    try:
        with urlopen(request, timeout=TIMEOUT) as response:
            final_url = validate_url(response.geturl())
            body = response.read(limit + 1)
            if len(body) > limit:
                raise PreviewError(f"Response exceeds the {limit // 1024} KiB limit: {url}")
            return Response(
                final_url, response.headers.get_content_type(),
                response.headers.get_content_charset() or "utf-8", body,
            )
    except HTTPError as exc:
        raise PreviewError(f"HTTP {exc.code} while fetching {url}") from exc
    except (URLError, TimeoutError, OSError, HTTPException) as exc:
        raise PreviewError(f"Cannot fetch {url}: {exc}") from exc


class MetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, list[str]] = {}
        self.nonstandard_og: set[str] = set()
        self.base = ""
        self.canonical = ""
        self.title = ""
        self.in_title = False
        self.in_head = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "head":
            self.in_head = True
        if not self.in_head:
            return
        if tag == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            content = (values.get("content") or "").strip()
            if key:
                self.meta.setdefault(key, []).append(content)
                if key.startswith("og:") and not values.get("property"):
                    self.nonstandard_og.add(key)
        elif tag == "base" and not self.base:
            self.base = values.get("href") or ""
        elif tag == "link" and "canonical" in (values.get("rel") or "").lower().split():
            if not self.canonical:
                self.canonical = values.get("href") or ""
        elif tag == "title":
            self.in_title = True

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        if tag == "head":
            self.in_head = False
        elif tag == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_head and self.in_title:
            self.title += data

    def first(self, key: str) -> str:
        values = self.meta.get(key, [])
        return values[0] if values else ""


@dataclass
class CardImage:
    url: str
    data_uri: str = ""
    width: int = 0
    height: int = 0
    size: int = 0


@dataclass
class Card:
    label: str
    title: str
    description: str
    image: CardImage | None
    compact: bool = False


@dataclass
class Preview:
    url: str
    canonical: str
    metadata: dict[str, list[str]]
    cards: list[Card]
    issues: list[str] = field(default_factory=list)


def load_image(url: str) -> CardImage:
    response = fetch(url, MAX_IMAGE_BYTES)
    if not response.content_type.startswith("image/"):
        raise PreviewError(f"Expected an image, received {response.content_type}: {url}")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(response.body)) as image:
                width, height = image.size
                if width * height > MAX_IMAGE_PIXELS:
                    raise PreviewError(f"Image exceeds {MAX_IMAGE_PIXELS:,} pixels: {url}")
                image.load()
                # Embed a decoded PNG: exports work offline and never execute remote SVG/HTML.
                output = io.BytesIO()
                image.convert("RGB").save(output, format="PNG")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise PreviewError(f"Cannot decode image {url}: {exc}") from exc
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return CardImage(response.url, f"data:image/png;base64,{encoded}", width, height, len(response.body))


def inspect_page(url: str) -> Preview:
    response = fetch(url, MAX_HTML_BYTES)
    if response.content_type not in ("text/html", "application/xhtml+xml"):
        raise PreviewError(f"Expected HTML, received {response.content_type}: {response.url}")
    try:
        source = response.body.decode(response.charset)
    except (LookupError, UnicodeError) as exc:
        raise PreviewError(f"Cannot decode page as {response.charset}: {exc}") from exc
    parser = MetadataParser()
    parser.feed(source)
    base = validate_url(urljoin(response.url, parser.base)) if parser.base else response.url
    canonical = urljoin(base, parser.canonical) if parser.canonical else ""
    preview = Preview(response.url, canonical, parser.meta, [])
    for key in ("og:title", "og:description", "og:image", "og:type", "og:url", "twitter:card"):
        if not parser.first(key):
            preview.issues.append(f"Missing or empty {key}.")
    for key in sorted(parser.nonstandard_og):
        preview.issues.append(f"{key} uses name=; Open Graph specifies property=.")
    for key, values in parser.meta.items():
        if key.startswith(("og:", "twitter:")) and len(set(values)) > 1 and key != "og:image":
            preview.issues.append(f"Conflicting values for {key}; showing the first.")
    if "noindex" in parser.first("robots").lower():
        preview.issues.append("Page has noindex (normal for staging/PR previews).")
    if urlsplit(response.url).hostname in ("localhost", "127.0.0.1", "::1"):
        preview.issues.append("Local URL: social platforms cannot fetch it. Use a public preview URL for a real share.")

    loaded: dict[str, CardImage] = {}

    def image_for(value: str) -> CardImage | None:
        if not value:
            return None
        image_url = urljoin(base, value)
        if image_url not in loaded:
            try:
                loaded[image_url] = load_image(image_url)
            except PreviewError as exc:
                preview.issues.append(str(exc))
                LOGGER.warning("%s", exc)
                loaded[image_url] = CardImage(image_url)
            image = loaded[image_url]
            if image.data_uri:
                if image.width < 600 or image.height < 315:
                    preview.issues.append(f"Small social image ({image.width}x{image.height}): {image_url}")
                if image.size > 5 * 1024 * 1024:
                    preview.issues.append(f"Image exceeds 5 MiB; some platforms may reject it: {image_url}")
        return loaded[image_url]

    og_title = parser.first("og:title") or parser.title.strip()
    og_description = parser.first("og:description") or parser.first("description")
    og_image = parser.first("og:image") or parser.first("og:image:url")
    twitter_type = parser.first("twitter:card")
    if twitter_type and twitter_type not in ("summary", "summary_large_image"):
        preview.issues.append(f"Twitter card type {twitter_type!r} is not simulated by this viewer.")
    preview.cards = [
        Card("Open Graph / Facebook-style", og_title, og_description, image_for(og_image)),
        Card("X / Twitter-style", parser.first("twitter:title") or og_title,
             parser.first("twitter:description") or og_description,
             image_for(parser.first("twitter:image") or og_image), twitter_type == "summary"),
    ]
    return preview


def render_page(url: str = "", preview: Preview | None = None, error: str = "") -> str:
    escape = html.escape
    content = ""
    if error:
        content += f'<p class="error" role="alert">{escape(error)}</p>'
    if preview:
        domain = urlsplit(preview.url).netloc
        for card in preview.cards:
            image = card.image
            picture = (f'<img src="{image.data_uri}" alt="Social card image">' if image and image.data_uri
                       else '<div class="missing">Image unavailable</div>')
            shape = "compact" if card.compact else ""
            content += (
                f'<section><h2>{escape(card.label)}</h2><div class="card {shape}">{picture}'
                f'<div class="text"><small>{escape(domain)}</small><h3>{escape(card.title)}</h3>'
                f'<p>{escape(card.description)}</p></div></div>'
            )
            if image:
                content += (f'<p class="details">{image.width} x {image.height} pixels; '
                            f'{image.size / 1024:.0f} KiB source<br>{escape(image.url)}</p>')
            content += "</section>"
        issues = "".join(f"<li>{escape(issue)}</li>" for issue in preview.issues)
        content += f'<section><h2>Checks</h2><ul>{issues or "<li>No issues detected.</li>"}</ul></section>'
        content += (f'<p class="details">Fetched URL: {escape(preview.url)}<br>'
                    f'Canonical: {escape(preview.canonical or "(missing)")}</p>')
        rows = "".join(
            f"<tr><th>{escape(key)}</th><td>{escape(value)}</td></tr>"
            for key, values in preview.metadata.items()
            if key.startswith(("og:", "twitter:")) or key in ("description", "robots")
            for value in values
        )
        content += f"<details><summary>Raw metadata</summary><table>{rows}</table></details>"
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FTSK social card preview</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#0a1116;color:#b9c7c9;font:16px/1.6 system-ui,sans-serif}}
main{{max-width:1000px;margin:auto;padding:24px}}h1,h2,h3{{color:#f2ede1}}h2{{font-size:1.2rem}}
form{{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0}}input{{flex:1;min-width:200px;padding:12px}}
button{{background:#bea070;color:#0a1116;border:0;padding:12px 20px;cursor:pointer}}
input,button{{border-radius:8px;font:inherit}}section{{margin:32px 0}}.card{{max-width:600px;border:1px solid #2c4652;border-radius:14px;overflow:hidden;background:#11202b}}
.card img,.missing{{display:block;width:100%;aspect-ratio:1200/630;object-fit:cover}}.missing{{padding:40px;color:#ffb4a9}}
.text{{padding:16px}}.text h3{{margin:4px 0;font-size:1.1rem}}.text p{{margin:0;font-size:.95rem}}
.compact{{display:flex}}.compact img,.compact .missing{{width:128px;flex-shrink:0;aspect-ratio:1;object-fit:cover}}
.compact .text{{min-width:0}}.details{{font-size:.85rem;overflow-wrap:anywhere}}.error{{color:#ffb4a9}}
table{{width:100%;border-collapse:collapse;table-layout:fixed}}th,td{{padding:8px;text-align:left;border-bottom:1px solid #2c4652;overflow-wrap:anywhere}}th{{width:30%}}
</style></head><body><main><h1>Social card preview</h1>
<p>Approximate Open Graph and X/Twitter cards, using the actual HTML and image served by the URL.
Platforms can crop, truncate, or cache differently. This is not a platform crawler/cache test.</p>
<form method="get" action="/"><input type="url" name="url" aria-label="Page URL"
placeholder="http://localhost:1313/tanfolyamok/tanfolyam-2027/" value="{escape(url)}" required>
<button type="submit">Preview</button></form>{content}</main></body></html>"""


class PreviewHandler(BaseHTTPRequestHandler):
    server: ThreadingHTTPServer

    def do_GET(self) -> None:
        if self.headers.get("Host") not in (
            f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}",
        ):
            self.send_error(403, "Use the localhost preview address.")
            return
        parsed = urlsplit(self.path)
        if parsed.path != "/":
            self.send_error(404)
            return
        url = parse_qs(parsed.query).get("url", [""])[0]
        status = 200
        try:
            page = render_page(url, inspect_page(url)) if url else render_page()
        except PreviewError as exc:
            LOGGER.warning("%s", exc)
            status = 400
            page = render_page(url, error=str(exc))
        body = page.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy",
                         "default-src 'none'; img-src data:; style-src 'unsafe-inline'; "
                         "form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", default="", help="Dev-server or public page URL")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--output", type=Path, help="Export a standalone HTML preview instead of serving")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    if args.output:
        if not args.url:
            parser.error("--output requires a page URL")
        try:
            preview = inspect_page(args.url)
            args.output.write_text(render_page(args.url, preview), encoding="utf-8")
        except (PreviewError, OSError) as exc:
            parser.exit(1, f"ERROR: {exc}\n")
        print(f"Saved preview: {args.output.resolve()}")
        return
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), PreviewHandler)
    except OSError as exc:
        parser.exit(1, f"ERROR: Cannot start preview server: {exc}\n")
    address = f"http://127.0.0.1:{args.port}/"
    if args.url:
        address += "?" + urlencode({"url": args.url})
    print(f"Social preview: {address}", flush=True)
    print("Local-only. Ctrl+C stops the server.", flush=True)
    if not args.no_browser:
        if not webbrowser.open(address):
            LOGGER.warning("Could not open a browser; open the printed URL manually.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping preview server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
