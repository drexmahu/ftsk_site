# Cikkírás: túrabeszámolók és tanfolyamok

Hogyan írj és bővíts egy hosszú, fotókkal illusztrált cikket a `content/turak/`
vagy a `content/tanfolyamok/` mappában - ez a minta a napról napra bontott
expedíciós beszámolóknál használatos, szemben a régebbi, rövid "lásd a
csatolt PDF-et" típusú bejegyzésekkel, amik szintén ezekben a mappákban
találhatók.

Új cikkhez kezdd a [másolható cikkmintákkal](BLOGPOST_TEMPLATES.md):
szöveges túrabeszámoló, PDF-es archív beszámoló, tanfolyami hirdetés és
tanfolyami beszámoló is található köztük. Ez az útmutató a mezőket és
képelrendezéseket magyarázza; a tanfolyam meghirdetésének kapcsolóit a
[tanfolyami útmutató](TANFOLYAM_GUIDE.md) írja le.

Ez a párja a
[`.github/instructions/content-review.instructions.md`](../.github/instructions/content-review.instructions.md)
fájlnak, ami alapján a Copilot code review ellenőrzi az új/módosított
cikkeket ehhez a struktúrához képest.

## Böngészős szerkesztés

Indítsd el a `scripts/run_workbench.bat` alkalmazást, majd nyisd meg a
**Pages & posts** részt a <http://127.0.0.1:8879/#content> címen.

- A kereshető könyvtárból nyiss meg egy cikket, vagy a **New** gombbal válassz
  egy fenntartott mintát. Az új oldal mentésig nem kerül a lemezre.
  A **Hide page library / Show page library** gombbal a könyvtár elrejthető,
  így a szerkesztő a teljes munkaterületet használja. A böngésző megjegyzi
  ezt a választást; rejtett könyvtár mellett a **New page** gomb is elérhető.
- A **Write**, **Page details**, **SEO & sharing**, **Course & FAQ** és **Placement** fülek
  kezelik a történetet, képeket, résztvevőket, keresési adatokat, tanfolyami
  mezőket és a fájl/URL elhelyezését. Az egyéb oldalak és tetszőleges YAML
  mezők a **Full source** fülön szerkeszthetők. Az alkalmazás nem WYSIWYG szerkesztő;
  a Markdown és shortcode-ok forrásként maradnak meg.
- Az **Images & PDF** fülön meglévő képet választhatsz, vagy az eredetit
  WebP-vé konvertálhatod. A cél szabadon megadható a `static/images/` alatt,
  például `turak/2026-expedicio/photos`; nem kell a `hero` mappát használnod.
  Egy képhez külön fájlnév is megadható. Az ütköző nevek számozott utótagot
  kapnak, meglévő fájl nem íródik felül. A kijelölt fotóból külön beállítható
  a bélyegkép, fő kép és `seo.featured_image` felülbírálás.
- Képenként adj meg valódi alt leírást és szükség esetén képaláírást.
  A **Write** eszköztár **Image / Gallery / Text & photo / PDF** gombjai
  közvetlenül a megfelelő beillesztőhöz vezetnek, a kurzorpozíció megőrzésével.
  A **FAQ** gomb a frontmatterben ad hozzá kérdés-válasz sort; ez külön
  FAQ szakaszként jelenik meg, nem a Markdown adott sorában.
  A beillesztő image/media/gallery vagy egyszerű Markdown kódot készít az
  utolsó kurzorpozícióra. PDF is feltölthető a `static/pdfs/` választott
  almappájába, és shortcode-ként beilleszthető. A **Syntax help** példákat
  és ezeket a fenntartott útmutatókat is megnyitja.
  A **Markdown & syntax help** külön, bezárható ablakban is elérhető:
  kereshető Markdown- és shortcode-példák, valamint **Copy syntax** gombok
  segítik a másolást. Az ablak nem írja át a vázlatot; Escape bezárja.
  A benne lévő építőgombok ugyanazt a konvertálási és elhelyezési munkafolyamatot
  nyitják meg, mint az eszköztár.
