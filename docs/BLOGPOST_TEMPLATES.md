# Másolható cikkminták

Válaszd ki a megfelelő típust, majd másold a teljes kódblokkot egy új
Markdown fájlba a megadott mappában. A minták nem publikált cikkek;
mindegyik `draft: true` értékkel indul.

A böngészős munkafelületen (**Pages & posts → New**) ugyanezek a fenntartott
kódblokkok töltődnek be, nincs külön másolatuk az alkalmazásban.
Választható célmappa és leaf bundle (`slug/index.md`); a PDF-es minta
`legacy-` fájlnevet használ, és nem bundle-ként hozható létre.
A forrás, metaadatok, képek és még nem mentett Hugo-előnézet lépéseit a
[böngészős szerkesztési útmutató](CONTENT_GUIDE.md#böngészős-szerkesztés) írja le.

| Cikktípus | Új fájl helye | Minta |
| --- | --- | --- |
| Túra, kutatás, expedíció, kanyoning, szemétszedés | `content/turak/<slug>.md` | [Szöveges túrabeszámoló](#szöveges-túrabeszámoló) |
| Régi beszámoló, amely PDF-ben olvasható | `content/turak/legacy-<slug>.md` | [PDF-es túrabeszámoló](#pdf-es-túrabeszámoló) |
| Új tanfolyam meghirdetése | `content/tanfolyamok/tanfolyam-<év>.md` | [Tanfolyami hirdetés](#tanfolyami-hirdetés) |
| Lezárt tanfolyam bemutatása | `content/tanfolyamok/tanfolyam-<év>.md` | [Tanfolyami beszámoló](#tanfolyami-beszámoló) |

## Másolás után

1. Cseréld ki az összes `KITÖLTENDŐ` szöveget, vagy töröld a nem szükséges blokkot.
2. Írd át a `date` értékét. A `2000-01-01` kizárólag helyőrző, nem eseményadat.
3. Töltsd ki az `author` és `participants` mezőket csak hiteles adatokkal.
   Ha nem ismered őket, maradjon `author: ""` és `participants: []`.
4. Cseréld a mintafotót saját képekre. A működő mintafotó nem az adott túrát
   vagy tanfolyamot ábrázolja. A mintában többször szerepel, hogy különböző
   képelrendezések legyenek kipróbálhatók; nem kell mindet megtartani.
5. Töltsd ki a `seo.page_description` rövid összefoglalóját.
6. Ellenőrizd helyben `hugo --buildDrafts --buildFuture` paranccsal, és nézd
   meg a cikket asztali és mobilnézetben. Publikálás előtt állítsd
   `draft: false`-ra, és futtass sima `hugo` buildet is.

Az előnézet indításához a projekt gyökérmappájában futtasd:

```powershell
hugo server --buildDrafts --buildFuture
```

Nyisd meg a parancs által kiírt helyi URL-t, majd a `/turak/<slug>/` vagy
`/tanfolyamok/<slug>/` oldalt. Ha egy másik szerver már használja a portot,
adj meg másikat, például `--port 1329`.

A fájlnév kiterjesztés nélküli része a **slug**: például
`2026-kanin-expedicio.md` esetén `2026-kanin-expedicio`. A képeket a
`static/images/<szekció>/<slug>/` mappába tedd, de a cikkben az útvonal
`/images/...` kezdetű legyen; a `static/` részt ne írd bele.

Az önálló képek mérete a szövegoszlophoz viszonyított százalék. A `media`
blokkban az `image-width` a kép oszlopának szélessége, a `font-size` pedig
a törzsszöveg szorzója. 768 px alatt a szöveg és fotó egymás alá kerül.
A részletes paraméterek a [képek útmutatójában](CONTENT_GUIDE.md#4-képek)
találhatók. A cím és a szerző a front matterből megjelenik; a törzsszövegben
ne ismételd meg őket külön főcímként. A résztvevői kártyákat is a sablon adja.

## Szöveges túrabeszámoló

Egy- és többnapos túrához is használható. A `categories` listájában a
megfelelő típust add meg: `Túra`, `Kutatás`, `Expedíció`, `Kanyoning` vagy
`Szemétszedés`. A többnapos expedíció napjait ismételd a valódi dátumokkal;
egy rövid túrát elég témák szerint tagolni.

```markdown
---
date: 2000-01-01T00:00:00Z # KITÖLTENDŐ: a túra dátuma; jövőbeli dátummal nem jelenik meg a normál buildben
title: "KITÖLTENDŐ: Túra neve (év)"
categories:
  - Túra
author: ""
participants: []
article_image_width: 85
thumbImg:
  image_path: /images/hero/ftsk-hero-cave-4.webp
featuredImg:
  image_path: /images/hero/ftsk-hero-cave-4.webp
seo:
  page_description: ""
  featured_image: "" # opcionális másik helyi fotó a közösségi kártyához
  open_graph_type: article
  no_index: false
draft: true
---

KITÖLTENDŐ: Rövid bevezető arról, hol jártunk, mi volt a túra célja,
és miért érdemes elolvasni a beszámolót.

## 1. nap - KITÖLTENDŐ: dátum és a hét napja

KITÖLTENDŐ: A nap története, az indulástól a fontosabb élményekig.

![KITÖLTENDŐ: mi látható a fotón](/images/hero/ftsk-hero-cave-4.webp "KITÖLTENDŐ: képaláírás")

{{< media src="/images/hero/ftsk-hero-cave-4.webp" alt="KITÖLTENDŐ: a fotó leírása" caption="KITÖLTENDŐ: képaláírás" image-side="right" image-width="40" font-size="1" >}}
### KITÖLTENDŐ: egy kiemelt esemény

KITÖLTENDŐ: A képhez tartozó történet. **Kiemelések**, listák és
[belső linkek](/turak/) is használhatók.
{{< /media >}}

## KITÖLTENDŐ: további élmények vagy eredmények

KITÖLTENDŐ: A következő szakasz szövege. Többnapos túránál ez lehet a
következő napi fejezet, egyébként egy témához tartozó rész.

{{< image src="/images/hero/ftsk-hero-cave-4.webp" alt="KITÖLTENDŐ: a fotó leírása" caption="KITÖLTENDŐ: képaláírás" width="60" mobile-width="100" align="center" >}}

## Zárszó

KITÖLTENDŐ: Rövid összegzés, eredmények és köszönetnyilvánítás.

## További képek

{{< gallery >}}
{{< photo src="/images/hero/ftsk-hero-cave-4.webp" alt="KITÖLTENDŐ: első fotó leírása" caption="KITÖLTENDŐ: felirat" >}}
{{< photo src="/images/hero/ftsk-hero-cave-4.webp" alt="KITÖLTENDŐ: második fotó leírása" >}}
{{< /gallery >}}
```

A `További képek` részt és a galériát töröld, ha nincs hozzá valódi fotó.
A fejléc nagy képe (`featuredImg.image_path`) lesz a közösségi előnézet
alapfotója is; a `seo.featured_image` mezőben más helyi fotó adható meg.
Erre automatikusan kerül a cím és az FTSK-logó.

## PDF-es túrabeszámoló

A `legacy-` fájlnév miatt a kártyán archív jelvény jelenik meg, és nem
kerül a szöveges beszámolók „Legújabb” kiemelésébe. A PDF-et tedd a
`static/pdfs/turak/<slug>/` mappába, vagy használd a meglévő lapos
`static/pdfs/turak/<slug>.pdf` elrendezést; az útvonalat pontosan add meg.

```markdown
---
date: 2000-01-01T00:00:00Z # KITÖLTENDŐ: az eredeti túra ismert dátuma
title: "KITÖLTENDŐ: Régi túra neve (év)"
categories:
  - Túra
author: ""
participants: []
thumbImg:
  image_path: /images/hero/ftsk-hero-cave-4.webp
featuredImg:
  image_path: /images/hero/ftsk-hero-cave-4.webp
seo:
  page_description: ""
  featured_image: "" # opcionális másik helyi fotó a közösségi kártyához
  open_graph_type: article
  no_index: false
draft: true
---

KITÖLTENDŐ: Rövid, hiteles bevezető a túráról és az eredeti beszámolóról.
Ismeretlen szerzőt, résztvevőt vagy pontos dátumot ne találj ki.

{{< pdf src="/pdfs/turak/KITÖLTENDŐ.pdf" title="KITÖLTENDŐ: a teljes beszámoló címe" >}}
```

A PDF útvonalát a feltöltött fájlra cseréld; a mintában nincs kész PDF.
A beágyazott nézet alatt automatikusan megjelenik a letöltési gomb.
Ha csak az év ismert, a nap pontosságú technikai dátum kezelését egyeztesd
a szerkesztővel, és ne tüntesd fel hiteles eseménynapként.

## Tanfolyami hirdetés

Ez a tanfolyam saját cikke, nem a főoldali hirdetés konfigurációja.
Utóbbi bekapcsolásához kövesd a
[tanfolyam meghirdetésének lépéseit](TANFOLYAM_GUIDE.md#4-teendők---tanfolyam-megnyitása).
Egyszerre csak egy publikált tanfolyamnál legyen `current: true`.

```markdown
---
date: 2000-01-01T00:00:00Z # KITÖLTENDŐ: a meghirdetés dátuma, nem a tanfolyam jövőbeli kezdete
title: "KITÖLTENDŐ: Alapfokú tanfolyam (év)"
current: true
author: ""
participants: []
article_image_width: 85
thumbImg:
  image_path: /images/hero/ftsk-hero-cave-4.webp
featuredImg:
  image_path: /images/hero/ftsk-hero-cave-4.webp
flyer_images: []
milestones:
  - label: Jelentkezés kezdete
    date:
    estimated: false
  - label: Nyílt próbatúra
    date:
    estimated: false
  - label: Tanfolyam kezdése
    date:
    estimated: false
  - label: Vizsga
    date:
    estimated: false
contacts: []
faq:
  - question: "Ki jelentkezhet a tanfolyamra?"
    answer: |-
      KITÖLTENDŐ: A jóváhagyott jelentkezési feltételek.
  - question: "Milyen felszerelést kell hozni?"
    answer: |-
      KITÖLTENDŐ: Mit biztosít az egyesület, és mit kell hozni?
seo:
  page_description: ""
  featured_image: "" # opcionális másik helyi fotó a közösségi kártyához
  open_graph_type: article
  no_index: false
draft: true
---

KITÖLTENDŐ: Rövid bevezető arról, kiknek szól a tanfolyam, és miért
érdemes jelentkezni.

## Mit tanulunk?

KITÖLTENDŐ: A tényleges tematika röviden, például felsorolásként.

{{< media src="/images/hero/ftsk-hero-cave-4.webp" alt="KITÖLTENDŐ: a kép leírása" caption="KITÖLTENDŐ: képaláírás" image-side="left" image-width="40" font-size="1" >}}
### Gyakorlati alkalmak

KITÖLTENDŐ: A tervezett foglalkozások és túrák hiteles leírása.
Ne adj meg nem egyeztetett helyszínt vagy időpontot.
{{< /media >}}

## Jelentkezési feltételek

KITÖLTENDŐ: A jóváhagyott feltételek, díj és jelentkezési határidő.
A még ismeretlen részleteket jelezd ismeretlenként, ne találj ki adatokat.

## Felszerelés

KITÖLTENDŐ: Mi szükséges, mit biztosít az egyesület, és mit kell hozni?
```

A dátum nélküli mérföldkövek „Dátum még nem ismert” felirattal jelennek
meg. A `date` helyére `YYYY-MM-DD` formátumú valós dátumot írj; becslésnél
legyen `estimated: true`. A lépések száma és címkéje szabadon változtatható.

A `contacts: []` helyére csak egyeztetett kapcsolattartót adj meg:

```yaml
contacts:
  - name: "KITÖLTENDŐ: a kapcsolattartó valódi neve"
    role: "KITÖLTENDŐ: feladata"
    email: "" # csak egyeztetett címet írj ide
    phone: "" # opcionális, csak egyeztetett telefonszám
```

Üres lista esetén nincs automatikus „Jelentkezem!” szakasz. A névhez
tartozó elérhetőségeket a sablon közvetlen email- és telefonlinkként adja.
A kapcsolattartó nem feltétlenül azonos az `author` szerzővel.

A `faq` kérdései a cikk szövege után lenyitható GYIK-ként jelennek meg.
Az `answer` Markdown szöveg lehet; a mintaválaszokat cseréld jóváhagyott
információkra, vagy töröld a kérdést. Üres `faq: []` esetén nincs GYIK.
A funkció [túrabeszámolókban is használható](CONTENT_GUIDE.md#gyik-lenyitható-kérdések-és-válaszok).

Kész szórólap esetén a `flyer_images: []` helyére kerülhet:

```yaml
flyer_images:
  - image_path: /images/tanfolyamok/KITÖLTENDŐ/szorolap.webp
```

A szórólapok a fejléc nagy képe után jelennek meg. A tanfolyam közösségi
előnézetéhez a cikk `featuredImg.image_path` fotóját használja a rendszer,
vagy a külön megadott `seo.featured_image` fotót; nem a szórólapot.

## Tanfolyami beszámoló

Meglévő tanfolyam lezárásakor az eredeti cikket bővítsd, ne hozz létre
azonos évhez második cikket. Az ismert szerzőt, dátumot, résztvevőket és
szöveget őrizd meg. Újonnan feldolgozott régi tanfolyamhoz ez a minta használható.

```markdown
---
date: 2000-01-01T00:00:00Z # KITÖLTENDŐ: meglévő cikknél őrizd meg; új archív cikknél egyeztetett dátum
title: "KITÖLTENDŐ: Alapfokú tanfolyam (év)"
current: false
author: ""
participants: []
article_image_width: 85
thumbImg:
  image_path: /images/hero/ftsk-hero-cave-4.webp
featuredImg:
  image_path: /images/hero/ftsk-hero-cave-4.webp
seo:
  page_description: ""
  featured_image: "" # opcionális másik helyi fotó a közösségi kártyához
  open_graph_type: article
  no_index: false
draft: true
---

KITÖLTENDŐ: Rövid összefoglaló a lezárt tanfolyamról.

## A tanfolyam menete

KITÖLTENDŐ: Az elméleti és gyakorlati foglalkozások története.

{{< media src="/images/hero/ftsk-hero-cave-4.webp" alt="KITÖLTENDŐ: a gyakorlat fotójának leírása" caption="KITÖLTENDŐ: képaláírás" image-side="right" image-width="45" font-size="1" >}}
### Egy emlékezetes gyakorlat

KITÖLTENDŐ: A képhez kapcsolódó élmények, megszerzett tapasztalatok.
{{< /media >}}

## Eredmények

KITÖLTENDŐ: A tanfolyam eredményei, csak ellenőrzött adatokkal.

{{< image src="/images/hero/ftsk-hero-cave-4.webp" alt="KITÖLTENDŐ: a fotó leírása" caption="KITÖLTENDŐ: képaláírás" width="65" mobile-width="100" align="center" >}}

## Zárszó

KITÖLTENDŐ: Összegzés és köszönet az oktatóknak, segítőknek.

## További képek

{{< gallery >}}
{{< photo src="/images/hero/ftsk-hero-cave-4.webp" alt="KITÖLTENDŐ: a fotó leírása" caption="KITÖLTENDŐ: felirat" >}}
{{< /gallery >}}
```

Lezáráskor a `contacts` mezőt töröld vagy állítsd `[]`-ra, hogy ne legyen
jelentkezési blokk. A `milestones` és `flyer_images` megőrizhető történeti
adatként, de törölhető, ha már nem szükséges. A `current: false` önmagában
nem rejti el a főoldali hirdetést vagy menügombot: ehhez a
`data/tanfolyam.yaml` fájlban `active: false` szükséges.

## Szerzők és résztvevők kitöltése

Az alábbi blokk **csak formai példa**; a nevek helyére az adott cikk valódi
adatai kerüljenek. A szerző neve kattintható, ha a taglistában szerepel.
A résztvevők kártyái automatikusan a cikk szövege alá kerülnek.

```yaml
author: "KITÖLTENDŐ: a szerző teljes neve"
participants:
  - "KITÖLTENDŐ: első résztvevő"
  - "KITÖLTENDŐ: második résztvevő (Becenév)"
```

További részletek: [cikkírás és képek](CONTENT_GUIDE.md),
[tanfolyami kapcsolók és lezárás](TANFOLYAM_GUIDE.md).