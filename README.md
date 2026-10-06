# FTSK Barlangkutató Szakosztály - website

Az [ftsk.hu](https://www.ftsk.hu) weboldal forráskódja: egy [Hugo](https://gohugo.io/)
statikus webhely natív, újrafelhasználható Hugo-részsablonokkal
(`layouts/partials/sections/`). A build nem igényel Bookshopot, Go-t vagy
telepített npm-csomagokat.

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

Windows 10/11-en kattints duplán a [setup-dev-env.bat](setup-dev-env.bat)
fájlra a főmappában. Telepít vagy javít, és a végén nyitva hagyja az ablakot,
hogy a hibák olvashatók legyenek. Utána indítsd a
[site_editor.bat](site_editor.bat) fájlt dupla kattintással a főmappában.

```powershell
./scripts/setup-dev-env.ps1   # egyszeri: rögzített Hugo, Node és Python-eszközök
./scripts/dev-server.ps1      # hugo server a http://localhost:1313/ címen
./site_editor.bat             # cikkek, frontmatter, képek, portrék, hero, előnézetek, ellenőrzések egy böngészőben
```

Az egységes **Site Workbench** a [http://127.0.0.1:8879/](http://127.0.0.1:8879/)
címen nyílik meg. A meglévő eszközöket és a cikkek/frontmatter szerkesztését
fogja össze; nem commitol és nem publikál automatikusan.
Részletek: [böngészős munkafelület](docs/TECHNICAL_ENVIRONMENT.md#site-workbench).

A `npm start` és `npm run dev` ugyanezt a Hugo fejlesztői szervert indítja.
A JavaScript-ellenőrzések Node-ot használnak, külső npm-csomagok nélkül.
Futtatásuk: `npm test`.

A `public/`, `resources/_gen/`, `node_modules/` és `__pycache__/` mappák
generált kimenetek vagy gyorsítótárak, nem forrásfájlok. Leállított helyi
szerverek mellett törölhetők; a következő build újra létrehozza a szükségeseket.
A `.venv/` a helyi Python-eszközök környezete, ezt normál takarításkor őrizd meg.

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
