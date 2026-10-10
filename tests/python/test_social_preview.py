import io
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image

import tools.social_preview as social_preview


class FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/nested/page")
            self.end_headers()
            return
        if self.path == "/missing":
            self.send_error(404)
            return
        if self.path == "/image.png":
            image = Image.new("RGB", (1200, 630), "#184175")
            output = io.BytesIO()
            image.save(output, "PNG")
            body = output.getvalue()
            mime = "image/png"
        elif self.path == "/broken.png":
            body, mime = b"not an image", "image/png"
        elif self.path == "/empty":
            body, mime = b"<html><head><title>Fallback</title></head></html>", "text/html"
        elif self.path == "/broken":
            body = b'<html><head><meta property="og:image" content="/broken.png"></head></html>'
            mime = "text/html"
        else:
            body = """<html><head>
<title>Document title</title><base href="../">
<meta property="og:title" content="Barlang &amp; kutat&#225;s">
<meta property="og:description" content="Cave description">
<meta property="og:image" content="image.png">
<meta property="og:type" content="article">
<meta property="og:url" content="https://www.ftsk.hu/article/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Twitter title">
<link rel="canonical" href="https://www.ftsk.hu/article/">
</head><body><meta property="og:title" content="Ignore body"></body></html>""".encode("utf-8")
            mime = "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class PreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_metadata_redirect_base_image_and_twitter_fallback(self):
        preview = social_preview.inspect_page(self.base + "/redirect")
        self.assertEqual(preview.url, self.base + "/nested/page")
        self.assertEqual(preview.canonical, "https://www.ftsk.hu/article/")
        og, twitter = preview.cards
        self.assertEqual(og.title, "Barlang & kutat\u00e1s")
        self.assertEqual(twitter.title, "Twitter title")
        self.assertEqual(twitter.description, og.description)
        self.assertIs(twitter.image, og.image)
        self.assertIsNotNone(og.image)
        assert og.image is not None
        self.assertEqual((og.image.width, og.image.height), (1200, 630))
        self.assertTrue(og.image.data_uri.startswith("data:image/png;base64,"))
        self.assertTrue(any("Local URL" in issue for issue in preview.issues))
        self.assertFalse(any("Missing" in issue for issue in preview.issues))

    def test_missing_metadata_is_reported_not_hidden_by_fallback(self):
        preview = social_preview.inspect_page(self.base + "/empty")
        self.assertEqual(preview.cards[0].title, "Fallback")
        self.assertEqual(preview.canonical, "")
        self.assertIsNone(preview.cards[0].image)
        self.assertTrue(any("Missing or empty og:image" in issue for issue in preview.issues))

    def test_broken_image_renders_explicit_warning(self):
        with self.assertLogs(social_preview.LOGGER, level="WARNING"):
            preview = social_preview.inspect_page(self.base + "/broken")
        self.assertTrue(any("Cannot decode image" in issue for issue in preview.issues))
        self.assertIn("Image unavailable", social_preview.render_page(preview=preview))

    def test_page_fetch_failure_is_explicit(self):
        with self.assertRaisesRegex(social_preview.PreviewError, "HTTP 404"):
            social_preview.inspect_page(self.base + "/missing")

    def test_response_size_limit(self):
        with self.assertRaisesRegex(social_preview.PreviewError, "exceeds"):
            social_preview.fetch(self.base + "/image.png", 10)

    def test_non_html_response(self):
        with self.assertRaisesRegex(social_preview.PreviewError, "Expected HTML"):
            social_preview.inspect_page(self.base + "/image.png")

    def test_invalid_urls(self):
        for url in ("file:///secret", "ftp://example.com", "localhost:1313",
                    "http://user:pass@example.com", "http://example.com:0",
                    "http://example.com:bad", "http://example.com/\x01"):
            with self.subTest(url=url), self.assertRaises(social_preview.PreviewError):
                social_preview.validate_url(url)

    def test_legacy_names_duplicates_and_self_closing_tags(self):
        parser = social_preview.MetadataParser()
        parser.feed('<head><meta name="og:title" content="One"/>'
                    '<meta property="og:title" content="Two"></head>')
        self.assertEqual(parser.first("og:title"), "One")
        self.assertEqual(parser.meta["og:title"], ["One", "Two"])
        self.assertIn("og:title", parser.nonstandard_og)

    def test_render_escapes_remote_content(self):
        preview = social_preview.Preview(
            self.base, "", {"og:title": ['<script>alert("x")</script>']},
            [social_preview.Card("<unsafe>", "<script>bad</script>", "<b>text</b>", None)],
            ["<img src=x onerror=alert(1)>"],
        )
        rendered = social_preview.render_page('"><script>url</script>', preview)
        self.assertNotIn("<script>", rendered)
        self.assertNotIn("<img src=x", rendered)
        self.assertIn("&lt;script&gt;", rendered)

    def test_server_query_preview_and_host_guard(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), social_preview.PreviewHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            address = f"http://127.0.0.1:{server.server_port}/"
            with urlopen(address + "?" + urlencode({"url": self.base + "/nested/page"})) as response:
                page = response.read().decode()
                self.assertIn("Twitter title", page)
                self.assertIn("data:image/png;base64,", page)
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
            request = Request(address, headers={"Host": "untrusted.example"})
            with self.assertRaises(HTTPError) as error:
                urlopen(request)
            self.assertEqual(error.exception.code, 403)
            with self.assertLogs(social_preview.LOGGER, level="WARNING"):
                with self.assertRaises(HTTPError) as error:
                    urlopen(address + "?url=file%3A%2F%2F%2Fsecret")
            self.assertEqual(error.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
