# Tanfolyam meghirdetése és lezárása

Egy alapfokú tanfolyam három helyen jelenik meg, de **két kapcsoló** vezérli.
A főoldali hirdetés és a menügomb közösen az `active` értékét követi;
a cikk kiemelése ettől függetlenül a `current` mezőt. Így a hirdetés már
lekerülhet, miközben a cikk még "Aktuális tanfolyam"-ként látszik.

Teljes, másolható [tanfolyami hirdetés](BLOGPOST_TEMPLATES.md#tanfolyami-hirdetés)
és [tanfolyami beszámoló](BLOGPOST_TEMPLATES.md#tanfolyami-beszámoló) is elérhető.
A képek, egymás melletti szöveg/fotó és szerzői kártya használatát a
[cikkírási útmutató](CONTENT_GUIDE.md) magyarázza.

| Hol jelenik meg? | Mi vezérli? | Fájl |
| --- | --- | --- |
| Főoldali hirdetés (CTA doboz, "Új tanfolyam") | `active` | [`data/tanfolyam.yaml`](../data/tanfolyam.yaml) |
| Felső menü gombja (pl. "Tanfolyam 2027") | `active` | [`data/tanfolyam.yaml`](../data/tanfolyam.yaml) |
| "Aktuális tanfolyam" kiemelés a `/tanfolyamok/` oldalon + jelvény a cikkben | `current` | `content/tanfolyamok/tanfolyam-<év>.md` |

A cikk `current` mezője tehát **nem** kapcsolja ki a főoldali hirdetést és a
menügombot - azt a `data/tanfolyam.yaml` `active` mezője teszi.

A böngészős **Pages & posts** szerkesztőben a **Course & FAQ** fülön
állíthatók a `current`, `milestones`, `contacts`, `flyer_images` és FAQ mezők;
a sorok hozzáadhatók, sorrendezhetők és törölhetők. A főoldali/menu `active`
kapcsolót ez a szerkesztő nem módosítja. A flyerhez a médiatárból is
választható kép, és a nem mentett tanfolyam valódi Hugo-előnézetben
ellenőrizhető. Részletek: [böngészős szerkesztés](CONTENT_GUIDE.md#böngészős-szerkesztés).

## 1. `data/tanfolyam.yaml` - főoldali hirdetés + menügomb

```yaml
active: true                        # true = hirdetés + menügomb látszik, false = mindkettő eltűnik
url: /tanfolyamok/tanfolyam-2027/   # ide mutat a menügomb
nav_text: "Tanfolyam 2027"          # a menügomb felirata
```

- A menügomb csak akkor jelenik meg, ha a
  [`data/nav.yaml`](../data/nav.yaml)-ban `enable_nav_btn: true` is be van
  állítva (ezt általában nem kell piszkálni).
- A főoldali hirdetés szövege **nem** itt van, hanem a
  [`content/_index.md`](../content/_index.md) `global/cta` blokkjában (lásd 3.
  pont). Az a blokk `data_gated: tanfolyam` sorral kötődik ehhez a fájlhoz -
  ezt a sort ne töröld, különben a hirdetés az `active` értékétől függetlenül
  mindig látszani fog.

## 2. A tanfolyam cikke - `content/tanfolyamok/tanfolyam-<év>.md`

```yaml
---
date: 2026-10-02T00:00:00Z          # a meghirdetés dátuma, ez alapján rendeződik a lista
title: Alapfokú tanfolyam (2027)
current: true                       # true = "Aktuális tanfolyam" kiemelés és jelvény
author: ""                         # csak a valódi szerző; taglistás név esetén kattintható
participants: []                    # ismert résztvevők; kártyák a cikk alatt
faq: []                            # opcionális, lenyitható GYIK a cikk szövege után
article_image_width: 85             # normál Markdown képek szélessége %-ban
thumbImg:
  image_path: /images/hero/ftsk-cave-hero.jpg
featuredImg:
  image_path: /images/hero/ftsk-cave-hero.jpg
flyer_images: []                    # opcionális szórólap-kép(ek), pl. - image_path: /images/tanfolyamok/<slug>/szorolap.webp
milestones:                         # opcionális - az idővonal a cikk tetején
  - label: Jelentkezés
    date:                           # valós dátum: YYYY-MM-DD; üres = még nem ismert
    estimated: false                # true = "(becsült)" felirat egy kitöltött dátum mellett
  - label: Vizsga
    date:                           # üres = "Dátum még nem ismert"
    estimated: false
contacts: []                       # valós kapcsolattartók nélkül nincs "Jelentkezem!" szakasz
seo:
  page_description: ""             # rövid, tényszerű összefoglaló
  featured_image: ""               # opcionális másik helyi fotó a közösségi kártyához
  open_graph_type: article
  no_index: false
draft: true                         # ellenőrzés után false
---
```

- Egyszerre **csak egy** publikált cikkben legyen `current: true`.
  Az első ilyen cikket emeli ki az oldal; további `current: true` cikkek
  nem kerülnek az archívumba sem, ezért a régi cikket állítsd `false`-ra.
- A `current: true` cikk alatt nincs "Korábbi tanfolyamaink" ajánló.
  A többi tanfolyami cikk alatt az ajánló továbbra is megjelenik.
- A `date` a meghirdetés dátuma legyen, ne a jövőbeli tanfolyamkezdés.
  Normál buildben a jövőbeli dátumú vagy `draft: true` cikk nem jelenik meg.
  Az archívum évszűrője a `date` évére szűr, nem a címben szereplő évre.
- Az idővonalon a lépések állapota (kész / folyamatban / következik)
  automatikusan számolódik a mai dátum alapján, a build idején. A dátumokat
  időrendben add meg. A dátum egy szakasz kezdetét jelöli: az elkezdett
  szakasz a következő kezdetéig folyamatban van. A jövőbeli és dátum nélküli
  lépések következők; az utolsó lépés a dátuma után kész. A lépések száma
  és címkéje nem kötött, nem csak négy mérföldkő adható meg.
- Ha nincs `milestones`, `contacts` vagy `flyer_images`, az adott szakasz
  egyszerűen nem jelenik meg - archív tanfolyamnál nyugodtan maradhatnak is.
- A megjelenés sorrendje: cím és szerző, mérföldkövek, fejlécfotó,
  szórólapok, cikk, GYIK, résztvevők, kapcsolattartók. Ezeket ne ismételd meg
  kézzel a törzsszövegben.
- A GYIK a `faq` lista `question` és `answer` mezőiből készül. A válaszok
  Markdownnal formázhatók; a [cikkírási útmutató](CONTENT_GUIDE.md#gyik-lenyitható-kérdések-és-válaszok)
  teljes példát ad. Csak egyeztetett jelentkezési adatokat és feltételeket írj bele.
- Saját fotóhoz `thumbImg` és `featuredImg` állítható. A tanfolyam
  közösségi előnézete alapértelmezésben a `featuredImg.image_path` fotót
  használja; a `seo.featured_image` mezőben más helyi fotó is megadható.
  Ez nem változtatja meg a fejlécet vagy a listaképet.

## 3. Főoldali hirdetés szövege - `content/_index.md`

```yaml
   -
      _bookshop_name: global/cta
      data_gated: tanfolyam          # ez köti a data/tanfolyam.yaml "active" mezőjéhez
      eyebrow: Új tanfolyam
      title: "Jelentkezz a "
      title_suffix: "2027-es alapfokú barlangász tanfolyamunkra!"
      description: >-
         ...
      link:
         text: Bővebben
         url: /tanfolyamok/tanfolyam-2027/
      note: ...
```

Új tanfolyamnál az évszámot, a leírást és a `link.url`-t kell frissíteni.

## 4. Teendők - tanfolyam megnyitása

1. Hozd létre a `content/tanfolyamok/tanfolyam-<év>.md` fájlt (a 2. pont
  mintájára), `current: true` és `draft: true` értékkel.
2. Töltsd ki a szöveget, dátumokat, valódi kapcsolattartókat és képeket;
  cseréld ki vagy töröld a helyőrzőket.
3. Az előző tanfolyam cikkében állítsd `current: false`-ra (ha még nem volt).
4. Teszteld helyben a draftot, majd állítsd `draft: false`-ra. Sima `hugo`
  buildben is ellenőrizd, hogy a cikk elérhető a megadott URL-en.
5. `data/tanfolyam.yaml`: `active: true`, és frissítsd az `url`-t és a
   `nav_text`-et az új tanfolyamra.
6. `content/_index.md`: frissítsd a `global/cta` blokk szövegét és linkjét.
7. Ellenőrizd, hogy a főoldali hirdetés, menügomb és tanfolyami kiemelés
  ugyanarra a megfelelő cikkre vezet, és csak egy aktuális tanfolyam van.

## 5. Teendők - tanfolyam lezárása

A lezárás két lépésben is történhet, igény szerint:

- **Jelentkezés vége** (a tanfolyam még fut, de már nem toborzunk):
  `data/tanfolyam.yaml` → `active: false`. Eltűnik a főoldali hirdetés és a
  menügomb, a cikk továbbra is "Aktuális tanfolyam".
- **Tanfolyam vége / archiválás**: a cikkben `current: false`. A tanfolyam
  átkerül a "Korábbi tanfolyamaink" közé.
  - Ilyenkor érdemes a cikk szövegét múlt időbe tenni / beszámolóvá bővíteni
    (lásd [`CONTENT_GUIDE.md`](CONTENT_GUIDE.md)), a `contacts` blokkot pedig
    törölni, hogy az archív oldalon ne legyen "Jelentkezem!" szakasz.

A meglévő cikket bővítsd; ne hozz létre ugyanahhoz a tanfolyamhoz új
beszámoló-fájlt. A szerző eredeti történetét ne írd át; a toborzó szöveg
lezárását vagy a tényszerű beszámoló hozzáadását kezeld külön. A meglévő
`date` maradjon meg, a résztvevőket a `participants` mezőben frissítsd.

A `content/_index.md` hirdetésszövegét lezáráskor nem kell törölni - az
`active: false` elrejti, és a következő tanfolyamnál csak át kell írni.