- A **Validate** a metaadatokat ellenőrzi; a **Render preview** a valódi
  Hugo sablonokat és shortcode-okat is. A még nem mentett forrás külön
  pillanatképből épül, külön helyi, csak olvasható címen. Mobil/tablet/asztali
  szélesség és social kártya is ellenőrizhető. A link csak az alkalmazás
  futásáig él, és a legrégebbi előnézetek három sikeres render után elévülnek.
  A preview a draft/jövőbeli/lejárt tartalmat is megmutatja, no-index módban.
- A **Save page** vagy Ctrl+S kifejezett mentés. Külső fájlmódosításnál
  ütközést jelez, nem írja felül a másik szerkesztő munkáját.
  A böngésző az utolsó nem mentett vázlat visszaállítását is felajánlja.
  Fájlmozgatáskor a képek, PDF-ek és bejövő linkek nem változnak:
  ezeket kézzel ellenőrizd, és szükség esetén adj meg `aliases` átirányítást.
- A **Delete** megerősítéséhez a teljes tartalomútvonalat kell beírni.
  A hivatkozott helyi `/images/` és `/pdfs/` fájlok egyenként kijelölhetők;
  a másutt is használt képeket/PDF-eket védi az alkalmazás. A relatív
  bundle-fájlokat nem törli automatikusan. Nincs külön archívum: visszaállítás
  kézzel Gitből történik. A Git által nem követett fájlok és nem mentett
  szövegek így nem állíthatók vissza.

Az ismeretlen frontmatter mezők megmaradnak, a nem változtatott forrásrészek
és megjegyzések változatlanok. A módosított YAML mezők formázása normalizálódik.
YAML aliasok és ismétlődő kulcsok nem támogatottak. Komponensoldalakon a
`content_blocks` vezérli a látványt, nem feltétlenül a Markdown törzs.
Nincs automatikus commit vagy publikálás; élesítés előtt futtasd a
**Build & checks** ellenőrzéseit és ellenőrizd a `draft` beállítást.

## 1. Front matter

A front matter a fájl eleji, két `---` sor közötti YAML blokk. A cím,
dátum, képek és opcionális adatok innen kerülnek a cikkre. Az alábbi példa
**túrabeszámolóhoz** való; tanfolyamnál a `categories` helyett elsősorban
a `current`, `milestones`, `contacts` és `flyer_images` mezők számítanak.
Teljes, draftként induló példák a [cikkmintákban](BLOGPOST_TEMPLATES.md) vannak.

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
draft: true # szerkesztés alatt true; ellenőrzés után false
---
```

A `<slug>` a cikk fájlneve `.md` kiterjesztés nélkül (pl. `2026-kanin-expedicio`).
Az `author` mezőt inkább hagyd üresen, mint hogy találgass - egy rosszul
tulajdonított beszámoló rosszabb, mint egy üres mező.

### Dátum, draft és megjelenés

- A túrabeszámolók `date` mezője rendszerint a túra kezdő dátuma.
- Tanfolyami hirdetésnél a `date` a meghirdetés dátuma, nem a következő
  tanfolyam jövőbeli kezdete; a tervezett időpontok a `milestones` mezőbe kerülnek.
- Mindkét lista dátum szerint, a legújabbal kezdve rendez. A tanfolyami
  archívum évszűrője is a `date` évét használja, nem a címben szereplő évszámot.
  Meglévő cikk lezárásakor a dátumot ne írd át csak a sorrend megváltoztatásáért.
- A normál `hugo` build kihagyja a draftokat és a jövőbeli dátumú cikkeket.
  A `hugo --buildDrafts --buildFuture` ezeket is megmutatja ellenőrzéshez;
  a helyi fejlesztői szerver és a CI is mutathat még nem publikálható cikkeket.
- Publikálás előtt ellenőrizd a címet, dátumot, képeket és helyőrzőket,
  majd legyen `draft: false`. Az üres opcionális mezők vagy listák elhagyhatók.

A `tanfolyamok` cikkeiben is megadható az `author: "Teljes Név"` mező.
Mindkét cikkoldal fejlécében a szerző neve a tag előnézeti kártyáját nyitja
meg, ha a név szerepel a `data/members.yaml` listájában. A név vagy becenév
pontos egyezése szükséges; a zárójeles becenév nem akadályozza az egyezést.
Ismeretlen szerző egyszerű szövegként jelenik meg, hiányzó szerző esetén
nem jelenik meg szerzői sor. Ez nem változtatja meg a résztvevők listáját.

### Közösségi megosztások előnézeti képe

A túrabeszámolók és tanfolyami cikkek előnézeti fotóját alapértelmezésben
a `featuredImg.image_path` mező adja, ugyanaz a kép, mint a cikk nagy bannere.
Ha más fotót szeretnél a megosztáshoz, add meg a cikk front matterében:

```yaml
seo:
  featured_image: /images/turak/<slug>/megosztas.webp
