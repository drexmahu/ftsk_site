# Hosszú cikkek írása (túrabeszámolók, expedíciók, tanfolyamok)

Hogyan írj és bővíts egy hosszú, fotókkal illusztrált cikket a `content/turak/`
vagy a `content/tanfolyamok/` mappában - ez a minta a napról napra bontott
expedíciós beszámolóknál használatos, szemben a régebbi, rövid "lásd a
csatolt PDF-et" típusú bejegyzésekkel, amik szintén ezekben a mappákban
találhatók.

Ez a párja a
[`.github/instructions/content-review.instructions.md`](../.github/instructions/content-review.instructions.md)
fájlnak, ami alapján a Copilot code review ellenőrzi az új/módosított
cikkeket ehhez a struktúrához képest.

## 1. Front matter

Minden cikknek ugyanaz a front matter blokkja kell legyen, mint a `turak`/
`tanfolyamok` mappák többi cikkének:

```yaml
---
date: 2026-08-14T00:00:00Z # az esemény kezdő dátuma, ez alapján rendeződik a lista
title: Kanin expedíció (2026) # "Név (évszám)", ahogy a meglévő bejegyzéseknél is
categories:
  - Expedíció # egy a következők közül: Túra, Kutatás, Expedíció, Kanyoning, Szemétszedés (lásd data/blog-tags.yaml)
author: "" # ki írta - hagyd üresen, ha nem tudod biztosan, ne találgass
participants: # opcionális - lásd a "Résztvevők" szakaszt lentebb
  - Első Név
  - Második Név (Becenév)
thumbImg:
  image_path: /images/turak/<slug>/01-....webp # a lista/kapcsolódó cikkek kártyáin jelenik meg
featuredImg:
  image_path: /images/turak/<slug>/01-....webp # a cikk oldalán a nagy banner képe
seo:
  page_description:
  canonical_url:
  featured_image:
  author_twitter_handle:
  open_graph_type: article
  no_index: false
draft: false
---
```

A `<slug>` a cikk fájlneve `.md` kiterjesztés nélkül (pl. `2026-kanin-expedicio`).
Az `author` mezőt inkább hagyd üresen, mint hogy találgass - egy rosszul
tulajdonított beszámoló rosszabb, mint egy üres mező.

## 2. A szöveg felépítése

A hosszú túrabeszámolók sokkal jobban olvashatók, ha napról napra vannak
tagolva, nem pedig egyetlen összefüggő szövegfalként:

```markdown
<bevezető/nyitó bekezdés, cím nélkül>

## 1. nap – augusztus 14. (péntek)

<az adott nap bekezdése(i)>

## 2. nap – augusztus 15. (szombat)

...

## Zárszó

<záró köszönet/összegző bekezdés>
```

- Naponta egy `##` cím, még akkor is, ha az adott napnak több bekezdése van -
  ne ismételd meg a címet ugyanannak a napnak minden bekezdésénél.
- A napokat sorban, 1-től számozd, és adj mindegyikhez valódi naptári dátumot
  + hét napját, a cikkben ténylegesen megadott dátumból kiindulva (ne találj
  ki olyan dátumot, amit a szöveg nem támaszt alá).
- Mindig zárd `## Zárszó` szakasszal (összegzés).
- Ha egy már publikált cikket szerkesztesz, csak struktúrát adj hozzá
  (címek, bekezdéshatárok, képek) - ne írd át a szerző eredeti mondatait.

## 3. Résztvevők

A résztvevőket a front matterben soroljuk fel, nem a szövegben - egy egyszerű
névlista, soronként egy név, ahogy természetesen olvasható (ha úgy szokás
hivatkozni rá, tüntesd fel a "(Becenév)" toldalékot):

```yaml
participants:
  - Kámvás Linda
  - Kun Imre (Bástya)
  - Ács Réka
```

A cikk oldala ezekből automatikusan kattintható tagkártyákat generál a
szöveg alatt (`layouts/partials/participant-cards.html`), a neveket a
`data/members.yaml` hiteles taglistájához illesztve. Ha van találat, bekerül
a személy valódi fotója/tisztsége/bemutatkozása; ha nincs találat, egyszerű
monogramos csempe jelenik meg - ez elvárt, nem minden résztvevő egyesületi
tag. Ne írj kézzel "Résztvevők" címet/listát a szövegbe - a sablon
automatikusan hozzáadja a címet és a kártyarácsot, amint a `participants:`
mező ki van töltve.

Push előtt futtasd le helyben a `python scripts/verify_members.py` parancsot
(ehhez kell a `pip install PyYAML`), hogy ellenőrizd a `data/members.yaml`-t
és minden cikk `participants:` listáját - ez kiszűri például a duplikált
neveket/becenevek, egy olyan név/becenév, amiben még ott maradt a "(...)" a
megfelelő mező helyett, ismeretlen tagmezőket (elgépeléseket), és üres/duplikált
`participants:` bejegyzéseket. Ugyanez az ellenőrzés fut a CI-ban is minden
pull requestnél.

