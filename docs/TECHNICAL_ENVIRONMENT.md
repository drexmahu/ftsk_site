# Technical environment

How to set up a local dev environment for this Hugo/Bookshop site on Windows, and
what has to be configured in GitHub for the CI/CD pipeline in `.github/workflows/`.

## Stack

- **Hugo** (extended) with **Hugo Modules** for the component library
  (`component-library/`) and the [Bookshop](https://github.com/cloudcannon/bookshop) Hugo engine
  (`github.com/cloudcannon/bookshop/hugo/v3`, declared in [go.mod](../go.mod)).
  Module resolution needs **Go** on PATH, even though there's no Go code to compile.
- **Node.js / npm** - only needed for the Bookshop *live component
  preview* (`npm run dev`), not for a plain `hugo build`/`hugo server`.
- **SCSS** compiled via Hugo's built-in libsass transpiler (`css.Sass`, see
  [assets/scss/theme.scss](../assets/scss/theme.scss)) - no separate Dart Sass
  install required.

## Single sources of truth for versions

These files/fields are read by both the GitHub Actions build (`.github/actions/build-site`)
and the local scripts (`scripts/`). Don't hardcode a version anywhere else - change it here:

| What | Where | Read by |
|---|---|---|
| Hugo version | [`.hugo-version`](../.hugo-version) | `build-site` action's "Resolve Hugo version" step; `scripts/setup-dev-env.ps1`; `scripts/dev-server.ps1` |
| Go version | `go` directive in [`go.mod`](../go.mod) | `actions/setup-go` (`go-version-file: go.mod`); `scripts/setup-dev-env.ps1` |
| Node version | `engines.node` in [`package.json`](../package.json) | `scripts/setup-dev-env.ps1` (minimum check; new installs use compatible LTS) |

To bump the Hugo version everywhere (CI + local), edit `.hugo-version` only.

## Local setup (Windows)

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
| Go | Existing version meeting `go.mod`, otherwise current stable official portable archive under `.tools/go/`. |
| Node/npm | Existing version meeting `package.json`, otherwise official portable LTS archive under `.tools/node/`. |
| Hugo | Exact pinned **extended** version; reused if correct, otherwise under `.tools/hugo/<version>/`. |
| Python | Working 64-bit Python >= 3.10 with Tk and venv, otherwise user-scoped Python 3.12 from WinGet. |
| Python tool libraries | Project `.venv`: Pillow, PyYAML and Paramiko, from [`scripts/requirements-dev.txt`](../scripts/requirements-dev.txt). Member portrait crops are selected manually with Tk. |
| Bookshop/npm | `npm ci` when a lockfile exists, otherwise `npm install`. A valid tree with an unchanged setup fingerprint is reused. |
| Smoke checks | Builds to a temporary folder, verifies members/internal links, and runs hero-framing and social preview/card-selection regressions. |

Portable archives are verified using their publisher's SHA-256 manifests.
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

Use `-PythonPath "C:\path\to\python.exe"` to select a particular interpreter,
`-SkipEditor` to omit VS Code/extensions, or `-SkipVerification` to skip smoke
checks. An incomplete or linked `.venv` is rejected rather than deleted;
rename it explicitly before rerunning if it needs replacement. Binary Python
packages are required, avoiding surprise compiler installs.

If execution policy blocks the script, run it with a process-only override:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-dev-env.ps1
```

The summary is also saved to `.tools/setup-report.json` after a real setup.
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

For the Bookshop visual component editor on top of the dev server, use the existing
npm script in another terminal: `npm run bookshop`.

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
.\scripts\run_workbench.bat
# Without opening a browser automatically:
.\.venv\Scripts\python.exe scripts\site_workbench.py --no-browser --port 8879
```

Open <http://127.0.0.1:8879/>. The launcher uses the project `.venv`; the
environment installer already supplies Pillow and PyYAML. No additional
framework, npm build or Python dependencies are required.

