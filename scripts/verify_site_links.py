"""Validate generated internal links and assets for an exact deployment base URL."""

import argparse
import json
import posixpath
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse


class PageReferences(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.references = []
        self.identifiers = set()

    def handle_starttag(self, tag, attributes):
        values = dict(attributes)
        if values.get("id"):
            self.identifiers.add(values["id"])
        if tag == "a" and values.get("name"):
            self.identifiers.add(values["name"])
        for attribute in ("href", "src", "poster", "data-search-index"):
            value = values.get(attribute)
            if value and not (tag == "link" and values.get("rel") == "canonical"):
                self.references.append(value)
        if tag == "meta":
            kind = values.get("property") or values.get("name")
            if kind in ("og:image", "twitter:image") and values.get("content"):
                self.references.append(values["content"])
            if values.get("http-equiv", "").lower() == "refresh":
                _, separator, target = values.get("content", "").partition("url=")
                if separator:
                    self.references.append(target)


def verify_site(root, base_url):
    root = Path(root).resolve()
    base_url = base_url.rstrip("/") + "/"
    base = urlparse(base_url)
    if base.scheme not in ("http", "https") or not base.netloc:
        raise ValueError("Deployment base URL must be an absolute HTTP(S) URL")
    prefix = base.path
    pages = {}
    for path in root.rglob("*"):
        if path.suffix.lower() not in (".html", ".htm"):
            continue
        parser = PageReferences()
        parser.feed(path.read_text(encoding="utf-8"))
        pages[path.resolve()] = parser
    errors = []

    def check(reference, document_url, source):
        target = urlparse(urljoin(document_url, reference))
        if target.scheme not in ("http", "https"):
            return
        own_host = target.netloc == base.netloc
        if base.hostname in ("ftsk.hu", "www.ftsk.hu"):
            own_host = target.hostname in ("ftsk.hu", "www.ftsk.hu")
        if not own_host:
            return
        path = posixpath.normpath(unquote(target.path))
        if path == prefix.rstrip("/"):
            relative = ""
        elif path.startswith(prefix):
            relative = path[len(prefix):]
        elif prefix == "/":
            relative = path.lstrip("/")
        else:
            errors.append(f"{source}: escapes deployment prefix: {reference}")
            return
        local = root / relative
        if local.is_dir():
            local = local / "index.html"
        if not local.is_file():
            errors.append(f"{source}: missing target: {reference}")
        elif target.fragment and local.resolve() in pages:
            fragment = unquote(target.fragment)
            if fragment not in pages[local.resolve()].identifiers:
                errors.append(f"{source}: missing fragment: {reference}")

    for path, page in pages.items():
        relative = path.relative_to(root).as_posix()
        document_path = relative[:-len("index.html")] if relative.endswith("index.html") else relative
        document_url = urljoin(base_url, document_path)
        for reference in page.references:
            check(reference, document_url, relative)
    for path in root.rglob("*.css"):
        relative = path.relative_to(root).as_posix()
        for reference in re.findall(r"url\(\s*['\"]?([^)'\"\s]+)['\"]?\s*\)", path.read_text(encoding="utf-8")):
            check(reference, urljoin(base_url, relative), relative)
    index = root / "searchindex.json"
    if index.is_file():
        for entry in json.loads(index.read_text(encoding="utf-8")):
            check(entry["url"], base_url, "searchindex.json")
    return len(pages), sorted(set(errors))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default="public")
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()
    count, errors = verify_site(args.root, args.base_url)
    if errors:
        for error in errors:
            print(error)
        raise SystemExit(f"Internal link validation failed: {len(errors)} issue(s).")
    print(f"PASS: {count} generated HTML pages, CSS assets and search-index URLs resolve under {args.base_url}")


if __name__ == "__main__":
    main()