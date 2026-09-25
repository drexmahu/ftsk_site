# FTSK Barlangkutató Szakosztály - website

Source for the [ftsk.hu](https://www.ftsk.hu) site: a [Hugo](https://gohugo.io/) static
site using the [Bookshop](https://github.com/cloudcannon/bookshop) component library
engine (`component-library/`) for reusable page sections.

## Develop

See [docs/TECHNICAL_ENVIRONMENT.md](docs/TECHNICAL_ENVIRONMENT.md) for full setup
details (required tools, pinned versions, parameters). Quick start on Windows:

```powershell
./scripts/setup-dev-env.ps1   # one-time: installs the pinned Hugo, checks Go/Node, npm install
./scripts/dev-server.ps1      # hugo server at http://localhost:1313/
```

For the optional Bookshop live component browser alongside the dev server:
`npm run bookshop` (defaults to [http://localhost:30775/](http://localhost:30775/)).

## CI/CD

Build validation, PR preview sites, a staging deploy, and manual production
(FTP) deploy all live in [`.github/workflows/`](.github/workflows/) - see
[docs/TECHNICAL_ENVIRONMENT.md](docs/TECHNICAL_ENVIRONMENT.md) for the pipeline
overview and required repository configuration.
