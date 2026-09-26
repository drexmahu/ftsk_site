"""Replace a dedicated site directory using SFTP, with verified SSH host keys."""

import argparse
import base64
import errno
import os
import posixpath
import stat
import tempfile
import uuid
from pathlib import Path


def deployment_page(source):
    root = Path(source)
    page = Path(__file__).with_name("deployment-page.html").read_text(encoding="utf-8")
    artwork = {
        "__ERROR_IMAGE__": "images/404/error.svg",
        "__HANGING_MOTIF__": "images/motifs/hanging.svg",
        "__STANDING_MOTIF__": "images/motifs/standing.svg",
    }
    for token, relative in artwork.items():
        image = root / relative
        if not image.is_file() or image.is_symlink():
            raise ValueError(f"Deployment page artwork is missing or linked: {relative}")
        encoded = base64.b64encode(image.read_bytes()).decode("ascii")
        page = page.replace(token, f"data:image/svg+xml;base64,{encoded}")
    return page


def local_manifest(source):
    root = Path(source).absolute()
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Build source must be a real directory")
    for required in ("index.html", "404.html"):
        if not (root / required).is_file() or not (root / required).stat().st_size:
            raise ValueError(f"Build is missing a nonempty {required}")
    files = []
    directories = []
    for entry in root.rglob("*"):
        if entry.is_symlink():
            raise ValueError("Build artifacts must not contain symlinks")
        relative = entry.relative_to(root).as_posix()
        if entry.is_dir():
            directories.append(relative)
        elif entry.is_file():
            files.append(relative)
        else:
            raise ValueError("Build contains an unsupported file type")
    return root, sorted(directories, key=lambda value: (value.count("/"), value)), sorted(files)


def site_directory(sftp, directory):
    if not directory or not directory.startswith("/") or "\\" in directory or "\x00" in directory:
        raise ValueError("SFTP_SERVER_DIR must be an explicit absolute POSIX site directory")
    normalized = posixpath.normpath(directory)
    if normalized == "/" or ".." in directory.split("/"):
        raise ValueError("Refusing to purge a root or parent-traversal path")
    if not stat.S_ISDIR(sftp.lstat(normalized).st_mode):
        raise ValueError("SFTP_SERVER_DIR must exist and must not be a symlink")
    canonical = sftp.normalize(normalized).rstrip("/") or "/"
    home = sftp.normalize(".").rstrip("/") or "/"
    if canonical in ("/", home):
        raise ValueError("Refusing to purge the SFTP root or account home; use a dedicated site directory")
    return canonical


def purge_directory(sftp, directory, keep=()):
    for entry in sftp.listdir_attr(directory):
        name = entry.filename
        if name in (".", "..") or "/" in name or "\\" in name or not name:
            raise ValueError("SFTP returned an unsafe directory entry")
        if name in keep:
            continue
        remote = posixpath.join(directory, name)
        if entry.st_mode is None:
            raise ValueError("SFTP did not report the remote file type")
        if stat.S_ISDIR(entry.st_mode):
            purge_directory(sftp, remote)
            sftp.rmdir(remote)
        else:
            sftp.remove(remote)


def publish_page(sftp, source, destination):
    temporary = destination + ".ftsk-upload-" + uuid.uuid4().hex
    try:
        sftp.put(str(source), temporary, confirm=True)
        try:
            sftp.posix_rename(temporary, destination)
        except OSError as exc:
            unsupported = exc.errno in (errno.ENOSYS, errno.EOPNOTSUPP) or "unsupported" in str(exc).lower() or "not supported" in str(exc).lower()
            if not unsupported:
                raise
            try:
                sftp.lstat(destination)
            except FileNotFoundError:
                pass
            else:
                sftp.remove(destination)
            sftp.rename(temporary, destination)
    finally:
        try:
            sftp.remove(temporary)
        except OSError:
            pass


def replace_site(sftp, source, remote_directory, dry_run=False):
    root, directories, files = local_manifest(source)
    target = site_directory(sftp, remote_directory)
    maintenance = deployment_page(root)
    if dry_run:
        print(f"Dry run: would publish the temporary deployment page, purge old artifacts, upload {len(files)} files, and switch to the completed site; no remote changes made.")
        return
    with tempfile.TemporaryDirectory(prefix="ftsk-deployment-page-") as temporary:
        page = Path(temporary) / "index.html"
        page.write_text(maintenance, encoding="utf-8")
        for name in ("index.html", "404.html"):
            publish_page(sftp, page, posixpath.join(target, name))
    purge_directory(sftp, target, keep=("index.html", "404.html"))
    for relative in directories:
        sftp.mkdir(posixpath.join(target, relative))
    for relative in files:
        if relative in ("index.html", "404.html"):
            continue
        sftp.put(str(root / relative), posixpath.join(target, relative), confirm=True)
    publish_page(sftp, root / "404.html", posixpath.join(target, "404.html"))
    publish_page(sftp, root / "index.html", posixpath.join(target, "index.html"))
    print(f"Replaced the dedicated site directory with {len(files)} build artifacts.")


def required_environment(name):
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"Required deployment setting is missing: {name}")
    return value


def main():
    import paramiko

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="public")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    local_manifest(args.source)
    host = required_environment("SFTP_SERVER").strip()
    username = required_environment("SFTP_USERNAME").strip()
    password = required_environment("SFTP_PASSWORD")
    directory = required_environment("SFTP_SERVER_DIR").strip()
    known_hosts = required_environment("SFTP_KNOWN_HOSTS")
    port = int(os.environ.get("SFTP_PORT") or "22")
    if not 1 <= port <= 65535:
        raise ValueError("SFTP_PORT must be between 1 and 65535")
    with tempfile.TemporaryDirectory(prefix="ftsk-sftp-") as temporary:
        hosts_file = Path(temporary) / "known_hosts"
        hosts_file.write_text(known_hosts, encoding="utf-8")
        client = paramiko.SSHClient()
        client.load_host_keys(str(hosts_file))
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
        try:
            client.connect(hostname=host, port=port, username=username, password=password,
                           look_for_keys=False, allow_agent=False, timeout=30,
                           banner_timeout=30, auth_timeout=30)
            with client.open_sftp() as sftp:
                sftp.get_channel().settimeout(60)
                replace_site(sftp, args.source, directory, args.dry_run)
        finally:
            client.close()


if __name__ == "__main__":
    main()