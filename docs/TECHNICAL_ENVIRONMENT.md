# Technical environment

How to set up a local dev environment for this Hugo site on Windows, and
what has to be configured in GitHub for the CI/CD pipeline in `.github/workflows/`.

## Stack

- **Hugo** (extended) with native reusable sections under
  [`layouts/partials/sections/`](../layouts/partials/sections/).
  There are no external Hugo modules, Bookshop runtime or Go requirement.
- **Node.js / npm** - used for JavaScript regression tests, optional
  `npm start` / `npm run dev` aliases, and the local Workbench Monaco bundle.
  A plain Hugo build/server still requires no npm packages.
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

## Report PDF export

Non-archive trip reports generate A4 PDFs in the visitor's browser using
pdfmake 0.2.23 and html-to-pdfmake 2.6.0. Sources, browser bundles, bundled
Roboto fonts and license notices are committed under
[`static/vendor/report-pdf/`](../static/vendor/report-pdf/); Hugo requires no
additional build dependency. Libraries load only when the compact author-row
PDF control is clicked. Conversion uses the rendered Markdown/shortcodes, not
a separate Markdown parser or raster screenshots.
The npm packages are development-only vendoring and PDF test tools; public
pages use the committed local assets, not npm packages or external CDNs.

After deliberately updating the exact pins in [`package.json`](../package.json),
run `npm install --ignore-scripts` and `npm run vendor:pdf`, then commit the
lockfile and vendored outputs together. The vendoring command verifies installed
versions before copying. Retain the Roboto SIL Open Font License 1.1 notice
when updating fonts; the shipped Roboto Classic 3.014 fonts use this license.
[`static/js/report-pdf.js`](../static/js/report-pdf.js) owns print normalization,
cover design, pagination and explicit error reporting. The same source runs
as a dedicated Web Worker for PDF layout, loading only local vendor assets.
Closing the bat-themed progress dialog aborts image requests and terminates
the worker; stale completions cannot download or change a newer request.
Fonts and decoded images are in memory before using pdfmake's synchronous
stream API so both layout and stream failures reach the dialog. Success closes
the dialog without adding messages to the article. Isolated editor previews
allow same-origin/blob workers while retaining their separate read-only origin.

