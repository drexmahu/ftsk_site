# Tanfolyam meghirdetése és lezárása

Egy alapfokú tanfolyam három, egymástól **független** helyen jelenik meg az
oldalon. Mindegyiknek saját kapcsolója van, így külön-külön lehet őket be- és
kikapcsolni (pl. a főoldali hirdetés már lekerülhet, miközben a tanfolyam
oldala még "Aktuális tanfolyam"-ként látszik).

| Hol jelenik meg? | Mi vezérli? | Fájl |
| --- | --- | --- |
| Főoldali hirdetés (CTA doboz, "Új tanfolyam") | `active` | [`data/tanfolyam.yaml`](../data/tanfolyam.yaml) |
| Felső menü gombja (pl. "Tanfolyam 2027") | `active` | [`data/tanfolyam.yaml`](../data/tanfolyam.yaml) |
| "Aktuális tanfolyam" kiemelés a `/tanfolyamok/` oldalon + jelvény a cikkben | `current` | `content/tanfolyamok/tanfolyam-<év>.md` |

A cikk `current` mezője tehát **nem** kapcsolja ki a főoldali hirdetést és a
menügombot - azt a `data/tanfolyam.yaml` `active` mezője teszi.

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
thumbImg:
  image_path: /images/hero/ftsk-cave-hero.jpg
featuredImg:
  image_path: /images/hero/ftsk-cave-hero.jpg
flyer_images: []                    # opcionális szórólap-kép(ek), pl. - image_path: /images/tanfolyamok/<slug>/szorolap.webp
milestones:                         # opcionális - az idővonal a cikk tetején
  - label: Jelentkezés
    date: 2026-10-22
    estimated: true                 # true = "(becsült)" felirat a dátum mellett
  - label: Vizsga
    date:                           # üres = "Dátum még nem ismert"
    estimated: true
contacts:                           # opcionális - "Jelentkezem!" szakasz
  - name: Gyovai Tamás
    role: elnök
    email: gyovai94@gmail.com
    # phone: "+36 ..."
seo:
  page_description: ...
  open_graph_type: article
  no_index: false
draft: false
---
```

- Egyszerre **csak egy** cikkben legyen `current: true` - a `/tanfolyamok/`
  oldal az első ilyet emeli ki, a többi az archívumba kerül.
- Az idővonalon a lépések állapota (kész / folyamatban / következik)
  automatikusan számolódik a mai dátum alapján, a build idején. A dátumokat
  időrendben add meg.
- Ha nincs `milestones`, `contacts` vagy `flyer_images`, az adott szakasz
  egyszerűen nem jelenik meg - archív tanfolyamnál nyugodtan maradhatnak is.

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
   mintájára), `current: true` értékkel.
2. Az előző tanfolyam cikkében állítsd `current: false`-ra (ha még nem volt).
3. `data/tanfolyam.yaml`: `active: true`, és frissítsd az `url`-t és a
   `nav_text`-et az új tanfolyamra.
4. `content/_index.md`: frissítsd a `global/cta` blokk szövegét és linkjét.
5. Opcionális: `flyer_images`, saját `thumbImg`/`featuredImg` a
   `static/images/tanfolyamok/<slug>/` mappából.

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

A `content/_index.md` hirdetésszövegét lezáráskor nem kell törölni - az
`active: false` elrejti, és a következő tanfolyamnál csak át kell írni.
