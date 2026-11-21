"""Report frontmatter controls archive selection, PDF eligibility and layout."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(shutil.which("hugo"), "Hugo is required.")
class ReportRenderingTests(unittest.TestCase):
    def test_archive_is_explicit_and_formatting_pdf_urls_are_validated(self):
        with tempfile.TemporaryDirectory(prefix="ftsk-report-rendering-") as directory:
            root = Path(directory)
            for folder in ("content/turak", "layouts/turak", "layouts/partials",
                           "layouts/_default", "static/js"):
                (root / folder).mkdir(parents=True)
            (root / "hugo.toml").write_text(
                'baseURL="https://example.test/preview/"\n'
                'disableKinds=["taxonomy","term","RSS","sitemap"]\n', encoding="utf-8")
            for name in ("single", "list"):
                shutil.copyfile(ROOT / "layouts" / "turak" / f"{name}.html",
                                root / "layouts" / "turak" / f"{name}.html")
            for name in ("report-archive", "article-size", "page-author", "url"):
                shutil.copyfile(ROOT / "layouts" / "partials" / f"{name}.html",
                                root / "layouts" / "partials" / f"{name}.html")
            shutil.copyfile(ROOT / "static" / "js" / "report-pdf.js",
                            root / "static" / "js" / "report-pdf.js")
            (root / "layouts" / "_default" / "baseof.html").write_text(
                '{{ block "main" . }}{{ end }}', encoding="utf-8")
            for name, template in {
                "person": '{{ return (dict "name" .) }}',
                "author-badge": '<span class="author">{{ . }}</span>',
                "featured-image": "", "article-faq": "", "page-participants": "{{ return false }}",
                "archive-pager": "",
            }.items():
                (root / "layouts" / "partials" / f"{name}.html").write_text(template, encoding="utf-8")
            (root / "content" / "turak" / "_index.md").write_text(
                "---\ntitle: Reports\n---\n", encoding="utf-8")
            pages = {
                "legacy-modern": 'archive: false\narticle_paragraph_spacing: 0\narticle_text_align: justify\nauthor: Test Author\n',
                "archived": 'archive: true\narticle_paragraph_spacing: 4\narticle_text_align: right\n',
                "default": "",
                "null-default": "article_paragraph_spacing: null\narticle_text_align: null\n",
            }
            for name, fields in pages.items():
                (root / "content" / "turak" / f"{name}.md").write_text(
                    f"---\ntitle: {name}\ndate: 2020-01-01\n{fields}---\n\nFirst paragraph.\n\nSecond paragraph.\n",
                    encoding="utf-8")

            def build():
                return subprocess.run([shutil.which("hugo"), "--source", str(root)],
                                      capture_output=True, text=True, check=False)

            result = build()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            modern = (root / "public" / "turak" / "legacy-modern" / "index.html").read_text(encoding="utf-8")
            self.assertIn('id="report-pdf-download"', modern)
            self.assertIn("--article-paragraph-spacing: 0rem", modern)
            self.assertIn("--article-text-align: justify", modern)
            self.assertIn('class="ftsk-report-meta-separator" aria-hidden="true"', modern)
            self.assertIn('data-logo="/preview/images/ftsk-logo.png"', modern)
            self.assertIn('data-pdfmake="/preview/vendor/report-pdf/pdfmake.min.js"', modern)
            archived = (root / "public" / "turak" / "archived" / "index.html").read_text(encoding="utf-8")
            self.assertNotIn('id="report-pdf-download"', archived)
            self.assertNotIn("report-pdf.min", archived)
            self.assertIn("--article-paragraph-spacing: 4rem", archived)
            self.assertIn("--article-text-align: right", archived)
            for name in ("default", "null-default"):
                default = (root / "public" / "turak" / name / "index.html").read_text(encoding="utf-8")
                self.assertIn('id="report-pdf-download"', default)
                self.assertIn("--article-paragraph-spacing: 1.5rem", default)
                self.assertIn("--article-text-align: left", default)
                self.assertNotIn("ftsk-report-meta-separator", default)
            listing = (root / "public" / "turak" / "index.html").read_text(encoding="utf-8")
            featured = listing.split('id="ftsk-turak-featured"')[1].split('id="ftsk-turak-grid"')[0]
            self.assertNotIn("/preview/turak/archived/", featured)
            self.assertEqual(listing.count("ftsk-turak-card-legacy"), 1)
            for fields, error in (
                ('archive: "false"\n', "archive must be true or false"),
                ("article_paragraph_spacing: 4.01\n", "must be between 0 and 4"),
                ("article_text_align: false\n", "article_text_align must be"),
            ):
                with self.subTest(fields=fields):
                    (root / "content" / "turak" / "invalid.md").write_text(
                        f"---\ntitle: Invalid\ndate: 2020-01-01\n{fields}---\nText\n", encoding="utf-8")
                    invalid = build()
                    self.assertNotEqual(invalid.returncode, 0)
                    self.assertIn(error, invalid.stdout + invalid.stderr)