```

Ez csak a közösségi kártya alapfotóját cseréli, nem a cikk fejlécét vagy
listaképét. A képet tedd a `static/images/` alá; a megadott útvonalból hagyd
el a `static` részt. Az üres vagy hiányzó `seo.featured_image` az alapképet
használja. Külső URL és SVG helyett helyi JPG, PNG vagy WebP fotót adj meg;
hibás vagy hiányzó megadott kép esetén a build jelzi a hibát.

A többi oldal (főoldal, túra- és tanfolyamlista, egyesületi oldalak) a
`data/hero_images.yaml` `images` listájából kap véletlenszerű fotót, oldalanként,
az oldal generálásakor. Csak legalább **1,5:1 szélesség/magasság arányú** képek
kerülnek ebbe a választásba, az egész pixeles méretek kerekítését megengedve
(például 1600x1067 megfelel). Álló és közel négyzetes fotót nem választ.
Ez a szűrés nem vonatkozik a cikk saját vagy kézzel felülírt fotójára;
azok középre vágva kerülnek az 1200x630-as kártyára.

A fotóra továbbra is rákerül a cím, az FTSK-logó és a sötét átmenet;
az Open Graph és Twitter ugyanazt az 1200x630-as képet használja.
Ha nincs cikkfotó, megfelelő diavetítés-fotót választ a rendszer.
Ha nincs megfelelő diavetítés-fotó sem, figyelmeztetés mellett a
`data/meta.yaml` `image` mezője a tartalék.
A véletlen választás csak új buildnél változhat, nem minden megosztáskor.
Publikálás után a közösségi platformok gyorsítótára miatt szükség lehet
az előnézet újralekérésére (például a Facebook Sharing Debuggerben).

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
- Hosszú szöveges beszámolónál legyen `## Zárszó` (összegzés).
  Rövid túránál használhatsz témacímeket; a tanfolyami hirdetésnél inkább
  tematika, feltételek és felszerelés szerint tagolj. A PDF-es bevezetőhöz
  nem szükséges napi fejezeteket vagy külön zárszót írni.
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
és minden cikk `participants:` listáját. Ez kiszűri például a duplikált
tagneveket és beceneveket, a rossz mezőben maradt zárójeles beceneveket,
az ismeretlen tagmezőket (elgépeléseket), valamint az üres vagy duplikált
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

Tanfolyami képeknél a célmappa `static/images/tanfolyamok/<slug>/` legyen.

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

### Relatív képméret és igazítás

A hagyományos Markdown képek alapértelmezett szélessége a cikk
szövegoszlopának 100%-a. Az összes ilyen kép alapmérete a front matterben
állítható (a túrabeszámolók és tanfolyamok esetén is):

