"""Real Hugo regressions for scope separation and shared profile resolution."""

import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

import yaml
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


class Buttons(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tiles, self.authors = [], []
        self.links = []
        self.status = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        classes = values.get("class", "").split()
        if tag == "button" and "ftsk-members-tile" in classes:
            self.tiles.append(values)
        if tag == "button" and "ftsk-turak-author" in classes:
            self.authors.append(values)
        if tag == "span" and "ftsk-members-status" in classes:
            self.status = True
        if tag == "a" and (values.get("href", "").startswith(("mailto:", "tel:")) or "ftsk-contact-social-link" in classes):
            self.links.append(values["href"])

    def handle_data(self, data):
        if self.status:
            self.tiles[-1]["status"] = self.tiles[-1].get("status", "") + data

    def handle_endtag(self, tag):
        if tag == "span":
            self.status = False


@unittest.skipUnless(shutil.which("hugo"), "Hugo is required for shared people rendering.")
class RenderingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="ftsk-people-render-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for folder in ("data", "content", "content/turak", "content/tanfolyamok",
                       "layouts", "layouts/partials", "layouts/_default", "layouts/_default/_markup"):
            (self.root / folder).mkdir(exist_ok=True)
        (self.root / "config.toml").write_text(
            'baseURL="https://example.test/subpath/"\ndisableKinds=["taxonomy","term","RSS","sitemap"]\n',
            encoding="utf-8")
        for name in ("people-index", "course-people", "automatic-role", "person", "participant-roles", "assignment-role", "page-author", "page-participants",
                     "member-tile", "participant-cards", "author-badge", "url", "tanfolyam-contacts", "person-social-links",
                     "person-contact-links", "person-profile-contacts", "member-modal", "member-cv", "article-figure", "article-size",
                     "meta", "social-card", "social-card-source", "absurl",
                     "member-cv-person", "member-cv-pages", "page-title"):
            shutil.copyfile(ROOT / "layouts" / "partials" / f"{name}.html",
                            self.root / "layouts" / "partials" / f"{name}.html")
        shutil.copyfile(ROOT / "layouts" / "partials" / "sections" / "global" / "members.html",
                        self.root / "layouts" / "partials" / "members.html")
        shutil.copyfile(ROOT / "layouts" / "partials" / "sections" / "contact" / "info.html",
                        self.root / "layouts" / "partials" / "contact-info.html")
        shutil.copyfile(ROOT / "layouts" / "partials" / "sections" / "global" / "richtext.html",
                        self.root / "layouts" / "partials" / "richtext.html")
        (self.root / "layouts" / "index.html").write_text(
            '{{ partial "members.html" (dict "title" "Members" "title_suffix" "") }}'
            '{{ partial "member-modal.html" . }}', encoding="utf-8")
        shutil.copyfile(ROOT / "layouts" / "_default" / "_markup" / "render-image.html",
                        self.root / "layouts" / "_default" / "_markup" / "render-image.html")
        (self.root / "layouts" / "member-cv").mkdir()
        shutil.copyfile(ROOT / "layouts" / "member-cv" / "single.html",
                        self.root / "layouts" / "member-cv" / "single.html")
        shutil.copyfile(ROOT / "layouts" / "rss.xml", self.root / "layouts" / "rss.xml")
        (self.root / "layouts" / "member-cv" / "baseof.html").write_text(
            '<html><head>{{ partial "meta.html" . }}</head><body>{{ block "main" . }}{{ end }}</body></html>',
            encoding="utf-8")
        (self.root / "assets" / "images" / "members" / "alice").mkdir(parents=True)
        (self.root / "assets" / "images" / "og").mkdir()
        for path in ("members/alice/portrait.webp", "alice.webp", "fallback.png", "ftsk-logo.png"):
            Image.new("RGB", (120, 180), "#184175").save(self.root / "assets" / "images" / path)
        Image.new("RGBA", (1200, 630), (0, 0, 0, 100)).save(
            self.root / "assets" / "images" / "og" / "gradient.png")
        (self.root / "data" / "meta.yaml").write_text(
            'image: /images/fallback.png\nBaseURL: https://production.test\n', encoding="utf-8")
        (self.root / "layouts" / "_default" / "single.html").write_text(
            '{{ with (partial "page-author.html" .) }}{{ partial "author-badge.html" . }}{{ end }}'
            '{{ partial "participant-cards.html" (dict "participants" (partial "page-participants.html" .) "section" .Section) }}'
            '{{ with .Params.contacts }}{{ partial "tanfolyam-contacts.html" . }}{{ end }}'
            '{{ range .Params.content_blocks }}{{ if eq ._bookshop_name "contact/info" }}{{ partial "contact-info.html" . }}{{ end }}'
            '{{ if eq ._bookshop_name "global/richtext" }}{{ partial "richtext.html" . }}{{ end }}{{ end }}',
            encoding="utf-8")
        self.registry = {"people": [
            {"id": "alice", "name": "Alice Cute", "aliases": ["Alice Formal"],
             "image": "/images/alice.webp", "bio": "Shared biography"},
            {"id": "guest", "name": "Guest", "image": "/images/guest.webp"},
        ], "groups": [{"label": "Current members", "members": [{"person": "alice", "role": "President"}]}]}
        self.write_registry()
        self.roles = {"roles": [
            {"id": "president", "label": "President", "aliases": [], "exempt_from_guest": False},
            {"id": "student", "label": "Tanuló", "aliases": ["student", "hallgató"], "exempt_from_guest": True},
            {"id": "helper", "label": "Segítő", "aliases": [], "exempt_from_guest": False},
            {"id": "course-status", "label": "tanfolyami résztvevő",
             "automatic_when": {"current_member": False, "course_participant": True}},
            {"id": "guest-status", "label": "vendég"},
        ]}
        (self.root / "data" / "participant_roles.yaml").write_text(
            yaml.safe_dump(self.roles, allow_unicode=True), encoding="utf-8")
        (self.root / "content" / "turak" / "trip.md").write_text(
            "---\ntitle: Trip\nauthor_id: alice\nparticipant_ids:\n- person: alice\n  role: trip guide\n"
            "- guest\n---\n", encoding="utf-8")
        (self.root / "content" / "tanfolyamok" / "course.md").write_text(
            "---\ntitle: Course\nauthor: Alice Formal\nparticipant_ids:\n- person: guest\n  role: student\n"
            "---\n", encoding="utf-8")

    def write_registry(self):
        (self.root / "data" / "people.yaml").write_text(
            yaml.safe_dump(self.registry, allow_unicode=True, sort_keys=False), encoding="utf-8")

    def write_document(self, identifier, body, **params):
        path = self.root / "content" / "tagok" / identifier / "index.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("---\n" + yaml.safe_dump(
            {"type": "member-cv", "person": identifier, **params}, allow_unicode=True,
            sort_keys=False) + "---\n\n" + body, encoding="utf-8")
        return path

    def build(self):
        return subprocess.run([shutil.which("hugo"), "--source", str(self.root)],
                              capture_output=True, text=True, check=False)

    def parsed(self, relative):
        buttons = Buttons()
        buttons.feed((self.root / "public" / relative / "index.html").read_text(encoding="utf-8"))
        return buttons

    def test_cv_markdown_portrait_captions_subpath_and_category_hint(self):
        body = '## Life\n\n**Remembered**\n\n![Cave](/images/members/alice/cave.webp "A caption")'
        document = self.write_document("alice", body)
        self.registry["people"][0]["modal_image"] = "/images/members/alice/portrait.webp"
        self.registry["groups"][0]["hint"] = "Click to open the necrolog"
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        html = (self.root / "public" / "index.html").read_text(encoding="utf-8")
        self.assertIn('data-person-id="alice"', html)
        self.assertIn('id="ftsk-member-cv-alice"', html)
        self.assertNotIn('id="ftsk-member-cv-guest"', html)
        self.assertIn("<h2", html)
        self.assertIn(">Life</h2>", html)
        self.assertIn("<strong>Remembered</strong>", html)
        self.assertIn("<figcaption>A caption</figcaption>", html)
        self.assertIn('/subpath/images/members/alice/cave.webp', html)
        self.assertIn('/subpath/images/members/alice/portrait.webp', html)
        self.assertIn('class="ftsk-members-hint">Click to open the necrolog</p>', html)
        self.assertIn('class="ftsk-member-cv-group">Current members</p>', html)
        self.assertIn('class="ftsk-member-cv-label">CV</p>', html)
        self.assertIn('href="/subpath/tagok/alice/"', html)
        share = self.root / "public" / "tagok" / "alice" / "index.html"
        self.assertTrue(share.is_file())
        shared_html = share.read_text(encoding="utf-8")
        self.assertIn('<h1>Alice Cute</h1>', shared_html)
        self.assertNotIn('class="ftsk-member-cv-share"', shared_html)
        self.assertNotIn('ftsk-member-cv-copy', shared_html)
        self.assertIn('<meta property="og:title" content="Alice Cute – CV"', shared_html)
        self.assertIn('<meta property="og:type" content="article"', shared_html)
        self.assertIn('<meta property="og:url" content="https://example.test/subpath/tagok/alice/"', shared_html)
        self.assertIn('<link rel="canonical" href="https://production.test/tagok/alice/"', shared_html)
        # Inspect the actual generated image, not just the metadata tag.
        class SocialImage(HTMLParser):
            url = ""

            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag == "meta" and attrs.get("property") == "og:image":
                    self.url = attrs["content"]

        parser = SocialImage()
        parser.feed(shared_html)
        self.assertTrue(parser.url.startswith("https://example.test/subpath/images/members/alice/"))
        with Image.open(self.root / "public" / parser.url.split("/subpath/", 1)[1]) as image:
            self.assertEqual(image.size, (1200, 630))
        self.assertIn('<strong>Remembered</strong>', shared_html)
        self.assertIn('class="ftsk-member-cv-page ftsk-hero-top-motif"', shared_html)
        self.assertIn('class="ftsk-member-cv-preview container"', shared_html)
        self.assertIn('<figcaption>A caption</figcaption>', shared_html)
        self.assertFalse((self.root / "public" / "tagok" / "guest").exists())
        self.write_document("alice", body, document_label='Nekrológ <em>Életút</em>')
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        html = (self.root / "public" / "index.html").read_text(encoding="utf-8")
        self.assertIn('class="ftsk-member-cv-label">Nekrológ &lt;em&gt;Életút&lt;/em&gt;</p>', html)
        self.assertIn('Nekrológ &lt;em&gt;Életút&lt;/em&gt;', share.read_text(encoding="utf-8"))
        document.unlink()
        self.registry["groups"][0].pop("hint")
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        html = (self.root / "public" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn('id="ftsk-member-cv-alice"', html)
        self.assertNotIn('class="ftsk-members-hint"', html)

    def test_cv_share_without_portrait_uses_stable_fallback(self):
        self.write_document("guest", "## Guest life\n\nBiography.")
        self.registry["people"][1].pop("image")
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        html = (self.root / "public" / "tagok" / "guest" / "index.html").read_text(encoding="utf-8")
        self.assertIn('<h1>Guest</h1>', html)
        self.assertIn('content="https://example.test/subpath/images/fallback_', html)

    def test_cv_year_paragraph_and_real_numbered_list(self):
        self.write_document("alice", "1931\\. április 29-én született.\n\n1. First\n2. Second")
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for relative in ("index.html", "tagok/alice/index.html"):
            html = (self.root / "public" / relative).read_text(encoding="utf-8")
            self.assertIn("<p>1931. április 29-én született.</p>", html)
            self.assertNotIn('<ol start="1931">', html)
            self.assertIn("<ol>", html)
            self.assertRegex(html, r"<li>\s*(?:<p>)?First(?:</p>)?\s*</li>")
            self.assertRegex(html, r"<li>\s*(?:<p>)?Second(?:</p>)?\s*</li>")

    def test_cv_subtitle_beneath_name_escaped_and_optional(self):
        self.write_document("alice", "Life story", subtitle="1931 – 2025 <em>Remembered</em>")
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for relative, heading in (("index.html", "h2"), ("tagok/alice/index.html", "h1")):
            html = (self.root / "public" / relative).read_text(encoding="utf-8")
            self.assertRegex(html, rf"<{heading}>Alice Cute</{heading}>\s*"
                             r'<p class="ftsk-member-cv-subtitle">1931 – 2025 &lt;em&gt;Remembered&lt;/em&gt;</p>')
        self.write_document("alice", "Life story", subtitle=" ")
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for relative in ("index.html", "tagok/alice/index.html"):
            self.assertNotIn('class="ftsk-member-cv-subtitle"',
                             (self.root / "public" / relative).read_text(encoding="utf-8"))

    def test_cv_author_after_body_escaped_and_optional(self):
        self.write_document("alice", "Life story", document_author="Writer <em>Name</em>")
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for relative in ("index.html", "tagok/alice/index.html"):
            html = (self.root / "public" / relative).read_text(encoding="utf-8")
            credit = '<p class="ftsk-member-cv-author">Writer &lt;em&gt;Name&lt;/em&gt;</p>'
            self.assertIn(credit, html)
            self.assertLess(html.index("Life story"), html.index(credit))
        self.write_document("alice", "Life story", document_author=" ")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for relative in ("index.html", "tagok/alice/index.html"):
            self.assertNotIn('class="ftsk-member-cv-author"',
                             (self.root / "public" / relative).read_text(encoding="utf-8"))

    def test_cv_duplicate_and_unknown_person_fail_build(self):
        self.write_document("alice", "Life story")
        self.write_document("other", "Duplicate", person="alice")
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Multiple CV pages", result.stdout + result.stderr)
        self.write_document("other", "Unknown")
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("known person ID", result.stdout + result.stderr)

    def test_cv_draft_and_empty_document_do_not_replace_profile(self):
        self.write_document("alice", "Unpublished", draft=True)
        self.write_document("guest", " ")
        self.registry["people"][1].pop("image")
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        html = (self.root / "public" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn('id="ftsk-member-cv-alice"', html)
        self.assertNotIn('id="ftsk-member-cv-guest"', html)

    def test_cv_identity_and_share_url_come_from_person_and_page(self):
        document = self.write_document("alice", "Life story", document_label="Életút")
        self.registry["people"][0]["name"] = "Renamed Alice"
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        html = (self.root / "public" / "tagok" / "alice" / "index.html").read_text(encoding="utf-8")
        self.assertIn("<h1>Renamed Alice</h1>", html)
        self.assertIn('content="Renamed Alice – Életút"', html)
        self.assertNotIn("Renamed Alice", document.read_text(encoding="utf-8"),
                         "Document does not duplicate registry identity")
        self.write_document("alice", "Life story", document_label="Életút", url="/emlekezes/alice/")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        roster = (self.root / "public" / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="/subpath/emlekezes/alice/"', roster,
                      "Modal shares the page's real permalink, not an ID-guessed URL")

    def test_registry_cv_is_rejected_instead_of_a_second_content_source(self):
        self.registry["people"][0]["cv"] = "Legacy document"
        self.write_registry()
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("move CV content", result.stdout + result.stderr)

    def test_cv_feed_uses_registry_identity_without_duplicate_title(self):
        config = self.root / "config.toml"
        config.write_text(config.read_text(encoding="utf-8").replace('"RSS",', ""), encoding="utf-8")
        self.write_document("alice", "Life story", document_label="Életút")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        items = ET.parse(self.root / "public" / "index.xml").getroot().findall("channel/item")
        document = next(item for item in items if item.findtext("link").endswith("/tagok/alice/"))
        self.assertEqual(document.findtext("title"), "Alice Cute – Életút")

    def test_current_membership_does_not_leak_into_course_or_trip_roles(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        roster, trip, course = self.parsed(""), self.parsed("turak/trip"), self.parsed("tanfolyamok/course")
        self.assertEqual([tile["data-name"] for tile in roster.tiles], ["Alice Cute"])
        self.assertEqual(roster.tiles[0]["data-role"], "President")
        self.assertEqual(trip.tiles[0]["data-role"], "trip guide")
        self.assertEqual(course.tiles[0]["data-role"], "Tanuló")
        self.assertEqual(course.tiles[0]["data-name"], "Guest")
        self.assertEqual(course.authors[0]["data-name"], "Alice Cute")
        self.assertEqual(course.authors[0]["data-image"], trip.tiles[0]["data-image"])
        self.assertIn("/subpath/images/alice.webp", course.authors[0]["data-image"])
        self.assertEqual(course.authors[0]["data-bio"], "Shared biography")
        self.assertEqual(trip.tiles[1]["data-image"], course.tiles[0]["data-image"])
        self.assertNotIn("status", trip.tiles[0])
        self.assertEqual(trip.tiles[1]["status"], "tanfolyami résztvevő")
        self.assertNotIn("status", course.tiles[0])
        self.assertNotIn("status", roster.tiles[0])
        self.registry["groups"][0]["members"] = []
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.parsed("").tiles, [])
        self.assertEqual(self.parsed("turak/trip").authors[0]["data-name"], "Alice Cute")
        self.assertNotIn("status", self.parsed("turak/trip").tiles[0], "Manual event role overrides fallback even after membership removal")
        self.assertEqual(self.parsed("tanfolyamok/course").tiles[0]["data-name"], "Guest")

    def test_manual_roles_override_automatic_status_even_for_nonmembers(self):
        for identifier in ("student", "tanulo", "hallgato", "helper"):
            self.registry["people"].append({"id": identifier, "name": identifier.title()})
        self.write_registry()
        (self.root / "content" / "turak" / "trip.md").write_text(
            "---\ntitle: Trip\nparticipant_ids:\n- alice\n- guest\n"
            "- person: student\n  role: ' Student '\n- person: tanulo\n  role: tanuló\n"
            "- person: hallgato\n  role: hallgató\n- person: helper\n  role: túravezető\n---\n",
            encoding="utf-8")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        tiles = self.parsed("turak/trip").tiles
        self.assertEqual([tile.get("status", "") for tile in tiles], ["", "tanfolyami résztvevő", "", "", "", ""])
        self.assertEqual([tile["data-role"] for tile in tiles], ["", "", "Tanuló", "Tanuló", "Tanuló", "túravezető"])
        self.assertNotIn("data-image", tiles[-1])

    def test_configurable_multiple_roles_rename_and_guest_policy(self):
        page = self.root / "content" / "turak" / "trip.md"
        page.write_text("---\ntitle: Trip\nparticipant_ids:\n"
                        "- person: guest\n  roles: [student, helper]\n---\n", encoding="utf-8")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.parsed("turak/trip").tiles[0]["data-role"], "Tanuló, Segítő")
        self.assertNotIn("status", self.parsed("turak/trip").tiles[0])
        path = self.root / "data" / "participant_roles.yaml"
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        data["roles"][1].update(label="Új szerep", exempt_from_guest=False)
        path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.parsed("turak/trip").tiles[0]["data-role"], "Új szerep, Segítő")
        self.assertNotIn("status", self.parsed("turak/trip").tiles[0], "Manual roles do not depend on the old guest-exemption flag")
        page.write_text("---\ntitle: Trip\nparticipant_ids:\n"
                        "- person: guest\n  roles: [nonexistent]\n---\n", encoding="utf-8")
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unknown participant role ID: nonexistent", result.stdout + result.stderr)

    def test_workbench_custom_categories_do_not_change_any_public_people_markup(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        before = {path.relative_to(self.root / "public"): path.read_bytes()
                  for path in (self.root / "public").rglob("*.html")}
        self.registry["categories"] = [
            {"id": "organizers", "label": "Workbench organizers", "people": ["alice", "guest"]},
            {"id": "students", "label": "Workbench students", "people": ["guest"]},
        ]
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        after = {path.relative_to(self.root / "public"): path.read_bytes()
                 for path in (self.root / "public").rglob("*.html")}
        self.assertEqual(before, after)

    def test_membership_role_list_keeps_identical_visible_labels_order_and_cards(self):
        self.registry["groups"][0]["members"][0]["role"] = "President, Segítő"
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        before = self.parsed("").tiles
        trip = self.parsed("turak/trip").tiles
        self.registry["groups"][0]["members"][0] = {"person": "alice", "roles": ["president", "helper"]}
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.parsed("").tiles, before)
        self.assertEqual(self.parsed("turak/trip").tiles, trip, "Membership duties do not leak into page-specific roles")
        roles_path = self.root / "data" / "participant_roles.yaml"
        self.roles["roles"][0]["label"] = "Renamed duty"
        roles_path.write_text(yaml.safe_dump(self.roles, allow_unicode=True), encoding="utf-8")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.parsed("").tiles[0]["data-role"], "Renamed duty, Segítő")

    def test_legacy_guest_names_resolve_but_unknown_names_are_not_guessed(self):
        (self.root / "content" / "turak" / "trip.md").write_text(
            "---\ntitle: Trip\nparticipants: [Alice Formal, Guest, Unknown Visitor]\n---\n",
            encoding="utf-8")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([tile.get("status", "") for tile in self.parsed("turak/trip").tiles],
                         ["", "tanfolyami résztvevő", ""])

    def test_data_driven_automatic_rules_saved_draft_course_and_manual_override(self):
        course = self.root / "content" / "tanfolyamok" / "course.md"
        course.write_text("---\ntitle: Course\ndraft: true\nparticipants: [Guest]\n---\n", encoding="utf-8")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.parsed("turak/trip").tiles[1]["status"], "tanfolyami résztvevő")
        roles_path = self.root / "data" / "participant_roles.yaml"
        self.roles["roles"][3]["label"] = "Course alumnus"
        roles_path.write_text(yaml.safe_dump(self.roles, allow_unicode=True), encoding="utf-8")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.parsed("turak/trip").tiles[1]["status"], "Course alumnus")
        course.unlink()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("status", self.parsed("turak/trip").tiles[1], "Nonmembership alone never implies guest status")
        (self.root / "content" / "turak" / "trip.md").write_text(
            "---\ntitle: Trip\nparticipant_ids:\n- person: guest\n  roles: [guest-status]\n---\n", encoding="utf-8")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.parsed("turak/trip").tiles[0]["data-role"], "vendég", "Explicit guest assignments remain supported")
        self.assertNotIn("status", self.parsed("turak/trip").tiles[0])

    def test_overlapping_automatic_rules_fail_build(self):
        self.roles["roles"][4]["automatic_when"] = {"current_member": False}
        (self.root / "data" / "participant_roles.yaml").write_text(
            yaml.safe_dump(self.roles, allow_unicode=True), encoding="utf-8")
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("rules overlap", result.stdout + result.stderr)

    def test_unknown_canonical_id_fails_build_instead_of_plain_name_fallback(self):
        (self.root / "content" / "turak" / "trip.md").write_text(
            "---\ntitle: Trip\nauthor_id: nonexistent\n---\n", encoding="utf-8")
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unknown person ID: nonexistent", result.stdout + result.stderr)

    def test_contact_cards_share_registry_portraits_and_details_without_leaking_to_normal_cards(self):
        self.registry["people"][0].update(email="alice@example.test", phone="+36 (20) 123-4567")
        self.write_registry()
        (self.root / "content" / "tanfolyamok" / "course.md").write_text(
            "---\ntitle: Course\ncontacts:\n- person: alice\n  role: organizer\n---\n", encoding="utf-8")
        (self.root / "content" / "kapcsolat.md").write_text(
            "---\ntitle: Contact\ncontent_blocks:\n- _bookshop_name: contact/info\n"
            "  heading: Contacts\n  contacts:\n  - person: alice\n    role: president\n"
            "  - person: guest\n---\n", encoding="utf-8")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for relative, role in (("tanfolyamok/course", "organizer"), ("kapcsolat", "president")):
            cards = self.parsed(relative)
            self.assertEqual(cards.tiles[0]["data-name"], "Alice Cute")
            self.assertEqual(cards.tiles[0]["data-role"], role)
            self.assertEqual(cards.tiles[0]["data-image"], "/subpath/images/alice.webp")
            self.assertIn("ftsk-contact-profile", cards.tiles[0]["class"])
            self.assertEqual(cards.links, ["tel:+36201234567", "mailto:alice@example.test"])
            self.assertNotIn("data-email", cards.tiles[0])
            self.assertNotIn("data-phone", cards.tiles[0], "Profile popup must not receive contact details")
        for relative in ("", "turak/trip"):
            html = (self.root / "public" / relative / "index.html").read_text(encoding="utf-8")
            self.assertNotIn("alice@example.test", html)
            self.assertNotIn("123-4567", html)
        self.registry["people"][0]["email"] = "new@example.test"
        self.write_registry()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for relative in ("tanfolyamok/course", "kapcsolat"):
            self.assertIn("mailto:new@example.test", self.parsed(relative).links)

    def test_social_links_render_only_on_explicit_contact_cards(self):
        links = ["https://www.instagram.com/alice/", "https://example.test/alice",
                 "https://facebook.com.evil.test/alice"]
        self.registry["people"][0]["social_links"] = links
        self.write_registry()
        (self.root / "content" / "tanfolyamok" / "course.md").write_text(
            "---\ntitle: Course\ncontacts:\n- person: alice\n---\n", encoding="utf-8")
        (self.root / "content" / "kapcsolat.md").write_text(
            "---\ntitle: Contacts\ncontent_blocks:\n- _bookshop_name: contact/info\n  contacts:\n  - person: alice\n---\n",
            encoding="utf-8")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for relative in ("tanfolyamok/course", "kapcsolat"):
            html = (self.root / "public" / relative / "index.html").read_text(encoding="utf-8")
            self.assertEqual(self.parsed(relative).links, links)
            self.assertIn("ph-instagram-logo", html)
            self.assertEqual(html.count('class="ph ph-link"'), 2, "Lookalike domains use the generic icon")
            self.assertIn('aria-label="Alice Cute: Instagram"', html)
            self.assertIn('rel="noopener noreferrer"', html)
        for relative in ("", "turak/trip"):
            html = (self.root / "public" / relative / "index.html").read_text(encoding="utf-8")
            self.assertNotIn(links[0], html, "Private contact details must not leak into ordinary cards")

    def test_invalid_social_links_fail_the_build(self):
        for link in ("javascript:alert(1)", "https://user:password@example.test/", "https://example.test/ bad"):
            with self.subTest(link=link):
                self.registry["people"][0]["social_links"] = [link]
                self.write_registry()
                (self.root / "content" / "tanfolyamok" / "course.md").write_text(
                    "---\ntitle: Course\ncontacts:\n- person: alice\n---\n", encoding="utf-8")
                result = self.build()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("invalid social link", result.stdout + result.stderr)

    def test_profile_contacts_are_explicit_opt_in_for_all_profile_triggers(self):
        person = self.registry["people"][0]
        person.update(email="alice@example.test", phone="+36 20 1234567",
                      social_links=["https://instagram.com/alice"])
        for enabled in (None, False, True, False):
            with self.subTest(enabled=enabled):
                if enabled is None:
                    person.pop("show_profile_contacts", None)
                else:
                    person["show_profile_contacts"] = enabled
                self.write_registry()
                result = self.build()
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                for relative in ("", "turak/trip"):
                    html = (self.root / "public" / relative / "index.html").read_text(encoding="utf-8")
                    self.assertEqual("alice@example.test" in html, enabled is True)
                    if enabled:
                        self.assertRegex(html, r'</button>\s*<template class="ftsk-profile-contacts">')
                        self.assertIn("tel:+36201234567", self.parsed(relative).links)
                        self.assertIn("ph-instagram-logo", html)
                if enabled:
                    trip = (self.root / "public" / "turak" / "trip" / "index.html").read_text(encoding="utf-8")
                    self.assertEqual(trip.count('class="ftsk-profile-contacts"'), 2, "Author and participant profiles both opt in")

    def test_richtext_contacts_resolve_shared_registry_details(self):
        self.registry["people"][0]["email"] = "alice@example.test"
        self.write_registry()
        (self.root / "content" / "association.md").write_text(
            "---\ntitle: Association\ncontent_blocks:\n- _bookshop_name: global/richtext\n"
            "  title: Official details\n  content: Keep address\n"
            "  contacts:\n  - person: alice\n    roles: [president]\n---\n", encoding="utf-8")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.parsed("association").links, ["mailto:alice@example.test"])
        self.assertEqual(self.parsed("association").tiles[0]["data-role"], "President")

    def test_profile_visibility_requires_a_real_boolean(self):
        self.registry["people"][0]["show_profile_contacts"] = "true"
        self.write_registry()
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("show_profile_contacts must be true or false", result.stdout + result.stderr)

if __name__ == "__main__":
    unittest.main()
