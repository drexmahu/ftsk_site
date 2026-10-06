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

A **People & portraits** felületen minden személy egyetlen, tartós
azonosítót kap a `data/people.yaml` fájlban. Először keress rá a névre,
becenévre vagy korábbi névalakra; csak utána válaszd az **Add person** gombot.
A név, bemutatkozás és portrépár közös minden cikkben. A megjelenített név
lehet a megszokott kedves névalak (például Kalotai Zsófi); az ID nem változik
átnevezéskor. Az **Aliases** korábbi névalakokat őriz, nem új személyeket.
Csak azonos, megerősített személyhez tartozó neveket adj meg aliasként, ne
bizonytalan jelölteket. Az ütközési figyelmeztetés megmutatja az érintett
személyt és azt, hogy név, becenév, alias vagy ID egyezik. Azonos keresztnév
önmagában nem ütközés. Hibás meglévő alias esetén másold ki a nem mentett
vázlatod adatait, nyisd meg a jelzett személyt, töröld a hibás aliast és ments,
majd térj vissza az új személyhez. A tisztázási jelölőnégyzet nem írja felül
az ütközésvédelmet.

Mentett ID-t a normál **Save person** nem módosít. Ha mégis szükséges,
a **Change person ID with reference review** részben adj meg egy új, még nem
használt ID-t, majd válaszd a **Review ID change** gombot. Kézzel ellenőrizd
a régi és új ID-t, a tagságot és minden felsorolt cikk érintett mezőit.
Csak a **Confirm reviewed ID change** és a külön megerősítés után frissül
a személy ID-ja, a tagsági hozzárendelés, valamint a mentett szerzői,
résztvevői és kapcsolattartói ID-hivatkozások. A nevek, fotók, szerepek és
régi név alapú hivatkozások nem változnak. Ütköző ID, hibás ellenőrzés vagy
az előnézet óta módosult fájl esetén új ellenőrzés szükséges; kezelt írási
hibánál a módosítások visszaállnak. Ez több fájlt érintő művelet, nem adatbázis-
tranzakció: folyamatleállás ellen a Git-előzmény biztosít helyreállítási alapot.
A nem mentett cikkvázlatok érintetlenek maradnak; az érintett mentett cikket
töltsd újra, vagy a vázlat régi ID-jait kézzel cseréld ki mentés előtt.

A tagság külön hozzárendelés. A **Not a current member** állapot vendégnek,
korábbi tagnak és tanulónak is megfelelő: ettől még lehet szerző, résztvevő
vagy kapcsolattartó. A **Remove membership** csak a Tagjaink listából veszi ki,
a régi cikkek és fotók megmaradnak. Véglegesen csak tagság és mentett
cikkhivatkozás nélküli személy törölhető. Tanfolyami részvétel nem ad tagságot.

A személy szerkesztője külön, görgethető párbeszédablakban nyílik meg, így a
névsor a teljes rendelkezésre álló szélességet használja. A bezárás és az
Escape nem dobja el kérdés nélkül a nem mentett változásokat.
A tanfolyamra vagy történeti oldalra navigálás megőrzi a személyvázlatot:
visszatérve a **Resume person editor** gombbal folytathatod. A képkivágó is
ugyanebben az ablakban elérhető; személy nélküli exporthoz válaszd a
**Standalone portrait export** gombot.
A szerkesztő **Profile** részében a név és bemutatkozás azonnal elérhető;
az aliasok, kontaktadatok, portrépárok és veszélyes identitásműveletek külön
lenyitható részekbe kerültek. A **Save person** gomb görgetéskor is elérhető.
A korábbi történet a **Participation & contribution history** részben található.

A **Groups & categories** külön kezeli a nyilvános tagságot és a munkafelület
kategóriáit. Egy személy több tanfolyami és egyéni kategóriához tartozhat,
miközben a meglévő aktuális tagsági besorolása változatlan marad.
A **Group / category** szűrő tagsági, tanfolyami és egyéni csoportok szerint
szűkíti a névsort; a kereső a kategórianeveket is megtalálja.

Minden tanfolyami cikkből automatikus **Tanfolyami résztvevők** csoport készül.
A mentett `participant_ids` listában szereplő minden személy bekerül:
a szerep nélküli résztvevő, a tanuló, az oktató és a segítő is.
A cikkben megadott szerepek változatlanul, külön adatokként megmaradnak;
a csoport nem minősít senkit tanulónak és nem ad tagságot.
A tanfolyami jelvény kattintható: a kapcsolódó oldal résztvevőit nyitja meg.
A cím és hozzárendelés a mentett oldalból származik; nincs második másolat a
személyadatokban. Vázlatos tanfolyamok is szerepelnek, külön jelzéssel.
Szerepváltás, új oldal vagy oldaltörlés után töltsd újra a személynévsort.

