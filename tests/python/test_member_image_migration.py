"""ID-folder migration preserves originals and refuses ambiguous overwrites."""

from unittest.mock import patch

from scripts.migrate_member_images import apply, plan
from test_member_workbench import MemberFixture


class MigrationTests(MemberFixture):
    def test_move_preserves_bytes_references_and_mixed_folder_recognition(self):
        folder = self.root / "static" / "images" / "members" / "alice"
        folder.mkdir()
        illustration = folder / "illustration.webp"
        illustration.write_bytes(b"CV image")
        self.report.write_bytes(self.report_bytes + b"![Portrait](/images/members/alice_full.webp)\n")
        original = self.roster.read_bytes()
        moves, edits = plan(self.root)
        self.assertEqual(len(moves), 2)
        self.assertEqual(self.roster.read_bytes(), original)
        apply(moves, edits)
        for move in moves:
            self.assertFalse(move["source"].exists())
            self.assertEqual(move["target"].read_bytes(), b"fixture image")
        self.assertEqual(illustration.read_bytes(), b"CV image")
        self.assertIn(b"/images/members/alice/alice_full.webp", self.report.read_bytes())
        catalog = self.app.members.catalog()
        alice = next(person for person in catalog["people"] if person["id"] == "alice")
        self.assertEqual(alice["image"], "/images/members/alice/alice_thumb.webp")
        self.assertIn(alice["image"], catalog["portraits"])
        self.assertIn(alice["modal_image"], catalog["portraits"])
        self.assertNotIn("/images/members/alice/illustration.webp", catalog["portraits"])
        self.assertNotIn("/images/members/alice/illustration.webp", catalog["audit"]["unassigned_portraits"])
        self.assertEqual(plan(self.root), ([], []))

    def test_existing_destination_and_shared_images_are_rejected(self):
        folder = self.root / "static" / "images" / "members" / "alice"
        folder.mkdir()
        target = folder / "alice_thumb.webp"
        target.write_bytes(b"existing")
        with self.assertRaisesRegex(ValueError, "Destination already exists"):
            plan(self.root)
        self.assertEqual(target.read_bytes(), b"existing")
        target.unlink()
        self.roster.write_bytes(self.roster.read_bytes().replace(
            b"name: Bob", b"name: Bob\n  image: /images/members/alice_thumb.webp"))
        with self.assertRaisesRegex(ValueError, "Shared portrait"):
            plan(self.root)

    def test_stale_plan_and_failed_reference_write_leave_originals_intact(self):
        original = self.roster.read_bytes()
        moves, edits = plan(self.root)
        self.roster.write_bytes(original + b"# external edit\n")
        with self.assertRaisesRegex(ValueError, "changed since planning"):
            apply(moves, edits)
        self.roster.write_bytes(original)
        with patch("scripts.migrate_member_images.write_atomic", side_effect=OSError("Fixture write failure")):
            with self.assertRaisesRegex(OSError, "Fixture write failure"):
                apply(moves, edits)
        self.assertEqual(self.roster.read_bytes(), original)
        for move in moves:
            self.assertTrue(move["source"].is_file())
            self.assertFalse(move["target"].exists())
