# Writing long-form articles (trip reports, expeditions, courses)

How to write and maintain a long, photo-illustrated article under
`content/turak/` or `content/tanfolyamok/` - the pattern used by multi-day
expedition write-ups (e.g. day-by-day trip reports) as opposed to the older,
short "see the attached PDF" style entries that also live in those folders.

This is the counterpart used by
[`.github/instructions/content-review.instructions.md`](../.github/instructions/content-review.instructions.md),
which asks Copilot code review to check new/changed articles against this
structure.

## 1. Front matter

Every article needs the same front matter block as the rest of `turak`/
`tanfolyamok`:

```yaml
---
date: 2026-08-14T00:00:00Z # the event's start date, used for sorting
title: Kanin expedíció (2026) # "Name (year)", matches existing entries
categories:
  - Expedíció # one of: Túra, Kutatás, Expedíció, Kanyoning, Szemétszedés (see data/blog-tags.yaml)
author: "" # who wrote it - leave blank if unknown, don't guess
participants: # optional - see "Participants" section below
  - Name One
  - Name Two (Nickname)
thumbImg:
  image_path: /images/turak/<slug>/01-....webp # used in list/related-post cards
featuredImg:
  image_path: /images/turak/<slug>/01-....webp # used as the big banner on the article page
seo:
  page_description:
  canonical_url:
  featured_image:
  author_twitter_handle:
  open_graph_type: article
  no_index: false
draft: false
---
```

`<slug>` is the article's filename without `.md` (e.g. `2026-kanin-expedicio`).
Leave `author` blank rather than guessing - misattributing a report is worse
than an empty field.

## 2. Body structure

Long trip reports read much better broken into day-by-day sections instead of
one continuous wall of text:

```markdown
<opening/intro paragraph, no heading>

## 1. nap – augusztus 14. (péntek)

<that day's paragraph(s)>

## 2. nap – augusztus 15. (szombat)

...

## Zárszó

<closing thanks/wrap-up paragraph>
```

- One `##` heading per day, even if that day has several paragraphs - don't
  repeat the heading for every paragraph of the same day.
- Number days sequentially from 1, and give each a real calendar date +
  weekday, derived from whatever date the article itself states (don't invent
  a date the text doesn't support).
- Always close with `## Zárszó` (wrap-up).
- When editing an *existing* published report, only add structure (headings,
  paragraph breaks, images) - don't rewrite the author's actual sentences.

## 3. Participants

List who took part in the front matter, not the body - a plain list of names,
one per entry, written however reads naturally (include a "(Nickname)" suffix
if that's how the person is normally referred to):

```yaml
participants:
  - Kámvás Linda
  - Kun Imre (Bástya)
  - Ács Réka
```

The article page automatically renders these as clickable member cards below
the text (`layouts/partials/participant-cards.html`), looking each name up
against the canonical roster in `data/members.yaml`. A match pulls in that
person's real photo/role/bio; no match just renders a plain initials tile -
that's expected, not every participant is a registered club member. Don't
hand-write a "Résztvevők" heading/list in the body - the template adds the
heading and card grid automatically whenever `participants:` is set.

Run `python scripts/verify_members.py` locally (needs `pip install PyYAML`) to
check `data/members.yaml` and every article's `participants:` list before
pushing - it catches things like duplicate names/nicknames, a name/nickname
that still has "(...)" baked in instead of using the proper field, unknown
member fields (typos), missing `image`/`modal_image` files, and empty/duplicate
`participants:` entries. The same check runs in CI on every PR.

## 4. Images

### Converting photos

Use `scripts/site_image_converter/` (see its own `readme.md`) to produce
resized, web-friendly `.webp` files - never commit original camera/phone
photos directly, they're far too large. Non-interactive example:

```powershell
python scripts\site_image_converter\site_image_converter.py `
  --input "C:\path\to\original\photos" `
  --output "static\images\turak\2026-kanin-expedicio" `
  --max-width 1600 --max-height 1600 --quality 82
```

### Folder & naming convention

Each article gets its **own** folder, so photos never mix between articles and
old ones are easy to find or delete later:

```
static/images/turak/<article-slug>/
  01-short-descriptive-slug.webp
  02-another-photo.webp
  03-....webp
```

Rename the converter's output (which keeps the original camera filename) to a
short, descriptive, numbered slug - `01-csapat-a-ducatonal.webp`, not
`810814349_1602452671581952_...webp`.

### Embedding photos in the article body

Just use standard Markdown image syntax, placed near the paragraph it
illustrates, with an optional quoted **title** that becomes the visible
caption:

```markdown
![Rövid alt szöveg a fotóról](/images/turak/2026-kanin-expedicio/01-csapat-a-ducatonal.webp "Ez a felirat jelenik meg a kép alatt")
```

- The bracketed `alt` text is required (accessibility + shown if the image
  fails to load) - describe what's in the photo.
- The quoted `"title"` after the path is optional and becomes the caption
  under the photo. Omit it for an uncaptioned image.
- Don't hand-write `<img>`/`<figure>` HTML - a Goldmark render hook
  (`layouts/_default/_markup/render-image.html`) automatically wraps every
  Markdown image into a styled, captioned figure that opens full-size in the
  site's lightbox (all images in one article are grouped into one gallery).
- Pick one photo (usually the most representative one) as both `thumbImg` and
  `featuredImg` in the front matter - it doesn't need to be repeated in the
  body too, though it can be.

## 5. Adding to a long-published article later

Because images live in their own per-article folder and are embedded with
plain Markdown, extending an old report is just:

1. Convert and drop new photos into its existing
   `static/images/turak/<slug>/` folder (continue the numbering).
2. Add `![...](...)` lines at the right point in the body, or a new day
   section following the same `## N. nap – ...` heading pattern.

No front matter or template changes are needed for either case.