A **Manage roles — membership, courses & trips** részben a meglévő tagsági
szerepekből származó közös választékot kezelheted: létrehozás, névmódosítás,
törlés. A kezdeti szerepek: elnök, kutatásvezető, elnökségi tag, pénztáros,
túravezető, raktáros. Nincsenek előre kitalált oktatói vagy tanulói szerepek.
A `tanfolyami résztvevő` automatikus alapértelmezés szintén itt
kezelhető. A **Use this role automatically** kapcsoló alatt a jelenlegi
tagság és a mentett tanfolyami részvétel feltételeit választhatod:
**Any**, igen vagy nem. Legalább egy feltétel szükséges; mindegyiknek
teljesülnie kell. Átfedő szabályokat a rendszer nem enged menteni.
A név és a feltételek adatként tárolódnak, nem HTML/JavaScript-felsorolásként.
A cikkszerkesztő **Manage global participant roles** gombja ide vezet;
a nyitott cikkvázlat közben megmarad. A szerep neve megjelenik a nyilvános
kártyán is. A stabil ID új szerepnél automatikusan készül, mentés után
nem változtatható. Átnevezéskor a régi név történeti aliasként megmarad.
Ehhez nem kell HTML-t vagy JavaScriptet szerkeszteni.

A személy **Membership roles — choose any number** részében ugyanezekből
a szerepekből többet is választhatsz. A tagsági szerepek a `data/people.yaml`
csoportbejegyzéseiben listaként szerepelnek, például:

```yaml
- person: gyovai-tamas
  roles: [elnok, kutatasvezeto]
```

A szerepek sorrendje megmarad; a nyilvános kártyán továbbra is
`elnök, kutatásvezető` jelenik meg, változatlan megjelenéssel.
A **Save person** a tagsági hozzárendeléseket menti. A tagság törlése a
tagsági szerepeket is leveszi, a személy és a cikkeken megadott szerepei megmaradnak.

A cikkben az **Add a role** mező gépelés közben felajánlja a közös szerepeket.
Egy személyhez több szerepet is választhatsz; a jelvényre kattintva
eltávolíthatod az adott szerepet. A hozzárendelések csak a cikk mentésekor
mentődnek, és csak arra a tanfolyamra vagy túrára érvényesek.
A személy általános kategóriái, tagsága és a kontaktkártyák szabad szöveges
feladatai ettől külön maradnak.

A szerepszerkesztő felsorolja a szerepet használó tagokat és mentett oldalakat.
Használt szerep nem törölhető: előbb távolítsd el a kapcsolódó tagokon vagy oldalakon,
majd töltsd újra a névsort. Ellenőrzési hiba esetén a törlés szintén tiltott,
az ok látható. Az üres szerep törlése külön megerősítést kér; a nem mentett
cikkvázlatokat nem írja át. A szerepvázlat Git-műveleteket blokkol,
a főoldal vázlatletöltés/elvetés gombjai ezt is kezelik.
A régi `role: szöveg` értékek továbbra is olvashatók. Ismeretlen történeti
szerepet a szerkesztő külön jelez, nem alakít át találgatással; kiválasztás
vagy törlés után az új listaformátum kerül mentésre.

A névsor **Manage custom categories** részében új kategóriát hozhatsz létre,
vagy egy meglévő megjelenített nevét módosíthatod. Az ID mentés után állandó.
Előbb mentsd vagy vesd el az aktuális személyvázlatot. A személy **Custom
categories** jelölőnégyzeteivel több kategóriát választhatsz; ezeket a
**Save person** menti. A tárolás a `data/people.yaml` opcionális `categories`
listájában történik (`id`, `label`, `people`), csak személy-ID-hivatkozásokkal.
Kategóriát csak üresen, külön megerősítéssel törölhetsz. A személy ID-cseréje
frissíti ezeket a hivatkozásokat; összevonáskor a kategóriák egyesülnek,
használaton kívüli személy törlésekor a kategóriakapcsolatai is megszűnnek.
Ezek a kategóriák nem jelennek meg a nyilvános Tagjaink oldalon, nem adnak
tagságot, és nem módosítják a vendégjelölést.

Az email és telefon a közös személyrekord **Contact email / Contact phone**
mezőiben szerkeszthető. Csak egyeztetett, publikálható elérhetőségeket adj meg.
A normál tag- és résztvevőkártya, valamint a profilablak nem jeleníti meg
ezeket. Csak a kapcsolatkártya tartalmaz email- és telefonlinket.
A **Pages & posts → People & contacts** fülön kereshető személyválasztóval
állíthatod be a tanfolyam és a globális Kapcsolat oldal kapcsolattartóit,
sorrendjüket és oldalankénti szerepüket. A jelvény képpel vagy monogrammal
jelenik meg; rákattintva a személy szerkesztője nyílik meg.
A nyilvános kapcsolatkártya képe és neve a közös profilablakot nyitja.
A cikkben csak `person` és opcionális `role` szükséges; a globális oldalon
ugyanez a `contact/info` komponens `contacts` listájában van.
Az ilyen oldalak `content_blocks` listáját natív Hugo-részsablonok jelenítik meg
a `layouts/partials/sections/` mappából. A `_bookshop_name` a szakasztípus
megőrzött YAML-kulcsa (például `contact/info`), nem Bookshop-függőség.
A listák sorrendjét és meglévő mezőit nem kell átírni. Ismeretlen szakasztípus
vagy hibás lista esetén a build kifejezett hibával leáll.
Régi, cikkbe írt elérhetőségek átmenetileg olvashatók, de az új hozzárendelések
nem másolják őket: a munkafelület figyelmeztet, és a közös rekord adatai
elsőbbséget kapnak. A beágyazott kapcsolatok is részei a hivatkozásvédelemnek,
az ID-változtatásnak és az identitás-összevonásnak.

