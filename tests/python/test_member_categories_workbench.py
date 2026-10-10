"""Category regressions use disposable people registries and course pages."""

import copy
import unittest

import yaml

from tools.workbench.content_workbench import ConflictError, ContentError
from tools.workbench.people_registry import registry_data
from test_member_workbench import MemberFixture


class CategoryTests(MemberFixture):
    def category_payload(self, identifier="organizers", label="Organizers", original=None):
        return {"revision": self.app.members.catalog()["revision"],
                "id": identifier, "label": label, "original": original}

    def add_categories(self):
        self.app.members.save_category(self.category_payload())
        self.app.members.save_category(self.category_payload("helpers", "Helpers"))

    def course(self, name="course", participants=None):
        path = self.root / "content" / "tanfolyamok" / f"{name}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {"title": f"Course {name}", "date": "2027-01-01", "draft": True,
                "participant_ids": participants or []}
        path.write_text("---\n" + yaml.safe_dump(data) + "---\nBody stays unchanged.\n", encoding="utf-8")
        return path

    def test_categories_create_rename_and_multiple_assignments_do_not_change_membership(self):
        groups = copy.deepcopy(self.app.members.read()[2]["groups"])
        self.add_categories()
        payload = self.payload({"id": "alice", "name": "Alice", "nickname": "Ally", "role": "Leader"},
                               {"id": "alice"}, group=0)
        result = self.app.members.save({**payload, "categories": ["organizers", "helpers"]})
        person = next(person for person in result["people"] if person["id"] == "alice")
        self.assertEqual({category["id"] for category in person["categories"]},
                         {"membership:0", "custom:organizers", "custom:helpers"})
        self.assertEqual(self.app.members.read()[2]["groups"], groups)
        self.assertEqual(self.report.read_bytes(), self.report_bytes)
        self.app.members.save_category(self.category_payload(label="Trip organizers", original="organizers"))
        categories = self.app.members.read()[2]["categories"]
        self.assertEqual(categories[0], {"id": "organizers", "label": "Trip organizers", "people": ["alice"]})
        # Older clients preserve assignments when the category payload is omitted.
        self.app.members.save(self.payload({"name": "Alice", "nickname": "Ally", "role": "Leader"}, {"id": "alice"}))
        self.assertEqual(self.app.members.read()[2]["categories"], categories)
        payload = self.payload({"name": "Alice"}, {"id": "alice"}, group=None)
        self.app.members.save({**payload, "categories": []})
        self.assertTrue(all(not category["people"] for category in self.app.members.read()[2]["categories"]))

    def test_new_nonmember_can_belong_to_multiple_custom_categories(self):
        self.add_categories()
        result = self.app.members.save({**self.payload(group=None), "categories": ["helpers", "organizers"]})
        person = next(person for person in result["people"] if person["id"] == "new-person")
        self.assertIsNone(person["membership"])
        self.assertEqual(len(person["categories"]), 2)

    def test_course_groups_include_all_participants_regardless_of_role(self):
        first = self.course(participants=[{"person": "alice", "role": " Student "}, {"person": "bob", "role": "instructor"}])
        second = self.course("second", [{"person": "alice", "role": "hallgató"}, "bob"])
        self.course("empty")
        self.course("_index")
        raw = self.roster.read_bytes()
        catalog = self.app.members.catalog()
        courses = [category for category in catalog["categories"] if category["kind"] == "course"]
        self.assertEqual(len(courses), 3)
        self.assertEqual([category["people"] for category in courses], [["alice", "bob"], [], ["alice", "bob"]])
        self.assertTrue(all(category["draft"] for category in courses))
        alice = next(person for person in catalog["people"] if person["id"] == "alice")
        self.assertEqual(len([category for category in alice["categories"] if category["kind"] == "course"]), 2)
        self.assertEqual(self.roster.read_bytes(), raw, "Derived assignments must never be written to the registry")
        before = first.read_text(encoding="utf-8")
        first.write_text(before.replace("Student", "instructor"), encoding="utf-8")
        second.unlink()
        courses = [category for category in self.app.members.catalog()["categories"] if category["kind"] == "course"]
        self.assertEqual([category["people"] for category in courses], [["alice", "bob"], []])
        bob = next(person for person in catalog["people"] if person["id"] == "bob")
        self.assertEqual(len([category for category in bob["categories"] if category["kind"] == "course"]), 2)
        self.assertIn("role: instructor", first.read_text(encoding="utf-8"))

    def test_course_participants_can_be_roleless_nonmembers(self):
        self.app.members.save(self.payload({"name": "Alice", "nickname": "Ally"}, {"id": "alice"}, group=None))
        self.course(participants=["alice"])
        alice = next(person for person in self.app.members.catalog()["people"] if person["id"] == "alice")
        self.assertIsNone(alice["membership"])
        self.assertEqual(len(alice["categories"]), 1)
        self.assertTrue(alice["course_participant"])

    def test_legacy_course_participation_and_canonical_precedence(self):
        course = self.course()
        course.write_text("---\ntitle: Course\ndraft: true\nparticipants: [Ally]\n---\n", encoding="utf-8")
        catalog = self.app.members.catalog()
        self.assertTrue(next(person for person in catalog["people"] if person["id"] == "alice")["course_participant"])
        self.assertFalse(next(person for person in catalog["people"] if person["id"] == "bob")["course_participant"])
        course.write_text("---\ntitle: Course\nparticipant_ids: [bob]\nparticipants: [Ally]\n---\n", encoding="utf-8")
        catalog = self.app.members.catalog()
        self.assertTrue(any("not both" in warning for warning in catalog["audit"]["warnings"]))
        course.write_text("---\ntitle: Course\nparticipant_ids: [bob]\nparticipants: []\n---\n", encoding="utf-8")
        catalog = self.app.members.catalog()
        self.assertFalse(next(person for person in catalog["people"] if person["id"] == "alice")["course_participant"])
        self.assertTrue(next(person for person in catalog["people"] if person["id"] == "bob")["course_participant"])
        course.write_text("---\ntitle: Course\nauthor_id: bob\n---\n", encoding="utf-8")
        self.assertTrue(all(not person["course_participant"] for person in self.app.members.catalog()["people"]))

    def test_category_creation_requires_valid_unique_ids_and_labels(self):
        self.add_categories()
        for identifier, label, original in (
            ("organizers", "Another", None), ("other", " organizers ", None),
            ("bad/id", "Bad", None), (True, "Bad", None), ("empty", "", None),
            ("long", "x" * 201, None), ("control", "Bad\nlabel", None),
            ("new-id", "Renamed", "organizers"), ("unknown", "Unknown", "unknown"),
        ):
            with self.subTest(identifier=identifier):
                before = self.roster.read_bytes()
                with self.assertRaises(ContentError):
                    self.app.members.save_category(self.category_payload(identifier, label, original))
                self.assertEqual(self.roster.read_bytes(), before)

    def test_category_assignments_are_validated_and_course_groups_are_read_only(self):
        self.add_categories()
        for categories in (None, "helpers", [True], ["unknown"], ["helpers", "helpers"], ["course:content/tanfolyamok/course.md"]):
            with self.subTest(categories=categories):
                before = self.roster.read_bytes()
                with self.assertRaises(ContentError):
                    self.app.members.save({**self.payload(group=None), "categories": categories})
                self.assertEqual(self.roster.read_bytes(), before)

    def test_category_delete_requires_confirmation_and_no_assignments(self):
        self.add_categories()
        self.app.members.save({**self.payload(group=None), "categories": ["helpers"]})
        payload = self.category_payload("helpers", "Helpers")
        with self.assertRaises(ContentError):
            self.app.members.delete_category(payload)
        with self.assertRaises(ConflictError):
            self.app.members.delete_category({**payload, "confirm": True})
        self.app.members.delete_category({**self.category_payload(), "confirm": True})
        self.assertEqual(len(self.app.members.read()[2]["categories"]), 1)

    def test_stale_category_edits_do_not_overwrite_registry(self):
        payload = self.category_payload()
        self.roster.write_bytes(self.roster.read_bytes() + b"\n# External edit\n")
        with self.assertRaises(ConflictError):
            self.app.members.save_category(payload)
        with self.assertRaises(ConflictError):
            self.app.members.delete_category({**payload, "confirm": True})

    def test_reviewed_person_id_change_includes_and_rewrites_category_assignments(self):
        self.add_categories()
        self.app.members.save({**self.payload({"name": "Alice"}, {"id": "alice"}), "categories": ["helpers"]})
        plan = self.app.members.rename_plan({"revision": self.app.members.catalog()["revision"],
                                            "source": "alice", "target": "alice-new"})
        self.assertEqual(plan["categories"], ["Helpers"])
        with self.assertRaises(ConflictError):
            self.app.members.rename({**plan, "categories": [], "confirm": True})
        self.app.members.rename({**plan, "confirm": True})
        self.assertEqual(self.app.members.read()[2]["categories"][1]["people"], ["alice-new"])

    def test_merge_unions_categories_and_person_delete_cleans_assignments(self):
        self.add_categories()
        self.report.write_text("---\ntitle: Empty\n---\nBody\n", encoding="utf-8")
        self.app.members.save({**self.payload({"name": "Alice", "nickname": "Ally"}, {"id": "alice"}, group=None),
                               "categories": ["helpers", "organizers"]})
        self.app.members.save({**self.payload({"name": "Bob"}, {"id": "bob"}, group=None),
                               "categories": ["helpers"]})
        plan = self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                           "source": "alice", "target": "bob"})
        self.app.members.merge({**plan, "confirm": True})
        self.assertTrue(all(category["people"] == ["bob"] for category in self.app.members.read()[2]["categories"]))
        self.app.members.delete({"revision": self.app.members.catalog()["revision"],
                                 "original": {"id": "bob"}, "confirm": True})
        self.assertTrue(all(not category["people"] for category in self.app.members.read()[2]["categories"]))

    def test_registry_rejects_dangling_duplicate_or_malformed_category_links(self):
        data = self.app.members.read()[2]
        for categories in (None, {}, [{"id": "test", "label": "Test", "people": ["missing"]}],
                           [{"id": "test", "label": "Test", "people": ["alice", "alice"]}],
                           [{"id": "test", "label": "Test", "people": [False]}]):
            with self.subTest(categories=categories), self.assertRaises(ContentError):
                registry_data(yaml.safe_dump({**data, "categories": categories}).encode("utf-8"))

    def test_course_scan_failures_are_reported_not_silently_defaulted(self):
        path = self.course()
        path.write_text("---\nparticipant_ids: [missing]\n---\n", encoding="utf-8")
        catalog = self.app.members.catalog()
        self.assertTrue(catalog["audit"]["warnings"])
        self.assertFalse(any(category["kind"] == "course" for category in catalog["categories"]))


if __name__ == "__main__":
    unittest.main()
