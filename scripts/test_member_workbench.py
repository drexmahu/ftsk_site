"""Roster regressions use disposable site fixtures, never the real member data."""

import json
import threading
from http.client import HTTPConnection
from unittest.mock import patch

import yaml

from content_workbench import ConflictError, ContentError
from test_site_workbench import Fixture


class MemberFixture(Fixture):
    def setUp(self):
        super().setUp()
        self.roster = self.root / "data" / "people.yaml"
        self.roster.write_text(
            "# Keep roster documentation\nversion: custom\n"
            "people:\n- id: alice\n  name: Alice\n  nickname: Ally\n"
            "  image: /images/members/alice_thumb.webp\n"
            "  modal_image: /images/members/alice_full.webp\n"
            "  bio: Original biography\n  custom: {keep: true}\n"
            "- id: bob\n  name: Bob\n"
            "groups:\n- label: First\n  members:\n  - person: alice\n    role: Leader\n"
            "- label: Second\n  extra: preserved\n  members:\n  - person: bob\n",
            encoding="utf-8",
        )
        portraits = self.root / "static" / "images" / "members"
        portraits.mkdir()
        for name in ("alice_thumb.webp", "alice_full.webp", "unused_thumb.webp", "unused_full.webp"):
            (portraits / name).write_bytes(b"fixture image")
        self.report = self.root / "content" / "turak" / "test.md"
        self.report.parent.mkdir(parents=True)
        self.report.write_text(
            "---\ntitle: Trip\nauthor: Ally\nparticipants:\n- Alice (Leader)\n"
            "- Guest\n- alice\n---\nHistorical report text\n", encoding="utf-8",
        )
        self.report_bytes = self.report.read_bytes()

    def payload(self, member=None, original=None, group=0):
        values = member or {"name": "New member"}
        if original is None:
            values = {"id": "new-person", **values}
        return {"revision": self.app.members.catalog()["revision"], "original": original,
                "group": group, "member": values}