- **Pages & posts:** search/filter the content library; create drafts from the
  maintained trip, archived-PDF and course templates; edit Markdown, frontmatter,
  SEO, participant/FAQ cards and course milestones/contacts/flyers. Other
  Markdown pages are editable in source mode, including component-driven pages.
  Placement supports nested folders, leaf bundles, slug/URL overrides, aliases,
  publishing and expiry dates. Unknown frontmatter fields remain available in
  source mode; unchanged source, comments and newline conventions are preserved.
  The media tab connects conversion, existing-image selection, image metadata,
  image/media/gallery/Markdown insertion, and PDF upload/insertion.
- **Site photos:** upload/drop a batch, choose maximum dimensions and quality,
  and export WebP into any named/nested folder under `static/images/`. General
  photos default to `gallery`, not `hero`; conversion does not automatically
  add slideshow entries. No upscaling or cropping. The content studio also
  supports an optional filename stem for a single conversion.
- **Members & portraits:** search the roster, add/edit members (group, name,
  nickname, role, biography and image URLs), or delete a roster entry. Choose an
  existing portrait pair, or position a square crop on an uploaded EXIF-corrected
  original and explicitly convert it. Conversion fills the open member draft;
  **Save member** atomically writes details and assignments to `data/members.yaml`.
  Without an open draft, conversion remains a standalone export. Exported files
  persist even when a draft is discarded. Renaming/deleting members never
  rewrites historical report names or removes images. Empty groups are retained
  so new members can be added to them. Stale roster revisions are rejected;
  copy your draft before Reload if someone edited the file externally.
  The roster checks show matching report references, missing/invalid images,
  unmatched participant/author names and portrait files not assigned to any
  member. Unmatched names can be guests and unassigned files may be used elsewhere;
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

Member-data editing, deployment, environment installation and the separate
Bookshop component editor are not embedded. Existing standalone tools continue
to work. Use Ctrl+C in the launch terminal to stop and clear staged originals.
No automatic commits or publishing occur.

Tests (disposable site fixtures; no real image/config edits):

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s scripts -p 'test_*workbench.py'
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
Other pages randomly choose a homepage slideshow photo at build time.
Random selection only includes source images with width/height >= 1.5, allowing
integer-pixel rounding of 3:2 exports (for example, 1600x1067);
no suitable image produces a warning and uses `data/meta.yaml`'s default image.
Invalid explicit paths fail the build instead of silently selecting a random photo.
Open Graph and Twitter use the same generated image, but a
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

| Workflow | Trigger | Purpose |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | PR opened/updated and merge queue | Validates members and participants, runs deployment/404 regressions, then builds (drafts + future included). Internal links/assets are a required build gate; the additional lychee check is advisory. |
| [`pr-preview.yml`](../.github/workflows/pr-preview.yml) | PR opened/updated | Builds and deploys the preview under `gh-pages/pr-preview/`, then verifies that Pages serves the current PR revision before succeeding. Require `PR Preview / preview` before merging. |
| [`pr-preview-cleanup.yml`](../.github/workflows/pr-preview-cleanup.yml) | PR close, push to `main`, preview/staging job completion, daily, manual | Deletes previews not associated with open PRs targeting `main`. The completion trigger also removes a preview recreated by a job that was still running when its PR closed. Use **Run workflow** to clean old folders after merging this workflow. |
| [`staging-deploy.yml`](../.github/workflows/staging-deploy.yml) | push to `main` | Publishes a shareable "always current `main`" preview to GitHub Pages. This is **not** production. |
| [`deploy-production.yml`](../.github/workflows/deploy-production.yml) | manual (`workflow_dispatch`) only | Always builds `main`, verifies internal links, then purges and replaces the dedicated production site directory over SFTP. Requires typing `deploy`. |

Merging into `main` never touches the production SFTP server - that only happens when
someone manually runs `deploy-production.yml`.

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

1. **Settings > Branches** - protect `main` and require both `CI / Build site` and
   `PR Preview / preview`. Enable **Require branches to be up to date before merging**.
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

The nine legacy documents still linked by the current site are preserved
under `static/FTSK/`, keeping their original production paths. Other old
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
