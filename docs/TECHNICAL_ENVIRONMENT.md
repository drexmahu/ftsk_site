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
| Node version | `engines.node` in [`package.json`](../package.json) | `scripts/setup-dev-env.ps1` (advisory check; CI doesn't need Node) |

To bump the Hugo version everywhere (CI + local), edit `.hugo-version` only.

## Local setup (Windows)

```powershell
./scripts/setup-dev-env.ps1
```

Checks Go and Node against the versions above (prints instructions if missing/outdated -
it will not silently install Go/Node itself, since those installers normally need admin
rights), downloads the exact pinned Hugo (extended) release into `.tools\hugo\<version>\`
so your local build always matches CI regardless of what's globally installed, and runs
`npm install`.

Add `-PersistPath` to also add the pinned Hugo folder to your permanent user PATH;
otherwise it's only on PATH for that terminal session (`scripts/dev-server.ps1` finds it
either way).

## Local build & hosting

```powershell
./scripts/dev-server.ps1              # hugo server, drafts + future content, http://localhost:1313/
./scripts/dev-server.ps1 -BuildOnly   # one-shot build to ./public/ (minified)
./scripts/dev-server.ps1 -NoDrafts -NoFuture   # production-like content set
./scripts/dev-server.ps1 -Port 8080 -BaseUrl "http://localhost:8080/"
```

For the Bookshop visual component editor on top of the dev server, use the existing
npm script in another terminal: `npm run bookshop`.

## CI/CD pipeline (`.github/workflows/`)

| Workflow | Trigger | Purpose |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | PR opened/updated and merge queue | Validates `data/members.yaml` and every article's `participants:` front matter (`scripts/verify_members.py`), then builds the site (drafts + future included); require `CI / Build site` so a failed check/build blocks merging. Also uploads the build as an artifact and runs a non-blocking broken-link check. |
| [`pr-preview.yml`](../.github/workflows/pr-preview.yml) | PR opened/updated | Builds and deploys the preview under `gh-pages/pr-preview/`, then verifies that Pages serves the current PR revision before succeeding. Require `PR Preview / preview` before merging. |
| [`pr-preview-cleanup.yml`](../.github/workflows/pr-preview-cleanup.yml) | PR close, push to `main`, daily, manual | Reconciles `gh-pages/pr-preview/` against open PRs targeting `main` and deletes orphaned preview folders. Use **Run workflow** to clean existing stale folders immediately after this workflow is merged. |
| [`staging-deploy.yml`](../.github/workflows/staging-deploy.yml) | push to `main` | Publishes a shareable "always current `main`" preview to GitHub Pages. This is **not** production. |
| [`deploy-production.yml`](../.github/workflows/deploy-production.yml) | manual (`workflow_dispatch`) only | Builds and publishes to the real production server over FTP. Requires typing `deploy` into the confirmation input. |

Merging into `main` never touches the production FTP server - that only happens when
someone manually runs `deploy-production.yml`.

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
   reviewers there if you want a manual approval gate before every FTP deploy, and add
   the FTP secrets below scoped to this environment.

### Secrets (Settings > Secrets and variables > Actions > Secrets)

Required, scoped to the `production` environment, used only by `deploy-production.yml`:

| Secret | Description |
|---|---|
| `FTP_SERVER` | FTP host, e.g. `ftp.ftsk.hu` |
| `FTP_USERNAME` | FTP account username |
| `FTP_PASSWORD` | FTP account password |
| `FTP_SERVER_DIR` | *(optional)* remote directory to upload to, must end with `/`. Defaults to `./` |

### Variables (Settings > Secrets and variables > Actions > Variables)

All optional - each has a working fallback baked into the workflow if unset:

| Variable | Default if unset | Used by |
|---|---|---|
| `HUGO_VERSION` | value in `.hugo-version` | all workflows |
| `STAGING_BASE_URL` | `https://<owner>.github.io/<repo>/` | `ci.yml`, `staging-deploy.yml` |
| `PRODUCTION_BASE_URL` | `https://www.ftsk.hu/` | `deploy-production.yml` |
| `FTP_PORT` | `21` | `deploy-production.yml` |
| `FTP_PROTOCOL` | `ftps` | `deploy-production.yml` |

### Running a production deploy

Actions tab > "Deploy to Production (FTP)" > Run workflow > type `deploy` into the
confirmation field. Tick "Dry run" first to preview what would change without
uploading anything.