class MemberTests(MemberFixture):
    def deletion_plan(self, urls=None):
        return self.app.members.portrait_deletion_plan({
            "revision": self.app.members.catalog()["revision"],
            "urls": urls or ["/images/members/unused_thumb.webp", "/images/members/unused_full.webp"],
        })

    def test_loose_portrait_plan_and_confirmed_batch_delete(self):
        raw = self.roster.read_bytes()
        plan = self.deletion_plan()
        self.assertTrue(all(not file["references"] for file in plan["files"]))
        result = self.app.members.delete_portraits({**plan, "confirm": True})
        self.assertEqual(len(result["deleted"]), 2)
        self.assertEqual(result["catalog"]["audit"]["unassigned_portraits"], [])
        self.assertEqual(len(result["catalog"]["portraits"]), 2)
        self.assertEqual(self.roster.read_bytes(), raw)
        self.assertEqual(self.report.read_bytes(), self.report_bytes)
        for url in result["deleted"]:
            self.assertFalse((self.root / "static" / url.lstrip("/")).exists())

    def test_referenced_loose_image_is_blocked_including_relative_and_config_references(self):
        for relative in ("content/page.md", "data/custom.json", "assets/test.scss",
                         "static/script.js", "layouts/custom.html",
                         "layouts/partials/sections/custom.html", "config/_default/params.toml",
                         "hugo.toml"):
            with self.subTest(relative=relative):
                file = self.root / relative
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('image = "images/members/unused_thumb.webp"', encoding="utf-8")
                plan = self.deletion_plan()
                self.assertIn(relative, plan["files"][0]["references"])
                with self.assertRaises(ConflictError):
                    self.app.members.delete_portraits({**plan, "confirm": True})
                self.assertTrue((self.root / "static" / "images" / "members" / "unused_full.webp").exists())
                file.unlink()

    def test_assigned_portraits_cannot_be_deleted(self):
        plan = self.deletion_plan(["/images/members/alice_thumb.webp"])
        self.assertIn("data/people.yaml", plan["files"][0]["references"])
        with self.assertRaises(ConflictError):
            self.app.members.delete_portraits({**plan, "confirm": True})

    def test_reference_scan_is_case_insensitive(self):
        self.report.write_text(self.report.read_text(encoding="utf-8") +
                               "\n![Photo](/images/members/UNUSED_THUMB.webp)\n", encoding="utf-8")
        plan = self.deletion_plan()
        self.assertIn("content/turak/test.md", plan["files"][0]["references"])
        with self.assertRaises(ConflictError):
            self.app.members.delete_portraits({**plan, "confirm": True})

    def test_new_reference_since_review_blocks_entire_batch(self):
        plan = self.deletion_plan()
        self.report.write_text(self.report.read_text(encoding="utf-8") +
                               "\n![Photo](/images/members/unused_full.webp)\n", encoding="utf-8")
        with self.assertRaises(ConflictError):
            self.app.members.delete_portraits({**plan, "confirm": True})
        self.assertTrue((self.root / "static" / "images" / "members" / "unused_thumb.webp").exists())

    def test_changed_missing_or_stale_file_blocks_deletion(self):
        plan = self.deletion_plan()
        path = self.root / "static" / "images" / "members" / "unused_full.webp"
        path.write_bytes(b"external edit")
        with self.assertRaises(ConflictError):
            self.app.members.delete_portraits({**plan, "confirm": True})
        plan = self.deletion_plan()
        path.unlink()
        with self.assertRaises(ConflictError):
            self.app.members.delete_portraits({**plan, "confirm": True})
        self.assertTrue((self.root / "static" / "images" / "members" / "unused_thumb.webp").exists())
        plan = self.deletion_plan(["/images/members/unused_thumb.webp"])
        self.roster.write_bytes(self.roster.read_bytes() + b"\n# changed\n")
        with self.assertRaises(ConflictError):
            self.app.members.delete_portraits({**plan, "confirm": True})

    def test_portrait_deletion_validation_and_confirmation(self):
        for urls in ([], ["bad"], [True], ["/images/hero/one.webp"],
                     ["/images/members/../../hero/one.webp"],
                     ["/images/members/unused_thumb.webp"] * 2):
            with self.subTest(urls=urls), self.assertRaises(ValueError):
                self.app.members.portrait_deletion_plan({
                    "revision": self.app.members.catalog()["revision"], "urls": urls,
                })
        plan = self.deletion_plan()
        with self.assertRaises(ContentError):
            self.app.members.delete_portraits(plan)
        self.assertEqual(len(self.app.members.catalog()["portraits"]), 4)

    def test_failed_batch_move_rolls_back_all_files(self):
        from pathlib import Path
        plan = self.deletion_plan()
        replace = Path.replace

        def fail_second(path, target):
            if path.name == "unused_full.webp":
                raise OSError("Fixture move failure")
            return replace(path, target)

        with patch.object(Path, "replace", fail_second):
            with self.assertRaises(OSError):
                self.app.members.delete_portraits({**plan, "confirm": True})
        self.assertEqual(len(self.app.members.catalog()["portraits"]), 4)
        self.assertEqual(list(self.app.scratch.glob("delete-portraits-*")), [])

    def test_reference_scan_failure_never_deletes_files(self):
        plan = self.deletion_plan()
        with patch.object(self.app.content, "references", side_effect=OSError("Cannot read site sources")):
            with self.assertRaises(OSError):
                self.app.members.delete_portraits({**plan, "confirm": True})
        self.assertEqual(len(self.app.members.catalog()["portraits"]), 4)

    def test_catalog_matches_site_and_exposes_orphans(self):
        catalog = self.app.members.catalog()
        alice = catalog["groups"][0]["members"][0]
        self.assertEqual(len(alice["references"]), 3)
        self.assertEqual([entry["name"] for entry in catalog["audit"]["unmatched_participants"]],
                         ["Guest"])
        self.assertEqual(catalog["audit"]["unmatched_authors"], [])
        self.assertEqual(catalog["audit"]["missing_images"], [])
        self.assertEqual(catalog["audit"]["unassigned_portraits"],
                         ["/images/members/unused_full.webp", "/images/members/unused_thumb.webp"])

    def test_add_reload_edit_move_preserves_unrelated_data(self):
        result = self.app.members.save(self.payload({"name": "Cecília", "nickname": "Ceci"}))
        self.assertEqual(result["selected"], {"id": "new-person"})
        self.assertEqual(self.app.members.read()[2]["people"][2]["name"], "Cecília")
        result = self.app.members.save(self.payload(
            {"name": "Alice Renamed", "bio": "Two\nlines"},
            {"id": "alice"}, group=1))
        self.assertEqual(result["selected"], {"id": "alice"})
        persisted = yaml.safe_load(self.roster.read_text(encoding="utf-8"))
        self.assertEqual(persisted["version"], "custom")
        self.assertEqual(persisted["groups"][1]["extra"], "preserved")
        self.assertEqual(persisted["people"][0]["custom"], {"keep": True})
        self.assertEqual(persisted["groups"][1]["members"][0], {"person": "bob"})
        self.assertTrue(self.roster.read_text(encoding="utf-8").startswith("# Keep roster documentation\n"))
        self.assertEqual(self.report.read_bytes(), self.report_bytes)

    def test_edit_in_place_retains_order_and_assigns_existing_pair(self):
        result = self.app.members.save(self.payload({
            "name": "Alice", "image": "/images/members/unused_thumb.webp",
            "modal_image": "/images/members/unused_full.webp", "role": "New role",
        }, {"id": "alice"}))
        member = result["groups"][0]["members"][0]
        self.assertEqual(member["role"], "New role")
        self.assertEqual(member["image"], "/images/members/unused_thumb.webp")
        self.assertNotIn("/images/members/unused_thumb.webp", result["audit"]["unassigned_portraits"])
        self.assertTrue((self.root / "static" / "images" / "members" / "alice_thumb.webp").exists())

    def test_converted_portrait_pair_and_details_save_together(self):
        upload = self.stage("portrait.jpg")
        exported = self.app.convert({"id": upload["id"], "folder": "members/nested",
                                     "crop": [20, 0, 140, 120]}, portrait=True)
        thumb, full = [file["url"] for file in exported["files"]]
        before = self.app.members.catalog()
        self.assertIn(thumb, before["portraits"])
        self.assertIn(thumb, before["audit"]["unassigned_portraits"])
        result = self.app.members.save(self.payload({
            "name": "Alice", "role": "Updated with portrait", "image": thumb, "modal_image": full,
        }, {"id": "alice"}))
        self.assertEqual(result["groups"][0]["members"][0]["image"], thumb)
        self.assertEqual(result["groups"][0]["members"][0]["modal_image"], full)
        self.assertNotIn(thumb, result["audit"]["unassigned_portraits"])
        self.assertEqual(self.report.read_bytes(), self.report_bytes)

    def test_replacement_returns_old_files_for_confirmed_cleanup_only_after_save(self):
        result = self.app.members.save(self.payload({
            "name": "Alice", "image": "/images/members/unused_thumb.webp",
            "modal_image": "/images/members/unused_full.webp",
        }, {"id": "alice"}))
        old = ["/images/members/alice_thumb.webp", "/images/members/alice_full.webp"]
        self.assertEqual(result["replaced_portraits"], old)
        self.assertTrue(all(self.app.members.image_path(url).exists() for url in old))
        plan = self.deletion_plan(old)
        deleted = self.app.members.delete_portraits({**plan, "confirm": True})
        self.assertEqual(deleted["deleted"], old)
        self.assertTrue(all(not self.app.members.image_path(url).exists() for url in old))
        self.assertEqual(deleted["catalog"]["people"][0]["image"], "/images/members/unused_thumb.webp")
        self.assertEqual(self.report.read_bytes(), self.report_bytes)

    def test_replacement_cleanup_preserves_shared_old_files(self):
        shared = "/images/members/alice_thumb.webp"
        self.app.members.save(self.payload({"name": "Bob", "image": shared}, {"id": "bob"}, group=1))
        result = self.app.members.save(self.payload({
            "name": "Alice", "image": "/images/members/unused_thumb.webp",
            "modal_image": "/images/members/unused_full.webp",
        }, {"id": "alice"}))
        plan = self.deletion_plan(result["replaced_portraits"])
        self.assertTrue(plan["files"][0]["references"])
        self.assertFalse(plan["files"][1]["references"])
        with self.assertRaises(ConflictError):
            self.app.members.delete_portraits({**plan, "confirm": True})
        self.assertTrue(self.app.members.image_path(shared).exists())
        self.app.members.delete_portraits({**plan, "files": [plan["files"][1]], "confirm": True})
        self.assertTrue(self.app.members.image_path(shared).exists())
        self.assertEqual(self.app.members.catalog()["people"][1]["image"], shared)

    def test_retained_or_swapped_portraits_are_not_offered_for_cleanup(self):
        for thumb, full in (("alice_thumb.webp", "alice_full.webp"),
                            ("alice_full.webp", "alice_thumb.webp")):
            result = self.app.members.save(self.payload({
                "name": "Alice", "image": f"/images/members/{thumb}",
                "modal_image": f"/images/members/{full}",
            }, {"id": "alice"}))
            self.assertEqual(result["replaced_portraits"], [])

    def test_unused_person_deletion_preserves_portrait_files(self):
        self.app.members.save(self.payload({
            "name": "Visitor", "image": "/images/members/unused_thumb.webp",
        }, group=None))
        result = self.app.members.delete({
            "revision": self.app.members.catalog()["revision"],
            "original": {"id": "new-person"}, "confirm": True,
        })
        self.assertNotIn("new-person", [person["id"] for person in result["people"]])
        self.assertTrue(self.app.members.image_path("/images/members/unused_thumb.webp").exists())

    def test_remove_membership_keeps_identity_references_and_files(self):
        result = self.app.members.save(self.payload({
            "name": "Alice", "nickname": "Ally",
            "image": "/images/members/alice_thumb.webp",
            "modal_image": "/images/members/alice_full.webp",
        }, {"id": "alice"}, group=None))
        self.assertEqual(result["groups"][0]["members"], [])
        self.assertEqual(self.report.read_bytes(), self.report_bytes)
        self.assertEqual(len(result["portraits"]), 4)
        self.assertEqual(result["people"][0]["membership"], None)
        self.assertEqual(len(result["people"][0]["references"]), 3)
        self.app.members.save(self.payload({"name": "Replacement"}, group=0))
        self.assertEqual(self.app.members.catalog()["groups"][0]["members"][0]["name"], "Replacement")

    def test_delete_requires_explicit_confirmation(self):
        raw = self.roster.read_bytes()
        with self.assertRaises(ContentError):
            self.app.members.delete({"revision": self.app.members.catalog()["revision"],
                                     "original": {"id": "alice"}})
        self.assertEqual(self.roster.read_bytes(), raw)

    def test_verifier_accepts_empty_group(self):
        import verify_members
        self.roster.write_text("people: []\ngroups:\n- label: Empty\n  members: []\n", encoding="utf-8")
        problems, _, count = verify_members.verify(self.root)
        self.assertEqual(count, 0)
        self.assertEqual(problems, [])

    def test_stale_save_and_delete_do_not_overwrite(self):
        payload = self.payload()
        self.roster.write_bytes(self.roster.read_bytes() + b"\n# External edit\n")
        raw = self.roster.read_bytes()
        with self.assertRaises(ConflictError):
            self.app.members.save(payload)
        with self.assertRaises(ConflictError):
            self.app.members.delete({**payload, "original": {"id": "alice"}, "confirm": True})
        self.assertEqual(self.roster.read_bytes(), raw)

    def test_external_deletion_or_invalid_yaml_is_a_conflict(self):
        payload = self.payload()
        self.roster.write_text("groups: [broken YAML", encoding="utf-8")
        with self.assertRaises(ConflictError):
            self.app.members.save(payload)
        self.roster.unlink()
        with self.assertRaises(ConflictError):
            self.app.members.save(payload)
        self.assertFalse(self.roster.exists())

    def test_atomic_failure_preserves_roster_and_cleans_tempfile(self):
        raw = self.roster.read_bytes()
        with patch("member_workbench.os.fsync", side_effect=OSError("Fixture disk failure")):
            with self.assertRaises(OSError):
                self.app.members.save(self.payload())
        self.assertEqual(self.roster.read_bytes(), raw)
        self.assertEqual(list(self.roster.parent.glob(".members-*.tmp")), [])

    def test_revision_rechecked_before_atomic_replace(self):
        original_checked = self.app.members.checked
        calls = 0

        def check(expected):
            nonlocal calls
            calls += 1
            if calls == 2:
                self.roster.write_bytes(self.roster.read_bytes() + b"# External change during save\n")
            return original_checked(expected)

        with patch.object(self.app.members, "checked", side_effect=check):
            with self.assertRaises(ConflictError):
                self.app.members.save(self.payload())
        self.assertNotIn(b"New member", self.roster.read_bytes())
        self.assertIn(b"External change during save", self.roster.read_bytes())
        self.assertEqual(list(self.roster.parent.glob(".members-*.tmp")), [])

    def test_invalid_fields_and_collisions_leave_roster_unchanged(self):
        raw = self.roster.read_bytes()
        for member in (
            {"name": ""}, {"name": True}, {"name": "Alice"}, {"name": "ally"},
            {"name": "Someone", "nickname": "Bob"},
            {"name": "Same", "nickname": "same"},
            {"name": "Person (nickname)"}, {"name": "Person\nSecond"},
            {"name": "Person", "unknown": "unsupported"},
            {"name": "Person", "image": "/images/members/missing.webp"},
            {"name": "Person", "image": "https://example.com/photo.webp"},
            {"name": "Person", "image": "/images/../../data/people.yaml"},
            {"name": "Person", "image": "/images/members/file.svg"},
            {"name": "Person", "role": None},
        ):
            with self.subTest(member=member), self.assertRaises(ValueError):
                self.app.members.save(self.payload(member))
            self.assertEqual(self.roster.read_bytes(), raw)

    def test_invalid_group_and_target_rejected(self):
        for group in (-1, 99, True, "0"):
            with self.subTest(group=group), self.assertRaises(ContentError):
                self.app.members.save(self.payload(group=group))
        for original in ({}, {"id": "missing"}, {"id": True}):
            with self.subTest(original=original), self.assertRaises(ContentError):
                self.app.members.save(self.payload(original=original))

    def test_missing_existing_image_can_be_repaired_or_retained_explicitly(self):
        (self.root / "static" / "images" / "members" / "alice_thumb.webp").unlink()
        catalog = self.app.members.catalog()
        self.assertEqual(catalog["audit"]["missing_images"][0]["name"], "Alice")
        self.app.members.save(self.payload({"name": "Alice", "image": "/images/members/alice_thumb.webp"},
                                           {"id": "alice"}))
        result = self.app.members.save(self.payload({"name": "Alice"}, {"id": "alice"}))
        self.assertEqual(result["audit"]["missing_images"], [])

    def test_bad_report_is_visible_and_does_not_block_roster(self):
        self.report.write_text("---\nparticipants: wrong\n---\n", encoding="utf-8")
        self.assertIn("participants must be a list", self.app.members.catalog()["audit"]["warnings"][0])

    def test_duplicate_yaml_keys_and_aliases_rejected(self):
        for source in ("groups: []\ngroups: []\n",
                       "groups:\n- &g {label: First, members: []}\n- *g\n"):
            self.roster.write_text(source, encoding="utf-8")
            with self.assertRaises(ContentError):
                self.app.members.catalog()

    def test_bom_and_crlf_preserved(self):
        source = self.roster.read_text(encoding="utf-8")
        self.roster.write_bytes(b"\xef\xbb\xbf" + source.replace("\n", "\r\n").encode("utf-8"))
        self.app.members.save(self.payload())
        self.assertTrue(self.roster.read_bytes().startswith(b"\xef\xbb\xbf# Keep"))
        self.assertNotIn(b"\n", self.roster.read_bytes().replace(b"\r\n", b""))

    def test_guest_course_assignment_then_membership_reuses_identity(self):
        created = self.app.members.save(self.payload(
            {"id": "guest", "name": "Guest", "needs_review": True,
             "image": "/images/members/unused_thumb.webp"}, group=None))
        self.assertIsNone(created["people"][-1]["membership"])
        course = self.root / "content" / "tanfolyamok" / "course.md"
        course.parent.mkdir()
        course.write_text("---\ntitle: Course\ndate: 2026-01-01\n"
                          "author_id: alice\nparticipant_ids:\n- person: guest\n  role: student\n"
                          "contacts:\n- person: alice\n  email: alice@example.test\n---\n", encoding="utf-8")
        before = course.read_bytes()
        result = self.app.members.save(self.payload(
            {"name": "Guest", "image": "/images/members/unused_thumb.webp",
             "needs_review": False}, {"id": "guest"}, group=1))
        person = next(p for p in result["people"] if p["id"] == "guest")
        self.assertEqual(person["membership"]["group"], 1)
        self.assertFalse(person["needs_review"])
        self.assertEqual(course.read_bytes(), before)
        self.assertEqual(person["image"], "/images/members/unused_thumb.webp")
        self.assertTrue(any(r["path"].endswith("course.md") for r in person["references"]))
        self.assertEqual(len([p for p in result["people"] if p["id"] == "guest"]), 1)

    def test_per_course_scopes_and_roles_are_independent(self):
        for number, identifier in ((1, "alice"), (2, "bob")):
            source = f"---\ntitle: Course\ndate: 2026-01-01\nparticipant_ids:\n- person: {identifier}\n  role: student\n---\n"
            result = self.app.content.validate(f"tanfolyamok/course-{number}.md", source)
            self.assertEqual(result["metadata"]["participant_ids"][0]["person"], identifier)
        self.assertEqual(self.app.members.catalog()["people"][0]["membership"]["role"], "Leader")

    def test_foreign_keys_and_duplicate_assignment_validation(self):
        source = "---\ntitle: Course\ndate: 2026-01-01\n---\n"
        for fields in ({"author_id": "missing"}, {"author_id": True}, {"participant_ids": ["missing"]},
                       {"participant_ids": ["alice", {"person": "alice"}]},
                       {"participant_ids": [{"person": "alice", "role": False}]},
                       {"contacts": [{"person": "missing"}]},
                       {"author_id": "alice", "author": "Alice"},
                       {"participant_ids": ["alice"], "participants": ["Alice"]}):
            with self.subTest(fields=fields), self.assertRaises(ContentError):
                self.app.content.validate("tanfolyamok/course.md", source, fields)

    def test_rename_id_immutable_and_legacy_aliases_keep_references(self):
        result = self.app.members.save(self.payload(
            {"name": "Alicia", "nickname": "A"}, {"id": "alice"}, group=None))
        self.assertEqual(result["selected"], {"id": "alice"})
        self.assertEqual(len(result["people"][0]["references"]), 3)
        self.assertEqual(set(result["people"][0]["aliases"]), {"Alice", "Ally"})
        with self.assertRaises(ContentError):
            self.app.members.save(self.payload({"id": "renamed", "name": "Alicia"}, {"id": "alice"}))

    def test_referenced_or_member_identity_cannot_be_deleted(self):
        for identifier in ("alice", "bob"):
            with self.subTest(identifier=identifier), self.assertRaises(ConflictError):
                self.app.members.delete({"revision": self.app.members.catalog()["revision"],
                                         "original": {"id": identifier}, "confirm": True})
        self.report.write_text("---\nparticipants: broken\n---\n", encoding="utf-8")
        self.app.members.save(self.payload({"id": "unused", "name": "Unused"}, group=None))
        with self.assertRaises(ConflictError):
            self.app.members.delete({"revision": self.app.members.catalog()["revision"],
                                     "original": {"id": "unused"}, "confirm": True})

    def test_registry_rejects_duplicate_ids_aliases_and_memberships(self):
        from people_registry import registry_data
        data = self.app.members.read()[2]
        for mutate in (
            lambda value: value["people"].append({"id": "alice", "name": "Other"}),
            lambda value: value["people"][1].update(aliases=["Ally"]),
            lambda value: value["groups"][1]["members"].append({"person": "alice"}),
            lambda value: value["groups"][0]["members"].append({"person": "missing"}),
            lambda value: value["people"][0].update(needs_review="true"),
        ):
            import copy
            value = copy.deepcopy(data)
            mutate(value)
            with self.assertRaises(ContentError):
                registry_data(yaml.safe_dump(value).encode())

    def rename_fixture(self):
        self.report.write_bytes(b"\xef\xbb\xbf---\r\ntitle: Trip\r\nauthor_id: alice\r\n"
                                b"participant_ids: [{person: alice, role: guide}, bob]\r\n"
                                b"contacts:\r\n- person: alice\r\n  role: organizer\r\n"
                                b"  email: alice@example.test\r\n---\r\nHistorical report text\r\n")
        course = self.root / "content" / "tanfolyamok" / "course.md"
        course.parent.mkdir()
        course.write_text("---\ntitle: Course\nparticipant_ids:\n- person: alice\n  role: ''\n"
                          "- bob\n---\nCourse story\n", encoding="utf-8")
        return self.app.members.rename_plan({"revision": self.app.members.catalog()["revision"],
                                             "source": "alice", "target": "alice-new"})

    def test_reviewed_id_change_preserves_profile_roles_and_rewrites_all_references(self):
        legacy = self.root / "content" / "legacy.md"
        legacy.write_bytes(self.report_bytes)
        plan = self.rename_fixture()
        before = self.roster.read_bytes()
        old_person = self.app.members.read()[2]["people"][0].copy()
        self.assertEqual(self.roster.read_bytes(), before, "Review must not write")
        self.assertEqual(plan["memberships"], [{"group": "First", "role": "Leader"}])
        trip = next(file for file in plan["files"] if file["path"].endswith("test.md"))
        self.assertEqual(trip["fields"], ["author_id", "contacts", "participant_ids"])
        result = self.app.members.rename({**plan, "confirm": True})
        self.assertEqual(result["selected"], {"id": "alice-new"})
        data = self.app.members.read()[2]
        self.assertEqual(data["people"][0], {**old_person, "id": "alice-new"})
        self.assertEqual(data["groups"][0]["members"], [{"person": "alice-new", "role": "Leader"}])
        self.assertEqual(data["groups"][1]["members"], [{"person": "bob"}])
        meta = self.app.content.read("turak/test.md")["metadata"]
        self.assertEqual(meta["author_id"], "alice-new")
        self.assertEqual(meta["participant_ids"], [{"person": "alice-new", "role": "guide"}, "bob"])
        self.assertEqual(meta["contacts"], [{"person": "alice-new", "role": "organizer", "email": "alice@example.test"}])
        course = self.app.content.read("tanfolyamok/course.md")["metadata"]
        self.assertEqual(course["participant_ids"], [{"person": "alice-new", "role": ""}, "bob"])
        self.assertEqual(legacy.read_bytes(), self.report_bytes, "Legacy names need no ID rewrite")
        self.assertTrue(self.report.read_bytes().startswith(b"\xef\xbb\xbf"))
        self.assertTrue(self.report.read_bytes().endswith(b"---\r\nHistorical report text\r\n"))
        self.assertNotIn(b"\n", self.report.read_bytes().replace(b"\r\n", b""))
        self.assertTrue(self.roster.read_bytes().startswith(b"# Keep roster documentation"))
        self.assertEqual(len(result["people"]), 2)

    def test_id_change_requires_confirmation_and_exact_current_review(self):
        plan = self.rename_fixture()
        before = self.roster.read_bytes()
        for payload in (plan, {**plan, "confirm": True, "files": []},
                        {**plan, "confirm": True, "memberships": []}):
            with self.subTest(payload=payload), self.assertRaises(ContentError):
                self.app.members.rename(payload)
            self.assertEqual(self.roster.read_bytes(), before)
        self.report.write_bytes(self.report.read_bytes() + b"External edit\r\n")
        with self.assertRaises(ConflictError):
            self.app.members.rename({**plan, "confirm": True})
        self.assertEqual(self.roster.read_bytes(), before)
        fresh = self.app.members.rename_plan({**plan, "files": []})
        self.roster.write_bytes(before + b"\n# External registry edit\n")
        with self.assertRaises(ConflictError):
            self.app.members.rename({**fresh, "confirm": True})

    def test_id_change_blocks_collisions_invalid_ids_and_scan_errors(self):
        revision = self.app.members.catalog()["revision"]
        for target in ("alice", "bob", "Bad ID", "-leading", "trailing-", "double--dash", "", None, "a" * 201):
            with self.subTest(target=target), self.assertRaises(ContentError):
                self.app.members.rename_plan({"revision": revision, "source": "alice", "target": target})
        with self.assertRaises(ContentError):
            self.app.members.rename_plan({"revision": revision, "source": "missing", "target": "valid"})
        for broken in ("participants: broken", "author_id: unknown"):
            self.report.write_text(f"---\n{broken}\n---\n", encoding="utf-8")
            with self.subTest(broken=broken), self.assertRaises(ConflictError):
                self.app.members.rename_plan({"revision": revision, "source": "alice", "target": "valid"})

    def test_id_change_detects_new_references_since_review(self):
        plan = self.rename_fixture()
        (self.root / "content" / "new.md").write_text("---\nauthor_id: alice\n---\n", encoding="utf-8")
        before = self.roster.read_bytes()
        with self.assertRaises(ConflictError):
            self.app.members.rename({**plan, "confirm": True})
        self.assertEqual(self.roster.read_bytes(), before)

    def test_id_change_rolls_back_disk_failure_and_cleans_staging(self):
        from pathlib import Path
        plan = self.rename_fixture()
        before = {file: file.read_bytes() for file in [self.roster, *self.root.joinpath("content").rglob("*.md")]}
        replace = Path.replace
        failed = False

        def fail_registry_once(path, target):
            nonlocal failed
            if target == self.roster and not failed:
                failed = True
                raise OSError("Fixture registry write failure")
            return replace(path, target)

        with patch.object(Path, "replace", fail_registry_once), self.assertRaises(OSError):
            self.app.members.rename({**plan, "confirm": True})
        for file, raw in before.items():
            self.assertEqual(file.read_bytes(), raw)
        self.assertEqual(list(self.root.rglob(".people-*.tmp")), [])

    def test_id_change_without_membership_or_canonical_references(self):
        self.app.members.save(self.payload({"id": "guest", "name": "Guest Person"}, group=None))
        plan = self.app.members.rename_plan({"revision": self.app.members.catalog()["revision"],
                                             "source": "guest", "target": "guest-new"})
        self.assertEqual(plan["files"], [])
        self.assertEqual(plan["memberships"], [])
        result = self.app.members.rename({**plan, "confirm": True})
        self.assertIsNone(next(person for person in result["people"] if person["id"] == "guest-new")["membership"])
        self.assertEqual(self.report.read_bytes(), self.report_bytes)

    def test_shared_contact_details_can_be_edited_cleared_and_validated(self):
        result = self.app.members.save(self.payload(
            {"name": "Alice", "email": "alice@example.test", "phone": "+36 (20) 123-4567"}, {"id": "alice"}))
        self.assertEqual(result["people"][0]["email"], "alice@example.test")
        self.assertEqual(result["people"][0]["phone"], "+36 (20) 123-4567")
        for field, value in (("email", "not-an-email"), ("phone", "javascript:alert(1)"),
                             ("email", "alice@example.test\nBcc: secret"), ("phone", "+")):
            before = self.roster.read_bytes()
            with self.subTest(field=field), self.assertRaises(ContentError):
                self.app.members.save(self.payload({"name": "Alice", field: value}, {"id": "alice"}))
            self.assertEqual(self.roster.read_bytes(), before)
        result = self.app.members.save(self.payload({"name": "Alice", "email": "", "phone": ""}, {"id": "alice"}))
        self.assertNotIn("email", result["people"][0])
        self.assertNotIn("phone", result["people"][0])

    def test_social_links_save_clear_validate_and_preserve_older_clients(self):
        links = ["https://www.instagram.com/alice/", "https://example.test/profile"]
        result = self.app.members.save(self.payload(
            {"name": "Alice", "social_links": links}, {"id": "alice"}))
        self.assertEqual(result["people"][0]["social_links"], links)
        result = self.app.members.save(self.payload({"name": "Alice"}, {"id": "alice"}))
        self.assertEqual(result["people"][0]["social_links"], links, "Older editor payloads preserve social links")
        for value in ("https://example.test", [""], ["javascript:alert(1)"],
                      ["https://user:password@example.test"], ["https://example.test/a b"],
                      ["https://example.test:invalid"], ["https://example.test\\bad"],
                      ["https://example.test"] * 2, ["https://example.test"] * 21):
            with self.subTest(value=value), self.assertRaises(ContentError):
                self.app.members.save(self.payload({"name": "Alice", "social_links": value}, {"id": "alice"}))
        result = self.app.members.save(self.payload({"name": "Alice", "social_links": []}, {"id": "alice"}))
        self.assertNotIn("social_links", result["people"][0])

    def test_profile_contact_visibility_saves_validates_and_preserves_older_clients(self):
        for enabled in (True, False):
            result = self.app.members.save(self.payload(
                {"name": "Alice", "show_profile_contacts": enabled}, {"id": "alice"}))
            self.assertIs(result["people"][0]["show_profile_contacts"], enabled)
            result = self.app.members.save(self.payload({"name": "Alice"}, {"id": "alice"}))
            self.assertIs(result["people"][0]["show_profile_contacts"], enabled)
        for value in ("true", 1, None, [], {}):
            with self.subTest(value=value), self.assertRaises(ContentError):
                self.app.members.save(self.payload(
                    {"name": "Alice", "show_profile_contacts": value}, {"id": "alice"}))
        from people_registry import registry_data
        data = self.app.members.read()[2]
        data["people"][0]["show_profile_contacts"] = "true"
        with self.assertRaises(ContentError):
            registry_data(yaml.safe_dump(data).encode("utf-8"))

    def test_merge_never_imports_profile_contact_consent(self):
        self.report.write_text("---\ntitle: Trip\nparticipant_ids:\n- person: alice\n---\n", encoding="utf-8")
        self.app.members.save(self.payload(
            {"name": "Alice", "show_profile_contacts": True}, {"id": "alice"}))
        self.app.members.save(self.payload(
            {"name": "Bob", "show_profile_contacts": False}, {"id": "bob"}))
        plan = self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                          "source": "alice", "target": "bob"})
        self.assertIn("show_profile_contacts", plan["profile_conflicts"])
        result = self.app.members.merge({**plan, "confirm": True})
        self.assertIs(next(person for person in result["people"] if person["id"] == "bob")["show_profile_contacts"], False)

    def test_richtext_and_top_level_contacts_follow_reviewed_id_changes(self):
        page = self.root / "content" / "association.md"
        page.write_text("---\ntitle: Association\ncontacts:\n- person: alice\n"
                        "content_blocks:\n- _bookshop_name: global/richtext\n  content: Keep address\n"
                        "  contacts:\n  - person: alice\n---\n", encoding="utf-8")
        plan = self.app.members.rename_plan({"revision": self.app.members.catalog()["revision"],
                                            "source": "alice", "target": "alice-new"})
        self.app.members.rename({**plan, "confirm": True})
        meta = self.app.content.read("association.md")["metadata"]
        self.assertEqual(meta["contacts"][0]["person"], "alice-new")
        self.assertEqual(meta["content_blocks"][0]["contacts"][0]["person"], "alice-new")
        self.assertEqual(meta["content_blocks"][0]["content"], "Keep address")

    def test_merge_keeps_default_profile_contacts_private(self):
        self.report.write_text("---\ntitle: Trip\nparticipant_ids:\n- person: alice\n---\n", encoding="utf-8")
        self.app.members.save(self.payload(
            {"name": "Alice", "show_profile_contacts": True}, {"id": "alice"}))
        plan = self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                          "source": "alice", "target": "bob"})
        result = self.app.members.merge({**plan, "confirm": True})
        self.assertNotIn("show_profile_contacts",
                         next(person for person in result["people"] if person["id"] == "bob"))

    def test_social_links_follow_profile_merge_rules(self):
        self.report.write_text("---\ntitle: Trip\nparticipant_ids:\n- person: alice\n---\n", encoding="utf-8")
        links = ["https://github.com/alice"]
        self.app.members.save(self.payload({"name": "Alice", "social_links": links}, {"id": "alice"}))
        plan = self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                          "source": "alice", "target": "bob"})
        result = self.app.members.merge({**plan, "confirm": True})
        self.assertEqual(next(person for person in result["people"] if person["id"] == "bob")["social_links"], links)
        self.app.members.save(self.payload({"id": "new-person", "name": "New Person",
                                           "social_links": ["https://example.test/new"]}, group=None))
        plan = self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                          "source": "new-person", "target": "bob"})
        self.assertIn("social_links", plan["profile_conflicts"])
        result = self.app.members.merge({**plan, "confirm": True})
        self.assertEqual(next(person for person in result["people"] if person["id"] == "bob")["social_links"], links,
                         "Reviewed merge keeps the target profile on conflict")

    def test_nested_global_contacts_are_protected_and_follow_reviewed_id_changes(self):
        self.app.members.save(self.payload({"id": "contact", "name": "Contact Person", "email": "contact@example.test"}, group=None))
        page = self.root / "content" / "kapcsolat.md"
        page.write_text("---\ntitle: Contact\ncontent_blocks:\n"
                        "- _bookshop_name: contact/hero\n  title: Keep hero\n"
                        "- _bookshop_name: contact/info\n  address: {address: Keep address}\n"
                        "  contacts:\n  - person: contact\n    role: organizer\n---\nKeep body\n", encoding="utf-8")
        person = next(person for person in self.app.members.catalog()["people"] if person["id"] == "contact")
        self.assertEqual(person["references"][0]["field"], "content_blocks.1.contacts")
        with self.assertRaises(ConflictError):
            self.app.members.delete({"revision": self.app.members.catalog()["revision"],
                                     "original": {"id": "contact"}, "confirm": True})
        plan = self.app.members.rename_plan({"revision": self.app.members.catalog()["revision"],
                                             "source": "contact", "target": "contact-new"})
        self.assertEqual(plan["files"][0]["fields"], ["content_blocks.1.contacts"])
        self.app.members.rename({**plan, "confirm": True})
        meta = self.app.content.read("kapcsolat.md")["metadata"]
        self.assertEqual(meta["content_blocks"][1]["contacts"], [{"person": "contact-new", "role": "organizer"}])
        self.assertEqual(meta["content_blocks"][1]["address"], {"address": "Keep address"})
        self.assertEqual(meta["content_blocks"][0]["title"], "Keep hero")
        self.assertTrue(page.read_text(encoding="utf-8").endswith("---\nKeep body\n"))
        plan = self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                            "source": "contact-new", "target": "bob"})
        result = self.app.members.merge({**plan, "confirm": True})
        self.assertEqual(self.app.content.read("kapcsolat.md")["metadata"]["content_blocks"][1]["contacts"][0]["person"], "bob")
        self.assertEqual(next(person for person in result["people"] if person["id"] == "bob")["email"], "contact@example.test")

    def test_unknown_nested_contact_blocks_fail_reference_validation(self):
        from people_registry import page_references, person_index
        people = person_index(self.app.members.read()[2])
        for contacts in ([{"person": "missing"}], "broken", [None]):
            with self.subTest(contacts=contacts), self.assertRaises(ContentError):
                page_references({"content_blocks": [{"_bookshop_name": "contact/info", "contacts": contacts}]}, people)

    def merge_fixture(self):
        self.app.members.save(self.payload(
            {"id": "duplicate", "name": "Duplicate Alice", "needs_review": True,
             "image": "/images/members/unused_thumb.webp"}, group=None))
        self.report.write_text("---\ntitle: Trip\nauthor_id: duplicate\nparticipant_ids:\n"
                               "- duplicate\n- bob\ncontacts:\n- person: duplicate\n  role: organizer\n"
                               "---\nHistorical report text\n", encoding="utf-8")
        return self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                            "source": "duplicate", "target": "alice"})

    def test_merge_rewrites_all_assignments_without_duplicating_profile(self):
        plan = self.merge_fixture()
        result = self.app.members.merge({**plan, "confirm": True})
        self.assertEqual(result["selected"], {"id": "alice"})
        self.assertEqual(len(result["people"]), 2)
        meta = self.app.content.read("turak/test.md")["metadata"]
        self.assertEqual(meta["author_id"], "alice")
        self.assertEqual(meta["participant_ids"], ["alice", "bob"])
        self.assertEqual(meta["contacts"][0]["person"], "alice")
        self.assertEqual(result["people"][0]["image"], "/images/members/alice_thumb.webp")
        self.assertIn("Duplicate Alice", result["people"][0]["aliases"])
        self.assertTrue(result["people"][0]["needs_review"])
        self.assertTrue(self.roster.read_text(encoding="utf-8").startswith("# Keep roster documentation"))
        self.assertEqual(self.report.read_text(encoding="utf-8").split("---")[-1], "\nHistorical report text\n")
        self.assertTrue((self.root / "static" / "images" / "members" / "unused_thumb.webp").exists())

    def test_merge_confirmation_stale_pages_and_roles_block_writes(self):
        plan = self.merge_fixture()
        raw = self.roster.read_bytes()
        with self.assertRaises(ContentError):
            self.app.members.merge(plan)
        self.report.write_bytes(self.report.read_bytes() + b"External edit\n")
        with self.assertRaises(ConflictError):
            self.app.members.merge({**plan, "confirm": True})
        self.assertEqual(self.roster.read_bytes(), raw)
        self.report.write_text("---\nparticipant_ids:\n- person: duplicate\n  role: teacher\n"
                               "- person: alice\n  role: student\n---\n", encoding="utf-8")
        with self.assertRaises(ContentError):
            self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                          "source": "duplicate", "target": "alice"})

    def test_merge_deduplicates_assignments_and_rolls_back_disk_failure(self):
        from pathlib import Path
        plan = self.merge_fixture()
        original_report, original_registry = self.report.read_bytes(), self.roster.read_bytes()
        replace = Path.replace
        failed = False

        def fail_registry_once(path, target):
            nonlocal failed
            if target == self.roster and not failed:
                failed = True
                raise OSError("Fixture registry write failure")
            return replace(path, target)

        with patch.object(Path, "replace", fail_registry_once), self.assertRaises(OSError):
            self.app.members.merge({**plan, "confirm": True})
        self.assertEqual(self.roster.read_bytes(), original_registry)
        self.assertEqual(self.report.read_bytes(), original_report)
        self.assertEqual(list(self.roster.parent.glob(".people-*.tmp")), [])
        self.report.write_text("---\nparticipant_ids: [alice, duplicate, bob]\n---\n", encoding="utf-8")
        plan = self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                            "source": "duplicate", "target": "alice"})
        self.app.members.merge({**plan, "confirm": True})
        self.assertEqual(self.app.content.read("turak/test.md")["metadata"]["participant_ids"], ["alice", "bob"])

    def test_merge_transfers_membership_when_target_is_nonmember(self):
        self.app.members.save(self.payload({"id": "guest", "name": "Guest"}, group=None))
        # First resolve all name-only participant references in the legacy fixture.
        self.report.write_text("---\nauthor_id: alice\nparticipant_ids: [alice]\n---\n", encoding="utf-8")
        plan = self.app.members.merge_plan({"revision": self.app.members.catalog()["revision"],
                                            "source": "alice", "target": "guest"})
        result = self.app.members.merge({**plan, "confirm": True})
        guest = next(p for p in result["people"] if p["id"] == "guest")
        self.assertEqual(guest["membership"], {"group": 0, "label": "First", "role": "Leader",
                                               "roles": [], "legacy_role": "Leader"})
        self.assertEqual(guest["image"], "/images/members/alice_thumb.webp")

    def test_reference_context_distinguishes_courses_trips_roles_and_credits(self):
        self.report.write_text("---\ntitle: Expedition\ndate: 2026-03-01\n"
                               "author_id: bob\nparticipant_ids:\n- person: alice\n  role: guide\n"
                               "- bob\n---\n", encoding="utf-8")
        course = self.root / "content" / "tanfolyamok" / "course.md"
        course.parent.mkdir()
        course.write_text("---\ntitle: Course 2025\ndate: 2025-01-01\ndraft: true\n"
                          "author_id: bob\nparticipant_ids:\n- person: alice\n  role: instructor\n"
                          "- person: bob\n  role: student\n---\n", encoding="utf-8")
        self.app.members.save(self.payload({"name": "Bob"}, {"id": "bob"}, group=None))
        people = {person["id"]: person for person in self.app.members.catalog()["people"]}
        self.assertEqual(people["alice"]["membership"]["label"], "First")
        self.assertIsNone(people["bob"]["membership"])
        courses = [r for r in people["bob"]["references"] if r["section"] == "tanfolyamok"]
        participants = [r for r in courses if r["field"] == "participant_ids"]
        self.assertEqual(len(participants), 1)
        self.assertEqual(participants[0]["title"], "Course 2025")
        self.assertEqual(participants[0]["role"], "student")
        self.assertEqual(participants[0]["date"], "2025-01-01")
        self.assertTrue(participants[0]["draft"])
        expedition = [r for r in people["bob"]["references"] if r["section"] == "turak"
                      and r["field"] == "participant_ids"]
        self.assertEqual(len(expedition), 1)
        self.assertEqual(expedition[0]["title"], "Expedition")
        self.assertEqual(expedition[0]["role"], "")
        self.assertEqual(len([r for r in people["bob"]["references"] if r["field"] == "author_id"]), 2)
        self.assertEqual(next(r["role"] for r in people["alice"]["references"]
                              if r["section"] == "tanfolyamok"), "instructor")