```yaml
article_image_width: 75
```

Ez 75%-os szélességet jelent, középre igazítva. Egy adott kép külön
méretezéséhez a Markdown képsor helyett használd az `image` shortcode-ot:

```markdown
{{< image src="/images/turak/2026-kanin-expedicio/01-csapat-a-ducatonal.webp" alt="A csapat a menedékháznál" caption="Indulás előtt" width="60" mobile-width="100" align="center" >}}
```

| Paraméter | Alapérték | Jelentés |
| --- | --- | --- |
| `src` | kötelező | A fotó elérési útja, ugyanúgy, mint Markdownban. |
| `alt` | kötelező | A fotó tartalmának rövid leírása. |
| `caption` | nincs | Opcionális, látható képaláírás. |
| `width` | `article_image_width`, különben `100` | A szövegoszlop szélességének 10–100%-a. |
| `mobile-width` | `100` | Szélesség 768 px alatt, 10–100%. |
| `align` | `center` | `left`, `center` vagy `right`; nem szövegkörbefuttatás. |

A számokhoz ne írj `%` jelet vagy `px` egységet. A `width` csak a
megjelenítési méretet változtatja meg: a képarány megmarad, és kattintásra
továbbra is a teljes fotó nyílik meg a cikk közös lightboxában. A front
matter beállítása nem méretezi át a fejléc bannerét vagy a galéria rácsát.
Az `article_image_width` is 10–100 közötti szám; a hagyományos Markdown
képek 768 px alatt teljes szélességűek. A méret a cikk szövegoszlopához
viszonyított, nem a teljes képernyőhöz. Más oldalakon (például az egyesület
bemutatkozásánál) további, oldalhoz tartozó szélességkorlát is érvényesülhet.

### Szöveg és fotó egymás mellett

A `media` blokk belsejébe normál Markdown szöveg kerülhet: bekezdések,
címek, listák, kiemelések és linkek. Nem kell HTML-t írni.

```markdown
{{< media src="/images/turak/2026-kanin-expedicio/01-csapat-a-ducatonal.webp" alt="A csapat indulás előtt" caption="A menedékháznál" image-side="right" image-width="40" font-size="1.1" >}}
### Indulás

A **szöveg** a fotó mellett jelenik meg. Több bekezdés is lehet itt.

- Első részlet
- Második részlet
{{< /media >}}
```

| Paraméter | Alapérték | Jelentés |
| --- | --- | --- |
| `src`, `alt`, `caption` | mint az `image` esetén | A fotó és opcionális felirata. |
| `image-side` | `right` | `left` vagy `right`: a fotó oldala asztali nézetben. |
| `image-width` | `40` | A blokk szélességének 10–90%-a; a szöveg kapja a maradékot a térköz után. |
| `font-size` | `1` | A törzsszöveg relatív mérete, 0.8–1.5; `1.1` = 110%. Tizedespontot használj. |
| `mobile-width` | `100` | A fotó szélessége az egymás alá rendezett mobilnézetben, 10–100%. |

768 px alatt a szöveg és fotó automatikusan egymás alá kerül, előbb a
szöveg, utána a fotó. A `font-size` a bekezdésekre és listákra vonatkozik,
nem a címekre vagy képaláírásokra. A `media` képe saját oszlopában teljes
szélességű; nem örökli az `article_image_width` beállítást. A fotók a
meglévő lightboxban nyílnak meg. A hibás méretek és oldalnevek buildhibát
adnak, nem kerülnek észrevétlenül az oldalra.

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

## GYIK: lenyitható kérdések és válaszok

A túrabeszámolók és tanfolyamok front matterjében is megadható az opcionális
`faq` lista. A cikk szövege után, a résztvevők és a tanfolyami
kapcsolattartók előtt automatikusan megjelenik a **Gyakran ismételt kérdések
(GYIK)** szakasz. Nem kell külön GYIK-címet írni a törzsszövegbe.

