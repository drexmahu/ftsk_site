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
        self.roster = self.root / "data" / "members.yaml"
        self.roster.write_text(
            "# Keep roster documentation\nversion: custom\n"
            "groups:\n- label: First\n  members:\n"
            "  - name: Alice\n    nickname: Ally\n    role: Leader\n"
            "    image: /images/members/alice_thumb.webp\n"
            "    modal_image: /images/members/alice_full.webp\n"
            "    bio: Original biography\n    custom: {keep: true}\n"
            "- label: Second\n  extra: preserved\n  members:\n  - name: Bob\n",
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
        return {"revision": self.app.members.catalog()["revision"], "original": original,
                "group": group, "member": member or {"name": "New member"}}


class MemberTests(MemberFixture):
    def test_catalog_matches_site_and_exposes_orphans(self):
        catalog = self.app.members.catalog()
        alice = catalog["groups"][0]["members"][0]
        self.assertEqual(len(alice["references"]), 2)
        self.assertEqual([entry["name"] for entry in catalog["audit"]["unmatched_participants"]],
                         ["Guest", "alice"])
        self.assertEqual(catalog["audit"]["unmatched_authors"], [])
        self.assertEqual(catalog["audit"]["missing_images"], [])
        self.assertEqual(catalog["audit"]["unassigned_portraits"],
                         ["/images/members/unused_full.webp", "/images/members/unused_thumb.webp"])

    def test_add_reload_edit_move_preserves_unrelated_data(self):
        result = self.app.members.save(self.payload({"name": "Cecília", "nickname": "Ceci"}))
        self.assertEqual(result["selected"], {"group": 0, "index": 1})
        self.assertEqual(self.app.members.read()[2]["groups"][0]["members"][1]["name"], "Cecília")
        result = self.app.members.save(self.payload(
            {"name": "Alice Renamed", "bio": "Two\nlines"},
            {"group": 0, "index": 0}, group=1))
        self.assertEqual(result["selected"], {"group": 1, "index": 1})
        persisted = yaml.safe_load(self.roster.read_text(encoding="utf-8"))
        self.assertEqual(persisted["version"], "custom")
        self.assertEqual(persisted["groups"][1]["extra"], "preserved")
        self.assertEqual(persisted["groups"][1]["members"][1]["custom"], {"keep": True})
        self.assertEqual(persisted["groups"][1]["members"][0], {"name": "Bob"})
        self.assertTrue(self.roster.read_text(encoding="utf-8").startswith("# Keep roster documentation\n"))
        self.assertEqual(self.report.read_bytes(), self.report_bytes)

    def test_edit_in_place_retains_order_and_assigns_existing_pair(self):
        result = self.app.members.save(self.payload({
            "name": "Alice", "image": "/images/members/unused_thumb.webp",
            "modal_image": "/images/members/unused_full.webp", "role": "New role",
        }, {"group": 0, "index": 0}))
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
        }, {"group": 0, "index": 0}))
        self.assertEqual(result["groups"][0]["members"][0]["image"], thumb)
        self.assertEqual(result["groups"][0]["members"][0]["modal_image"], full)
        self.assertNotIn(thumb, result["audit"]["unassigned_portraits"])
        self.assertEqual(self.report.read_bytes(), self.report_bytes)

    def test_delete_last_member_keeps_selectable_empty_group_and_files(self):
        result = self.app.members.delete({
            "revision": self.app.members.catalog()["revision"],
            "original": {"group": 0, "index": 0}, "confirm": True,
        })
        self.assertEqual(result["groups"][0]["members"], [])
        self.assertEqual(self.report.read_bytes(), self.report_bytes)
        self.assertEqual(len(result["portraits"]), 4)
        self.assertIn("Alice (Leader)", [item["name"] for item in result["audit"]["unmatched_participants"]])
        self.app.members.save(self.payload({"name": "Replacement"}, group=0))
        self.assertEqual(self.app.members.catalog()["groups"][0]["members"][0]["name"], "Replacement")

    def test_delete_requires_explicit_confirmation(self):
        raw = self.roster.read_bytes()
        with self.assertRaises(ContentError):
            self.app.members.delete({"revision": self.app.members.catalog()["revision"],
                                     "original": {"group": 0, "index": 0}})
        self.assertEqual(self.roster.read_bytes(), raw)

    def test_verifier_accepts_empty_group(self):
        import verify_members
        self.roster.write_text("groups:\n- label: Empty\n  members: []\n", encoding="utf-8")
        problems = []
        with patch.object(verify_members, "MEMBERS_PATH", self.roster):
            self.assertEqual(verify_members.load_members(problems), [])
        self.assertEqual(problems, [])

    def test_stale_save_and_delete_do_not_overwrite(self):
        payload = self.payload()
        self.roster.write_bytes(self.roster.read_bytes() + b"\n# External edit\n")
        raw = self.roster.read_bytes()
        with self.assertRaises(ConflictError):
            self.app.members.save(payload)
        with self.assertRaises(ConflictError):
            self.app.members.delete({**payload, "original": {"group": 0, "index": 0}, "confirm": True})
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
            {"name": "Person", "image": "/images/../../data/members.yaml"},
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
        for original in ({}, {"group": 0, "index": -1}, {"group": True, "index": 0}):
            with self.subTest(original=original), self.assertRaises(ContentError):
                self.app.members.save(self.payload(original=original))

    def test_missing_existing_image_can_be_repaired_or_retained_explicitly(self):
        (self.root / "static" / "images" / "members" / "alice_thumb.webp").unlink()
        catalog = self.app.members.catalog()
        self.assertEqual(catalog["audit"]["missing_images"][0]["name"], "Alice")
        self.app.members.save(self.payload({"name": "Alice", "image": "/images/members/alice_thumb.webp"},
                                           {"group": 0, "index": 0}))
        result = self.app.members.save(self.payload({"name": "Alice"}, {"group": 0, "index": 0}))
        self.assertEqual(result["audit"]["missing_images"], [])

    def test_bad_report_is_visible_and_does_not_block_roster(self):
        self.report.write_text("---\nparticipants: wrong\n---\n", encoding="utf-8")
        self.assertIn("Participants must be a list", self.app.members.catalog()["audit"]["warnings"][0])

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
        self.assertEqual(len(catalog["groups"]), 2)
        payload = self.payload()
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