class MemberHTTPTests(MemberFixture):
    def setUp(self):
        super().setUp()
        from site_workbench import WorkbenchServer
        self.server = WorkbenchServer(("127.0.0.1", 0), self.app)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)

    def request(self, route, payload=None, token=True):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        headers = {"X-Workbench-Token": self.app.token} if token else {}
        connection.request("GET" if payload is None else "POST", route,
                           body=json.dumps(payload) if payload is not None else None, headers=headers)
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_member_api_guards_crud_and_conflict(self):
        status, catalog = self.request("/api/workbench/members")
        self.assertEqual(status, 200)
        self.assertEqual(len(catalog["groups"]), 3)
        payload = self.payload(group=None)
        self.assertEqual(self.request("/api/workbench/members/save", payload, token=False)[0], 403)
        status, result = self.request("/api/workbench/members/save", payload)
        self.assertEqual(status, 200)
        self.assertEqual(self.request("/api/workbench/members/save", payload)[0], 409)
        self.assertEqual(self.request("/api/workbench/members/delete", {
            "revision": result["revision"], "original": result["selected"], "confirm": True,
        })[0], 200)
        self.assertEqual(self.request("/api/workbench/members/save", {
            **self.payload(), "member": {"name": "Alice"},
        })[0], 400)

    def test_custom_category_endpoints_require_token_revision_and_confirmation(self):
        payload = {"revision": self.app.members.catalog()["revision"], "id": "helpers", "label": "Helpers"}
        self.assertEqual(self.request("/api/workbench/members/category-save", payload, token=False)[0], 403)
        status, result = self.request("/api/workbench/members/category-save", payload)
        self.assertEqual(status, 200)
        self.assertEqual(self.request("/api/workbench/members/category-save", payload)[0], 409)
        deletion = {"revision": result["revision"], "id": "helpers", "confirm": True}
        self.assertEqual(self.request("/api/workbench/members/category-delete", deletion, token=False)[0], 403)
        self.assertEqual(self.request("/api/workbench/members/category-delete", {**deletion, "confirm": False})[0], 400)
        self.assertEqual(self.request("/api/workbench/members/category-delete", deletion)[0], 200)

    def test_portrait_deletion_api_guards_and_confirm(self):
        payload = {"revision": self.app.members.catalog()["revision"],
                   "urls": ["/images/members/unused_thumb.webp"]}
        self.assertEqual(self.request("/api/workbench/members/portrait-delete-plan", payload, token=False)[0], 403)
        status, plan = self.request("/api/workbench/members/portrait-delete-plan", payload)
        self.assertEqual(status, 200)
        self.assertEqual(self.request("/api/workbench/members/portrait-delete", {**plan, "confirm": True}, token=False)[0], 403)
        self.assertEqual(self.request("/api/workbench/members/portrait-delete", plan)[0], 400)
        status, result = self.request("/api/workbench/members/portrait-delete", {**plan, "confirm": True})
        self.assertEqual(status, 200)
        self.assertEqual(result["deleted"], payload["urls"])
        self.assertEqual(self.request("/api/workbench/members/portrait-delete", {**plan, "confirm": True})[0], 409)

    def test_participant_role_api_requires_token_revision_confirmation_and_working_branch(self):
        (self.root / "data" / "participant_roles.yaml").write_text(
            "roles:\n- id: leader\n  label: Leader\n  aliases: []\n", encoding="utf-8")
        payload = {"revision": self.app.roles.catalog()["revision"], "id": "helper",
                   "label": "Helper", "aliases": [], "exempt_from_guest": False}
        self.assertEqual(self.request("/api/workbench/members/role-save", payload, token=False)[0], 403)
        status, result = self.request("/api/workbench/members/role-save", payload)
        self.assertEqual(status, 200)
        self.assertEqual(result["role_catalog"]["roles"][-1]["id"], "helper")
        self.assertEqual(self.request("/api/workbench/members/role-save", payload)[0], 409)
        deletion = {"revision": result["role_catalog"]["revision"], "id": "helper", "original": "helper"}
        self.assertEqual(self.request("/api/workbench/members/role-delete", deletion, token=False)[0], 403)
        self.assertEqual(self.request("/api/workbench/members/role-delete", deletion)[0], 400)
        import subprocess
        subprocess.run(["git", "-C", str(self.root), "branch", "-m", "main"], check=True, capture_output=True)
        self.assertEqual(self.request("/api/workbench/members/role-delete", {**deletion, "confirm": True})[0], 409)
        subprocess.run(["git", "-C", str(self.root), "branch", "-m", "fixture"], check=True, capture_output=True)
        self.assertEqual(self.request("/api/workbench/members/role-delete", {**deletion, "confirm": True})[0], 200)

    def test_id_change_api_requires_token_review_and_confirmation(self):
        payload = {"revision": self.app.members.catalog()["revision"], "source": "alice", "target": "alice-new"}
        self.assertEqual(self.request("/api/workbench/members/rename-plan", payload, token=False)[0], 403)
        status, plan = self.request("/api/workbench/members/rename-plan", payload)
        self.assertEqual(status, 200)
        self.assertEqual(self.request("/api/workbench/members/rename", {**plan, "confirm": True}, token=False)[0], 403)
        self.assertEqual(self.request("/api/workbench/members/rename", plan)[0], 400)
        status, result = self.request("/api/workbench/members/rename", {**plan, "confirm": True})
        self.assertEqual(status, 200)
        self.assertEqual(result["selected"], {"id": "alice-new"})
        self.assertEqual(self.request("/api/workbench/members/rename", {**plan, "confirm": True})[0], 409)
