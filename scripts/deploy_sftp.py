"""Replace a dedicated site directory using SFTP, with verified SSH host keys."""

import argparse
import base64
import errno
import os
import posixpath
import stat
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

PROTECTED_PAGES = ("index.html", "404.html", ".htaccess")


def deployment_page(source):
    root = Path(source)
    page = Path(__file__).with_name("deployment-page.html").read_text(encoding="utf-8")
    image = root / "images/404/error.svg"
    if not image.is_file() or image.is_symlink():
        raise ValueError("Deployment page artwork is missing or linked: images/404/error.svg")
    encoded = base64.b64encode(image.read_bytes()).decode("ascii")
    return page.replace("__ERROR_IMAGE__", f"data:image/svg+xml;base64,{encoded}")


def maintenance_rules(base_path="/"):
    """Apache rules answering every URL with the deployment page (HTTP 503) until the deploy ends."""
    prefix = "/" + base_path.strip("/") if base_path.strip("/") else ""
    return f"""# Temporary FTSK deployment rules: replaced by the real rules when the deployment finishes.
ErrorDocument 404 {prefix}/404.html
ErrorDocument 503 {prefix}/index.html
<IfModule mod_headers.c>
  Header always set Retry-After "60"
  Header always set Cache-Control "no-store"
</IfModule>
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{{REQUEST_URI}} !^{prefix}/(index|404)\\.html$
  RewriteRule ^ - [R=503,L]
</IfModule>
"""


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


def verify_site(site_url, opener=urllib.request.urlopen):
    """Return (fatal, warnings) after checking the home page and a missing URL on the live site."""
    base = site_url.rstrip("/") + "/"

    def fetch(url):
        request = urllib.request.Request(url, headers={"User-Agent": "ftsk-deploy-check", "Cache-Control": "no-cache"})
        try:
            with opener(request, timeout=20) as response:
                return response.status, response.read(400000).decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read(400000).decode("utf-8", "replace")

    fatal, warnings = None, []
    try:
        status, body = fetch(base)
        if status >= 500:
            fatal = f"The live home page answered HTTP {status} after the deployment."
        elif status != 200 or "Frissítés alatt" in body:
            warnings.append(f"The live home page did not show the new site yet (HTTP {status}); a cache may still serve the deployment page.")
        status, body = fetch(urllib.parse.urljoin(base, f"ftsk-missing-{uuid.uuid4().hex}/"))
        if status != 404 or "data-error-home" not in body:
            warnings.append(
                f"A missing URL answered HTTP {status} without the FTSK 404 page. The web server ignores the published "
                ".htaccess rule; configure the host to serve /404.html for missing pages (see docs/TECHNICAL_ENVIRONMENT.md, 404 handling).")
    except (OSError, urllib.error.URLError) as exc:
        warnings.append(f"The live site could not be checked: {exc}")
    return fatal, warnings


def replace_site(sftp, source, remote_directory, dry_run=False, site_url=None, opener=urllib.request.urlopen):
    root, directories, files = local_manifest(source)
    target = site_directory(sftp, remote_directory)
    maintenance = deployment_page(root)
    base_path = urllib.parse.urlsplit(site_url).path if site_url else "/"
    if dry_run:
        print(f"Dry run: would publish the temporary deployment page, purge old artifacts, upload {len(files)} files, and switch to the completed site; no remote changes made.")
        return
    destination = lambda name: posixpath.join(target, name)
    with tempfile.TemporaryDirectory(prefix="ftsk-deployment-page-") as temporary:
        page = Path(temporary) / "index.html"
        page.write_text(maintenance, encoding="utf-8")
        rules = Path(temporary) / ".htaccess"
        rules.write_text(maintenance_rules(base_path), encoding="utf-8")
        for name in ("index.html", "404.html"):
            publish_page(sftp, page, destination(name))
        publish_page(sftp, rules, destination(".htaccess"))
    purge_directory(sftp, target, keep=PROTECTED_PAGES)
    for relative in directories:
        sftp.mkdir(destination(relative))
    # Pages go last so almost nothing real is reachable before the final switch.
    for relative in sorted(files, key=lambda name: (name.endswith(".html"), name)):
        if relative in PROTECTED_PAGES:
            continue
        sftp.put(str(root / relative), destination(relative), confirm=True)
    publish_page(sftp, root / "404.html", destination("404.html"))
    has_rules = (root / ".htaccess").is_file()
    if has_rules:
        publish_page(sftp, root / ".htaccess", destination(".htaccess"))
    else:
        sftp.remove(destination(".htaccess"))
    publish_page(sftp, root / "index.html", destination("index.html"))
    print(f"Replaced the dedicated site directory with {len(files)} build artifacts.")
    if not site_url:
        print("Live check skipped: set SITE_URL or --site-url to verify the home page and the 404 page.")
        return
    fatal, warnings = verify_site(site_url, opener)
    for warning in warnings:
        print(f"::warning::{warning}")
    if fatal:
        if has_rules:
            sftp.remove(destination(".htaccess"))
        raise RuntimeError(f"{fatal} The published .htaccess was removed so the site can serve again; fix the server rules before redeploying.")
    if not warnings:
        print("Live check passed: the home page is served and missing URLs show the FTSK 404 page.")


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
    parser.add_argument("--site-url", default=os.environ.get("SITE_URL", ""),
                        help="Public site URL used for the live check after publishing.")
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
                replace_site(sftp, args.source, directory, args.dry_run, args.site_url.strip() or None)
        finally:
            client.close()


if __name__ == "__main__":
    main()