## 4. Képek

### Fotók konvertálása

Használd a `scripts/site_image_converter/` szkriptet (lásd a saját
`readme.md`-jét) átméretezett, webre optimalizált `.webp` fájlok
előállításához - soha ne commitolj eredeti kamera-/telefonfotókat, azok
messze túl nagyok. Nem interaktív példa:

```powershell
python scripts\site_image_converter\site_image_converter.py `
  --input "C:\path\to\original\photos" `
  --output "static\images\turak\2026-kanin-expedicio" `
  --max-width 1600 --max-height 1600 --quality 82
```

### Mappa- és elnevezési konvenció

Minden cikk kap egy **saját** mappát, hogy a fotók sose keveredjenek a cikkek
között, és a régiek is könnyen megtalálhatók/törölhetők legyenek később:

```
static/images/turak/<cikk-slug>/
  01-rovid-leiro-nev.webp
  02-egy-masik-foto.webp
  03-....webp
```

Nevezd át a konverter kimenetét (ami megtartja az eredeti kamera-fájlnevet)
egy rövid, leíró, számozott névre - `01-csapat-a-ducatonal.webp`, ne
`810814349_1602452671581952_...webp`.

### Fotók beágyazása a cikk szövegébe

Egyszerűen a szabványos Markdown kép szintaxist használd, az illusztrált
bekezdés közelében, egy opcionális idézőjeles **title**-lel, ami a látható
képaláírás lesz:

```markdown
![Rövid alt szöveg a fotóról](/images/turak/2026-kanin-expedicio/01-csapat-a-ducatonal.webp "Ez a felirat jelenik meg a kép alatt")
```

- A szögletes zárójeles `alt` szöveg kötelező (akadálymentesség + akkor
  jelenik meg, ha a kép nem töltődik be) - írd le, mi látható a fotón.
- Az idézőjeles `"title"` az elérési út után opcionális, ez lesz a kép
  alatti felirat. Ha nincs felirat, hagyd el.
- Ne írj kézzel `<img>`/`<figure>` HTML-t - egy Goldmark render hook
  (`layouts/_default/_markup/render-image.html`) automatikusan minden
  Markdown képet egy stílusos, feliratozott figure-be csomagol, ami a
  webhely lightboxában nyílik meg teljes méretben (egy cikk összes képe egy
  galériába kerül csoportosítva).
- Válassz egy fotót (általában a legjellemzőbbet) `thumbImg`-nek és
  `featuredImg`-nek is a front matterben - nem kell megismételni a szövegben
  is, de lehet.

### Sok extra fotó csoportosítása galéria-rácsba

Ha egy beszámolóhoz több fotó tartozik, mint amennyi bekezdéshez rendelhető
(ez gyakori a többnapos expedícióknál), ne fűzz egymás után sok teljes
szélességű `![...]()` képet - ehelyett csoportosítsd a maradék fotókat egy
rácsba a `gallery`/`photo` shortcode-okkal:

```markdown
{{< gallery >}}
{{< photo src="/images/turak/2026-kanin-expedicio/08-....webp" alt="Rövid alt szöveg" caption="Opcionális felirat" >}}
{{< photo src="/images/turak/2026-kanin-expedicio/09-....webp" alt="Rövid alt szöveg" >}}
{{< /gallery >}}
```

- A `src` kötelező (a teljes `/images/turak/<slug>/...` elérési út); az `alt`
  kötelező az akadálymentesség miatt; a `caption` opcionális, és rámutatáskor
  jelenik meg, ugyanúgy, mint az önálló Galéria oldal rácsán.
- Minden `photo` továbbra is teljes méretben nyílik meg a cikk közös
  lightboxában, az egyszerű beágyazott képek mellett (mindkettő
  `.ftsk-article-figure-link`-kel jelenik meg), így az olvasó a cikk összes
  fotóján végig tud lapozni, akár beágyazott, akár rácsos elrendezésben van.
- Ne írd meg kézzel a rács HTML-jét/CSS-ét - a `layouts/shortcodes/gallery.html`
  és a `layouts/shortcodes/photo.html` ugyanazt a `.ftsk-gallery-grid`/
  `.ftsk-gallery-item` stílust használja, mint a
  `component-library/components/global/gallery` (a Galéria oldal).

## 5. Már publikált cikk bővítése később

Mivel a képek saját, cikkenkénti mappában élnek, és egyszerű Markdownnal
vannak beágyazva, egy régi beszámoló bővítése ennyi:

1. Konvertáld és tedd be az új fotókat a meglévő
   `static/images/turak/<slug>/` mappába (folytasd a számozást).
2. Illessz be `![...](...)` sorokat a megfelelő helyre a szövegben, vagy egy
   új napi szakaszt ugyanazzal a `## N. nap – ...` cím mintával.

Egyik esethez sem kell front matter vagy sablon módosítás.