A személy szerkesztőjének **Membership & participation** nézete külön mutatja
a tagság típusát és tisztségét, a tanfolyami részvételeket, az expedíciókat
és túrákat, valamint a szerzői és kapcsolattartói hozzájárulásokat.
A cikkcímek kattinthatók; mellettük dátum és az adott esemény szerepe látható.
A **Search contribution history** mező mindhárom listát szűri cím, dátum,
szerep és cikkútvonal alapján, kis- és nagybetűtől, illetve ékezettől függetlenül.
Több keresőszó esetén mindegyiknek illeszkednie kell. A kategóriák címe
az illeszkedő és az összes hozzárendelés számát mutatja; üres találatnál
egyértelmű jelzés jelenik meg. A hosszú listák külön görgethetők, a tagsági
összefoglaló, kereső és kategóriacímek nem görgetődnek velük.
A **Clear search** visszaállítja a teljes történetet. Keresés nem módosítja
a személyvázlatot vagy a cikkeket; másik személy megnyitásakor törlődik.
Kézi eseményszerep nélkül a globális automatikus szabályok érvényesek.
Alapból a tagság nélküli, mentett tanfolyamon szereplő személy
**tanfolyami résztvevő**; a tagság nélküli, tanfolyamon sem szereplő személy
nem kap automatikus szerepfeliratot. A **vendég** csak kézzel választható:
a tagság hiánya nem jelenti, hogy az adott túrán az illető vendég.
A mai tagok nem kapják meg a tagság nélküli tanfolyami jelölést.
A tanfolyami részvételbe a vázlatos, jövőbeli és névalapú tanfolyamok is
beleszámítanak, de puszta szerzőség vagy kapcsolattartás nem.
A nyilvános résztvevői kártyák ugyanezeket az adatvezérelt jelöléseket használják.
Az adott cikkben megadott kézi `roles` vagy történeti `role` mindig felülírja
az automatikus jelölést ezen az oldalon, a mai tagságtól függetlenül.
Üres szereplistánál ismét az automatikus szabály érvényes.
Ez nem ír új hozzárendeléseket a személyadatokba és nem ad tagságot.
Automatikus szerep törléséhez előbb kapcsold ki és mentsd a szabályát;
a mentett kézi hozzárendeléseket külön is el kell távolítani.

Feltöltés és konvertálás a nyitott személyvázlat képmezőit tölti ki;
a hozzárendelést a **Save person** menti. A konvertált fájl vázlat elvetésekor
is megmarad. Ugyanazt a portrépárt használd a különböző tanfolyamokon és túrákon,
ne másold át évente. Külső fájlmódosításnál a mentés ütközést jelez.

Portré cseréjekor a sikeres **Save person** után az alkalmazás felajánlja a
régi fájlok törlési előnézetét. A régi képek addig megmaradnak, amíg a törlést
külön meg nem erősíted; sikertelen mentés vagy elvetett vázlat nem törli őket.
Az előnézet letiltja a más személy vagy mentett tartalom által használt fájlokat,
és megmutatja a hivatkozásokat. Csak a kipipált, szabad fájlok törölhetők.
Ha elhalasztod a törlést, később a **Loose portraits** listából folytathatod.

A **Permanently delete person** mellett látható, miért nem engedélyezett a
törlés: aktuális tagság, mentett oldalhivatkozások, hiányos ellenőrzés vagy
folyamatban lévő művelet. A tagság eltávolítását előbb menteni kell.
Történelmi közreműködésnél őrizd meg a személyt, ne töröld a cikkek kreditjeit.
Szabad identitás törlése eltávolítja az egyéni kategóriakapcsolatokat is,
de a portréfájlokat megőrzi.

A **Needs clarification** szűrő a kézzel tisztázandó identitásokat mutatja.
Az ellenőrzések a régi, nem illeszkedő nevekhez lehetséges személyeket ajánlanak,
de nem rendelnek automatikusan senkit. Ha két rekord bizonyítottan ugyanaz a
személy, a **Merge identities** előnézetében válaszd ki a megtartandó rekordot.
A cél kitöltött profilmezői elsőbbséget kapnak; az üres mezők a forrásból
töltődnek, a korábbi nevek aliasokká válnak. A cikkek ID-hivatkozásai is frissülnek.
Eltérő résztvevői szerepek esetén előbb tisztázd az adott cikket. A nem mentett
cikkvázlatokat külön ellenőrizd; összevonás nem írja át őket.

