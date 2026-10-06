# Technical environment

How to set up a local dev environment for this Hugo site on Windows, and
what has to be configured in GitHub for the CI/CD pipeline in `.github/workflows/`.

## Stack

- **Hugo** (extended) with native reusable sections under
  [`layouts/partials/sections/`](../layouts/partials/sections/).
  There are no external Hugo modules, Bookshop runtime or Go requirement.
- **Node.js / npm** - used for dependency-free JavaScript regression tests and
  optional `npm start` / `npm run dev` aliases, not for a plain Hugo build/server.
  No npm package installation is required.
- **SCSS** compiled via Hugo's built-in libsass transpiler (`css.Sass`, see
  [assets/scss/theme.scss](../assets/scss/theme.scss)) - no separate Dart Sass
  install required.

Inner pages use the `ftsk-inner-page` body class for a shared blue-black (`#030810`)-to-page-color
background, passing through `#071019` at 45% and fading over 85vh (clamped to
560-900px). Top-level sections remain
transparent so the fade continues behind the cave motifs instead of restarting
between sections. Cards and the footer retain their own surfaces. The home page
does not receive this class; its slideshow and existing backgrounds are unchanged.
The styling lives in [the theme component](../assets/scss/components/_theme.scss).
The cave motifs retain their original SVG colours on all pages.

## Single sources of truth for versions

These files/fields are read by both the GitHub Actions build (`.github/actions/build-site`)
and the local scripts (`scripts/`). Don't hardcode a version anywhere else - change it here:

| What | Where | Read by |
|---|---|---|
| Hugo version | [`.hugo-version`](../.hugo-version) | `build-site` action's "Resolve Hugo version" step; `scripts/setup-dev-env.ps1`; `scripts/dev-server.ps1` |
| Node version | `engines.node` in [`package.json`](../package.json) | `scripts/setup-dev-env.ps1` (minimum check; new installs use compatible LTS) |

To bump the Hugo version everywhere (CI + local), edit `.hugo-version` only.

## Local setup (Windows)

For Windows 10/11 x64, **double-click [`setup-dev-env.bat`](../setup-dev-env.bat)**
in the repository's main folder. It starts a fresh Windows PowerShell without
profiles, with a process-only execution-policy override, from the correct folder.
Both success and failure leave the window open for reading. No permanent policy
change or administrator launch is made; enforced organisation policies still apply.
After successful setup, double-click [`site_editor.bat`](../site_editor.bat) in the repository root.

```powershell
./scripts/setup-dev-env.ps1
./scripts/setup-dev-env.ps1 -CheckOnly     # no downloads, installation or file writes
./scripts/setup-dev-env.ps1 -NonInteractive # accepts package/source agreements without the initial prompt
```

This is the full **Windows x64 / PowerShell 5.1+** installer. It prompts once
before changing dependencies, checks installed components, continues after
individual failures, and prints a component-by-component summary. Successful
components are reused when rerunning. `-CheckOnly` reports missing requirements
with a nonzero exit status but does not install them.

| Component | Installation/check method |
| --- | --- |
| Git | Existing working CLI, otherwise user-scoped WinGet `Git.Git`. |
| VS Code | Existing CLI, otherwise user-scoped WinGet `Microsoft.VisualStudioCode`. |
| Editor extensions | Markdown All in One, markdownlint, PowerShell, Python, Pylance, Hugo syntax; installed IDs are skipped. |
| Node/npm | Existing version meeting `package.json`, otherwise official portable LTS archive under `.tools/node/`. |
| Hugo | Exact pinned **extended** version; reused if correct, otherwise under `.tools/hugo/<version>/`. |
| Python | Working 64-bit Python >= 3.10 with Tk and venv; checks `py` launcher runtimes, PATH and usual install folders, otherwise user-scoped Python 3.12 from WinGet. |
| Python tool libraries | Project `.venv`: Pillow, pillow-heif, PyYAML and Paramiko, from [`scripts/requirements-dev.txt`](../scripts/requirements-dev.txt). HEIF/HEIC originals decode to 8-bit images for WebP export. Member portrait crops are selected manually with Tk. |
| Smoke checks | Builds to a temporary folder, verifies members/internal links, and runs hero-framing and social preview/card-selection regressions. |