```yaml
faq:
  - question: "Ki jelentkezhet a tanfolyamra?"
    answer: |-
      KITÖLTENDŐ: A jóváhagyott jelentkezési feltételek.
  - question: "Hol találom az egyesület elérhetőségeit?"
    answer: |-
      Az elérhetőségek a [Kapcsolat oldalon](/kapcsolat/) találhatók.
```

A `question` kötelező, egyszerű szöveg; az `answer` is kötelező, és normál
Markdown lehet: bekezdések, **kiemelések**, linkek és listák. Több soros
válaszhoz használd a `|-` jelölést, a válasz sorait azonos behúzással.
A kérdések a lista sorrendjében jelennek meg. Hiányzó kérdés/válasz buildhibát ad.

Kezdetben minden válasz csukott. A kérdésre kattintva, vagy billentyűzettel
Tab után Enter/Space használatával nyitható és csukható; egyszerre több
válasz is nyitva maradhat. JavaScript nélkül is működik. A szakaszra
`#gyik` horgonnyal lehet hivatkozni.

Ha nincs szükség GYIK-re, hagyd el a mezőt, vagy adj meg `faq: []` értéket.
Tanfolyami díjakat, feltételeket és időpontokat csak egyeztetett adatokkal
tölts ki. Archív szöveghez ne találj ki utólagos kérdéseket vagy válaszokat.

## 5. Már publikált cikk bővítése később

Mivel a képek saját, cikkenkénti mappában élnek, és egyszerű Markdownnal
vannak beágyazva, egy régi beszámoló bővítése ennyi:

1. Konvertáld és tedd be az új fotókat a meglévő
   `static/images/turak/<slug>/` mappába (folytasd a számozást).
2. Illessz be `![...](...)` sorokat a megfelelő helyre a szövegben, vagy egy
   új napi szakaszt ugyanazzal a `## N. nap – ...` cím mintával.

Új képek vagy szövegrészek beillesztéséhez nem kell a megjelenítő sablont
módosítani. Szerző, résztvevők vagy alapértelmezett képméret változásakor
a megfelelő front matter mezőt is frissítsd.

## 6. Régi, csak PDF-es beszámolók (`legacy-*`)

A `turak` mappa régebbi cikkei nem a fenti napról napra bontott formátumot
követik - ezek csak egy rövid bevezető bekezdésből állnak, a teljes
beszámoló pedig egy régi PDF-ben él. Ezeket a fájlneve is megkülönbözteti:
`legacy-` előtaggal kezdődnek (pl. `legacy-bu56-pireneusok-1998.md`).

- A PDF-eket ne külső (ftsk.hu-s) linkként hivatkozd - töltsd le és tedd be
  a repóba a `static/pdfs/<szekció>/<cikk-slug>.pdf` útvonalra (pl.
  `static/pdfs/turak/legacy-bu56-pireneusok-1998.pdf`).
- A szövegbe a `{{< pdf >}}` shortcode-dal ágyazd be, ami egy beágyazott
  PDF-nézetet és egy stílusos letöltés gombot is megjelenít:

  ```markdown
  {{< pdf src="/pdfs/turak/legacy-bu56-pireneusok-1998.pdf" title="BU 56 (Pireneusok, 1998)" >}}
  ```

- Ne írd meg kézzel a beágyazás HTML-jét/CSS-ét - a `layouts/shortcodes/pdf.html`
  és a hozzá tartozó `.ftsk-pdf-embed` stílus (lásd
  `assets/scss/components/_ftsk.scss`) intézi ezt.
- Ha egy régi cikk nem PDF-re, hanem valamilyen más régi oldalra (pl. `.htm`)
  hivatkozik, azt nem kell letölteni/beágyazni - elég csak a `legacy-`
  fájlnév-előtagot alkalmazni rá.
