# FTSK Barlangkutató Szakosztály - website

Az [ftsk.hu](https://www.ftsk.hu) weboldal forráskódja: egy [Hugo](https://gohugo.io/)
statikus webhely, ami a [Bookshop](https://github.com/cloudcannon/bookshop)
komponenskönyvtár motort használja (`component-library/`) az újrafelhasználható
oldalrészekhez.

## Kezdőknek: nulláról magabiztos szerkesztőig

**[Teljes, közérthető tanulókönyv: ZERO_TO_HERO](docs/ZERO_TO_HERO.md)** —
előzetes technikai tudás nélkül is követhető, fokozatosan haladó útmutató.
Elmagyarázza a weboldal felépítését, a böngészős szerkesztést, a Markdown és
YAML alapjait, a Git/GitHub használatát, a **rebase-alapú** PR- és review-folyamatot,
valamint a build, CI/CD, PR preview, staging és kézi éles publikálás közötti
különbségeket. Mermaid-ábrákkal, példákkal, gyakorló feladattal és
ellenőrzőlistákkal segít az önálló munkavégzésben.

## Fejlesztés

A teljes beállítási útmutatóért (szükséges eszközök, rögzített verziók,
paraméterek) lásd a [docs/TECHNICAL_ENVIRONMENT.md](docs/TECHNICAL_ENVIRONMENT.md)
fájlt. Gyors indítás Windows alatt:

```powershell
./scripts/setup-dev-env.ps1   # egyszeri: telepíti a rögzített Hugo verziót, ellenőrzi a Go/Node-ot, npm install
./scripts/dev-server.ps1      # hugo server a http://localhost:1313/ címen
./scripts/run_workbench.bat   # cikkek, frontmatter, képek, portrék, hero, előnézetek, ellenőrzések egy böngészőben
```

Az egységes **Site Workbench** a [http://127.0.0.1:8879/](http://127.0.0.1:8879/)
címen nyílik meg. A meglévő eszközöket és a cikkek/frontmatter szerkesztését
fogja össze; nem commitol és nem publikál automatikusan.
Részletek: [böngészős munkafelület](docs/TECHNICAL_ENVIRONMENT.md#site-workbench).

Az opcionális Bookshop élő komponens-böngészőhöz a dev szerver mellett:
`npm run bookshop` (alapértelmezetten [http://localhost:30775/](http://localhost:30775/)).

## Tartalom írása

Ha cikket (túrabeszámolót, expedíciós naplót, tanfolyami leírást) írsz vagy
szerkesztesz, lásd a **[docs/CONTENT_GUIDE.md](docs/CONTENT_GUIDE.md)** útmutatót
a napról napra bontott struktúráról, a résztvevők felsorolásáról, valamint a
fotók konvertálásáról/beágyazásáról és a galéria-rács használatáról.

## CI/CD

A build ellenőrzés, a PR előnézeti oldalak, a staging deploy és a kézi éles
(SFTP, teljes célmappa-cserével) deploy mind a [`.github/workflows/`](.github/workflows/) mappában
találhatók - lásd a [docs/TECHNICAL_ENVIRONMENT.md](docs/TECHNICAL_ENVIRONMENT.md)
fájlt a pipeline áttekintéséhez és a szükséges repository beállításokhoz.
