"""Featured-banner sizing is independent of article-body images."""

import shutil
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which("hugo"), "Hugo is required.")
class FeaturedImageTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="ftsk-featured-image-")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        for folder in ("content", "content/turak", "content/tanfolyamok", "layouts",
                       "layouts/_default", "layouts/partials"):
            (self.root / folder).mkdir(exist_ok=True)
        (self.root / "hugo.toml").write_text(
            'baseURL="https://example.test/"\ndisableKinds=["taxonomy","term","RSS","sitemap"]\n',
            encoding="utf-8")
        for partial in ("featured-image", "url"):
            shutil.copyfile(ROOT / "layouts" / "partials" / f"{partial}.html",
                            self.root / "layouts" / "partials" / f"{partial}.html")
        (self.root / "layouts" / "_default" / "single.html").write_text(
            '{{ partial "featured-image.html" . }}{{ .Content }}', encoding="utf-8")

    def build(self, width=None, omitted=False, image=True):
        for section in ("turak", "tanfolyamok"):
            meta = {"title": section, "featuredImg": {"image_path": "/images/banner.webp"}}
            if not omitted:
                meta["featuredImg"]["width"] = width
            if not image:
                del meta["featuredImg"]["image_path"]
            (self.root / "content" / section / "test.md").write_text(
                "---\n" + yaml.safe_dump(meta) + "---\n![Body photo](/images/body.webp)\n",
                encoding="utf-8")
        return subprocess.run([shutil.which("hugo"), "--source", str(self.root)],
                              capture_output=True, text=True, check=False)

    def test_percentages_defaults_and_unaffected_body_in_both_sections(self):
        for value, omitted, expected in ((None, True, 100), (None, False, 100),
                                        (10, False, 10), (40, False, 40),
                                        (62.5, False, 62.5), (100, False, 100)):
            with self.subTest(width=value, omitted=omitted):
                result = self.build(value, omitted)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                for section in ("turak", "tanfolyamok"):
                    html = (self.root / "public" / section / "test" / "index.html").read_text(encoding="utf-8")
                    self.assertIn(f"width: {expected}%; margin-left: auto; margin-right: auto;", html)
                    self.assertIn('src="/images/banner.webp" class="w-100"', html)
                    self.assertIn('<img src="/images/body.webp" alt="Body photo">', html)
        for section in ("turak", "tanfolyamok"):
            template = (ROOT / "layouts" / section / "single.html").read_text(encoding="utf-8")
            self.assertIn('partial "featured-image.html" .', template)

    def test_invalid_values_fail_build(self):
        for value in (0, 9, 101, True, "40", [40]):
            with self.subTest(width=value):
                result = self.build(value)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("featuredImg.width must be a number from 10 to 100", result.stdout + result.stderr)

    def test_course_flyers_link_original_images_with_subpath_support(self):
        template = (ROOT / "layouts" / "tanfolyamok" / "single.html").read_text(encoding="utf-8")
        self.assertLess(template.index('partial "course-flyers.html"'), template.index("</header>"))
        self.assertLess(template.index("</header>"), template.index(".Content"))
        shutil.copyfile(ROOT / "layouts" / "partials" / "course-flyers.html",
                        self.root / "layouts" / "partials" / "course-flyers.html")
        (self.root / "layouts" / "_default" / "single.html").write_text(
            '{{ partial "course-flyers.html" . }}', encoding="utf-8")
        meta = {
            "title": "Course",
            "flyer_images": [
                {"image_path": "/images/course/first.webp"},
                {"image_path": ""},
                {"image_path": "/images/course/second.webp"},
            ],
        }
        (self.root / "content" / "tanfolyamok" / "test.md").write_text(
            "---\n" + yaml.safe_dump(meta) + "---\n", encoding="utf-8")
        for base, prefix in (("https://example.test/", ""), ("https://example.test/preview/", "/preview")):
            with self.subTest(base=base):
                result = subprocess.run(
                    [shutil.which("hugo"), "--source", str(self.root), "--baseURL", base],
                    capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                html = (self.root / "public" / "tanfolyamok" / "test" / "index.html").read_text(encoding="utf-8")
                self.assertEqual(html.count('class="ftsk-tanfolyam-flyer-link"'), 2)
                self.assertIn('data-flyer-count="2"', html)
                for name in ("first", "second"):
                    url = f"{prefix}/images/course/{name}.webp"
                    self.assertIn(f'href="{url}"', html)
                    self.assertIn(f'src="{url}"', html)
                self.assertNotIn('src=""', html)
        script = (ROOT / "static" / "js" / "script.js").read_text(encoding="utf-8")
        self.assertIn("$('.ftsk-gallery-grid, .ftsk-tanfolyam-flyers').magnificPopup(", script)

    def test_closed_course_labels_follow_current_flag_only_for_courses(self):
        shutil.copyfile(
            ROOT / "layouts" / "partials" / "course-closed-label.html",
            self.root / "layouts" / "partials" / "course-closed-label.html")
        template = (ROOT / "layouts" / "tanfolyamok" / "single.html").read_text(encoding="utf-8")
        note = re.search(
            r'{{ if not \.Params\.current }}\s*<p class="ftsk-course-closed-note">.*?{{ end }}',
            template, re.DOTALL).group()
        (self.root / "layouts" / "_default" / "single.html").write_text(
            '{{ partial "course-closed-label.html" . }}'
            '{{ if eq .Section "tanfolyamok" }}' + note + '{{ end }}', encoding="utf-8")
        for section in ("turak", "tanfolyamok"):
            for state, current in (("closed", False), ("active", True), ("legacy", None)):
                meta = {"title": state}
                if current is not None:
                    meta["current"] = current
                (self.root / "content" / section / f"{state}.md").write_text(
                    "---\n" + yaml.safe_dump(meta) + "---\n", encoding="utf-8")
        result = subprocess.run([shutil.which("hugo"), "--source", str(self.root)],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for section in ("turak", "tanfolyamok"):
            for state in ("closed", "active", "legacy"):
                html = (self.root / "public" / section / state / "index.html").read_text(encoding="utf-8")
                expected = section == "tanfolyamok" and state != "active"
                self.assertEqual("(lezárult)" in html, expected)
                self.assertEqual("A tanfolyam lezárult." in html, expected)
        for relative in ("tanfolyamok/list.html", "tanfolyamok/single.html", "partials/blog-list.html"):
            source = (ROOT / "layouts" / relative).read_text(encoding="utf-8")
            self.assertIn('partial "course-closed-label.html" .', source)
        self.assertNotIn('class="ftsk-tanfolyam-jelentkezem" style=', template)

    def test_removed_banner_has_no_empty_image_or_reserved_space(self):
        result = self.build(60, image=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for section in ("turak", "tanfolyamok"):
            html = (self.root / "public" / section / "test" / "index.html").read_text(encoding="utf-8")
            self.assertNotIn("ftsk-featured-image", html)
            self.assertNotIn('alt="featured-image"', html)
            self.assertIn('<img src="/images/body.webp" alt="Body photo">', html)

    def test_removed_card_images_are_omitted_in_all_thumbnail_surfaces(self):
        fragments = []
        for relative in ("tanfolyamok/single.html", "tanfolyamok/list.html",
                         "turak/single.html", "turak/list.html", "partials/blog-list.html"):
            source = (ROOT / "layouts" / relative).read_text(encoding="utf-8")
            fragments.extend(re.findall(r'{{ if \.Params\.thumbImg\.image_path }}<img[^>]+>{{ end }}', source))
        self.assertEqual(len(fragments), 7)
        (self.root / "layouts" / "_default" / "single.html").write_text(
            "".join(fragments) + "{{ .Content }}", encoding="utf-8")
        result = self.build(omitted=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for section in ("turak", "tanfolyamok"):
            output = self.root / "public" / section / "test" / "index.html"
            html = output.read_text(encoding="utf-8")
            self.assertEqual(html.count("<img"), 1)
            file = self.root / "content" / section / "test.md"
            source = file.read_text(encoding="utf-8")
            file.write_text(source.replace("title:", "thumbImg: {image_path: /images/card.webp}\ntitle:", 1), encoding="utf-8")
        result = subprocess.run([shutil.which("hugo"), "--source", str(self.root)],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for section in ("turak", "tanfolyamok"):
            html = (self.root / "public" / section / "test" / "index.html").read_text(encoding="utf-8")
            self.assertEqual(html.count('src="/images/card.webp"'), 7)