A **Loose portraits** listában egyenként vagy kijelölt csoportként törölheted
a felesleges portréfájlokat a **Review & delete selected** gombbal.
Az előnézet megmutatja a mentett hivatkozásokat, és ezekkel rendelkező fájlt
nem enged törölni. Csak a külön megerősített, kipipált fájlok törlődnek;
a bélyegkép és a teljes portré külön fájl. A még nem mentett cikkvázlatokat
is ellenőrizd: az alkalmazás csak a mentett oldalak hivatkozásait tudja
átvizsgálni. A nem verziókezelt fájlokat a Git nem tudja visszaállítani.

### Git és munkaváltozatok a Workbenchben

Indításkor a **Git & workspace** főoldal segít kiválasztani a munkaváltozatot
(branch). A fejléc mindig kiemelten mutatja, melyiken dolgozol. A `main` és
`master` védett: a szerkesztési menük le vannak tiltva, és a szerver sem enged
tartalmat, személyt vagy képet módosítani ezeken. Leválasztott állapotban,
Git-hiba vagy folyamatban lévő Git-művelet alatt is zárolva marad a szerkesztés.

1. **Fetch server updates:** lekéri a GitHub legújabb ismert ágait és
   checkpointjait. Nem változtatja meg a fájljaidat. A kijelzett szerverállapot
   nem élő: az utolsó sikeres lekérés ideje látható.
2. Válassz meglévő munkaváltozatot, vagy a **Create branch from this checkout**
   gombbal hozz létre újat, például `tanfolyam-2027-frissites`.
   A létrehozás az éppen kiválasztott ág aktuális állapotából indul.
   Új munkához előbb a tiszta `main` ágon futtasd az **Update this branch**
   műveletet: ez csak a szerverrel megegyező előzményre léptethet előre,
   a szerkesztési menük továbbra is zárolva maradnak.
   A `main` ágon már elmentett, de nem commitolt változásokat az új ág megőrzi.
   Másik meglévő ágra váltás előtt a fájlokat commitolni kell.
3. A szerkesztők **Save** gombjai lemezre mentenek, nem a GitHubra.
   A **Review changed files & commit** ablakban válaszd ki a megosztani kívánt
   fájlokat, nézd át a változásokat, és írd le röviden, mit változtattál.
   A **Select all** minden felsorolt fájlt kijelöl, a **Select none** törli
   a kijelöléseket. A számláló mutatja, hány fájlt választottál.
   Kijelölésváltás után újra át kell nézni a kiválasztott változásokat.
   Az áttekintés fájlonként **Before / After** nézetet mutat: az előző
   checkpoint és a most mentett változat látható, a hozzáadott és törölt
   szöveg külön jelöléssel. A képek régi és új változata is megjelenik,
   ha a méretük engedi. A túl nagy vagy nem megjeleníthető fájloknál
   figyelmeztetés kér külön ellenőrzést. A nyers Git-kimenet csak a
   lenyitható **Technical details (optional)** részben szerepel.
   A nagy ablak bal oldalán fájlnévre vagy mappára kereshetsz; a keresés
   csak elrejti a nem illő sorokat, a kijelöléseket nem változtatja meg.
   A **Select all / Select none** a teljes listára hat, a rejtett sorokra is.
   Jobbra egyszerre egy kiválasztott fájl látható: **Previous file / Next file**
   gombokkal vagy a **Jump to a selected file** listával léphetsz közöttük.
   A leírás és a létrehozás/megszakítás gombjai görgetéskor is elérhetők.
   A **What changed? (required)** mezőbe saját szavaiddal írt, nem üres
   leírás kötelező; enélkül nem hozható létre checkpoint.
   A checkpoint egy helyi Git-commit. Nem kijelölt fájl nem kerül bele.
   Ellenőrizd, hogy nincs benne jelszó, token vagy magánadat.
   A már stage-elt fájlátnevezéseket a korlátozott commitfelület nem kezeli:
   ezek átnézéséhez és commitjához kérd a karbantartó segítségét.
4. **Send checkpoints to GitHub:** külön megerősítés után normál push küldi
   a commitokat a munkaváltozat szerveroldali ágára. Nem egyesít a `main` ággal,
   és nem használ force-push-t. Az automatikus CI/deploy viselkedését
   továbbra is a repository beállításai határozzák meg.
5. **Update this branch · pull with rebase:** fetch után a szerveroldali
   változatokra helyezi a még helyi commitokat. A külön **Rebase onto selected
   base** másik kiválasztott alapágra helyezi a nem publikált commitokat.
   Előbb fetch-elj, ha a legfrissebb szerveralapot akarod használni.
   Alapértelmezésben csak nem publikált történetet ír át, nem merge-el és nem stash-el.

Ha közben a `main` továbbhalad, a már megosztott munkaváltozatod is követheti:

1. Commitold a mentett változásokat, mentsd/elvetés előtt töltsd le a nyitott
   vázlatokat, majd **Fetch server updates**.
