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
| Smoke checks | Builds to a temporary folder, verifies members/internal links, and runs hero-framing regressions. |

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
