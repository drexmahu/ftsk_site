"""The quote and signature shortcodes render their markup and reject empty content."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(shutil.which("hugo"), "Hugo is required.")
class QuoteShortcodeTests(unittest.TestCase):
    def build(self, body):
        directory = tempfile.TemporaryDirectory(prefix="ftsk-quote-")
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        for folder in ("content", "layouts/shortcodes", "layouts/_default"):
            (root / folder).mkdir(parents=True, exist_ok=True)
        (root / "hugo.toml").write_text(
            'baseURL="https://example.test/"\n'
            'disableKinds=["taxonomy","term","RSS","sitemap"]\n', encoding="utf-8")
        for name in ("quote.html", "signature.html"):
            shutil.copyfile(ROOT / "layouts" / "shortcodes" / name, root / "layouts" / "shortcodes" / name)
        (root / "layouts" / "_default" / "single.html").write_text("{{ .Content }}", encoding="utf-8")
        (root / "content" / "page.md").write_text(f"---\ntitle: Page\n---\n{body}", encoding="utf-8")
        result = subprocess.run([shutil.which("hugo"), "--source", str(root)],
                                capture_output=True, text=True, check=False)
        html_path = root / "public" / "page" / "index.html"
        return result, html_path.read_text(encoding="utf-8") if html_path.exists() else ""

    def test_attribution_markdown_and_plain_quote(self):
        result, html = self.build(
            '{{< quote author="Lukács László" source="Barlangjárás, 1982" >}}\n'
            "Első **kiemelt** mondat.\n\nMásodik bekezdés.\n"
            "{{< /quote >}}\n\n"
            "{{< quote >}}\nCsak szöveg.\n{{< /quote >}}\n")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(html.count('<figure class="ftsk-quote">'), 2)
        self.assertIn('<blockquote class="ftsk-quote-text"><p>Első <strong>kiemelt</strong> mondat.</p>', html)
        self.assertIn("<p>Második bekezdés.</p>", html)
        self.assertIn('<span class="ftsk-quote-author">Lukács László</span>', html)
        self.assertIn('<cite class="ftsk-quote-source">Barlangjárás, 1982</cite>', html)
        self.assertEqual(html.count("ftsk-quote-attribution"), 1, "No empty attribution without author/source")

    def test_empty_quote_fails_build(self):
        result, _ = self.build("{{< quote author=\"Nobody\" >}}\n  \n{{< /quote >}}\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("quote shortcode requires quoted text", result.stdout + result.stderr)

    def test_signature_renders_and_rejects_empty(self):
        result, html = self.build("Szöveg.\n\n{{< signature >}}Gazdag László – Zsólyomi Zsolt{{< /signature >}}\n")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('<p class="ftsk-signature">Gazdag László – Zsólyomi Zsolt</p>', html)
        result, _ = self.build("{{< signature >}} {{< /signature >}}\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("signature shortcode requires the signing name", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