Report controls and the archive/PDF contract are documented in
[the content guide](CONTENT_GUIDE.md#6-bekezdések-archív-beszámolók-és-pdf-letöltés).

## Single sources of truth for versions

These files/fields are read by both the GitHub Actions build (`.github/actions/build-site`)
and the local scripts (`scripts/`). Don't hardcode a version anywhere else - change it here:

| What | Where | Read by |
|---|---|---|
| Hugo version | [`.hugo-version`](../.hugo-version) | `build-site` action's "Resolve Hugo version" step; `scripts/setup-dev-env.ps1`; `scripts/dev-server.ps1` |
| Node version | `engines.node` in [`package.json`](../package.json) | `scripts/setup-dev-env.ps1` (minimum check; new installs use compatible LTS) |

To bump the Hugo version everywhere (CI + local), edit `.hugo-version` only.

## Tooling source layout

Application code, maintenance commands and tests have separate homes:

| Folder | Responsibility |
|---|---|
| [`tools/workbench/`](../tools/workbench/) | Python editing services and HTTP server; `web/` contains browser assets and `hero/` the embedded hero editor. |
| [`tools/images/`](../tools/images/) | Reusable photo/portrait processing and hero configuration helpers. |
| [`tools/social_preview.py`](../tools/social_preview.py) | Social-card preview application, also used by the Workbench. |
| [`scripts/`](../scripts/) | Setup, local development, editor bundling, deployment, migration and verification commands, plus their dependency manifests. |
| [`tests/python/`](../tests/python/), [`tests/js/`](../tests/js/), [`tests/powershell/`](../tests/powershell/) | Regression suites grouped by runtime, not mixed into production code. |
| `.tools/` | Ignored, generated/downloaded executables and Monaco bundles; distinct from tracked `tools/` sources. |

Run Python application modules from the repository root, without `PYTHONPATH`
or ad-hoc import-path changes:

```powershell
.\.venv\Scripts\python.exe -m tools.workbench --no-browser
.\.venv\Scripts\python.exe -m tools.social_preview --no-browser
.\.venv\Scripts\python.exe -m scripts.verify_members
.\.venv\Scripts\python.exe -m scripts.migrate_people --help
.\.venv\Scripts\python.exe -m unittest discover -s tests\python -p 'test_*.py'
npm test
.\tests\powershell\test_setup_dev_env.ps1
```

The root double-click launchers remain unchanged for editors. Public Workbench
URLs (`/workbench/`, `/hero/`, and `/workbench-editor/`) are stable despite the
source moves. To add a test, place it in its runtime folder and update the
JavaScript runner/CI selector when needed; Python discovery already covers all
`test_*.py` files in `tests/python/`.

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
| Workbench Monaco | `npm ci` and `npm run workbench:editors`; local assets under `.tools/workbench-editor/`. Rebuilt when the lockfile or editor build sources change. |
| Hugo | Exact pinned **extended** version; reused if correct, otherwise under `.tools/hugo/<version>/`. |
| Python | Working 64-bit Python >= 3.10 with venv; checks `py` launcher runtimes, PATH and usual install folders, otherwise user-scoped Python 3.12 from WinGet. |
| Python tool libraries | Project `.venv`: Pillow, pillow-heif, PyYAML and Paramiko, from [`scripts/requirements-dev.txt`](../scripts/requirements-dev.txt). HEIF/HEIC originals decode to 8-bit images for WebP export. Member portrait crops are selected manually in the Workbench browser canvas. |
| Smoke checks | Builds to a temporary folder, verifies members/internal links, and runs hero-framing and social preview/card-selection regressions. |

Portable archives are verified using their publisher's SHA-256 manifests.
To prepare the Workbench editors manually, run `npm ci` then
`npm run workbench:editors` from the repository root. Monaco, its fonts and
language workers are served by the local Python server, never a CDN.
The DOMPurify override in `package.json` pins the patched sanitizer used by
the bundled Monaco Markdown tooltips; rebuild after changing dependencies.
If the bundle is missing, Workbench displays an explicit setup error and
leaves the original plain-text fields available for recovery.
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
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\powershell\test_setup_dev_env.ps1`.
The disposable fixtures exercise the setup and supervised Workbench batch
launchers, including argument forwarding, checkout paths with spaces and
success/failure exit codes.
Add `-Online` to also download, checksum-verify and run the pinned Hugo in a
disposable temporary folder; it is cleaned afterward and never added to PATH.
The Workbench replaces the separate image-converter GUIs and hero-server
launcher; their dependency installers have also been removed. Conversion
backends and the embedded hero editor remain. Tk is not required. For
maintenance/check scripts:

```powershell
./.venv/Scripts/Activate.ps1
python -m scripts.verify_members
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
.\.venv\Scripts\python.exe -m unittest discover -s tests/python -p test_content_blocks.py
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
.\site_editor.bat --no-browser --port 8879
# Editor development: reuse .venv; restart local source edits manually:
.\site_editor.bat --dev
```

Open <http://127.0.0.1:8879/>. The stable, standard-library launcher starts
from `.venv`, then supervises a separate checkout-specific editor behind that
same browser address. Keep its console open. No external editor service or CDN
is used. Direct `python -m tools.workbench` remains available for debugging,
but bypasses supervision and automatic restart.

### Editor versions, checkout changes and developer mode

`tools/workbench/version.json` declares the editor's semantic `version` and
`launcher_protocol` (currently `1`). Bump the semantic version for editor
releases; change the protocol only when the launcher/editor contract changes.
The launcher additionally hashes actual editor Python, JavaScript, CSS, HTML,
supporting tool modules, dependency manifests and editor build inputs. Thus
same-version source changes still trigger a restart; content-only edits do not.
The browser displays the running version, with a source fingerprint tooltip.

After checkout, creation, Receive, rebase or manual Git recovery, the launcher
waits for Git, requests and build jobs to finish before comparing sources.
If editor sources changed, it gracefully closes the old editor, including its
owned preview processes, prepares dependencies and starts the matching editor.
The launcher and its browser bridge remain in memory even when an older branch
removes their files. Unversioned branches are labelled **legacy (unversioned)**;
they must still contain the Workbench status API. A small legacy port adapter
keeps isolated-preview CSP bound to the public editor address, not its private
backend port. Unsupported protocol versions, missing editors and startup errors
leave a recovery screen rather than serving mismatched assets.

Browser requests carry an editor generation; an old tab cannot call the new
editor's APIs until reloaded, including after reopening the launcher. Request
tokens also change on restart. Reconnect
never silently discards browser-only drafts: affected tabs offer draft downloads
and an explicit reload after the user saves their work. Queued server uploads
and paused Git recovery prevent restarting. Finish/abort Git recovery or remove
queued uploads first. Saved files, local commits and recovery backups are never
discarded by the launcher. If status cannot verify that Git is finished, it
waits rather than killing an unverified worker.
The status contract must report Git availability, busy/recovery state, queued
uploads and the build-job lifecycle; missing fields are not treated as idle.

Managed mode caches separate Python environments under
`.tools/site-editor-runtime/python/`, keyed by the recursive requirements,
interpreter and Python version. It installs project requirements only into these
environments, never modifies `.venv`, and marks a cache ready only after successful
installation and `pip check`. Editor assets are rebuilt from the current lockfile
and build sources; `npm ci` affects project-local `node_modules` only. Missing or
incompatible Node/Hugo/system tools require the explicit setup installer; the
launcher does not install system tools or change PATH. Installation/startup
failures remain visible with **Retry startup** and instructions to double-click
`setup-dev-env.bat`. **Loading the matching editor** shows completed startup
stages, an indeterminate bar for the running stage, elapsed stage time, and a
separate plain-language explanation. **Technical details** is expanded by default
and streams dependency-command and child-editor output while commands are still
running. The browser polls once per second; the launcher retains the latest 200
log lines, capped at 2,000 characters each. No download percentage is guessed.
Errors retain the last stage and log; Retry begins a fresh progress history.
The launcher window also receives the full output. Close and reopen
`site_editor.bat` once to load this updated launcher and its in-memory bridge.
Retry after a failed managed editor start re-prepares only that editor's cached
Python environment; it does not delete environments or modify the project `.venv`.

**One-time migration:** update existing installations manually to a checkout
containing this launcher, rerun setup if needed, close the old editor, then
double-click `site_editor.bat`. Already-running unsupervised editors cannot gain
this feature retroactively. Subsequent editor-changing checkout operations are
supervised, including downgrades within the running launcher session. On a legacy
branch its old batch file may still launch unsupervised after the entire launcher
is closed; return to the launcher-enabled release for the next supervised session.
A protocol change requires closing and reopening the checkout's updated launcher.

**Developers:** `site_editor.bat --dev` uses the selected project `.venv` without
automatic dependency installation. Local source edits produce a warning and
**Restart editor** button rather than interrupting work. Checkout-changing Git
actions through the editor, and external branch switches, still restart changed
editor code. External same-branch source edits/updates in this mode require the
manual restart button. Ordinary page reloads do not reload Python modules.
Dependencies and Monaco builds are maintained explicitly with setup or the
existing build commands. The restart button replaces the editor process, not
the stable launcher: after editing `launcher.py` or `runtime-bridge.js`, close
and reopen the launcher. Keep protocol `1` compatibility across editor releases;
changing that contract requires a protocol bump and a new launcher session.
New processes disable stale bytecode caches, including
same-size, same-timestamp files checked out from another branch.

Focused regressions (no dependency downloads; disposable Git/editor processes):

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests\python -p test_workbench_runtime.py
node tests\js\test_workbench_runtime.js
```

### Shared image editing and reviewed WebP exports

Site photos, article image uploads/fields (including social previews) and CV
photos share `web/image-editor.js`. Member portrait uploads retain their
dedicated square-face/full-image workflow. No additional dependencies or remote
assets are used: the existing Pillow backend prepares all actual WebP outputs.

An unedited output means the original pixels converted/resized to WebP, not a
camera-file copy. Each source supports independently named versions with pixel
crops, free/preset ratios, rectangle/circle/ellipse shapes, brightness, contrast,
saturation, warmth and per-version maximum dimensions/quality. Circular and
elliptical masks preserve alpha, with smooth edges. EXIF orientation is corrected
before coordinates are exposed. Limits remain 30 MiB / 25 MP per source, 100
queued sources, 64–6000 maximum dimensions and quality 1–100; the editor limits
each source to 20 versions and each batch to 200 selected outputs; the backend
allows 200 live prepared previews. Omitting an unedited output releases its
preview reservation instead of consuming capacity for a file that will not save.

`POST /api/workbench/images/open` stages an existing local raster image.
`POST .../images/preview` receives the staged `id`, version `key`/monotonic
`sequence`, destination `context`, dimensions, name, mode and `edit` recipe.
The context is `photos` with a folder, `page` with a content path, or `cv` with
a person and roster revision. The server derives/validates owned destinations,
encodes a temporary WebP and reserves its collision-safe path. The response
includes the preview URL, nonce `token`, dimensions, byte count and authoritative
`can_overwrite` / `overwrite_reason` destination guidance.
`GET .../images/source/{id}` serves the oriented source thumbnail;
`GET .../images/preview/{token}` serves the **exact** encoded output.

`POST .../images/save` consumes the reviewed token, rather than rerendering client
parameters. New-copy paths use exclusive creation. Replacement requires an
existing staged WebP in the permitted folder, explicit `confirm_overwrite`,
matching source revision and branch, and same-directory atomic replacement.
Retrying a lost save response returns the verified saved result without creating
duplicates. Roster/branch changes, stale previews and newly occupied output paths
fail explicitly. Preview generation sequencing rejects old requests.
`POST .../images/finish` cleans all temporary versions in one request and removes
only completed/cancelled owned sources; unfinished site-photo queues survive.
All endpoints retain localhost/token/branch and isolated-preview-server guards.
Destination guards are anchored at the checkout root, rejecting linked/junction
ancestors including `static`, not only links below `static/images`.

The modal reviews every file before writing, retains completed outputs on partial
failure, and retries only remaining versions. Single image-field callers select
one reviewed output to assign; other outputs stay available in the page folder.
Crop changes invalidate previews as soon as dragging starts changing the
selection; invalid pixel fields block review/save until corrected. Navigation
finishes an active drag and remains available for already-read batch sources.
`Refresh preview` retries failed/expired previews without changing their recipes.
Unread sources remain visible in review and are returned as `sourceErrors`, so
upload callers do not replace partial-failure feedback with a success message.
The Site photos library uses an automatically loaded folder grid, clickable
ancestor breadcrumbs and a fixed Up/Refresh toolbar. Manual paths are a
separate disclosure, without a navigation dropdown. Sequenced reads prevent
late folder responses from displaying files under the wrong breadcrumb.
No image operation saves content/member drafts, commits or publishes. The open
editor contributes to the shared Git/restart blocker event and warns on browser
reload. Focused tests: `test_image_workbench.py` and `test_image_editor.js`.

### Unused-file cleanup

**File cleanup**, directly below **Save & sync**, discovers static files with no
internal references. Discovery is explicit and read-only, including on main.
The default view covers images, PDFs and other media/downloads. **Advanced: other
static files** also exposes HTML, scripts, styles, fonts and miscellaneous files;
content pages, editor source, build output and caches are never deletion targets.

The scanner examines saved content/configuration/templates/scripts and performs
a fresh Hugo build including drafts, future and expired pages. Build output,
resource processing and caches stay in a temporary directory, not `public/` or
the checkout's `resources/`. It also preserves original images consumed by Hugo's
image pipeline. Conservative filename matching can retain same-named files in
different folders. Recognized dynamic paths (such as legacy tutorial templates
and interpolated image names) are marked protected, not approved for deletion.
Unrecognized runtime path construction, external links and bookmarks cannot be
proven unused; always review candidates rather than treating discovery as proof.
A failed build or a checkout change during scanning approves no files.

Filter by filename/folder and type, inspect images/PDFs, then select individual
files or visible eligible candidates. Selection remains explicit across filters;
leaving advanced mode removes non-media selections. A single deletion dialog
lists every selected path. Save browser drafts and remove queued uploads first.
Deletion requires an editable working branch, a current scan and unchanged files
matching their committed Git blobs. Untracked, newly staged, modified and
publishing-infrastructure files are protected. Commit new/changed files first
when they need to become eligible. No recovery copy is created: deleted files
remain recoverable from the recorded Git checkpoint, and deletions appear as
ordinary local changes in **Save & sync**, with no automatic commit or publishing.
After deletion, scan again to discover any newly unreferenced dependencies.

`GET /api/workbench/cleanup` returns the current scan and build-job status.
`GET /api/workbench/cleanup/progress` provides live stage explanations, elapsed
stage time, actual checked-file counters/current paths and build output. Its
short-held progress lock is independent of the checkout lock, so both safety
snapshots remain visible while they read/hash files. The UI polls this endpoint
first and waits until discovery stops before requesting the candidate catalog.
The five stages are saved-file inspection, isolated Hugo build, generated
reference collection, static-file matching and final checkout verification.
Uncounted work uses an indeterminate bar rather than estimated percentages;
failed stages retain their evidence and receive red styling. Disconnection
stops the activity display and blocks review until polling reconnects.
Deletion shows a waiting indicator during its existing validation/removal
request, without adding another approval or changing deletion safeguards.
Start discovery through `POST /api/workbench/jobs` with `{"action":"cleanup-scan"}`.
`POST /api/workbench/cleanup/delete` accepts `scan`, distinct `paths`,
`confirm: true` and (for non-media files) `advanced: true`; existing token,
branch and editable-checkout guards apply. Reference/checkout fingerprints and
Git copies are rechecked before any deletion. Partial filesystem failures name
the files already removed rather than reporting success.

Focused tests:
`node tests\js\test_cleanup_workbench.js` and Python discovery for
`test_cleanup_workbench.py` under `tests\python`.

### PDF import API and archive batches

**Trips / Courses → Read a PDF** provides staged local text/image extraction,
photo selection and the same shared image editor used by ordinary uploads.
Photo preparation saves exact reviewed variants first; a separate action
adds the reviewed text/files to the unsaved page draft. Selections above 100
sources are processed in bounded batches. Cancelled batches retain completed
results; partially saved sources require an explicit saved-version decision
before continuing, rather than silently duplicating or inserting partial work.
See the [editor workflow](CONTENT_GUIDE.md#pdf-beszámoló-beolvasása).
Existing installations need the updated Python dependencies:

```powershell
.\.venv\Scripts\python.exe -m pip install -r scripts\requirements-dev.txt
```

The local-only API follows the existing origin, token and editable-Git guards.
Get the session token from `GET /api/workbench/status`; send it as
`X-Workbench-Token` on mutations. Send `X-Workbench-Branch` when pinning a
request to the branch shown by Workbench. Do not expose this server publicly.

| Method / route under `/api/workbench/content/` | Input / result |
| --- | --- |
| `POST pdf-import` | Raw PDF bytes; URL-encoded `X-Filename` and `X-Content-Path` headers. Returns extraction metadata, page text, image IDs/previews, warnings and `markdown`. |
| `POST pdf-import/inspect` | JSON `{"path":"turak/report.md","url":"/pdfs/turak/report.pdf"}` for an existing local PDF. Same result; no site writes. |
| `GET pdf-import/{id}/{image-id}.png` | Temporary image preview, valid until discard or server shutdown. |
| `POST pdf-import/export` | JSON with `id`, matching `path`, selected `images` IDs, optional `width`, `height`, `quality`, `keep_pdf`, and `image_files` mapping each selected source ID to reviewed WebP URLs. Reviewed files must exist in the exact page-owned image folder; multiple variants are supported, with at most 400 distinct files. Omitting the map preserves legacy converter-based exports. Returns `markdown`, exported `images` with local URLs, `pdf_url`, `warnings`, `folder`. Does not save a content page. |
| `DELETE pdf-import/{id}` | Discards staging only; exported assets remain. |

Example export JSON:

```json
{
  "id": "extraction-id-from-inspect",
  "path": "turak/report.md",
  "images": ["page-002-image-01"],
  "width": 1600,
  "height": 1600,
  "quality": 82,
  "keep_pdf": true
}
```

Exports are bound to the inspected page path and Git branch. Repeating the
same export is idempotent; changing the selection/settings after export
requires another extraction. Failed exports roll back newly created assets.
Local URLs and page-owned folders are enforced server-side. HTML/shortcode
syntax from extracted prose is escaped; image/PDF shortcodes are generated
separately. OCR is not performed.

Limits: 64 MiB per PDF, 200 pages, 200 image objects per page / distinct
exportable images, 25 million pixels per source image, 1 MiB extracted text,
120 MiB staged PNGs, five simultaneous staged imports. Photographs are
deduplicated and adjacent narrow strips joined. Staging previews are bounded
to 1600 pixels; final export never upscales.

For legacy archive reports, first generate **private** contact sheets:

```powershell
.\.venv\Scripts\python.exe -m scripts.import_archive_pdfs --review-dir C:\Temp\ftsk-pdf-review
.\.venv\Scripts\python.exe -m scripts.import_archive_pdfs --report legacy-bukk-mikulas-tura-2014 --apply --cover legacy-bukk-mikulas-tura-2014=page-003-image-02
```

Without `--apply`, the command only inspects PDFs (and optionally writes
review artifacts outside the site). Repeat `--report`, `--cover REPORT=ID`
and `--exclude REPORT=ID` for curated batches; `--cover REPORT=none` retains
the existing cover. Review before applying: an automatic landscape choice
is not necessarily a good cover. The apply step writes WebP photos under the
page-owned image folder, changes card/heading photos and appends a gallery.
It **preserves the existing story and original PDF** rather than publishing
unreviewed extracted text. Previously imported pages are rejected to avoid
duplicated galleries. A content-save failure is reported and may leave
exported photos for manual review; the command never claims success silently.

The previously truncated Cantabria 2018 archive PDF was restored from
`https://www.ftsk.hu/FTSK/turak/Cantabria2018.pdf`: the existing 11,101,628 bytes
were an exact prefix of the complete 55,250,442-byte, 13-page original.
Its existing local URL is unchanged. Other original archive PDFs were not modified.

### Notifications

Every Workbench tool reports through one notification system
(`tools/workbench/web/notifications.js`), never through banners inserted at the top
of a page. `notify(message, kind, options)` (kinds: info, success, warning, error, busy;
`options.key` makes a message replace its predecessor, `options.dedupe` ignores an identical
repeat such as a polling failure) shows a toast at the bottom right and records it in the
notification center behind the bell in the header.

- Problems and warnings stay until dismissed; results and info expire after a few
  seconds (longer for long messages; hovering or focusing a toast pauses the timer).
- The bell lists everything from this session (kept across a reload within the tab) with
  time and area, a Problems filter, per-entry copy/remove and Clear all. A red badge counts
  unread problems; opening the center or dismissing a toast acknowledges them.
- Toasts move into the open modal dialog, so they stay visible and clickable above it.
  Errors that belong to a dialog's own form still appear inline in that dialog.
- Status text that describes a page state (for example the cleanup status line or the
  Git lock explanation) stays on the page; outcomes and errors never do.
- The hero editor (an iframe) forwards its errors to the parent through
  `window.workbenchNotify`; standalone it keeps its own status line.

### Other Workbench tools

On startup, a loading screen keeps workspace controls inert until the first
complete status snapshot has rendered (branch, changes and local Git state).
It does not fetch or publish. Connection failures remain visible with
automatic retries and a reload action; later polling does not interrupt
editing with the startup screen. The spinner respects reduced motion.

Page editing uses a persistent **Edit page** workspace button alongside
dedicated tools. The active button, mode banner and panel border share an
accent (green editing, cyan files, magenta media, yellow PDF, peach placement,
lavender source). Text badges and pressed states also indicate the active
mode. Git recommendations use yellow for local files/checkpoints, magenta
for local-history actions and cyan for server actions, with stronger glows
only on actionable recommendations. Reduced-motion preferences disable the
recommendation pulse; busy/disabled actions remain unhighlighted.

- **Git & workspace:** the landing page displays working files, local commits,
  last-known origin refs and the checked-out branch, with operation animations
  and reduced-motion support.
  Controls live in their domains: reviewed commits beside working files,
  sending and branch/rebase controls beside local history, and checking/receiving
  beside GitHub. Separate directional lanes distinguish checkpoint, push, fetch
  (snapshot only), and pull (history/files). Only the active transfer is animated.
  Visible checkout and new-branch launchers on the local-history box open a
  compact, single-purpose modal with live draft/file blockers: switching
  existing work or naming a new branch from latest main. The submit button
  executes without a second approval. An advanced option retains creation
  from the current checkout, including saved changes on protected main.
  The checkpoint graph shows newer tips at the top, with older ancestry below
  (also in the accessible checkpoint list). It uses real parent links, merge-base(s), separate main
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
  The graph defaults to simple labels, with an explicit technical-details
  toggle for hashes. "You are here" marks the actual checkout (including a
  paused replay, not its original branch tip). "Back to latest" scrolls only
  the graph; polling never forces readers away from older history.
  Clicking a checkpoint or activating it with Enter/Space opens read-only
  author/date/message and changed-file details. The authenticated endpoint
  accepts only full IDs in the current graph, refuses inspection while Git
  is busy, and never restores files or changes branches. Merge changes are
  compared against the first parent; file lists are capped at 500 and messages
  at 10,000 characters with explicit truncation notices.
  Confirmed newly visible checkpoints get a brief pulse, not on initial load.
  Rebase/Receive confirmations include a static before/after illustration
  from the bounded snapshot, not an exact replay forecast. Equivalent changes
  may be skipped, fresh fetches may change the target, and conflicts may pause
  replay. Confirmation, stale-state checks and recovery backups are unchanged.
  Short graph guidance distinguishes local Save, Receive, Publish and Check
  GitHub; a successful publish is never presented as a merge or deployment.
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
  force-push, automatic stash or reset/discard. Server contact happens only
  after a user action. Fetch, ordinary push, Receive and Continue execute
  directly; rebase, abort, native terminal and leased publication retain reviews.
  Every GUI fetch (explicit Fetch, Receive, latest-main workflows and published-rebase preflight)
  runs `git fetch --all --prune`, refreshing all configured
  remotes and removing deleted server tracking refs without deleting local
  branches. The branch picker includes all cached remote branches. Receive
  rebases specifically onto this branch's origin upstream using
  `rebase --no-autostash`, preserving teammates' work and replaying only
  unpublished commits;
  it requires checkpointed files and makes a working-branch recovery backup.
  **Open a new branch from main** fetches first and creates an untracked
  working branch directly from the fetched `origin/main` commit, not current
  work or stale local main. Local main is not overwritten; dirty files block
  this workflow. Missing main, fetch failures and existing names fail visibly.
  **Rebase active branch onto latest main** fetches before validating fresh
  server tips, backs up and replays the current branch. It rejects missing
  teammate commits and retains the exact fetched lease for published work.
  An already-current branch does not acquire an unnecessary publication lease.
  If replay stops, Workbench aborts it and marks the backup aborted. The failure
  dialog gives checkout-specific PowerShell commands, conflicting paths,
  staging/continue/abort steps and exact leased publication instructions.
  An abort failure remains visible with recovery controls; it never claims
  restoration. Advanced selected-base and Receive workflows still pause for
  existing in-tool conflict recovery.
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
  containing its recorded server tip. The advanced selected-base workflow
  requires a new fetch to match both reviewed tips; latest-main explicitly
  requests the freshly fetched base instead. Every guided working-branch rebase saves a verified
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
- **Category content workspaces:** Trips and Courses have dedicated navigation;
  additional sections are derived automatically from catalog paths and their
  `_index.md` titles. `#content` remains the all-category library, while
  `#content/{encoded-section}` opens a category. Known labels, accented multi-term
  search, filtering and filename suggestions live in `content-library.js`.
  Root pages, section indexes and people documents remain accessible.
  The full-width library and focused editor are separate screens: browsing keeps
  the active draft, while replacing it offers Save/Discard/Keep editing. Failed
  saves never approve replacement. Create title-first drafts from the
  maintained trip, archived-PDF and course templates; edit Markdown, frontmatter,
  SEO, participant/FAQ cards and course milestones/contacts/flyers. Other
  Markdown pages are editable in source mode, including component-driven pages.
  Placement supports nested folders, leaf bundles, slug/URL overrides, aliases,
  publishing and expiry dates. Unknown frontmatter fields remain available in
  source mode; unchanged source, comments and newline conventions are preserved.
  The media tab connects conversion, existing-image selection, image metadata,
  image/media/gallery/Markdown insertion, and PDF upload/insertion.
  Media browsers use breadcrumbs/folder tiles and sequenced reads to reject stale
  folder responses, without changing fixed page-owned upload destinations.
  Preview status distinguishes building, ready, outdated and failed snapshots,
  with a separate technical log. Malformed pages retain a filename title and
  their explicit source error so they cannot break the entire catalog.
  **Find site text** and the Start here search form share one global search
  workflow. `GET /api/workbench/content/search?query=...&scope=all|pages|shared&offset=0`
  searches saved Markdown, configuration, data, translations and templates,
  ignoring case/accents and normalizing phrase whitespace. Queries are literal,
  not regular expressions. Results contain repository paths, source kinds,
  match counts and up to five line-numbered excerpts per file; pages of 25 files
  return `next_offset`. Non-UTF-8, symbolic-link and over-2-MiB sources are
  explicitly reported as skipped. Generated output, tool code and binary assets
  are excluded. Page results use draft-safe `workbenchContent.openMatch` and
  reveal the selected occurrence in Story, an existing guided field, or Full
  source. Shared sources are labelled as requiring source editing until a
  dedicated workflow exists. Search never writes files or replaces a draft.
  Shared file-action controls form card footers rather than sibling icons;
  interactive cards are wrapped to avoid nested buttons/links.
  Workbench layouts target small laptops through intermediate desktop sizes
  and ultrawide monitors; public-site mobile behavior is unchanged.
  Shared accessible typeahead controls show saved choices while typing, with
  arrow-key/Enter selection and Escape dismissal. Person suggestions include
  portraits/initials, stable IDs, aliases and membership context; already
  assigned participants are excluded. The same helper covers groups,
  categories, portrait pairs, merge targets, templates and image folders.
  Typing search text never assigns a person or marks a person draft as edited.
- **Site photos:** upload/drop a batch, choose maximum dimensions and quality,
  and export WebP into any named/nested folder under `static/images/`. General
  photos default to `gallery`, not `hero`; conversion does not automatically
  add slideshow entries. The shared image editor offers crops and tone controls,
  still without stretching or upscaling. The content studio also
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
  The workspace separates People, Connections, Checks & cleanup and Categories
  & roles. Registry cards are alphabetized within existing membership groups;
  saved roster order remains unchanged. The person dialog has section navigation
  and a fixed save header; advanced identity and portrait-file controls are
  progressively disclosed without removing their existing safeguards.
  Connections use an exact overlap matrix rather than implying independent
  Venn sets: defaults are current membership, every course participant
  (including instructors/helpers) and its nonmembership complement.
  `people.js` provides shared pure search/reference/filter/classification helpers;
  masks use member=1, course=2 and external=4, counting each identity once.
  Ephemeral view rules can restrict courses to configured roles and define
  external by nonmember participation, selected membership/event roles or a
  custom category. Event roles use the existing manual/legacy/automatic resolver.
  These controls never write registry, role or content files and reset on reload;
  actual membership/category editing remains in the person form.
  Population search, status/category, course, year, event-role and overlap
  filters combine. Counts precede overlap filtering; scoped course/role
  discovery uses matching saved references, never historical membership inference.
  Author/contact references can match an event scope but never confer course
  participation. Invalid incomplete view rules and incomplete reference scans
  are explicitly reported. Individual history adds type/year/role filtering
  and uses the same live rule controls, moved into its dialog and restored on
  close, excluded from dirty tracking. Its matrix reflects visible references
  and draft membership; saved automatic classification remains separately labeled.
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

Deployment and environment installation are not embedded. Use Ctrl+C in the
Workbench launch terminal to stop and clear staged originals.
No automatic commits or publishing occur.

Tests (disposable site fixtures; no real image/config edits):

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests/python -p 'test_*workbench.py'
.\.venv\Scripts\python.exe -m unittest discover -s tests/python -p 'test_people*.py'
node tests/js/test_people_workbench.js
```

The environment installer's smoke verification includes these tests.

## Social sharing preview

Start Hugo separately, then open the local Python viewer:

```powershell
.\scripts\run_social_preview.bat "http://localhost:1313/tanfolyamok/tanfolyam-2027/"
# Or use the configured Python interpreter:
python -m tools.social_preview "https://www.ftsk.hu/"
python -m tools.social_preview --no-browser --port 8878
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
python -m tools.social_preview "http://localhost:1313/" --output "$env:TEMP\ftsk-social-preview.html"
python -m unittest discover -s tests/python -p test_social_preview.py
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
`python -m unittest discover -s tests/python -p "test_social*.py"` (offline fixtures,
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
| [`ci.yml`](../.github/workflows/ci.yml) | PR opened/updated and merge queue | Ubuntu: validates people, builds with drafts/future, discovers all Python tests under `tests/python/`, and runs `npm test`. Windows: installer/launcher regressions under PowerShell 5.1 and manual portrait cropping. Internal links/assets are a required build gate; the additional lychee check is advisory. |
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
hero-framing geometry. The manual-crop suite also runs separately on Windows;
it tests image processing without requiring Tk or opening a window.
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

1. Publishes a temporary `index.html`, `404.html` and `.htaccess`. The page is
   just the centered crashing-bat picture and a short message; the picture is
   embedded SVG data, so purging image/style directories cannot break it. The
   temporary `.htaccess` answers **every** URL (HTTP 503 with `Retry-After`)
   with that page, so no half-uploaded article can be reached. The page keeps
   the visited URL and reloads itself every 20 seconds.
2. Deletes every prior artifact inside `SFTP_SERVER_DIR`, including dotfiles
   and subdirectories, while preserving those three newly published temporary files.
3. Uploads all remaining fresh artifacts (HTML pages last), then replaces `404.html`,
   then `.htaccess` (the build's `static/.htaccess`; the temporary one is removed
   if the build has none) and finally `index.html`.
4. Checks the live site (`SITE_URL`, default `PRODUCTION_BASE_URL`): the home page
   must be served and a missing URL must show the FTSK 404 page. If the home page
   answers HTTP 5xx the freshly published `.htaccess` is removed again and the job
   fails; if only the 404 page is missing the job prints a warning annotation.

The target directory itself remains. Symlinks inside it are removed, not
followed. Empty/incomplete builds, linked files, or missing maintenance
artwork are rejected before remote modification. Dry run checks maintenance
page generation as well, without publishing or purging anything.

The rewrite rule needs an Apache-compatible server that honours `.htaccess`
(Plesk in Apache mode does). On a server that ignores it, visited pages that
no longer exist fall through to the host's own handling and uploaded pages can
become reachable early; a uniform maintenance response or **503 / Retry-After**
then needs a rule in the web-server configuration outside the purged directory.

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
production web server to use it. The production host (Plesk behind nginx)
answered missing URLs with its own default error page, because nothing told it
to use `404.html`. `static/.htaccess` therefore ships the rule

```apache
ErrorDocument 404 /404.html
```

which keeps HTTP status **404** (not a redirect to the homepage). It is part of
every build, survives the purge-and-upload deployment and is checked by the live
check at the end of the production deploy. If that check warns that the FTSK 404
page is still missing, the host ignores `.htaccess`: in Plesk enable Apache
mode/overrides for the site, or add `error_page 404 /404.html;` (with
`proxy_intercept_errors on;` when nginx proxies Apache) under Apache & nginx
Settings → Additional nginx directives. For a site under a subpath, use that
subpath in the rule. Other hosts need the equivalent server rule.

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
python -m unittest discover -s tests/python -p test_deployment.py
node tests/js/test_404_navigation.js
python scripts/verify_site_links.py --root public --base-url "https://www.ftsk.hu/"
```

Use the same base URL as the build being checked; a PR build must be checked
against its full PR prefix. These checks do not connect to the production server.
