"""Compare site builds, ignoring only renderer markers and HTML indentation."""

import argparse
from html.parser import HTMLParser
from pathlib import Path


class RenderedHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.tokens = []
        self.verbatim = []

    def handle_starttag(self, tag, attrs):
        self.tokens.append(("start", tag, attrs))
        if tag in ("pre", "textarea", "script", "style"):
            self.verbatim.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.tokens.append(("empty", tag, attrs))

    def handle_endtag(self, tag):
        self.tokens.append(("end", tag))
        if self.verbatim and self.verbatim[-1] == tag:
            self.verbatim.pop()

    def handle_data(self, data):
        if data.strip() or self.verbatim:
            self.tokens.append(("text", data))
        elif self.tokens and self.tokens[-1][0] == "whitespace":
            self.tokens[-1] = ("whitespace", self.tokens[-1][1] + data)
        else:
            self.tokens.append(("whitespace", data))

    def handle_comment(self, data):
        if not data.startswith("bookshop-live "):
            self.tokens.append(("comment", data))

    def handle_decl(self, decl):
        self.tokens.append(("declaration", decl))

    def handle_entityref(self, name):
        self.tokens.append(("entity", name))

    def handle_charref(self, name):
        self.tokens.append(("character", name))


def html_tokens(raw: bytes) -> list:
    parser = RenderedHTML()
    # HTML input preprocessing normalizes Windows/Mac line endings in browsers.
    parser.feed(raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n"))
    parser.close()
    block_tags = {
        "html", "head", "body", "main", "section", "article", "aside", "header",
        "footer", "nav", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li", "dl", "dt", "dd", "figure", "figcaption", "form",
        "table", "thead", "tbody", "tfoot", "tr", "td", "th", "script", "style",
        "meta", "link", "title",
    }
    tokens = []
    for index, token in enumerate(parser.tokens):
        if token[0] == "whitespace":
            previous = parser.tokens[index - 1] if index else None
            following = parser.tokens[index + 1] if index + 1 < len(parser.tokens) else None
            if any(neighbor and neighbor[0] in ("start", "end", "empty")
                   and neighbor[1] in block_tags for neighbor in (previous, following)):
                continue
            token = ("text", token[1])
        tokens.append(token)
    return tokens


def compare(before: Path, after: Path) -> tuple[list[str], int]:
    if not before.is_dir() or not after.is_dir():
        raise ValueError("Both build paths must be existing directories.")
    old = {path.relative_to(before): path for path in before.rglob("*") if path.is_file()}
    new = {path.relative_to(after): path for path in after.rglob("*") if path.is_file()}
    problems = [f"Missing output: {path.as_posix()}" for path in sorted(old.keys() - new.keys())]
    problems += [f"Unexpected output: {path.as_posix()}" for path in sorted(new.keys() - old.keys())]
    for path in sorted(old.keys() & new.keys()):
        original, updated = old[path].read_bytes(), new[path].read_bytes()
        if original == updated:
            continue
        if path.suffix == ".html" and html_tokens(original) == html_tokens(updated):
            continue
        problems.append(f"Changed {'HTML content/structure' if path.suffix == '.html' else 'asset/output bytes'}: {path.as_posix()}")
    return problems, len(old)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    args = parser.parse_args()
    try:
        problems, count = compare(args.before, args.after)
    except (ValueError, OSError, UnicodeError) as exc:
        parser.error(str(exc))
    for problem in problems:
        print(problem)
    if problems:
        print(f"FAILED: {len(problems)} build differences.")
        return 1
    print(f"PASS: {count} outputs match; HTML matches after marker/indentation and browser line-ending normalization; all other files are byte-identical.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