2. Válaszd az `origin/main` alapágat (nem a régi helyi `main`-t), és jelöld be
   **Allow my published working branch to follow updated main, with a recovery backup**.
   Csak a saját, ugyanilyen nevű `origin/<munkaváltozat>` ágat követő ág használható.
   Ha másvalaki commitjai hiányoznak a helyi ágból, előbb pull/rebase szükséges.
3. **Rebase onto selected base:** nézd át és erősítsd meg. A szerver újraellenőrzése
   után, még az átírás ELŐTT a `.workbench-backups/<azonosító>/` mappába kerül
   `history.bundle`, `commits.patch`, `changes.patch`, `recovery.json` és `RESTORE.txt`.
   A bundle az eredeti teljes történetet, a patch-ek a commitokat és a bináris
   fájlokra is alkalmazható különbséget őrzik. Sikertelen mentés esetén nincs rebase.
4. Ütközésnél a szokásos feloldás/folytatás vagy **Abort rebase** használható.
   Abort után az eredeti ág áll vissza, de a helyreállítási backup megmarad.
5. Sikeres rebase után **Publish rebased branch · force with lease**:
   külön ellenőrizd az ágat, a backupot és a rögzített szervercommitot,
   majd a megerősítéshez írd be a munkaváltozat pontos nevét.
   Ez kizárólag ezt az ágat helyettesíti, és csak akkor, ha a szerver még a rebase
   előtt rögzített commiton áll. A `main`/`master` soha nem írható át.

A lease szándékosan nem frissül újabb fetch hatására. Ha közben valaki más
frissítette vagy törölte az ágat, a push elutasításra kerül; ne próbáld felülírni.
Kérd a karbantartót a két történet egyeztetésére. A függő leased publikálás alatt
újabb pull/rebase nem indulhat, hogy a régi szervertörténet ne kerüljön vissza
és a rögzített védelem ne vesszen el. Commit, fetch és ágváltás továbbra is lehetséges.
A rebase és backupállapot újraindítás után is megmarad.

A backup Git-ignorált; régebbi checkoutnál a Workbench a helyi Git-kizárásba is
felveszi a mappát. Nem tölti fel és nem törli automatikusan. Bizalmas adatokat is
tartalmazhat, ezért ne add Githez és ne oszd meg ellenőrzés nélkül.
A **Local rebase recovery backup** rész mutatja az elérési utat.
A `RESTORE.txt` biztonságos, ÚJ helyreállítási ág létrehozásához ad parancsot az
eredeti refből vagy bundle-ből. Ez nem reseteli a jelenlegi munkát; kézi visszaállítást
karbantartóval végezz. A patch kiegészítő mentés, nem a teljes történet helyettesítője.

Ágváltás és történetmódosítás előtt mentsd vagy töltsd le és vesd el a nyitott
szerkesztővázlatokat. Az alkalmazás nem dobja el őket magától. Sikeres ágváltás,
pull és rebase után az oldal újratöltődik, hogy az új ág fájljait használd.
Ha más program változtatja meg az ágat vagy a commitot, a Workbench zárol,
és újratöltést kér; előbb készíts másolatot a nem mentett vázlatodról.

A főoldal **Recover an unsaved editor draft before switching branches** részében zárolt ágon is
letöltheted a nyitott cikk-, személy- és hero-vázlatot. Ellenőrizd a letöltött
Markdown/JSON fájlt, mielőtt a **Discard unsaved editor drafts** gombbal,
külön megerősítés után elveted a böngészős vázlatokat. Ez a cikk automatikus
böngészős mentését is törli, de nem módosít mentett fájlt, commitot vagy
feltöltési sort. Folyamatban lévő szerkesztési, képfeldolgozási, Git- vagy
letöltési művelet alatt a vázlatmentés és elvetés nem használható.
A személy- és hero-vázlat JSON-másolat kézi visszaállítási alap, nem automatikus import.

Rebase-ütközésnél a szerkesztés zárolva marad. A Git főoldal megmutatja az
ütköző fájlokat. Szöveges fájlnál a **Review conflict** ablakban állítsd össze
a végleges tartalmat és távolítsd el az ütközésjelölőket, majd fogadd el.
Ezután **Continue rebase** folytatja a műveletet. Ha bizonytalan vagy,
**Abort rebase** visszaállítja a rebase előtti állapotot, elvetve az ezen belüli
ütközésfeloldásokat. Bináris, törölt vagy túl nagy fájl ütközésénél kérd a
karbantartó segítségét. A hibák és a Git részletes naplója megmaradnak a felületen.

A GitHub-hitelesítést és a commit-szerző nevét/emailjét a karbantartó egyszer
beállítja a Gitben. A Workbench nem kér és nem tárol GitHub-jelszót vagy tokent.
Sikertelen hálózati műveletnél nem jelzi azt, hogy a munkaváltozat szinkronban van.

Indítsd el a főmappában lévő `site_editor.bat` alkalmazást, majd nyisd meg a
**Pages & posts** részt a <http://127.0.0.1:8879/#content> címen.

