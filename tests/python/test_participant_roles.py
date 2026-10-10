"""Global role vocabulary and multi-role assignment regressions."""

import copy
import unittest

import yaml

from tools.workbench.content_workbench import ConflictError, ContentError, parse_frontmatter, split_source
from tools.workbench.participant_roles import assignment_roles, automatic_roles, role_data
from test_member_workbench import MemberFixture


class RoleTests(MemberFixture):
    def setUp(self):
        super().setUp()
        (self.root / "data" / "participant_roles.yaml").write_text(
            "roles:\n- id: leader\n  label: Leader\n  aliases: []\n", encoding="utf-8")

    def payload_role(self, identifier="instructor", label="Instructor", original=None, **extra):
        return {"revision": self.app.roles.catalog()["revision"], "id": identifier,
                "label": label, "original": original, "aliases": [],
                "exempt_from_guest": False, **extra}

    def create_roles(self):
        self.app.roles.mutate(self.payload_role())
        self.app.roles.mutate(self.payload_role("helper", "Helper"))

    def test_configurable_automatic_rule_lifecycle_and_overlap_validation(self):
        rule = {"current_member": False, "course_participant": True}
        self.app.roles.mutate(self.payload_role("course", "Course attendee", automatic_when=rule))
        roles = self.app.roles.read()[2]
        self.assertEqual([role["id"] for role in automatic_roles(roles, False, True)], ["course"])
        self.assertEqual(automatic_roles(roles, True, True), [])
        self.assertEqual(automatic_roles(roles, False, False), [])
        before = (self.root / "data" / "participant_roles.yaml").read_bytes()
        for invalid in [{}, {"current_member": "false"}, {"unknown": True}, []]:
            with self.subTest(rule=invalid), self.assertRaises(ContentError):
                self.app.roles.mutate(self.payload_role("invalid", "Invalid", automatic_when=invalid))
        with self.assertRaisesRegex(ContentError, "overlap"):
            self.app.roles.mutate(self.payload_role("all", "All nonmembers", automatic_when={"current_member": False}))
        self.assertEqual((self.root / "data" / "participant_roles.yaml").read_bytes(), before)
        with self.assertRaisesRegex(ContentError, "Disable"):
            self.app.roles.mutate(self.payload_role("course", original="course", confirm=True), delete=True)
        self.app.roles.mutate(self.payload_role("course", "Renamed", original="course"))
        self.assertEqual(automatic_roles(self.app.roles.read()[2], False, True)[0]["label"], "Renamed")
        self.app.roles.mutate(self.payload_role("course", "Renamed", original="course", aliases=["Course attendee"], automatic_when=None))
        self.assertEqual(automatic_roles(self.app.roles.read()[2], False, True), [])
        self.app.roles.mutate(self.payload_role("course", original="course", confirm=True), delete=True)

    def participants(self, entries):
        meta = {"title": "Trip", "date": "2027-01-01", "participant_ids": entries}
        self.report.write_text("---\n" + yaml.safe_dump(meta) + "---\nHistorical report text\n", encoding="utf-8")

    def test_role_lifecycle_preserves_people_and_pages_and_tracks_usage(self):
        before = self.roster.read_bytes(), self.report.read_bytes()
        self.create_roles()
        result = self.app.roles.mutate(self.payload_role(label="Guide", original="instructor"))
        self.assertEqual(next(role for role in result["role_catalog"]["roles"] if role["id"] == "instructor")["aliases"], ["Instructor"])
        self.assertEqual((self.roster.read_bytes(), self.report.read_bytes()), before)
        self.participants([{"person": "alice", "roles": ["instructor", "helper"]}, "bob"])
        catalog = self.app.members.catalog()
        alice = next(person for person in catalog["people"] if person["id"] == "alice")
        reference = next(entry for entry in alice["references"] if entry["field"] == "participant_ids")
        self.assertEqual(reference["role"], "Guide, Helper")
        self.assertEqual(reference["roles"], ["instructor", "helper"])
        self.assertEqual(alice["membership"]["role"], "Leader")
        with self.assertRaisesRegex(ContentError, "assigned to current members or on saved pages"):
            self.app.roles.mutate(self.payload_role(original="instructor", confirm=True), delete=True)
        self.participants(["alice", "bob"])
        self.app.roles.mutate(self.payload_role(original="instructor", confirm=True), delete=True)
        self.assertEqual([role["id"] for role in self.app.roles.read()[2]], ["leader", "helper"])

    def test_revision_covers_role_file_and_saved_pages(self):
        stale = self.payload_role()
        self.report.write_text(self.report.read_text() + "Changed externally\n", encoding="utf-8")
        with self.assertRaises(ConflictError):
            self.app.roles.mutate(stale)
        self.create_roles()
        stale = self.payload_role(original="instructor")
        self.app.roles.mutate(self.payload_role("organizer", "Organizer"))
        with self.assertRaises(ConflictError):
            self.app.roles.mutate(stale)

    def test_validation_rejects_unknown_duplicate_mixed_and_nonlist_roles(self):
        self.create_roles()
        for value in [["unknown"], ["helper", "helper"], "helper", [1], None]:
            with self.subTest(value=value), self.assertRaises(ContentError):
                assignment_roles({"roles": value}, self.app.roles.read()[2])
        with self.assertRaises(ContentError):
            assignment_roles({"roles": ["helper"], "role": "Helper"}, self.app.roles.read()[2])
        self.participants([{"person": "alice", "roles": ["unknown"]}])
        with self.assertRaisesRegex(ContentError, "Unknown participant role"):
            self.app.content.validate("turak/test.md", self.report.read_text())
        self.assertTrue(self.app.members.catalog()["audit"]["warnings"])

    def test_legacy_aliases_and_labels_stay_connected_after_renaming(self):
        self.create_roles()
        self.participants([{"person": "alice", "role": " Instructor "}])
        self.app.roles.mutate(self.payload_role(label="Guide", original="instructor"))
        self.assertEqual(assignment_roles({"role": "Instructor"}, self.app.roles.read()[2]), ["instructor"])
        with self.assertRaisesRegex(ContentError, "assigned to current members or on saved pages"):
            self.app.roles.mutate(self.payload_role(original="instructor", confirm=True), delete=True)
        with self.assertRaisesRegex(ContentError, "Keep existing aliases"):
            self.app.roles.mutate(self.payload_role(label="Guide", original="instructor"))
        self.app.roles.mutate(self.payload_role(label="Guide", original="instructor", aliases=["Instructor"]))

    def test_bad_definitions_do_not_write_and_scan_errors_block_deletion(self):
        self.create_roles()
        before = (self.root / "data" / "participant_roles.yaml").read_bytes()
        for extra in [{"id": "BAD"}, {"label": ""}, {"aliases": "bad"},
                      {"exempt_from_guest": "yes"}, {"id": "helper"}, {"label": "Helper"}]:
            with self.subTest(extra=extra), self.assertRaises(ContentError):
                self.app.roles.mutate(self.payload_role(**extra))
            self.assertEqual((self.root / "data" / "participant_roles.yaml").read_bytes(), before)
        self.participants([{"person": "alice", "role": "Unconfigured old text"}])
        with self.assertRaisesRegex(ContentError, "scan warnings"):
            self.app.roles.mutate(self.payload_role("helper", original="helper", confirm=True), delete=True)
        self.participants([])
        with self.assertRaisesRegex(ContentError, "confirm"):
            self.app.roles.mutate(self.payload_role("helper", original="helper", confirm=False), delete=True)
        with self.assertRaisesRegex(ContentError, "permanent"):
            self.app.roles.mutate(self.payload_role("new-id", original="helper"))

    def test_page_validation_and_person_merge_preserve_multiple_roles(self):
        self.create_roles()
        self.participants([{"person": "alice", "roles": ["instructor", "helper"]}, "bob"])
        validated = self.app.content.validate("turak/test.md", self.report.read_text())
        self.assertEqual(parse_frontmatter(split_source(validated["source"])[0])["participant_ids"][0]["roles"],
                         ["instructor", "helper"])
        with self.assertRaisesRegex(ContentError, "different participant roles"):
            self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                          "source": "alice", "target": "bob"})

    def test_merge_and_rename_never_erase_role_lists(self):
        self.create_roles()
        self.participants([{"person": "alice", "roles": ["instructor", "helper"]}])
        plan = self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                            "source": "alice", "target": "bob"})
        self.app.members.merge({**plan, "confirm": True})
        meta = parse_frontmatter(split_source(self.report.read_text())[0])
        self.assertEqual(meta["participant_ids"], [{"person": "bob", "roles": ["instructor", "helper"]}])
        plan = self.app.members.rename_plan({"revision": self.app.members.catalog()["revision"],
                                             "source": "bob", "target": "bob-new"})
        self.app.members.rename({**plan, "confirm": True})
        meta = parse_frontmatter(split_source(self.report.read_text())[0])
        self.assertEqual(meta["participant_ids"], [{"person": "bob-new", "roles": ["instructor", "helper"]}])

    def test_schema_requires_distinct_label_alias_namespace(self):
        definitions = [{"id": "a", "label": "Árvíz", "aliases": ["old"], "exempt_from_guest": True}]
        for label in [" a\u0301rvíz ", "OLD"]:
            with self.assertRaises(ContentError):
                role_data(yaml.safe_dump({"roles": definitions + [{"id": "b", "label": label}]}).encode())
        broken = copy.deepcopy(definitions)
        broken[0]["aliases"] = ["Árvíz"]
        with self.assertRaises(ContentError):
            role_data(yaml.safe_dump({"roles": broken}).encode())

    def test_merge_compares_role_identity_and_preserves_canonical_list(self):
        self.create_roles()
        for source, target, expected in [
            ({"person": "alice", "role": "Instructor"}, {"person": "bob", "roles": ["instructor"]}, ["instructor"]),
            ({"person": "alice", "roles": ["helper", "instructor"]},
             {"person": "bob", "roles": ["instructor", "helper"]}, ["instructor", "helper"]),
            ({"person": "alice", "roles": []}, "bob", []),
        ]:
            with self.subTest(source=source):
                self.participants([source, target])
                changes = self.app.members.merge_changes(self.app.members.read()[2], "alice", "bob")
                meta = parse_frontmatter(split_source(changes[0][2].decode())[0])
                self.assertEqual(meta["participant_ids"], [{"person": "bob", "roles": expected}])

    def test_membership_lists_use_global_roles_without_changing_page_assignments(self):
        self.create_roles()
        pages = self.report.read_bytes()
        payload = self.payload({"id": "alice", "name": "Alice", "nickname": "Ally",
                                "roles": ["helper", "leader"]}, {"id": "alice"}, group=0)
        result = self.app.members.save(payload)
        alice = next(person for person in result["people"] if person["id"] == "alice")
        self.assertEqual(alice["membership"]["roles"], ["helper", "leader"])
        self.assertEqual(alice["membership"]["role"], "Helper, Leader")
        self.assertEqual(self.app.members.read()[2]["groups"][0]["members"],
                         [{"person": "alice", "roles": ["helper", "leader"]}])
        self.assertNotIn("roles", self.app.members.read()[2]["people"][0], "Roles belong to the membership, not the identity")
        self.assertEqual(self.report.read_bytes(), pages)
        references = result["role_catalog"]["references"]
        self.assertTrue(any(entry["kind"] == "membership" and entry["id"] == "helper" for entry in references))
        with self.assertRaisesRegex(ContentError, "current members"):
            self.app.roles.mutate(self.payload_role("helper", original="helper", confirm=True), delete=True)
        rename = self.payload_role("helper", label="Existing duty renamed", original="helper")
        result = self.app.roles.mutate(rename)
        alice = next(person for person in result["people"] if person["id"] == "alice")
        self.assertEqual(alice["membership"]["role"], "Existing duty renamed, Leader")
        self.assertEqual(alice["membership"]["roles"], ["helper", "leader"])
        self.assertEqual(self.report.read_bytes(), pages)

    def test_membership_validation_and_stale_role_review(self):
        self.create_roles()
        before = self.roster.read_bytes()
        for roles in [["unknown"], ["helper", "helper"], "helper", [None]]:
            with self.subTest(roles=roles), self.assertRaises(ContentError):
                self.app.members.save(self.payload({"name": "Alice", "roles": roles}, {"id": "alice"}))
            self.assertEqual(self.roster.read_bytes(), before)
        with self.assertRaises(ContentError):
            self.app.members.save(self.payload({"name": "Alice", "role": "Leader", "roles": ["leader"]}, {"id": "alice"}))
        deletion = self.payload_role("helper", original="helper", confirm=True)
        self.app.members.save(self.payload({"name": "Alice", "roles": ["helper"]}, {"id": "alice"}))
        with self.assertRaises(ConflictError):
            self.app.roles.mutate(deletion, delete=True)
        result = self.app.members.save(self.payload({"name": "Alice", "roles": []}, {"id": "alice"}))
        self.assertEqual(next(person for person in result["people"] if person["id"] == "alice")["membership"]["roles"], [])
        self.app.roles.mutate(self.payload_role("helper", original="helper", confirm=True), delete=True)

    def test_comma_separated_legacy_roles_resolve_in_original_order(self):
        self.create_roles()
        roles = self.app.roles.read()[2]
        self.assertEqual(assignment_roles({"role": "Helper, Leader"}, roles), ["helper", "leader"])
        self.assertEqual(assignment_roles({"role": "Helper, Unknown"}, roles), [], "Do not silently drop unknown legacy roles")
        data = self.app.members.read()[2]
        data["groups"][0]["members"][0]["role"] = "Helper, Leader"
        self.roster.write_text(yaml.safe_dump(data), encoding="utf-8")
        self.assertEqual([entry["id"] for entry in self.app.roles.catalog()["references"]], ["helper", "leader"])

    def test_person_merge_and_rename_preserve_membership_role_lists(self):
        self.create_roles()
        self.participants(["alice"])
        self.app.members.save(self.payload({"name": "Alice", "roles": ["leader", "helper"]}, {"id": "alice"}))
        self.app.members.save(self.payload({"name": "Bob"}, {"id": "bob"}, group=None))
        plan = self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                            "source": "alice", "target": "bob"})
        self.app.members.merge({**plan, "confirm": True})
        self.assertEqual(self.app.members.read()[2]["groups"][0]["members"][0],
                         {"person": "bob", "roles": ["leader", "helper"]})
        plan = self.app.members.rename_plan({"revision": self.app.members.catalog()["revision"],
                                             "source": "bob", "target": "bob-new"})
        self.assertEqual(plan["memberships"][0]["role"], "Leader, Helper")
        self.app.members.rename({**plan, "confirm": True})
        self.assertEqual(self.app.members.read()[2]["groups"][0]["members"][0],
                         {"person": "bob-new", "roles": ["leader", "helper"]})


if __name__ == "__main__":
    unittest.main()
