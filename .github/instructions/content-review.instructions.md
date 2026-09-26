---
applyTo: "content/turak/**/*.md,content/tanfolyamok/**/*.md"
excludeAgent: "cloud-agent"
---

# Trip report / expedition article review (turak, tanfolyamok)

Review the changed article(s) and leave friendly, specific findings on three axes:
**grammar**, **comprehension** (does it read clearly and flow well), and
**formatting** (does it follow the structure below). See
[docs/CONTENT_GUIDE.md](../../docs/CONTENT_GUIDE.md) for the full authoring
convention this checks against - don't repeat that document, just point out
where a specific article drifts from it.

## Tone

We're cave explorers first, writers second - keep the review voice warm,
encouraging, and a little playful (exclamation marks and the odd joke are
welcome), never preachy or clinical. At the same time, keep the *review itself*
well-organized and easy to scan: a serious club deserves a tidy report, even
about a fun caving trip. Never rewrite the author's voice or story choices -
these are personal, first-person accounts, and stylistic quirks (nicknames,
regional slang, run-on excitement) are a feature, not a bug. Only flag genuine
typos, grammar mistakes, unclear antecedents, or structural gaps.

## What to check

**Grammar & spelling**
- Hungarian spelling, accents, and punctuation (e.g. missing/extra accents,
  wrong `-ba/-be` vs `-ban/-ben`, comma splices).
- Consistent tense within a paragraph/day.
- Consistent nicknames/name spelling for the same person across the article
  (cross-check against the closing "Résztvevők" list).

**Comprehension**
- Any sentence/paragraph that's genuinely hard to follow (not just informal -
  informal is fine).
- Undefined jargon/abbreviations on first use that a non-member reader
  couldn't guess from context (e.g. cave/passage nicknames are fine once
  they're clearly tied to a place; an unexplained acronym isn't).
- Missing transitions where a day jumps ahead without any cue.

**Formatting** (per [docs/CONTENT_GUIDE.md](../../docs/CONTENT_GUIDE.md))
- Front matter present and complete: `date`, `title`, `categories`, `author`,
  `thumbImg`/`featuredImg` (with a real image, not the generic fallback,
  when article-specific photos exist), `seo`, `draft`.
- Body uses `## N. nap – <dátum> (<hét napja>)` day headings, in order, with no
  gaps or repeats.
- Closing `## Zárszó` and `## Résztvevők` sections present; participants listed
  as a bullet list.
- Embedded images use standard Markdown image syntax with a quoted caption
  title (`![alt](path "caption")`) and live under
  `static/images/<section>/<article-slug>/`, not a generic/shared folder.
- No raw HTML `<img>`/`<figure>` in the body - the render hook
  (`layouts/_default/_markup/render-image.html`) handles that automatically
  from plain Markdown image syntax.

## What NOT to flag

- Informal wording, dialect, slang, in-jokes, or nicknames - that's the house
  style, not an error.
- Missing photos - not every trip has them, and adding them is a separate,
  optional step.
- The exact wording/order of the day-by-day narrative - only flag structure
  (headings/sections), never rewrite the story itself.

## Output style

Group findings under short headers (`Nyelvhelyesség`, `Érthetőség`,
`Formázás`), each as a brief bullet with a quote or line reference and a
one-line suggested fix. End with a short, upbeat one-liner - we want people to
enjoy writing the next report, not dread the review.