- A kereshető könyvtárból nyiss meg egy cikket, vagy a **New** gombbal válassz
  egy fenntartott mintát. Az új oldal mentésig nem kerül a lemezre.
  A **Hide page library / Show page library** gombbal a könyvtár elrejthető,
  így a szerkesztő a teljes munkaterületet használja. A böngésző megjegyzi
  ezt a választást; rejtett könyvtár mellett a **New page** gomb is elérhető.
- Az **Edit content** rész **Story**, **Page details**, **People & contacts**,
  **SEO & sharing** és **Course & FAQ** fülei
  kezelik a történetet, képeket, résztvevőket, keresési adatokat, tanfolyami
  mezőket. A külön **Page tools** rész az egész oldal eszközeit tartalmazza:
  **Files & usage** (Page media), **Add images & PDFs**, **File & URL** és
  **Full source**. Ezek saját munkapanelt nyitnak, nem tartalmi fülek.
  **Back to content editing** az előző tartalmi szakaszhoz tér vissza.
  A szerkesztősáv **Preview page**, **Validate** és **Save page** gombjai az egész
  oldalra vonatkoznak; az előnézet külön munkapanelben jelenik meg.
  Az egyéb oldalak és tetszőleges YAML
  mezők a **Full source** fülön szerkeszthetők. Az alkalmazás nem WYSIWYG szerkesztő;
  a Markdown és shortcode-ok forrásként maradnak meg.
- A **Page tools → Add images & PDFs** eszközben meglévő képet választhatsz, vagy az eredetit
  WebP-vé konvertálhatod.
  JPG, PNG, WebP és HEIF/HEIC eredetik is használhatók a fotó- és
  portrékonvertálóban. Többképes HEIF-ből az elsődleges kép készül el;
  a kimenet 8 bites WebP, nem őriz HDR-t, mozgást vagy mélységtérképet.
  Új fájl csak az oldal saját mappájába kerülhet:
  `turak/2026-expedicio.md` esetén `static/images/turak/2026-expedicio/`.
  A `slug/index.md` és `slug.md` azonos célmappát használ; PDF-eknél
  ugyanez a szabály a `static/pdfs/` alatt. A szerver is kikényszeríti ezt,
  nem csak a csak-olvasható célmező.
  Egy képhez külön fájlnév is megadható. Az ütköző nevek számozott utótagot
  kapnak, meglévő fájl nem íródik felül. A kijelölt fotóból külön beállítható
  a bélyegkép, fő kép és `seo.featured_image` felülbírálás.
  A konvertálás mellett folyamatjelző mutatja a feldolgozott képek számát és
  az aktuális lépést (feltöltés, konvertálás, takarítás). Egyetlen kép vagy portré
  feldolgozásakor határozatlan folyamatjelző látszik: a szerver nem közöl
  képen belüli százalékot. A Site photos és a portrékonvertáló is jelzi a
  folyamat végét és az esetleges hibákat.
- A képmezők **Choose image…** gombja közvetlen fájlválasztót nyit:
  bélyegképre kattintva a kép az adott mezőbe kerül, URL-másolás nélkül.
  A választó az oldal saját mappájából indul. **Borrow existing file…**
  esetén más mappákból kölcsönözhetsz meglévő fájlt: csak hivatkozás készül,
  nincs másolás vagy áthelyezés. **This page's own files** visszavált.
  Új fájlhoz **Upload new file to page folder…**,
  majd konvertálás után **Use for …**. A kézi URL-mező továbbra is használható.
  Ez a túrabeszámolók és a régi/új tanfolyamok képmezőire egyaránt érvényes.
  A **Course & FAQ → Course flyers → + Add → Choose image…** szórólapot rendel
  hozzá; az **Add images & PDFs** kijelölt képén az **Add course flyer** is használható.
  A szórólapok a címsávban, enyhén elforgatott és egymást átfedő kártyákként
  jelennek meg, nem cserélik le a fő vagy közösségi képet.
  A kártyák mérete a darabszámhoz igazodik: egy szórólap nagyobb, kettő
  közepes, három vagy több kisebb; sok kártya további sorokba rendeződik.
  Kattintásra az eredeti kép
  a nagy képnézegetőben nyílik meg. Több szórólap között ott lapozni is lehet.
  A 2019-es és 2022-es tanfolyam közös GYIK PDF-je a
  `static/pdfs/tanfolyamok/shared/` könyvtárból kölcsönzött dokumentum;
  a 2024-es GYIK a saját `static/pdfs/tanfolyamok/tanfolyam-2024/` mappában van.
  A nem aktuális tanfolyamok kártyáján halk „(lezárult)” jelzés, az oldalon
  a cím alatt „A tanfolyam lezárult.” szöveg jelenik meg. Ezt a `current`
  mező vezérli; az aktuális tanfolyamokon nincs lezárult jelzés.
  A **PDF reports → Choose / borrow existing PDF…** a meglévő PDF-eket listázza,
  és a választott fájlt kitölti a beillesztőben. Ezután **Insert PDF shortcode**.
  A hozzárendelés vázlat; a **Save page** rögzíti, míg a feltöltött fájl már
  a konvertálás/feltöltés során lemezre kerül.
