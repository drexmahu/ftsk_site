"""Unsized portraits remain compact; manual image sizing takes priority."""

import shutil
import subprocess
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


class Figures(HTMLParser):
    def __init__(self):
        super().__init__()
        self.figures = []

    def handle_starttag(self, tag, attrs):
        if tag == "figure":
            self.figures.append(dict(attrs))


@unittest.skipUnless(shutil.which("hugo"), "Hugo is required.")
class ArticleImageTests(unittest.TestCase):
    def test_default_orientation_manual_overrides_and_subpaths(self):
        with tempfile.TemporaryDirectory(prefix="ftsk-article-images-") as directory:
            root = Path(directory)
            for folder in ("content", "layouts/partials", "layouts/shortcodes",
                           "layouts/_default/_markup", "static/images"):
                (root / folder).mkdir(parents=True, exist_ok=True)
            (root / "hugo.toml").write_text(
                'baseURL="https://example.test/preview/"\n'
                'disableKinds=["taxonomy","term","RSS","sitemap"]\n', encoding="utf-8")
            for name in ("article-figure", "article-size", "url"):
                shutil.copyfile(ROOT / "layouts" / "partials" / f"{name}.html",
                                root / "layouts" / "partials" / f"{name}.html")
            for name in ("image", "media"):
                shutil.copyfile(ROOT / "layouts" / "shortcodes" / f"{name}.html",
                                root / "layouts" / "shortcodes" / f"{name}.html")
            shutil.copyfile(ROOT / "layouts" / "_default" / "_markup" / "render-image.html",
                            root / "layouts" / "_default" / "_markup" / "render-image.html")
            (root / "layouts" / "_default" / "single.html").write_text(
                "{{ .Content }}", encoding="utf-8")
            for name, size in (("portrait", (600, 1200)), ("landscape", (1200, 600)),
                               ("square", (600, 600)), ("small", (80, 160))):
                Image.new("RGB", size, "#184175").save(root / "static" / "images" / f"{name}.webp")
            body = (
                '![Portrait](/images/portrait.webp "Caption")\n\n'
                '![Landscape](/images/landscape.webp)\n\n'
                '![Square](/images/square.webp)\n\n'
                '![Small](/images/small.webp)\n\n'
                '{{< image src="/images/portrait.webp" alt="Manual" width="40" mobile-width="75" >}}\n\n'
                '{{< image src="/images/portrait.webp" alt="Mobile" mobile-width="75" >}}\n\n'
                '{{< media src="/images/portrait.webp" alt="Column" image-width="40" >}}Text{{< /media >}}\n\n'
                '![Remote](https://example.test/portrait.webp)\n\n'
                '![Vector](/images/vector.svg)\n'
            )
            for name, metadata in (("auto", ""), ("manual", "article_image_width: 65\n")):
                (root / "content" / f"{name}.md").write_text(
                    f"---\ntitle: {name}\n{metadata}---\n{body}", encoding="utf-8")
            result = subprocess.run([shutil.which("hugo"), "--source", str(root)],
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            html = (root / "public" / "auto" / "index.html").read_text(encoding="utf-8")
            parser = Figures()
            parser.feed(html)
            auto = ["ftsk-article-figure-auto-portrait" in item["class"] for item in parser.figures]
            self.assertEqual(auto, [True, False, False, True, False, True, False, False, False])
            self.assertIn("--article-portrait-ratio: 0.5;", parser.figures[0]["style"])
            self.assertIn("--article-portrait-natural-width: 80px;", parser.figures[3]["style"])
            self.assertIn("--article-image-width: 40%;", parser.figures[4]["style"])
            self.assertIn("--article-mobile-image-width: 75%;", parser.figures[4]["style"])
            self.assertIn("ftsk-article-figure-manual-mobile", parser.figures[5]["class"])
            self.assertIn('src="/preview/images/portrait.webp"', html)
            self.assertIn('width="600" height="1200"', html)
            self.assertIn("<figcaption>Caption</figcaption>", html)
            manual = (root / "public" / "manual" / "index.html").read_text(encoding="utf-8")
            self.assertNotIn("ftsk-article-figure-auto-portrait", manual)
            self.assertIn("--article-image-width: 65%;", manual)
