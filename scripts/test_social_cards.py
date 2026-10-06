"""Exercise the real Hugo social-card partials with controlled image fixtures."""

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]


class SocialCardSelectionTests(unittest.TestCase):
    def setUp(self):
        self.hugo = shutil.which("hugo")
        if not self.hugo:
            self.fail("Hugo is required for social-card selection tests.")
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for directory in ("layouts/partials", "layouts/_default", "content/turak",
                          "content/tanfolyamok", "assets/images/og", "data"):
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        for name in ("social-card-source.html", "social-card.html", "absurl.html", "meta.html"):
            shutil.copyfile(REPO_ROOT / "layouts" / "partials" / name,
                            self.root / "layouts" / "partials" / name)
        (self.root / "hugo.toml").write_text(
            'baseURL = "https://example.com/preview/"\n'
            'disableKinds = ["taxonomy", "term", "RSS", "sitemap"]\n', encoding="utf-8",
        )
        (self.root / "layouts" / "index.html").write_text(
            '{{ $rows := slice }}'
            '{{ $rows = $rows | append (dict "title" .Title "source" '
            '(partial "social-card-source.html" .) "image" (partial "social-card.html" .)) }}'
            '{{ range site.RegularPages }}'
            '{{ $rows = $rows | append (dict "title" .Title "source" '
            '(partial "social-card-source.html" .) "image" (partial "social-card.html" .)) }}'
            '{{ end }}{{ $rows | jsonify | safeHTML }}', encoding="utf-8",
        )
        for name in ("single.html", "list.html"):
            (self.root / "layouts" / "_default" / name).write_text("fixture", encoding="utf-8")
        (self.root / "data" / "meta.json").write_text(
            json.dumps({"image": "/images/fallback.png", "BaseURL": "https://example.com"}),
            encoding="utf-8",
        )
        self.image("landscape", (150, 100))
        self.image("below-threshold", (149, 100))
        self.image("portrait", (80, 120))
        self.image("square", (100, 100))
        self.image("featured", (160, 100))
        self.image("override", (80, 120))
        self.image("fallback", (160, 100))
        self.image("ftsk-logo", (60, 100))
        Image.new("RGBA", (1200, 630), (0, 0, 0, 100)).save(
            self.root / "assets" / "images" / "og" / "gradient.png",
        )
        self.hero_images(["portrait", "square", "below-threshold", "landscape"])
        self.page("_index.md", "Home")

    def image(self, name, size):
        Image.new("RGB", size, "#184175").save(self.root / "assets" / "images" / f"{name}.png")

    def hero_images(self, names):
        (self.root / "data" / "hero_images.json").write_text(
            json.dumps({"images": [{"path": f"/images/{name}.png"} for name in names]}),
            encoding="utf-8",
        )

    def page(self, path, title, featured="", override=""):
        data = {"title": title, "date": "2020-01-01", "draft": False}
        if featured:
            data["featuredImg"] = {"image_path": featured}
        if override:
            data["seo"] = {"featured_image": override}
        (self.root / "content" / path).write_text(
            json.dumps(data, ensure_ascii=False) + "\n\nFixture text.\n", encoding="utf-8",
        )

    def build(self, succeeds=True):
        result = subprocess.run(
            [self.hugo, "--source", str(self.root), "--destination", str(self.root / "public")],
            capture_output=True, text=True, encoding="utf-8", timeout=60,
        )
        if succeeds:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            rows = json.loads((self.root / "public" / "index.html").read_text(encoding="utf-8"))
            for row in rows:
                self.assertTrue(row["image"].startswith("https://example.com/preview/images/"))
                relative = row["image"].split("/preview/", 1)[1]
                with Image.open(self.root / "public" / relative) as image:
                    self.assertEqual(image.size, (1200, 630))
            return {row["title"]: row["source"] for row in rows}, result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, "Invalid image unexpectedly succeeded")
        return {}, result.stdout + result.stderr

    def test_post_defaults_overrides_and_exact_ratio_threshold(self):
        self.page("turak/default.md", "Trip default", featured="/images/featured.png")
        self.page("tanfolyamok/default.md", "Course default", featured="/images/featured.png")
        self.page("turak/override.md", "Trip override", featured="/images/featured.png",
                  override="/images/override.png")
        self.page("tanfolyamok/override.md", "Course override", featured="/images/featured.png",
                  override="/images/override.png")
        self.page("other.md", "Other", featured="/images/portrait.png")
        sources, _ = self.build()
        self.assertEqual(sources["Trip default"], "/images/featured.png")
        self.assertEqual(sources["Course default"], "/images/featured.png")
        self.assertEqual(sources["Trip override"], "/images/override.png")
        self.assertEqual(sources["Course override"], "/images/override.png")
        self.assertEqual(sources["Home"], "/images/landscape.png")
        self.assertEqual(sources["Other"], "/images/landscape.png")

    def test_no_suitable_hero_warns_and_uses_fallback(self):
        self.hero_images(["portrait", "below-threshold"])
        sources, log = self.build()
        self.assertEqual(sources["Home"], "/images/fallback.png")
        self.assertIn("no hero image has an aspect ratio >= 1.5", log)

    def test_integer_pixel_rounding_of_three_to_two_export(self):
        self.image("rounded-landscape", (1600, 1067))
        self.hero_images(["portrait", "below-threshold", "rounded-landscape"])
        sources, _ = self.build()
        self.assertEqual(sources["Home"], "/images/rounded-landscape.png")

    def test_missing_post_featured_image_uses_suitable_hero(self):
        self.page("turak/default.md", "Missing featured")
        sources, _ = self.build()
        self.assertEqual(sources["Missing featured"], "/images/landscape.png")

    def test_missing_explicit_override_fails_instead_of_random_fallback(self):
        self.page("turak/invalid.md", "Invalid override", featured="/images/featured.png",
                  override="/images/does-not-exist.png")
        _, log = self.build(succeeds=False)
        self.assertIn("does-not-exist.png was not found", log)

    def test_non_raster_override_fails_explicitly(self):
        (self.root / "assets" / "images" / "vector.svg").write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>',
            encoding="utf-8",
        )
        self.page("tanfolyamok/invalid.md", "Invalid override", override="/images/vector.svg")
        _, log = self.build(succeeds=False)
        self.assertIn("must be a local processable raster image", log)

    def test_card_image_does_not_repeat_the_page_title(self):
        self.page("turak/one.md", "First report", featured="/images/featured.png")
        self.page("turak/two.md", "A completely different report title",
                  featured="/images/featured.png")
        self.build()
        rows = json.loads((self.root / "public" / "index.html").read_text(encoding="utf-8"))
        images = {row["title"]: row["image"] for row in rows}
        self.assertEqual(images["First report"], images["A completely different report title"])

    def test_exact_social_image_and_independent_share_text(self):
        for relative in ("turak/exact.md", "tanfolyamok/exact.md"):
            self.page(relative, "Article title", featured="/images/featured.png")
            file = self.root / "content" / relative
            data = json.loads(file.read_text(encoding="utf-8").split("\n")[0])
            data["seo"] = {
                "social_image": "/images/override.png",
                "featured_image": "/images/does-not-exist.png",
                "social_title": 'Share "title" & details',
                "social_description": "Share description",
                "page_description": "Search description",
            }
            file.write_text(json.dumps(data) + "\n\nBody\n", encoding="utf-8")
        (self.root / "layouts" / "_default" / "single.html").write_text(
            '{{ partial "meta.html" . }}<h1>{{ .Title }}</h1>', encoding="utf-8")
        # The exact image must not require the generated card's overlays.
        (self.root / "assets" / "images" / "og" / "gradient.png").unlink()
        (self.root / "layouts" / "index.html").write_text("fixture", encoding="utf-8")
        result = subprocess.run([self.hugo, "--source", str(self.root)],
                                capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for section in ("turak", "tanfolyamok"):
            html = (self.root / "public" / section / "exact" / "index.html").read_text(encoding="utf-8")
            for tag in ('property="og:image"', 'name="twitter:image"'):
                self.assertIn(f'<meta {tag} content="https://example.com/preview/images/override.png"', html)
            for tag in ('property="og:title"', 'name="twitter:title"'):
                self.assertIn(f'<meta {tag} content="Share &#34;title&#34; &amp; details"', html)
            self.assertIn('<meta name="description" content="Search description"', html)
            self.assertIn('<meta property="og:description" content="Share description"', html)
            self.assertIn('<meta name="twitter:description" content="Share description"', html)
            self.assertIn("<h1>Article title</h1>", html)
        self.assertEqual(
            (self.root / "assets" / "images" / "override.png").read_bytes(),
            (self.root / "public" / "images" / "override.png").read_bytes())

    def test_invalid_exact_social_images_fail_build(self):
        (self.root / "layouts" / "_default" / "single.html").write_text(
            '{{ partial "meta.html" . }}', encoding="utf-8")
        for path in ("/images/missing.png", "https://example.test/image.png", "/images/vector.svg"):
            with self.subTest(path=path):
                (self.root / "assets" / "images" / "vector.svg").write_text(
                    '<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")
                (self.root / "content" / "turak" / "invalid.md").write_text(
                    json.dumps({"title": "Invalid", "seo": {"social_image": path}}) + "\n", encoding="utf-8")
                _, log = self.build(succeeds=False)
                self.assertIn("Social image for", log)

    def test_empty_share_overrides_keep_default_metadata(self):
        self.page("turak/default.md", "Original title", featured="/images/featured.png")
        file = self.root / "content" / "turak" / "default.md"
        data = json.loads(file.read_text(encoding="utf-8").split("\n")[0])
        data["seo"] = {"social_title": "", "social_description": "", "social_image": "",
                       "page_description": "Original description"}
        file.write_text(json.dumps(data) + "\n", encoding="utf-8")
        (self.root / "layouts" / "_default" / "single.html").write_text(
            '{{ partial "meta.html" . }}', encoding="utf-8")
        self.build()
        html = (self.root / "public" / "turak" / "default" / "index.html").read_text(encoding="utf-8")
        self.assertIn('<meta property="og:title" content="Original title"', html)
        self.assertIn('<meta property="og:description" content="Original description"', html)

    def test_social_url_follows_build_url_independently_of_canonical(self):
        template = '{{ partial "meta.html" . }}'
        (self.root / "layouts" / "index.html").write_text(template, encoding="utf-8")
        (self.root / "layouts" / "_default" / "single.html").write_text(
            template, encoding="utf-8",
        )
        self.page("turak/report.md", "Report", featured="/images/featured.png")
        for base in ("https://example.com/preview/pr-42/", "http://localhost:1313/",
                     "https://production.example/"):
            with self.subTest(base=base):
                env = dict(os.environ, HUGO_CANONICAL_BASE_URL="https://production.example/")
                result = subprocess.run(
                    [self.hugo, "--source", str(self.root), "--destination",
                     str(self.root / "public"), "--baseURL", base],
                    capture_output=True, text=True, encoding="utf-8", timeout=60, env=env,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                for path in ("", "turak/report/"):
                    source = (self.root / "public" / path / "index.html").read_text(
                        encoding="utf-8",
                    )
                    self.assertIn(f'<meta property="og:url" content="{base}{path}"', source)
                    self.assertIn(
                        f'<link rel="canonical" href="https://production.example/{path}"',
                        source,
                    )
                    image = re.search(r'<meta property="og:image" content="([^"]+)"', source)
                    self.assertIsNotNone(image)
                    self.assertTrue(image.group(1).startswith(base + "images/"))


if __name__ == "__main__":
    unittest.main()