- A **Page tools → Files & usage** (Page media) eszköz közvetlenül megmutatja az
  oldalhoz hivatkozott képeket/PDF-eket és a kapcsolt mappák többi fájlját.
  Az új képek és PDF-ek kötelező célmappája az oldal útvonalából készül,
  nem egy meglévő kép helyéből. Egy közösen használt hero kép nem teszi a
  hero mappát az oldal feltöltési céljává. A célmappa nem módosítható.
  A **Browse page's own images** ezt a konvertálási célmappát nyitja meg.
  Több mappában tárolt hivatkozott fájlokat a **Page media** együtt is mutatja.
  **Remove from page…** után előbb nézd át a javasolt forrást, majd
  **Apply to draft · keep file**: a megszokott képmezőket, szórólapokat és
  image/photo/pdf shortcode-okat, Markdown-képeket/PDF-linkeket eltávolítja;
  media blokknál a szöveg megmarad. Egyedi HTML, komponens-YAML és kódpéldák
  esetén **Find in source** segít; ezek nem törlődnek találgatással.
  **Save page** után a már nem használt fájl külön törölhető a
  **Delete file permanently…** gombbal, a teljes URL begépelése után.
  Mentett oldalakban/beállításokban vagy a nyitott vázlatban használt fájl nem
  törölhető; a törlés előtt a hivatkozások és a fájlverzió újra ellenőrződnek.
  Más böngészőablakok nem mentett vázlatait külön ellenőrizd.
  A fájltörlés nem törli az oldalt. Nem követett feltöltést a Git sem tud visszaállítani.
- Szerző, résztvevő és kapcsolattartó keresésekor a találatok gépelés közben
  automatikusan megjelennek, portréval vagy monogrammal, névvel és tartós ID-val.
  A keresés az aliasokat és beceneveket is figyeli; a tagságszűrő megmarad.
  Kattints egy találatra, vagy válaszd ki a fel/le nyíllal és Enterrel.
  Gépelés önmagában nem rendel hozzá személyt. Escape bezárja a találatlistát.
  Már felvett résztvevőt a hozzáadó mező nem ajánl fel újra.
  Hasonló kereshető ajánlások segítik a tagság, kategória, meglévő portrépár,
  összevonási cél, oldalsablon és képmappa kiválasztását is. Az eseményszerep
  ajánlásai nem kötelezőek: saját szöveg továbbra is megadható. A mentett
  oldalkategóriákhoz külön kereshető hozzáadó mező tartozik.
- Képenként adj meg valódi alt leírást és szükség esetén képaláírást.
  A **Story** eszköztár **Image / Gallery / Text & photo / PDF** gombjai
  közvetlenül a megfelelő beillesztőhöz vezetnek, a kurzorpozíció megőrzésével.
  A **FAQ** gomb a frontmatterben ad hozzá kérdés-válasz sort; ez külön
  FAQ szakaszként jelenik meg, nem a Markdown adott sorában.
  A beillesztő image/media/gallery vagy egyszerű Markdown kódot készít az
  utolsó kurzorpozícióra. PDF is feltölthető a `static/pdfs/` választott
  saját oldalmappájába, és shortcode-ként beilleszthető. A **Syntax help** példákat
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
author_id: "" # a valódi szerző ID-ja; ne találgass
participant_ids: [] # a People felületen kiválasztott személyazonosítók
thumbImg:
  image_path: /images/turak/<slug>/01-....webp # a lista/kapcsolódó cikkek kártyáin jelenik meg
featuredImg:
  image_path: /images/turak/<slug>/01-....webp # a cikk oldalán a nagy banner képe
  width: 40 # csak a cikk bannerének szélessége: 10–100%; elhagyva 100%
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
Az `author_id` mezőt inkább hagyd üresen, mint hogy találgass - egy rosszul
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

A `tanfolyamok` cikkeiben is az `author_id` mező választ szerzőt.
Mindkét cikkoldal és a túraarchívum keresője a közös személyrekord aktuális
nevét használja, tagságtól függetlenül. A szerzői kártya ugyanazt a fotót és
bemutatkozást nyitja meg. Hiányzó szerzőnél nincs szerzői sor.
A régi `author` szöveg átmenetileg támogatott (például nem tisztázott közös
szerzőség), de ne keverd kitöltött `author_id`-val. Az ellenőrző ezt jelzi.

### Közösségi megosztások előnézeti képe

A **SEO & sharing** fülön a megosztás külön címe, leírása és kész képe is
beállítható. Az **Exact social preview image** képválasztó meglévő képet is
kölcsönözhet, vagy új képet tölthet fel az oldal saját mappájába.

```yaml
seo:
  social_title: Rövid cím a megosztáshoz
  social_description: Külön leírás a közösségi kártyához.
  social_image: /images/turak/<slug>/kesz-kartya.webp
```

A `social_image` változatlanul kerül az Open Graph és Twitter metaadatokba:
nincs vágás, ráírás vagy logó. Helyi JPG, PNG vagy WebP használható;
1200×630 ajánlott. A platform maga még vághatja a képet. A `social_title`
nem változtatja a cikk címét, a `social_description` nem változtatja a kereső
`page_description` mezőjét. Üres értékeknél az eredeti alapértékek érvényesek.
Az **Preview page → Inspect this draft's social card** az el nem mentett
változat valódi megosztási metaadatait és képét mutatja.

