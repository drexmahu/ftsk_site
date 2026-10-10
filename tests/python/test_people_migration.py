"""Migration regressions: preserve stories and never infer an unknown identity."""

import tempfile
import unittest
from pathlib import Path

from tools.workbench.content_workbench import parse_frontmatter, split_source
from scripts.migrate_people import plan


class MigrationTests(unittest.TestCase):
    def test_confirmed_display_names_and_shared_course_guest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "data").mkdir()
            (root / "content" / "tanfolyamok").mkdir(parents=True)
            roster = root / "data" / "members.yaml"
            roster.write_text("groups:\n- label: Members\n  members:\n"
                              "  - name: Kalotai Zsófia\n    role: Treasurer\n"
                              "    image: /images/members/shared.webp\n", encoding="utf-8")
            before = {}
            for year in (2015, 2017):
                file = root / "content" / "tanfolyamok" / f"course-{year}.md"
                text = "---\r\ntitle: Course\r\nauthor: Kalotai Zsófi\r\nparticipants:\r\n"
                text += "- Kalotai Zsófia\r\n- Zsuzsi\r\n---\r\n\r\nOriginal story\r\n"
                file.write_bytes(text.encode("utf-8"))
                before[file] = file.read_bytes()
            original_roster = roster.read_bytes()
            registry, changes = plan(root)
            self.assertEqual(len(registry["people"]), 2)
            self.assertEqual(registry["people"][0]["name"], "Kalotai Zsófi")
            self.assertEqual(registry["people"][0]["image"], "/images/members/shared.webp")
            self.assertEqual(registry["people"][1], {"id": "zsuzsi", "name": "Zsuzsi", "needs_review": True})
            self.assertEqual(registry["groups"][0]["members"], [{"person": "kalotai-zsofia", "role": "Treasurer"}])
            self.assertEqual(roster.read_bytes(), original_roster)
            self.assertFalse((root / "data" / "people.yaml").exists())
            for path, old, new in changes:
                self.assertEqual(old, before[path])
                self.assertEqual(path.read_bytes(), old)
                self.assertEqual(split_source(old.decode())[1], split_source(new.decode())[1])
                meta = parse_frontmatter(split_source(new.decode())[0])
                self.assertEqual(meta["author_id"], "kalotai-zsofia")
                self.assertEqual(meta["participant_ids"], ["kalotai-zsofia", "zsuzsi"])

    def test_collective_credit_does_not_become_a_fake_person(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "data").mkdir()
            (root / "content").mkdir()
            (root / "data" / "members.yaml").write_text(
                "groups:\n- label: Members\n  members: []\n", encoding="utf-8")
            (root / "content" / "credit.md").write_text(
                "---\ntitle: Archive\nauthor: Frédi és Leó\n---\nStory\n", encoding="utf-8")
            registry, changes = plan(root)
            self.assertEqual(registry["people"], [])
            self.assertEqual(changes, [])


if __name__ == "__main__":
    unittest.main()
