import posixpath
import errno
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import scripts.deploy_sftp as deploy_sftp
import scripts.verify_site_links as verify_site_links


class FakeSFTP:
    def __init__(self):
        self.nodes = {
            "/site": stat.S_IFDIR,
            "/site/old": stat.S_IFDIR,
            "/site/old/stale.html": stat.S_IFREG,
            "/site/.htaccess": stat.S_IFREG,
            "/site/link": stat.S_IFLNK,
            "/site-link": stat.S_IFLNK,
            "/outside": stat.S_IFDIR,
            "/outside/keep": stat.S_IFREG,
            "/home/account": stat.S_IFDIR,
        }
        self.operations = []
        self.contents = {}

    def normalize(self, path):
        return "/home/account" if path == "." else posixpath.normpath(path)

    def lstat(self, path):
        if path not in self.nodes:
            raise FileNotFoundError(path)
        return SimpleNamespace(st_mode=self.nodes[path])

    def listdir_attr(self, path):
        return [SimpleNamespace(filename=posixpath.basename(name), st_mode=mode)
                for name, mode in list(self.nodes.items())
                if posixpath.dirname(name) == path and name != path]

    def remove(self, path):
        if path not in self.nodes:
            raise FileNotFoundError(path)
        self.operations.append(("remove", path))
        del self.nodes[path]
        self.contents.pop(path, None)

    def rmdir(self, path):
        self.operations.append(("rmdir", path))
        del self.nodes[path]

    def mkdir(self, path):
        self.operations.append(("mkdir", path))
        self.nodes[path] = stat.S_IFDIR

    def put(self, local, remote, confirm):
        if not confirm:
            raise AssertionError("Upload size confirmation disabled")
        self.contents[remote] = Path(local).read_bytes()
        self.operations.append(("put", remote))
        self.nodes[remote] = stat.S_IFREG

    def rename(self, source, destination):
        self.operations.append(("rename", destination))
        self.nodes[destination] = self.nodes.pop(source)
        self.contents[destination] = self.contents.pop(source)

    def posix_rename(self, source, destination):
        self.rename(source, destination)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.source = Path(self.temporary.name)
        for filename in ("index.html", "404.html", ".nojekyll"):
            (self.source / filename).write_text("build artifact", encoding="utf-8")
        (self.source / "images").mkdir()
        (self.source / "images/photo.webp").write_bytes(b"image")
        for filename in ("images/404/error.svg", "images/motifs/hanging.svg", "images/motifs/standing.svg"):
            target = self.source / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"></svg>', encoding="utf-8")
        self.remote = FakeSFTP()

    def test_full_purge_precedes_complete_upload(self):
        deploy_sftp.replace_site(self.remote, self.source, "/site")
        self.assertNotIn("/site/.htaccess", self.remote.nodes)
        self.assertNotIn("/site/old", self.remote.nodes)
        self.assertNotIn("/site/link", self.remote.nodes)
        self.assertIn("/outside/keep", self.remote.nodes)
        self.assertIn("/site/.nojekyll", self.remote.nodes)
        self.assertIn("/site/images/photo.webp", self.remote.nodes)
        first_upload = next(index for index, operation in enumerate(self.remote.operations) if operation == ("put", "/site/.nojekyll"))
        self.assertTrue(all(operation[0] not in ("remove", "rmdir") for operation in self.remote.operations[first_upload:]))
        self.assertEqual(self.remote.operations[-1], ("rename", "/site/index.html"))
        self.assertEqual(self.remote.contents["/site/index.html"], b"build artifact")
        self.assertEqual(self.remote.contents["/site/404.html"], b"build artifact")
        self.assertFalse(any("ftsk-upload" in path for path in self.remote.nodes))

    def test_failed_artifact_upload_keeps_deployment_page(self):
        original_put = self.remote.put

        def fail_upload(local, remote, confirm):
            if remote == "/site/images/photo.webp":
                raise OSError("Simulated upload failure")
            original_put(local, remote, confirm)

        self.remote.put = fail_upload
        with self.assertRaises(OSError):
            deploy_sftp.replace_site(self.remote, self.source, "/site")
        for name in ("index.html", "404.html"):
            page = self.remote.contents["/site/" + name].decode("utf-8")
            self.assertIn("data:image/svg+xml;base64,", page)
            self.assertIn("Frissítés alatt", page)

    def test_standard_rename_fallback(self):
        def unsupported(source, destination):
            raise OSError(errno.EOPNOTSUPP, "Operation unsupported")

        self.remote.posix_rename = unsupported
        deploy_sftp.replace_site(self.remote, self.source, "/site")
        self.assertEqual(self.remote.contents["/site/index.html"], b"build artifact")

    def test_missing_artwork_rejected_before_remote_changes(self):
        (self.source / "images/404/error.svg").unlink()
        with self.assertRaises(ValueError):
            deploy_sftp.replace_site(self.remote, self.source, "/site")
        self.assertEqual(self.remote.operations, [])

    def test_dry_run_does_not_modify_server(self):
        deploy_sftp.replace_site(self.remote, self.source, "/site", dry_run=True)
        self.assertEqual(self.remote.operations, [])

    def test_unsafe_remote_roots_rejected(self):
        for directory in ("/", ".", "relative", "/site/..", "/home/account", "/site-link"):
            with self.subTest(directory=directory), self.assertRaises(ValueError):
                deploy_sftp.replace_site(self.remote, self.source, directory)
        self.assertEqual(self.remote.operations, [])

    def test_incomplete_build_rejected_before_purge(self):
        (self.source / "404.html").unlink()
        with self.assertRaises(ValueError):
            deploy_sftp.replace_site(self.remote, self.source, "/site")
        self.assertEqual(self.remote.operations, [])


class LinkMappingTests(unittest.TestCase):
    def test_subpath_assets_fragments_and_missing_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "index.html").write_text('<a href="/preview/guide/#details">Guide</a><button data-search-index="/preview/searchindex.json"></button>', encoding="utf-8")
            (root / "guide").mkdir()
            (root / "guide/index.html").write_text('<h2 id="details">Details</h2>', encoding="utf-8")
            (root / "searchindex.json").write_text('[{"url":"/preview/guide/"}]', encoding="utf-8")
            _, errors = verify_site_links.verify_site(root, "https://example.org/preview/")
            self.assertEqual(errors, [])
            (root / "guide/index.html").write_text('<a href="/wrong/">Broken</a>', encoding="utf-8")
            _, errors = verify_site_links.verify_site(root, "https://example.org/preview/")
            self.assertTrue(any("escapes deployment prefix" in error for error in errors))
            self.assertTrue(any("missing fragment" in error for error in errors))


if __name__ == "__main__":
    unittest.main()