A túrabeszámolók és tanfolyami cikkek előnézeti fotóját alapértelmezésben
a `featuredImg.image_path` mező adja, ugyanaz a kép, mint a cikk nagy bannere.
Ha más fotót szeretnél a megosztáshoz, add meg a cikk front matterében:

```yaml
seo:
  featured_image: /images/turak/<slug>/megosztas.webp
```

Ez csak a generált közösségi kártya alapfotóját cseréli, nem a cikk fejlécét vagy
listaképét. A képet tedd a `static/images/` alá; a megadott útvonalból hagyd
el a `static` részt. Az üres vagy hiányzó `seo.featured_image` az alapképet
használja. Külső URL és SVG helyett helyi JPG, PNG vagy WebP fotót adj meg;
hibás vagy hiányzó megadott kép esetén a build jelzi a hibát.
Ha a `social_image` is ki van töltve, az elsőbbséget élvez a generált kártyával
és annak `featured_image` alapfotójával szemben.

A többi oldal (főoldal, túra- és tanfolyamlista, egyesületi oldalak) a
`data/hero_images.yaml` `images` listájából kap véletlenszerű fotót, oldalanként,
az oldal generálásakor. Csak legalább **1,5:1 szélesség/magasság arányú** képek
kerülnek ebbe a választásba, az egész pixeles méretek kerekítését megengedve
(például 1600x1067 megfelel). Álló és közel négyzetes fotót nem választ.
Ez a szűrés nem vonatkozik a cikk saját vagy kézzel felülírt fotójára;
azok középre vágva kerülnek az 1200x630-as kártyára.

A generált fotóra az FTSK-logó, márkanév és a sötét átmenet kerül;
az oldal címe csak a megosztási metaadatokban jelenik meg.
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

A résztvevőket a cikk **Page details** részében válaszd ki a kereshető
személylistából. Minden túra és minden tanfolyam saját listával rendelkezik;
a hozzárendelés nem módosítja a tagságot. A szerkesztőben a résztvevő neve
mellett a közös portré bélyegképe látható, fotó nélkül pedig a név kezdőbetűi
jelennek meg. A sorrend és az eseményen betöltött
szerep itt állítható, nem a személy általános profiljában:

A fotóra, monogramra vagy névre kattintva a személy szerkesztője nyílik meg.
A megnyitott cikk nem mentett vázlata megmarad; a **Pages & posts** menüvel
visszatérhetsz hozzá. A személy szerkesztésekor egy másik nem mentett
személyvázlat elvetéséhez külön megerősítés kell.

```yaml
participant_ids:
  - kamvas-linda
  - person: kun-imre
    roles: [turavezeto, kutatasvezeto]
  - acs-reka
```

A sablon automatikusan hozzáadja a Résztvevők címet és a közös profilokból
készülő kártyákat. Fotó nélküli személy monogramot kap. A résztvevői szerep
csak az adott eseményre vonatkozik, nem veszi át a mai egyesületi tisztséget.
Ne ismételd meg kézzel ezt a listát a törzsszövegben. A régi `participants`
névlista átmenetileg olvasható; új hozzárendeléshez ID-t használj.

Push előtt futtasd le helyben a `python scripts/verify_members.py` parancsot
(ehhez kell a `pip install PyYAML`), hogy ellenőrizd a `data/people.yaml`-t
és minden cikk szerző-, résztvevő- és kapcsolattartó-hivatkozását. A duplikált
ID, név vagy alias, hibás tagság, hiányzó fotó és ismeretlen ID hibát okoz.
A tisztázandó személyek és régi szöveges nevek tájékoztató jelzések.
Ugyanez fut a CI-ban is minden pull requestnél.

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
A banner külön állítható a **Page details → Card & banner photos →
Featured image width (%)** mezővel (`featuredImg.width`, 10–100%).
Üresen vagy elhagyva 100%; a meglévő tanfolyamok és túrabeszámolók 40%-ot
használnak. A kép középre igazodik és megtartja az arányait, telefonon is.
Ez nem változtatja meg a szövegközi képeket, listakártyákat vagy közösségi
előnézeteket, és nem méretezi át a képfájlt.
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
  `layouts/partials/sections/global/gallery.html` (a Galéria oldal).

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
- A túrabeszámolók PDF-nézete asztali képernyőn legfeljebb 1200 px széles,
  és a képernyőmagasság 85%-át használja (600–1100 px között). A cikk szövege
  továbbra is a keskenyebb olvasási sávban marad; mobilon a PDF a szövegsávhoz
  igazodik.
- Ha egy régi cikk nem PDF-re, hanem valamilyen más régi oldalra (pl. `.htm`)
  hivatkozik, azt nem kell letölteni/beágyazni - elég csak a `legacy-`
  fájlnév-előtagot alkalmazni rá.