Portable archives are verified using their publisher's SHA-256 manifests.
Text manifests are decoded whether Windows PowerShell returns text or raw UTF-8
bytes (including GitHub's `application/octet-stream` responses). Hugo uses the
pinned release's official download URLs without depending on GitHub API quotas.
The installer never invokes elevation or changes machine PATH. WinGet must
be available for missing desktop apps/Python; install or update **App Installer**
from Microsoft Store if it is missing. Corporate policies, network access,
package availability and extension access can still prevent installation;
failures are reported instead of claiming success. ARM64 is explicitly
rejected rather than installing mismatched portable/native tool binaries.

Tool directories are added to the current **user** PATH by default. Opt out
with `-PersistPath:$false`. Restart VS Code and terminals afterward. No
credentials or production settings are requested. The installer does not
remove or modify unrelated system Python environments.

Use `-PythonPath "C:\path\to\python.exe"` to select a particular interpreter.
An invalid explicit choice fails rather than selecting a different interpreter.
Use `-SkipEditor` to omit VS Code/extensions, or `-SkipVerification` to skip smoke
checks. An incomplete or linked `.venv` is rejected rather than deleted;
rename it explicitly before rerunning if it needs replacement. Binary Python
packages are required, avoiding surprise compiler installs.

If execution policy blocks the script, run it with a process-only override:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-dev-env.ps1
```

The summary is also saved to `.tools/setup-report.json` after a real setup,
with console output in `.tools/setup.log` (replaced on each real setup attempt).
These files are local/gitignored. Share them with the maintainer if a component
fails. Rerun the double-click installer after fixing the reported issue.
`py --version` alone does not mean the project environment exists: Workbench
requires setup's `.venv` and its packages. Its launcher keeps startup errors
visible and points to the installer instead of silently closing.
Installer regressions run without installing software:
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test_setup_dev_env.ps1`.
Add `-Online` to also download, checksum-verify and run the pinned Hugo in a
disposable temporary folder; it is cleaned afterward and never added to PATH.
Image-converter GUI launchers, their dependency installers, and the hero-picker
launcher prefer `.venv/Scripts/python.exe`. For command-line Python tools:

```powershell
./.venv/Scripts/Activate.ps1
python scripts/verify_members.py
```

In VS Code use **Python: Select Interpreter** and choose `.venv/Scripts/python.exe`
if the editor has not selected it automatically. Tool binaries, virtual
environments and reports are gitignored.

## Footer note

Set `additional_text` in [`data/footer.yaml`](../data/footer.yaml) to display
an optional, subdued note directly below the footer's last-update date.
Markdown links are supported.
Leave it empty or remove the field to hide the note.

## Local build & hosting

```powershell
./scripts/dev-server.ps1              # hugo server, drafts + future content, http://localhost:1313/
./scripts/dev-server.ps1 -BuildOnly   # one-shot build to ./public/ (minified)
./scripts/dev-server.ps1 -NoDrafts -NoFuture   # production-like content set
./scripts/dev-server.ps1 -Port 8080 -BaseUrl "http://localhost:8080/"
```

`npm start` and `npm run dev` launch the same Hugo wrapper; no component-browser
server or npm dependencies are needed.

### Native content sections

The default list/single layouts call
[`content-blocks.html`](../layouts/partials/content-blocks.html), which explicitly
maps supported section names to native partials. Section order, data gating,
Markdown rendering and all CSS/JavaScript hooks stay in the existing templates.
Unknown names or malformed sections fail the build rather than disappearing.

Existing frontmatter retains `content_blocks` and `_bookshop_name` for compatibility:
the latter is just a section-type key, not a Bookshop dependency. Adding a section
requires a native partial and an explicit dispatcher entry. The Workbench still
edits articles and contact assignments; arbitrary component-page content is edited
in Full source. The former Bookshop browser and CMS blueprints/bindings are removed.

For rendering migrations, capture builds with the same Hugo version, base URL,
content flags and build-date environment, then compare every output:

```powershell
.\.venv\Scripts\python.exe scripts/compare_site_builds.py before after
.\.venv\Scripts\python.exe -m unittest discover -s scripts -p test_content_blocks.py
```

The comparator ignores only Bookshop HTML marker comments and non-verbatim
HTML indentation, with browser-standard line-ending normalization; attributes,
content and all non-HTML bytes must match.
Social-card fallback selection intentionally uses a random eligible hero image;
use a controlled social-card source in disposable comparison fixtures when exact
metadata reproducibility is needed. Do not change the production selection policy.

Every invocation of `scripts/dev-server.ps1` removes `public/` and
`resources/_gen/` before rebuilding. `npm start` and `npm run dev` use this
same wrapper. The server also disables fast rendering and requests clean
destination output, so old pages and fingerprinted assets do not survive
startup. Only generated directories are purged; content/static source files
are never deleted. Stop another Hugo server first if it is using those
directories. Calling `hugo server` directly bypasses the startup purge.

## Site Workbench

One local browser application brings together the existing tools:

```powershell
.\site_editor.bat
# Without opening a browser automatically:
.\.venv\Scripts\python.exe scripts\site_workbench.py --no-browser --port 8879
```

Open <http://127.0.0.1:8879/>. The launcher uses the project `.venv`; the
environment installer already supplies Pillow and PyYAML. No additional
framework, npm build or Python dependencies are required.

- **Git & workspace:** the landing page displays working files, local commits,
  last-known origin refs and the checked-out branch, with operation animations
  and reduced-motion support.
  Controls live in their domains: reviewed commits beside working files,
  sending and branch/rebase controls beside local history, and checking/receiving
  beside GitHub. Separate directional lanes distinguish checkpoint, push, fetch
  (snapshot only), and pull (history/files). Only the active transfer is animated.
  Visible checkout and new-branch launchers on the local-history box open a
  guided branch modal with the current checkout, live draft/file blockers,
  both controls and common questions. It explains the creation base, main
  protection, cached server choices and the absence of automatic stash/push.
  Execution still requires the existing separate operation confirmation.
  The checkpoint graph uses real parent links, merge-base(s), separate main
  and working-branch reachability counts, and exact local/cached-server tip
  labels. It shows at most 18 recent checkpoints per lane plus the shared
  branch point; dashed stubs explicitly mark missing earlier history. Local
  main, tracked server work and paused rebase checkout remain distinct.
  The shared point describes current ancestry, not a historical creation date.
  Graph data is cached by tip identities and shallow-history boundaries.
  Running rebase motion is labelled illustrative and retains the last confirmed
  graph; completion redraws real ancestry, while conflicts show the paused
  position. Rebase never moves the cached published-branch label. Reduced
  motion disables the replay marker and completion pulse; an accessible text
  list and internally scrollable graph preserve mobile and keyboard access.
  A persistent header hint and next-step banner flag browser drafts, saved but
  uncommitted files, unpublished checkpoints, conflicts and missing updates.
  GitHub snapshots older than 15 minutes prompt an explicit fetch; no network
  operation runs automatically. Missing `origin/main`/`origin/master` checkpoints
  are counted separately from upstream divergence to guide main-following rebases.
  Successful operations show the next required action, including send after
  commit and exact leased publication after an approved published rebase.
  Available recommended controls and their matching checkpoint/send/check/
  receive lanes use a subtle light-blue pulse. Local branch/rebase guidance
  highlights controls without implying server transfer. Busy, blocked and
  already-synced states do not pulse recommendations; reduced-motion keeps a
  static blue highlight instead. Active transfer animations remain separate.
  Suggested arrows glow directly along their shaft and arrowhead, without a
  surrounding lane box. Disabled Git buttons have focusable help wrappers:
  hover, keyboard focus or tap shows the blocking reason and next enabling
  step. Descriptions update with Git/draft/review state and remain accessible
  to screen readers; controls themselves stay natively disabled.
  Checkout, branch creation, explicit fetch, fetch+rebase updates, rebase,
  reviewed selected-file commits and ordinary push run in a serialized
  background worker. Guided operations expose no merge, unconditional
  force-push, automatic stash, reset/discard or automatic server contact.
  Every GUI fetch (explicit Fetch, Receive and published-rebase preflight)
  runs `git fetch --all --prune`, refreshing all configured
  remotes and removing deleted server tracking refs without deleting local
  branches. The branch picker includes all cached remote branches. Receive
  rebases specifically onto this branch's origin upstream using
  `rebase --no-autostash`, preserving teammates' work and replaying only
  unpublished commits;
  it requires checkpointed files and makes a working-branch recovery backup.
  Advanced recovery explicitly confirms a native Windows PowerShell window
  rooted at this checkout. No Git command runs automatically. Manual commands
  bypass GUI protections, so drafts must be saved/exported first and experienced
  maintainers must review destructive commands themselves. Workbench editing,
  builds and GUI Git operations lock while the terminal process is open.
  Close child editors and type `exit` to release it; the UI reloads actual Git
  state rather than assuming the manual commands succeeded. Do not restart
  Workbench while this window is open; the process lock is session-local.
  Binary/deletion conflicts and unfinished external merges can use this path;
  UTF-8 rebase conflicts still support review, resolution, continue and abort.
  Manual recovery does not certify or rewrite the GUI backup/lease ledger;
  keep backups and complete any manually rewritten publication in the terminal
  if the guarded GUI lease remains unavailable. Git credentials and
  author identity are supplied by the existing Git installation; Git/GCM
  interactive prompts are disabled, network commands time out, and errors
  remain visible rather than reporting a successful sync.
  The header marks protected `main`/`master` and detached/unavailable states.
  All editing HTTP mutations are gated under the shared Workbench lock, not
  merely hidden in the UI. Git operations exclude writes and build jobs; branch
  headers and state/file fingerprints reject stale operations. A commit requires
  an exact current selected-file review. Unselected staged files stay out of it.
  The primary review uses per-file Before/After cards, labelled added/removed
  text and bounded embedded image previews; raw Git output is optional and
  collapsed. Truncated or unsupported previews explicitly require full-file
  inspection. A nonblank editor-written message is required by both UI and API.
  Published working branches may explicitly opt into rebase onto `origin/main`
  or `origin/master`, only when tracking their own same-name origin branch and
  containing its recorded server tip. A new fetch must match both reviewed tips
  before backup/rebase begins. Every guided working-branch rebase saves a verified
  history bundle, retained `refs/workbench-backups/<id>` reference, commit patch,
  binary tree-difference patch and manual recovery instructions under the
  ignored `.workbench-backups/` directory. Local `info/exclude` protects backups
  even on older checkouts without the ignore rule. Backup failure prevents rebase.
  Persistent per-branch records retain the original remote object ID, server URL,
  backup ID, phase and resulting history. Separate typed-branch confirmation
  authorizes only `--force-with-lease=refs/heads/<branch>:<original-remote-oid>`.
  The source is the reviewed local commit, not a mutable `HEAD`; fetch never
  advances the lease. Server races/deletion reject the push, and changing origin
  or externally replacing the rebased history disables eligibility.
  An outstanding leased publication blocks another pull/rebase. Continue/abort
  preserve the backup and update its durable state, including across restarts.
  Protected branches are never eligible for leased publication; ordinary push
  remains separate. Backups remain local until explicitly cleaned by a maintainer.
  Rebase
  text-conflict review verifies file content revisions; continue/abort are
  available, while binary/deletion conflicts require maintainer help.
  Protected branches can receive clean fast-forward-only server updates through
  the pull action; local commits, divergence and content edits remain blocked.
  Staged renames require a maintainer's full Git review outside the limited
  selected-file commit UI. Open editor drafts can be explicitly downloaded and
  discarded from the dashboard without modifying saved files; active editor,
  image, Git and draft-download operations block draft recovery.
  The last successful fetch/contact timestamp is session-local; refs on disk
  remain explicitly last-known until the user fetches again.
  Tests use disposable checkouts and local bare remotes only; they never fetch,
  commit, push or switch the actual site checkout.
- **Pages & posts:** search/filter the content library; create drafts from the
  maintained trip, archived-PDF and course templates; edit Markdown, frontmatter,
  SEO, participant/FAQ cards and course milestones/contacts/flyers. Other
  Markdown pages are editable in source mode, including component-driven pages.
  Placement supports nested folders, leaf bundles, slug/URL overrides, aliases,
  publishing and expiry dates. Unknown frontmatter fields remain available in
  source mode; unchanged source, comments and newline conventions are preserved.
  The media tab connects conversion, existing-image selection, image metadata,
  image/media/gallery/Markdown insertion, and PDF upload/insertion.
  Shared accessible typeahead controls show saved choices while typing, with
  arrow-key/Enter selection and Escape dismissal. Person suggestions include
  portraits/initials, stable IDs, aliases and membership context; already
  assigned participants are excluded. The same helper covers groups,
  categories, portrait pairs, merge targets, templates and image folders.
  Typing search text never assigns a person or marks a person draft as edited.
- **Site photos:** upload/drop a batch, choose maximum dimensions and quality,
  and export WebP into any named/nested folder under `static/images/`. General
  photos default to `gallery`, not `hero`; conversion does not automatically
  add slideshow entries. No upscaling or cropping. The content studio also
  supports an optional filename stem for a single conversion.
- **People & portraits:** search all identities, add/edit permanent IDs, names,
  aliases, biographies and shared image URLs, independently assigning current
  membership and its role. Guests, former members and students stay out of
  Tagjaink unless given membership. Workbench-only categories allow multiple
  assignments per person: automatic course-participant groups include every saved
  `participant_ids` assignment regardless of role, including role-less entries,
  instructors and helpers; page-specific roles remain unchanged. Custom categories are managed
  in the registry panel and stored as `{id, label, people: [person_id]}` entries
  in the optional top-level `categories` list. They are independent of the
  existing public membership `groups`. Empty courses are discoverable too;
  draft courses are marked, and unspecified/instructor roles are not guessed.
  Reload the registry after course-page changes to update these derived groups.
  The shared role vocabulary lives in `data/participant_roles.yaml` (the
  filename is retained for compatibility). Manual duties are seeded from the six
  existing membership duties: elnök, kutatásvezető, elnökségi tag, pénztáros,
  túravezető and raktáros. Membership and event assignments use the same
  definitions but remain independent; contact text and custom categories stay separate.
  Each definition has a permanent `id`, editable `label`, historical `aliases`
  and optional `automatic_when` conditions. The historical `exempt_from_guest`
  field is retained for compatibility but no longer controls classification:
  any explicit event role overrides the automatic fallback.
  The course-attendee definition uses
  `{current_member: false, course_participant: true}`.
  The guest definition is manual-only: nonmembership does not imply guest
  status on someone else's trip. Unmatched nonmembers get no public role label.
  Conditions are boolean facts; omitted facts mean any. Empty, invalid and
  overlapping rules are rejected. Names and conditions are editable in the
  existing global role manager, with revision checks and draft recovery.
  Course participation is derived from all saved course pages, including
  drafts/future pages and resolved legacy names; mixed nonempty canonical and
  legacy participant lists fail validation. Authorship, contact references and section indexes do not count.
  Hugo scans the saved course YAML, not only published pages, so its fallback
  matches Workbench. Disable and save a rule before deleting its definition.
  Assignments use
  `groups[].members: [{person: person-id, roles: [elnok, kutatasvezeto]}]` and
  `participant_ids: [{person: person-id, roles: [turavezeto]}]`;
  role-less scalar page IDs remain supported. Membership role lists preserve
  order and render with the existing comma-and-space separator; migrating
  the original comma-separated duties does not change the visible site.
  The registry's role manager, person editor and content editor's searchable
  multi-select use this same catalogue; no code
  edits are needed to add, rename or remove a role. Labels are resolved by Hugo
  and Workbench; unknown IDs, duplicate IDs and mixed `role`/`roles` fail validation.
  Legacy free-text `role` values remain readable without rewriting saved pages;
  aliases resolve recognized labels, including complete comma-separated legacy
  lists; partially unknown strings are never silently reduced. Unresolved
  labels are flagged explicitly. Role deletion requires no saved membership
  or page assignments (including legacy aliases),
  explicit confirmation and a complete page scan. Definition writes are atomic
  and revision-checked against the role file, people registry and saved page contents. Person
  merge/rename preserves role lists and rejects conflicting assignments.
  Custom category labels can be edited, IDs stay stable, deletion requires no
  assignments and explicit confirmation. Person rename/merge/delete maintains
  these links. The registry uses full-width cards and the person editor opens
  in a scrollable native dialog, including portrait upload/crop/export. Closing
  or Escape confirms unsaved person drafts; page navigation retains the draft
  behind a Resume person editor button. Standalone portrait export opens the
  same dialog without a person. Profile fields are prominent; contact/portrait/advanced controls
  and participation history are expandable.
  People may have an ordered `social_links` list of up to 20 unique HTTP(S)
  URLs alongside shared email/phone. The person editor provides add/remove
  rows and includes links in draft exports. Explicit contact cards always render
  these links as accessible platform icons (generic link icon for other hosts).
  A person's boolean `show_profile_contacts` (default false) opts into showing
  shared email, phone and social links in opened profiles, including author,
  roster, participant and contact profiles. Ordinary tiles still omit visible
  contact links. Older save payloads preserve the flag; identity merges retain
  the target's consent without importing the source's opt-in.
  Association richtext blocks with `contacts` and the privacy page's top-level
  `contacts` use the same registry-backed cards. Their assignments participate
  in reference checks and reviewed ID changes/merges; Workbench's Contacts tab
  edits them without duplicating contact details.
  Workbench reuses the site's local hanging/standing cave SVGs at the main
  area's top and bottom; decorations are noninteractive and sit behind controls.
  Links open with `noopener noreferrer`; credentials, whitespace, control
  characters and unsafe schemes are rejected. Older save payloads that omit
  `social_links` preserve the list; an explicit empty list clears it. Reviewed
  identity merges transfer missing lists and report conflicting target lists,
  following existing target-profile precedence.
  Remove membership without deleting identity;
  delete only unused non-members. Choose an
  existing portrait pair, or position a square crop on an uploaded EXIF-corrected
  original and explicitly convert it. Conversion fills the open person draft;
  **Save person** atomically writes identities and membership to `data/people.yaml`.
  Without an open draft, conversion remains a standalone export. Exported files
  persist even when a draft is discarded. Renaming updates ID-based displays
  everywhere; old names remain aliases. Removing membership never removes
  historical credits or images. Empty groups are retained
  so new members can be added to them. Stale roster revisions are rejected;
  copy your draft before Reload if someone edited the file externally.
  The roster checks show matching report references, missing/invalid images,
  legacy matching hints, identities needing manual clarification and portrait
  files not assigned to any person. Unassigned files may be used elsewhere;
  these checks do not perform automatic cleanup. In **Loose portraits**, select
  individual files or a batch and choose **Review & delete selected**. The review
  blocks files referenced by saved site sources (including relative basename
  references); deletion rechecks references, the roster revision and file hashes.
  An open member draft's assigned images are also blocked in the UI. Check other
  unsaved drafts manually before confirming permanent deletion. Only checked
  files under `static/images/members/` are removed; thumbnail/full files are
  separate selections, and untracked files cannot be recovered with Git.
  Saves preserve the YAML header and all
  unrelated data values, but normalize YAML formatting.
  Reviewed identity merges update saved page IDs, coalesce identical participant
  assignments, preserve the target's populated profile fields and fill empty
  ones from the source. Membership transfers only when the target has none.
  Stale revisions, unreadable references and conflicting participant roles block
  merging. All affected files are staged with backups and rolled back on a write
  failure. Keep Git backups: no filesystem provides a database-style crash-atomic
  transaction across multiple Markdown files, and unsaved browser drafts are
  outside the merge. Per-page `author_id`, `participant_ids` and contact `person`
  keys are foreign keys into the registry; each course has its own assignments.
- **Hero slideshow:** embeds the existing connected POI/motion editor. Explicit
  Save updates `data/hero_images.yaml`. In workbench mode, Remove only removes
  the slideshow entry; its file remains available for posts and social cards.
  The standalone hero launcher's existing deletion behavior is unchanged.
- **Social previews:** inspect localhost or public HTTP(S) pages and export a
  self-contained HTML snapshot with embedded preview images.
- **Build & checks:** temporary Hugo build, internal links/assets, member
  references, and existing hero/navigation/social/crop/workbench regressions.
  One job runs at a time; failures and command output remain visible.

The preview controls reuse a server already responding on port 1313. Otherwise
they start Hugo directly with drafts/future content, render-to-memory and no
startup purge. Stop and Ctrl+C only terminate processes owned by this workbench,
not a separately launched server. Builds use temporary destinations rather
than replacing `public/`; Hugo may still update its normal resource cache.

Original uploads are temporary (30 MiB / 25 MP each; 100 queued maximum).
Converted images, uploaded PDFs, saved pages and explicitly saved hero settings
persist in this checkout. A content preview builds an isolated unsaved snapshot
with real Hugo templates; it does not save the page or replace `public/`.
It runs on a separate read-only loopback origin so authored scripts cannot
access the editor API. Local styles, images and PDFs are served there; Google
Fonts remain permitted for faithful rendering. Only the latest three successful
snapshots are kept, and preview links expire when the workbench stops.
Preview builds include drafts/future/expired pages and force preview no-index
behavior; use the normal build to check production publication settings.
Component pages may render their `content_blocks` instead of the Markdown body.
The browser offers restoration of the latest unsaved draft and warns on exit.
Revision checks reject external-file conflicts without overwriting them.
Moves change only Markdown, not assets or incoming links; add aliases/update
links yourself. Deletion requires the exact content path and lets you select
linked local `/images/` and `/pdfs/` assets individually. Shared assets are
protected; relative bundle assets are not automatically deleted. Recovery is
manual through Git, which cannot restore untracked files or unsaved edits.

Existing output names are protected and receive numeric suffixes instead of
being overwritten. Relative output folders cannot traverse outside
`static/images/`, and linked/reparse-point paths are rejected. The server binds
only to loopback and requires same-origin, token-authenticated writes.
Do not expose it through a public tunnel: it edits local site files.

Deployment and environment installation are not embedded. Existing standalone tools continue
to work. Use Ctrl+C in the launch terminal to stop and clear staged originals.
No automatic commits or publishing occur.

Tests (disposable site fixtures; no real image/config edits):

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s scripts -p 'test_*workbench.py'
.\.venv\Scripts\python.exe -m unittest discover -s scripts -p 'test_people*.py'
node scripts/test_people_workbench.js
```

The environment installer's smoke verification includes these tests.

## Social sharing preview

Start Hugo separately, then open the local Python viewer:

```powershell
.\scripts\run_social_preview.bat "http://localhost:1313/tanfolyamok/tanfolyam-2027/"
# Or use the configured Python interpreter:
python scripts\social_preview.py "https://www.ftsk.hu/"
python scripts\social_preview.py --no-browser --port 8878
```

The viewer uses Python >= 3.10 and Pillow (already in
[`scripts/requirements-dev.txt`](../scripts/requirements-dev.txt)). It binds only
to `127.0.0.1`, opens the browser, and accepts a dev-server or public URL in its
form. It fetches the actual HTML, follows redirects, resolves relative image URLs
and `<base>` tags, decodes the images, and shows approximate Open Graph and
X/Twitter cards plus raw metadata and explicit warnings. It never executes the
target page's JavaScript. Response sizes, image pixel counts and network waits
are limited; inaccessible or unsupported images are reported, not hidden.

A preview can be bookmarked as
`http://127.0.0.1:8878/?url=http%3A%2F%2Flocalhost%3A1313%2F`.
That link only works on the machine running the viewer. To share an offline
preview, export HTML with embedded images:

```powershell
python scripts\social_preview.py "http://localhost:1313/" --output "$env:TEMP\ftsk-social-preview.html"
python -m unittest discover -s scripts -p test_social_preview.py
```

The tool does not upload pages/images to a third-party service. Only the supplied
page URL and its declared image URLs are requested. Treat the generated HTML as
a snapshot; rerender after editing or rebuilding.

Social platforms cannot fetch localhost URLs. A real share needs a public build
whose image URLs are also publicly accessible. Platform caching, robots rules,
authentication, crawler-specific responses, cropping and text truncation can
differ from this approximation. The viewer checks served metadata/assets, not
whether a particular platform has refreshed its cache.

Hugo generates 1200x630 branded images in
[`layouts/partials/social-card.html`](../layouts/partials/social-card.html):
trip and course posts default to `featuredImg.image_path`;
`seo.featured_image` overrides the source with another local raster image.
`seo.social_image` instead bypasses generation and publishes the selected local
JPG/PNG/WebP unchanged, with precedence over the background override.
`seo.social_title` and `seo.social_description` independently override both
Open Graph and Twitter text, leaving the article title and search description
unchanged. Blank values retain the original defaults. The Workbench's
SEO & sharing section edits these fields using the shared upload/borrow picker;
its draft social inspector reads the generated draft metadata.
Other pages randomly choose a homepage slideshow photo at build time.
Random selection only includes source images with width/height >= 1.5, allowing
integer-pixel rounding of 3:2 exports (for example, 1600x1067);
no suitable image produces a warning and uses `data/meta.yaml`'s default image.
Invalid explicit paths fail the build instead of silently selecting a random photo.
Open Graph and Twitter use the same selected or generated image, but a
new build may choose a different non-post photo. Images contain only the FTSK
crest and wordmark, not the page title; the title remains in Open Graph/Twitter
metadata for the card's text area. `og:url` uses the page's Hugo permalink,
and image URLs follow the build base URL, including local/staging/PR prefixes.
SEO canonical links continue to identify the production page even in local/PR builds.

The environment installer already installs Pillow from the existing requirements;
no extra package is needed. Its verification stage now also runs
`python -m unittest discover -s scripts -p "test_social*.py"` (offline fixtures,
including real Hugo builds). The social viewer's launcher prefers the project
`.venv`, just like the existing image tools.

## Responsive layout

The site uses a centered canvas capped at **1920px**, with dark outer gutters on
ultrawide displays. A subtle blue-gray ambient glow softens the canvas edges only
above 1920px, without overlays or changes to layout dimensions.
The cap is shared by the page and its fixed navigation in
[`assets/scss/_container.scss`](../assets/scss/_container.scss), controlled by
`$site-max-width` in [`assets/scss/_variables.scss`](../assets/scss/_variables.scss).
This keeps hero photos and cave motifs from stretching indefinitely. Existing
content containers retain their narrower Bootstrap-style limits (up to 1320px).
No layout rules change below 1920px; at 1920px the cap adds no outer margin.
Viewport-based overlays (member modals and image lightboxes) remain full-screen.

The homepage hero's cave silhouette layer is opaque, so animated photos cannot
bleed through the rock. A 48px bottom fade blends its floor into the page color;
the standing SVG stays bottom-aligned at every breakpoint.

At desktop widths (992px and above), the homepage hero follows the screen height
using `100svh` (`100vh` fallback), capped at 1080px and retaining its existing
560px/640px minimums on short screens. The cap prevents tall desktop displays and
wide portrait tablets from stretching the hero indefinitely. Content is vertically
centered within the padded section and can expand the hero beyond 1080px if needed
instead of being clipped. Below 992px (including narrower portrait tablets), the
existing content-sized layout is unchanged.

At 1200px and above, the homepage hero displays the navigation's FTSK logo
to the left of its heading and description, vertically centered on the combined
text group. The logo is
220–340px wide; the slideshow and its framing remain unchanged. Below 1200px,
the extra logo is hidden and the original tablet/mobile composition is retained.
Desktop heading type scales from 40–60px with balanced wrapping. The description
is left-aligned directly beneath the heading in the same text column, with a
`48ch` maximum width, 20px type (at the default root size), 1.6 line height,
and a 1.5rem gap above it.
Below 992px, it remains centered. The hero has no CTA button on any screen size;
navigation links remain available in the header.
The logo's transparent top/bottom padding is cropped in a square, unadorned
frame to avoid an oversized gap below the brand row. The heading has a compact
line length. The description uses `text-wrap: pretty` where supported, falling
back to ordinary wrapping in other browsers.

Related-card sections below archived courses and trip reports use only the hanging
cave motif, without standing rocks. Their card rows use Bootstrap's `gy-4` vertical
gutter so stacked cards remain separated on phones and tablets.

When changing the cap, compare layouts before/after at 375px and on both sides of
the 576, 768, 992, 1200, 1400 and 1700px breakpoints, plus 1920px. Check the
homepage, archives, course detail, members, privacy and 404 pages. At 2560px,
3440px and 3840px, verify that the page, hero, footer and fixed navigation are
1920px wide and share equal left/right gutters, including after scrolling.

## CI/CD pipeline (`.github/workflows/`)

### Temporary standalone history archive

`static/barlangos-tortenelem/` preserves the authorized legacy application
from `https://ftsk.hu/FTSK/index.html`, downloaded on 2026-10-06.
The Linkek page links to `/barlangos-tortenelem/`; `static/FTSK/index.html`
redirects the old address using a relative URL that also works under PR prefixes.
Hugo copies the archive unchanged into every build, so normal staging/production
deployment includes it. It has no Hugo content pages, shared styles, registry
assignments, editor support, build dependencies or external runtime assets.
External catalog/Wikipedia links remain external.

The original JSON is preserved: 601 events, 131 caves, 21 areas and 24 activity
types. All 11 tutorial pages and their images are included, along with the
original libraries and author/license notices. The old Google Analytics tracker
was removed and the document language corrected to Hungarian. The original
`info.png` was missing (HTTP 404); the bundled cave icon supplies that image.
Fourteen missing vendor timeline/network editor icon references were replaced
with `none` in the vendor CSS; those editing controls are not used by this app.
The app otherwise retains its legacy desktop-oriented design and old libraries;
this is preservation, not a modernization or security certification.
The tutorial's final Next button now closes it instead of requesting nonexistent
page 12; reopening starts at page 1. Its event-types link now opens the archived
`events.html` instead of the original broken site-root address.
`test_history_archive.py` checks asset completeness, local runtime,
data counts and links under production/PR deployment prefixes in CI.
The obsolete tutorial promise of future public editing was removed.
Normal wheel scrolling now scrolls the page; Ctrl+wheel uses bounded,
cursor-anchored timeline zoom without overlapping animations. Dragging and the
zoom/pan buttons remain available; reversed pan button directions were corrected.
`test_history_archive.js` exercises this behavior through `npm test` in CI.

To remove it later, delete this archive folder, its legacy redirect, its Linkek
entry and the dedicated archive regression tests (including the JavaScript test
entry in `package.json`). Do not delete the rest of
`static/FTSK/`: it holds unrelated legacy report PDFs.

| Workflow | Trigger | Purpose |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | PR opened/updated and merge queue | Ubuntu: validates people, builds with drafts/future, discovers all top-level Python tests, and runs `npm test`. Windows: installer/launcher regressions under PowerShell 5.1 and manual portrait cropping. Internal links/assets are a required build gate; the additional lychee check is advisory. |
| [`pr-preview.yml`](../.github/workflows/pr-preview.yml) | PR opened/updated | Builds and deploys the preview under `gh-pages/pr-preview/`, then verifies that Pages serves the current PR revision before succeeding. Require `PR Preview / preview` before merging. |
| [`pr-preview-cleanup.yml`](../.github/workflows/pr-preview-cleanup.yml) | PR close, push to `main`, preview/staging job completion, daily, manual | Deletes previews not associated with open PRs targeting `main`. The completion trigger also removes a preview recreated by a job that was still running when its PR closed. Use **Run workflow** to clean old folders after merging this workflow. |
| [`staging-deploy.yml`](../.github/workflows/staging-deploy.yml) | push to `main` | Publishes a shareable "always current `main`" preview to GitHub Pages. This is **not** production. |
| [`deploy-production.yml`](../.github/workflows/deploy-production.yml) | manual (`workflow_dispatch`) only | Always builds `main`, verifies internal links, then purges and replaces the dedicated production site directory over SFTP. Requires typing `deploy`. |

Merging into `main` never touches the production SFTP server - that only happens when
someone manually runs `deploy-production.yml`.

CI's Python discovery includes social previews/cards, participant roles, featured
images, deployment safeguards and all people/content/Git Workbench tests.
Hugo is installed before discovery so rendering tests actually run.
`npm test` includes 404 navigation, autocomplete, Git/people frontend tests and
hero-framing geometry. The nested manual-crop suite runs separately on Windows,
where Tk is available; it tests image processing/geometry without opening a window.
The Windows installer suite uses disposable fixtures and does not install software,
change PATH, or make live downloads. Its optional `-Online` check remains manual:
publisher availability is not a deterministic regression test. A hosted Windows
runner is not a clean Windows 10 laptop and does not certify a full first-time
installation or desktop interaction.

Every workflow uses an empty build destination. The shared build action
runs `scripts/verify_site_links.py` against the exact deployment base URL
and rejects broken internal routes, fragments, fonts, images, search-index
URLs, and URLs escaping a PR/project prefix. It does not test external
websites or prove live web-server permissions/configuration are correct.

PR URLs use `STAGING_BASE_URL` plus `pr-preview/pr-<number>/`, matching
the main Pages URL and the deployment action's preview link. A preview job
checks that the PR is still open at the same head revision before publishing.
Pages preview builds include `noindex` metadata; canonical URLs point to
`PRODUCTION_BASE_URL` (falling back to `data/meta.yaml`), without preview prefixes.

For a custom Pages domain, configure that domain in GitHub Pages settings
and set `STAGING_BASE_URL` to its actual served URL. Staging cleanup preserves
the branch's `CNAME` file as well as active PR folders; it must not erase the
custom-domain configuration. This is separate from production SFTP purging.

### Required GitHub repository configuration

These can't be expressed in the workflow YAML and must be set up once in the repo's
Settings:

1. **Settings > Branches** - protect `main` and require `CI / Build site`,
   `CI / Windows tooling` and `PR Preview / preview`.
   Enable **Require branches to be up to date before merging**.
   A push/rebase to the PR branch reruns checks automatically; a push to `main` alone
   does not emit a PR `synchronize` event. Strict up-to-date checks block stale PRs until
   their branches are updated. This repo does not automatically update PR branches when
   `main` advances; doing that requires a trusted GitHub App or token. `ci.yml` checks
   merge-group refs, but the Pages preview is PR-scoped, so a merge queue needs additional
   preview/deployment handling before it can replace branch updates for both gates.
2. **Settings > Pages** - Source = "Deploy from a branch" -> `gh-pages` (needed for
   `pr-preview.yml` and `staging-deploy.yml`).
3. **Settings > Actions > General > Workflow permissions** - "Read and write
   permissions" (needed so the preview/staging workflows can push to `gh-pages`).
4. **Settings > Environments** - create an environment named `production`. Add required
   reviewers there if you want a manual approval gate before every SFTP deploy, and add
   the SFTP secrets below scoped to this environment.

### Secrets (Settings > Secrets and variables > Actions > Secrets)

Required, scoped to the `production` environment, used only by `deploy-production.yml`:

| Secret | Description |
|---|---|
| `SFTP_SERVER` | SFTP/SSH host; confirm the hosting provider actually offers SFTP, not just FTP/FTPS. |
| `SFTP_USERNAME` | Account with permission to list, remove, create and upload inside the site directory. |
| `SFTP_PASSWORD` | SFTP account password. This workflow uses password authentication. |
| `SFTP_SERVER_DIR` | Required existing absolute POSIX path to a **dedicated** site directory, e.g. `/home/account/public_html`. No default; `/`, account home, parent traversal and symlink targets are rejected. |
| `SFTP_KNOWN_HOSTS` | Verified SSH public host-key entry/entries in OpenSSH `known_hosts` format. Obtain and verify the fingerprint with the provider through a trusted channel. Unknown or changed host keys fail deployment. For a nondefault port, the entry must use `[hostname]:port`. |

Configure these in GitHub directly; never put credentials in the repository
or paste them into chat. The old `FTP_*` secrets are no longer used.

### Variables (Settings > Secrets and variables > Actions > Variables)

All optional - each has a working fallback baked into the workflow if unset:

| Variable | Default if unset | Used by |
|---|---|---|
| `HUGO_VERSION` | value in `.hugo-version` | all workflows |
| `STAGING_BASE_URL` | `https://<owner>.github.io/<repo>/` | CI, staging and PR preview URL resolution |
| `PRODUCTION_BASE_URL` | `https://www.ftsk.hu/` | Production build and canonical URLs in all workflows |
| `SFTP_PORT` | `22` | `deploy-production.yml` |

### Running a production deploy

Actions tab > **Deploy to Production (SFTP)** > Run workflow > type `deploy`.
The checkout is always `main`, regardless of the branch selected in the UI.
Run **Dry run** first: it verifies build artifacts, connection, host key and
target-directory safety but makes no remote changes. It does not prove that
all upload/delete operations are permitted.

Take a backup of the server before the first real replacement. A real deploy:

1. Publishes a temporary `index.html` and `404.html` announcing deployment.
   The centered error illustration and hanging/standing cave borders are
   embedded SVG data, so purging image/style directories cannot break them.
2. Deletes every prior artifact inside `SFTP_SERVER_DIR`, including dotfiles
   and subdirectories, while preserving those two newly published temporary pages.
3. Uploads all remaining fresh artifacts, then replaces `404.html` and finally
   `index.html`. The homepage switches back only after the other uploads succeed.

The target directory itself remains. Symlinks inside it are removed, not
followed. Empty/incomplete builds, linked files, or missing maintenance
artwork are rejected before remote modification. Dry run checks maintenance
page generation as well, without publishing or purging anything.

The temporary page refreshes every 20 seconds using a cache-busting URL.
It is shown at the homepage and, when the host's custom-404 rule is active,
at missing URLs. Existing/new article URLs are not globally intercepted:
some can become accessible during upload. A uniform maintenance response
for **every** URL, or HTTP **503 / Retry-After**, requires a web-server or
reverse-proxy rule configured outside the directory being purged.

This is still a **purge then upload**, not an atomic release swap. Interrupted
artifact uploads leave the temporary homepage/404 in place, but can leave
other parts of the site incomplete; restore the backup or rerun deployment.
Page publication uses atomic POSIX SFTP rename when the host supports it;
otherwise standard rename has a brief replacement gap. The host's directory
index must serve `index.html`. Server-level caching/routing must also be
configured appropriately; HTML alone cannot guarantee zero downtime.
Use a directory containing only this site: unrelated uploads, verification
files, hosting-managed files and server rules will be deleted too. Anything
that must survive needs to be in `static/` or managed outside this directory.

Legacy report documents still linked by the current site are preserved
under `static/FTSK/`, keeping their original production paths. Course FAQ
PDFs have been relocated: the 2019/2022 shared document lives under
`static/pdfs/tanfolyamok/shared/`, and the 2024 document under
`static/pdfs/tanfolyamok/tanfolyam-2024/`. Their course links use the new
paths; the old `/FTSK/tanfolyamosGYIK*.pdf` URLs are no longer published.
Other old
server files and historical URLs not referenced by this build are not
automatically preserved. Inventory them before the first purge if old
incoming links or unlinked documents must keep working.

## 404 handling

Hugo generates `404.html`; uploading it alone does not configure every
production web server to use it. Configure the host to serve this page with
HTTP status **404**, not redirect all missing pages to the homepage with 200.
For an Apache site mounted at the domain root, a rule is:

```apache
ErrorDocument 404 /404.html
```

For a subpath, use that subpath in the rule. If this rule belongs in
`.htaccess`, add the reviewed file under `static/.htaccess` before the first
purge; this repository does not assume the host is Apache. On nginx/IIS,
configure the equivalent rule through the host or server administrator.

GitHub Pages uses the root `404.html` for missing PR-preview URLs, not each
preview's own 404 file. The Pages-specific 404 script rewrites navigation
and the search-index URL to the requested `pr-preview/pr-<number>/` prefix.
Shared assets can still load from the main Pages build. Run **Staging Deploy**
at least once to publish that root fallback. After a PR is removed, its old
URLs intentionally no longer lead to a live preview. The 404 page checks
the preview revision marker; if it is absent, navigation/search stay on main
Pages instead of linking back into the deleted preview. Pages caching and its
deployment queue can delay visible removal after the branch is cleaned.

Publishing and cleanup explicitly request a Pages rebuild after their branch
push. GitHub documents that `GITHUB_TOKEN` pushes do not automatically
trigger a Pages build; deleting a folder only in Git therefore is not enough.
These jobs request `pages: write`. A missing/incorrect Pages setup or rejected
build request fails the workflow rather than silently claiming publication.

## Verification commands

```powershell
python -m unittest discover -s scripts -p test_deployment.py
node scripts/test_404_navigation.js
python scripts/verify_site_links.py --root public --base-url "https://www.ftsk.hu/"
```

Use the same base URL as the build being checked; a PR build must be checked
against its full PR prefix. These checks do not connect to the production server.
