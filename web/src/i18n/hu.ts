// The Hungarian dictionary — and the SHAPE of every other one.
//
// This file is the source of truth for the key set: `en.ts` is typed as `Dict`
// (= `typeof hu`), so a missing or a stray key there is a compile error rather
// than a blank label discovered in production.
//
// The keys are flat and dotted, deliberately. A nested object would read a shade
// nicer, but `keyof` over a flat record gives an exact union for free — which is
// what makes `t('sleep.title')` typo-proof without any path-type machinery.
//
// `{name}` placeholders are filled in by `t()` (plain text) or `tx()` (React
// nodes). Keys ending in `.one` / `.other` are plural forms, chosen by
// `Intl.PluralRules` via `tp()`; Hungarian does not inflect after a numeral, so
// both forms are the same here — English is where they differ.

export const hu = {
  ui: {
    // --- Navigation and chrome ---------------------------------------------
    'app.notMedical':
      'Statisztika, nem orvoslás. A Helsa nem orvostechnikai eszköz, és semmi itt nem diagnózis vagy tanács. Ami aggaszt, arról orvossal beszélj.',
    'nav.today': 'Ma',
    'nav.trends': 'Trendek',
    'nav.workouts': 'Edzések',
    'nav.sleep': 'Alvás',
    'nav.nutrition': 'Táplálkozás',
    'nav.challenge': 'Havi kihívás',
    'nav.coverage': 'Adat-teljesség',
    'nav.ingest': 'Feltöltési sor',
    'nav.settings': 'Beállítások',
    'lang.aria': 'Nyelv megválasztása',
    'lang.hu': 'Magyar',
    'lang.en': 'Angol',

    // --- Shared units and separators ---------------------------------------
    'unit.minShort': 'p',
    'unit.hourShort': 'ó',
    'unit.bpm': 'bpm',
    'unit.kmh': 'km/h',
    'unit.perKm': '/km',
    'unit.per100m': '/100 m',

    // --- Duration ----------------------------------------------------------
    'duration.hm': '{h} ó {m} p',
    'duration.h': '{h} óra',
    'duration.m': '{m} p',

    // --- Relative time -----------------------------------------------------
    'relative.never': 'soha',
    'relative.now': 'épp most',

    // --- Error and empty states -------------------------------------------
    'error.noToken.title': 'Nincs érvényes eszköz-token',
    'error.noToken.body':
      'Állítsd be a Beállítások oldalon. Egyfelhasználós rendszer — nincs bejelentkezés, csak egy token, amit egyszer kell megadni ezen a gépen.',
    'error.generic.title': 'Hiba történt',
    'error.generic.detail': 'A backend nem válaszolt a várt módon.',

    // --- Ranges ------------------------------------------------------------
    'range.day': 'Nap',
    'range.week': 'Hét',
    'range.month': 'Hónap',
    'range.year': 'Év',

    // --- Dashboard ---------------------------------------------------------
    'dashboard.title': 'Ma',
    'dashboard.tz': 'időzóna: {tz}',
    'dashboard.lastSync': 'eszköz utoljára látva: {when}',
    'dashboard.empty.title': 'Még nincs adat',
    'dashboard.empty.hint':
      'Az iPhone az egyetlen feltöltő — amint szinkronizál, itt megjelenik.',
    'dashboard.rings.title': 'Aktivitás-gyűrűk',
    'dashboard.rings.move': 'Mozgás',
    'dashboard.rings.exercise': 'Edzés',
    'dashboard.rings.stand': 'Állás',
    'dashboard.rings.empty.title': 'Nincs gyűrű-adat',
    'dashboard.rings.empty.hint': 'A HealthKit napi activity-summaryja még nem érkezett meg.',

    // --- Trends ------------------------------------------------------------
    'trends.title': 'Trendek',
    'trends.subtitle': 'Hosszabb távú alakulás, a saját időzónád szerint bucketelve.',
    'trends.metric': 'Metrika',
    'trends.degraded.title': 'Ez a típus mintánkénti átlagként érkezik, nem napi összegként',
    'trends.degraded.body':
      'A {metric} összegzendő metrika, de a szerver csak azt az öt típust ismeri név szerint, aminek beégetett aggregációja van — a többire átlagot, minimumot és maximumot ad vissza, darabszámot nem. Napi összeget ebből nem lehet visszaállítani, ezért itt az egy mintára jutó átlag látszik. A javítás helye a backend {file} metricMeta táblája.',
    'trends.empty.title': 'Nincs adat ebben az időszakban: {metric}',
    'trends.empty.hintElsewhere':
      'Erre a típusra van adat, csak nem ebben az ablakban — válts időtávot.',
    'trends.empty.hintNever':
      'Erre a típusra még nem érkezett minta. A HealthKit nem különbözteti meg a „nincs adat” és a „nincs engedély” esetet — mindkettő üres.',
    'trends.extremes': 'Szélsőértékek',
    'trends.periodAverage': 'Átlag az időszakban',
    'trends.periodTotal': 'Összesen az időszakban',
    'trends.bandNote': '· a halvány sáv a bucketen belüli minimum–maximum',

    // --- Trendek · lépkedés az időszakok között ------------------------------
    // Ahogy a GÖRDÜLŐ ablakot hívjuk. Saját neve nincs — a múlt péntektől a
    // mostaniig tartó szakaszt senki nem nevezi sehogy —, ezért azzal nevezzük
    // meg, ami. A naptári ablak a valódi nevét kapja („2026. augusztus”), amit
    // az `Intl` állít elő, nem egy itteni kulcs: a hónapneveket a böngésző
    // amúgy is tudja, minden nyelven.
    'trends.window.day': 'Ma, óránként',
    'trends.window.week': 'Az elmúlt 7 nap',
    'trends.window.month': 'Az elmúlt 30 nap',
    'trends.window.year': 'Az elmúlt 12 hónap',
    'trends.step.back': 'Korábbi időszak',
    'trends.step.forward': 'Későbbi időszak',
    'trends.step.now': 'Vissza a mához',
    // ⚠️ A lefúrás-súgó szintenként ki van írva, nem egy időtáv-névből áll
    // össze, mert a hónap → hét lépés az, ami meglepi az embert: a hónap
    // oszlopai napok, egy koppintás mégis a körülötte lévő hetet nyitja meg.
    'trends.drill.toMonth': 'Koppints a grafikonra: megnyílik az a hónap.',
    'trends.drill.toWeek':
      'Koppints a grafikonra: megnyílik a köré eső hét — az oszlopok napok, de a hét az a szint, amire általában gondolunk.',
    'trends.drill.toDay': 'Koppints a grafikonra: megnyílik az a nap, óránként.',
    'trends.table.hint':
      'Billentyűzettel a grafikon alatti táblázat ugyanezeket az időszakokat nyitja meg.',
    'trends.table.summary': 'A grafikon számai',
    'trends.table.period': 'Időszak',
    'trends.table.value': 'Érték',
    'trends.table.notMeasured': 'nincs mérés',
    'trends.table.open': 'Megnyitás: {period}',
    'trends.loading': 'Az új időszak töltődik…',
    'trends.chartDesc':
      'Bucketenként egy oszlop vagy pont, {period}. Az üres bucketekben nem volt mérés. A grafikon alatti táblázat ugyanezeket a számokat sorolja fel.',

    // --- Trendek · az előző időszakhoz képest --------------------------------
    // ⚠️ Se szín, se ítélet. Egy növekedés hol öröm (lépés), hol figyelmeztetés
    // (nyugalmi pulzus); ez az oldal nem tudhatja, melyikre kíváncsi az olvasó,
    // ezért kimondja a tényt, és megáll.
    'trends.compare.title': 'Az előző időszakhoz képest',
    'trends.compare.unchanged': 'Nem változott',
    'trends.compare.previous': 'Az előző időszak ({dates}): {value}',
    'trends.compare.none':
      'Az előző időszakban nem volt mérés, tehát nincs mihez hasonlítani. Ez nem nullára esés — ez hiány.',
    'trends.compare.clipped':
      'Ez az időszak még tart, ezért csak az eltelt {days} napot hasonlítjuk össze — az előző időszak ugyanazon {days} napjával, nem az egészével. Huszonhét nap harmincegy mellett zuhanásnak látszana.',
    'trends.compare.coverage.day':
      'Mért órák: {a} / {total}; az előző időszakban {b} / {prevTotal}.',
    'trends.compare.coverage.week':
      'Mért napok: {a} / {total}; az előző időszakban {b} / {prevTotal}.',
    'trends.compare.coverage.month':
      'Mért napok: {a} / {total}; az előző időszakban {b} / {prevTotal}.',
    'trends.compare.coverage.year':
      'Mért hónapok: {a} / {total}; az előző időszakban {b} / {prevTotal}.',
    'trends.compare.uneven':
      'Nincs összevetés: a két időszakban nagyon eltérő arányban volt mérés, és kevesebb mért nap összege már ettől is kisebb. Az előző időszak ({dates}): {value}.',
    'trends.compare.unevenAvg':
      'A két átlag nagyon eltérő számú mérésre támaszkodik, ezért a különbséget lazán érdemes olvasni.',

    // --- Trends · a szokásos tartomány --------------------------------------
    // ⚠️ „Szokásos”, soha nem „normális”: a normálisnak orvosi csengése van, amit
    // ez a szám nem érdemel meg — az elmúlt két hónap leírása, nem laboratóriumi
    // referenciatartomány. Az öt szó az appé (`TrendStanding.label`), és a
    // kettőnek egyeznie kell: aki a telefonján ezt olvassa, a böngészőben ne
    // találkozzon másik megfogalmazással ugyanarról a számról.
    // Ugyanaz a mondat, ami az app grafikon-jelmagyarázatában áll: ugyanarra a
    // kérdésre felel — mi az a halvány téglalap —, és a napok számának kimondása a
    // lényege. Egy 14 napon és egy 60 napon nyugvó sáv nem egyformán erős állítás.
    'trends.usual.band':
      'A széles sáv a szokásos tartományod: az utolsó {days} mért nap közepe, annyi szórással, amennyi ezekben a napokban volt.',
    'trends.usual.pending':
      'Még nincs elég mért nap a szokásos tartományhoz ({days}/{min}). Addig nem rajzolunk sávot — egy kevesebb napra támaszkodó sáv nem szűkebb állítás lenne, hanem ugyanolyan magabiztos.',
    'trends.usual.flat':
      'Nincs rajzolható szokásos tartomány: a viszonyítási időszak mind a(z) {days} mért napján ugyanaz volt az érték ({value}), így nincs szórás, amiből sáv lenne. Ez nem adathiány.',
    'trends.usual.unavailable':
      'A szerver nem küldött szokásos tartományt ehhez a méréshez, pedig mért napból van elég ({days}).',
    'trends.standing.wellBelow': 'Jóval a szokásod alatt',
    'trends.standing.below': 'A szokásod alatt',
    'trends.standing.typical': 'A szokásos tartományodban',
    'trends.standing.above': 'A szokásod fölött',
    'trends.standing.wellAbove': 'Jóval a szokásod fölött',

    // --- Trendek · napról napra és a testsúly-trend ----------------------------
    // A szövegek a telefonéi (`DayValueGrid.swift`, `WeightTrend.swift`,
    // `TrendsView.swift`), hogy a kettő ugyanazt mondja ugyanarról a számról.
    'daygrid.aria': 'Napról napra',
    'daygrid.noData': 'nincs adat',
    'daygrid.gaps.one': '{n} napon nincs mérés — az a mező üres, nem nulla.',
    'daygrid.gaps.other': '{n} napon nincs mérés — azok a mezők üresek, nem nullák.',
    'trends.dayGrid.title': 'Napról napra',
    'trends.weight.title': 'Trendvonal',
    'trends.weight.series': 'Trendvonal',
    'trends.weight.rate': '{rate} {unit}/hét',
    'trends.weight.rateNoUnit': '{rate}/hét',
    'trends.weight.explanation':
      'A trendvonal változása az elmúlt {days} napban. Nem a mérések különbsége: a napi ingadozás a sótól, a víztől és a mérés időpontjától jön, nem tőled.',
    'trends.weight.noRate':
      'A vonal megvan, de a heti változáshoz legalább {days} napnyi megszakítás nélküli szakasz kell.',
    'trends.weight.yearly':
      'Az éves nézet havi átlagokat mutat — azokra a trendvonal már nem mond újat. Válts a „Hónap” nézetre.',
    'trends.weight.fewSamples':
      'A trendvonalhoz legalább {min} mérés kell egy megszakítás nélküli szakaszon belül — most {count} van. Addig a nyers mérések látszanak, kitalált görbe nélkül.',
    'trends.weight.shortSpan':
      'A mérések {span} napot fognak át; a trendvonalhoz legalább {min} nap kell. Rövidebb szakaszon a görbe még jórészt az első mérés lenne, csak trendnek öltöztetve.',
    'trends.weight.legend':
      'A sötét vonal a súlyozott mozgóátlag: a napi ingadozást simítja el. Ahol több mint {days} nap kimarad, ott megszakad — azalatt nem tudjuk, mi történt.',

    // --- Workouts ----------------------------------------------------------
    'workouts.title': 'Edzések',
    'workouts.subtitle':
      'Az edzések hónapokba rendezve, a legfrissebbel kezdve. Egy becsukott hónap egyetlen sor, és egy két készülékkel rögzített edzés is egyetlen sor.',
    'workouts.empty.title': 'Még nincs edzés',
    'workouts.empty.hint':
      'A Watch edzései a párosított iPhone HealthKitjébe kerülnek, onnan töltődnek fel.',
    'workouts.col.type': 'Típus',
    'workouts.col.when': 'Mikor',
    'workouts.col.duration': 'Időtartam',
    'workouts.col.energy': 'Energia',
    'workouts.col.distance': 'Táv',
    'workouts.col.avgHr': 'Átlag pulzus',
    'workouts.col.maxHr': 'Max pulzus',
    'workouts.hrNote':
      'Üres pulzus-oszlop: a minták csak a HealthKit {field}-ját ismerik, a szerver-oldali edzés-azonosítóhoz kötés az ingest workerben történik.',
    'workouts.filter.title': 'Szűrő',
    'workouts.filter.place': 'Helyszín',
    'workouts.place.any': 'Bárhol',
    'workouts.place.indoor': 'Fedett',
    'workouts.place.outdoor': 'Szabadtéri',
    'workouts.filter.minDuration': 'Legalább ennyi ideig',
    'workouts.filter.minDistance': 'Legalább ennyi táv',
    'workouts.filter.minEnergy': 'Legalább ennyi energia',
    'workouts.filter.minHr': 'Átlagpulzus ettől',
    'workouts.filter.maxHr': 'Átlagpulzus eddig',
    'workouts.filter.noLimit': 'Nincs korlát',
    'workouts.filter.clear': 'Szűrő törlése',
    'workouts.filter.count.one': '{n} edzésből {shown} látszik',
    'workouts.filter.count.other': '{n} edzésből {shown} látszik',
    'workouts.filter.none.title': 'Egyetlen edzés sem felel meg a szűrőnek',
    'workouts.filter.none.hint.one': '{n} edzés van a listában — próbáld tágítani a szűrőt.',
    'workouts.filter.none.hint.other': '{n} edzés van a listában — próbáld tágítani a szűrőt.',
    'workouts.filter.missingNote':
      'Amelyik edzés nem tud válaszolni egy szűrőre, azt a szűrő nem rejti el. Egy erősítő edzésnek nincs távja, így a „legalább 5 km” bent hagyja ahelyett, hogy a hiányzó távot nullának olvasná.',
    'workouts.month.count.one': '{n} edzés',
    'workouts.month.count.other': '{n} edzés',
    'workouts.month.open.one': '{n} lezáratlan, az összegen kívül',
    'workouts.month.open.other': '{n} lezáratlan, az összegen kívül',
    'workouts.fold.identical.one':
      '{n} lehetséges egyező felvétel erről az edzésről — az időtartam, a táv és az energia 0,5%-on belül egyezik.',
    'workouts.fold.identical.other':
      '{n} lehetséges egyező felvétel erről az edzésről — az időtartam, a táv és az energia 0,5%-on belül egyezik.',
    'workouts.fold.differ.one':
      '{n} lehetséges egyező felvétel erről az edzésről — az időtartam, a táv vagy az energia eltér.',
    'workouts.fold.differ.other':
      '{n} lehetséges egyező felvétel erről az edzésről — az időtartam, a táv vagy az energia eltér.',
    'workouts.dupNote':
      '{sessions} edzés úgy fest, mintha egynél többször érkezett volna meg a Healthbe: azonos tevékenység, átfedő időben (a közös időtartamuk legalább 70%-a, vagy legfeljebb 5 perc eltérés a kezdésben). A Health nem köti össze az ilyen felvételeket, így ez következtetés. A lista mindegyikről egyetlen sort mutat, így a havi összegek nem duplázódnak; további {extra} felvétel áll ezek mögött.',
    'workouts.loading.title': 'A történet még töltődik',
    'workouts.loading.body.one':
      'Eddig {n} felvétel. A régebbi hónapok még érkeznek, az összegük tehát még nem végleges.',
    'workouts.loading.body.other':
      'Eddig {n} felvétel. A régebbi hónapok még érkeznek, az összegük tehát még nem végleges.',
    'workouts.truncated.title': 'Itt megáll a történet',
    'workouts.truncated.body':
      'A régebbi edzések nincsenek ebben a listában: a lapozás elérte a korlátját. Ami fölötte van, az teljes — alatta van még.',

    // --- One workout, opened -----------------------------------------------
    'workout.back': '← Vissza az edzésekhez',
    'workout.missing.title': 'Nincs ilyen edzés',
    'workout.missing.hint':
      'A hivatkozás olyan alkalomra mutat, ami ezen a szerveren nincs meg. Vagy törölték az Egészség appban, vagy egy másik szerver linkje.',

    'workout.metric.time': 'Idő',
    'workout.metric.distance': 'Táv',
    'workout.metric.energy': 'Energia',
    'workout.metric.pace': 'Tempó',
    'workout.metric.speed': 'Sebesség',
    'workout.metric.avgHr': 'Átlagos pulzus',
    'workout.metric.maxHr': 'Csúcspulzus',
    'workout.metric.pool': 'Medence',
    'workout.metric.none.title': 'Ehhez az edzéshez nem érkezett mérés',
    'workout.metric.none.hint':
      'Az alkalmat rögzítették, de egyetlen szám sem jött vele. Ez a felvételről szóló tény, nem nulla.',

    'workout.route.title': 'Útvonal',
    'workout.route.loading': 'Töltődik az útvonal…',
    'workout.route.none': 'Ehhez az edzéshez nincs útvonal.',
    'workout.route.failed.title': 'Az útvonalat nem sikerült betölteni',
    'workout.route.failed.body':
      'Ez elbukott kérés, nem hiányzó útvonal — az edzéshez tartozhat útvonal.',
    'workout.route.start': 'Rajt',
    'workout.route.finish': 'Cél',
    'workout.route.startFinish': 'Rajt / Cél',
    'workout.route.aria': 'Az útvonal alakja: {points} rögzített pont, {length}.',
    'workout.route.dropped.one': '{n} pontatlan pont kimaradt.',
    'workout.route.dropped.other': '{n} pontatlan pont kimaradt.',
    // ⚠️ Négy állapot, és pontosan egy igaz belőlük egyszerre. A „nincs térkép"
    // az ALAPÉRTELMEZETT, és aki soha nem nyitja meg a beállítást, ebben marad.
    'workout.route.noTiles':
      'Csak a rögzített koordinátákból rajzolva: térkép nincs alatta, mert nincs bekapcsolva. A Beállításokban választhatsz forrást — és ott az is ott áll, hogy melyik mit ad tudtára kinek.',
    'workout.route.viaOwn':
      'A térkép a saját csempeszervereidről jön, a Helsa szerverén keresztül. A böngésződ csak a Helsa szerverével beszél, és a csempéket kérő gép is a tiéd.',
    'workout.route.viaPublic':
      'A térkép egy nyilvános szolgáltatótól jön, a Helsa szerverén keresztül. A böngésződ csak a Helsa szerverével beszél — a szolgáltató a Helsa szerverének címét és azt látja, melyik területet nézed.',
    'workout.route.mapUndrawable':
      'Van kiválasztott térképforrás, de ez a böngésző nem tudta megrajzolni — WebGL kell hozzá, vagy a forrás nem válaszolt. Az útvonal változatlan; a méretét a lépték adja meg.',
    // Az OpenStreetMap és az OpenMapTiles licence is látható feltüntetést kér.
    // ⚠️ Nem fordítjuk le és nem rövidítjük: ez jogi szöveg, nem felirat. És a
    // saját szövegünkből jön — egy hálózatról letöltött feltüntetés még egy dolog
    // lenne, amit valaki mástól kérünk el.
    'workout.route.attribution.osm': '© OpenStreetMap közreműködők',
    'workout.route.attribution.omt': '© OpenMapTiles © OpenStreetMap közreműködők',

    'workout.hr.title': 'Pulzus',
    'workout.hr.loading': 'Töltődnek a pulzusmérések…',
    'workout.hr.none': 'Ehhez az edzéshez nincs pulzusmérés.',
    'workout.hr.single':
      'Egyetlen pulzusmérés esik ebbe az alkalomba — kevés ahhoz, hogy görbe legyen belőle, és ahhoz is, hogy átlagot mondjunk.',
    'workout.hr.noWindow':
      'Ennek a felvételnek nincs záró ideje, így nincs időablak, amin a pulzust végigolvashatnánk.',
    'workout.hr.failed.title': 'A pulzusmérések nem tölthetők be',
    'workout.hr.failed.body': 'Elbukott kérés, nem hiányzó mérés.',
    'workout.hr.average': 'Átlag',
    'workout.hr.peak': 'Csúcs',
    'workout.hr.lowest': 'Legalacsonyabb',
    'workout.hr.fromWindow':
      'A görbe és a fölötte álló három szám minden olyan pulzusmérés, amit az alkalom időablakában bármelyik készülék vagy app rögzített. Egy mérés nincs felvételhez kötve, így egy másik készülék ugyanazon percekből származó mérései is benne vannak.',
    'workout.hr.truncated':
      'A görbe félbemarad: ebben az alkalomban több mérés van, mint amennyit a beolvasás követ.',

    'workout.laps.title': 'Etapok',
    'workout.laps.col.index': '#',
    'workout.laps.note':
      'Az etapok a rögzítő alkalmazástól jönnek. Az egyetlen szakaszból álló alkalomnál nem jelenik meg semmi — egy etap a rendszer saját alakja, nem általad csinált szakasz.',

    'workout.weather.title': 'Időjárás',
    'workout.weather.condition': 'Állapot',
    'workout.weather.temperature': 'Hőmérséklet',
    'workout.weather.humidity': 'Páratartalom',

    'workout.dup.title': 'Valószínűleg ugyanez az alkalom, máshol is rögzítve',
    'workout.dup.body.one':
      'Ez az alkalom úgy fest, mintha {n} alkalommal szerepelne az Egészségben.',
    'workout.dup.body.other':
      'Ez az alkalom úgy fest, mintha {n} alkalommal szerepelne az Egészségben: azonos tevékenység felvételei átfedő időben — órától és apptól, vagy két apptól. A Health nem köti össze őket, így ez következtetés. A lista egy sort mutat belőle; itt vannak a többiek, pontosan úgy, ahogy rögzítették őket.',
    'workout.dup.thisOnly':
      'A fenti összesítő számok ennek az egy felvételnek a számai, és ez az oldal nem átlagolja össze a felvételeket: két készülék ugyanarra a fél órára mást mér, és nem a mi dolgunk eldönteni, melyiknek higgy. A pulzusgörbe a kivétel — abban az alkalom időablakának minden mérése benne van, bármelyik készülék rögzítette.',
    'workout.dup.secondary': 'A listában ennek az alkalomnak a másik felvétele látszik, nem ez.',
    'workout.dup.listed': 'ez látszik a listában',
    'workout.dup.noMeasurement': 'Ezen a felvételen nincs mérés.',
    'workout.dup.keep':
      'A Helsa egyiket sem törli: ez a te egészségadatod, és nem a mi dolgunk eldönteni, melyik felvétel maradjon.',
    'workout.dup.checking': 'Ellenőrizzük, rögzítették-e ezt az alkalmat többször is…',

    'workout.source.title': 'Honnan jött',
    'workout.source.uuid': 'HealthKit-azonosító',
    'workout.source.gap':
      'A dróton csak a mintákhoz tartozik forráskészülék, így ez csak azt mondja meg, ki írta a pulzust, mást nem. Hogy melyik app rögzítette magát az alkalmat, és melyik írta az útvonalat, az a telefonon, a HealthKitben van — a szerver nem tudja meg.',

    'device.watch': 'Apple Watch',
    'device.iphone': 'iPhone',

    // --- Weather conditions (HKWeatherCondition) ---------------------------
    // ⚠️ Saját kulcsokon, nem az angol szavakon. A telefonon az időjárás
    // „Clear”-je egy kulcson ül a szűrő „Clear” gombjával, a magyar bundle
    // pedig „Törlés”-nek fordítja — a derült ég ott „Törlés”-ként olvasható.
    'weather.clear': 'Derült',
    'weather.fair': 'Kellemes',
    'weather.partlyCloudy': 'Részben felhős',
    'weather.mostlyCloudy': 'Erősen felhős',
    'weather.cloudy': 'Borult',
    'weather.foggy': 'Ködös',
    'weather.haze': 'Párás',
    'weather.windy': 'Szeles',
    'weather.blustery': 'Viharos szél',
    'weather.smoky': 'Füstös',
    'weather.dust': 'Poros',
    'weather.snow': 'Havazás',
    'weather.hail': 'Jégeső',
    'weather.sleet': 'Havas eső',
    'weather.freezingDrizzle': 'Ónos szitálás',
    'weather.freezingRain': 'Ónos eső',
    'weather.mixedRainAndHail': 'Eső jégesővel',
    'weather.mixedRainAndSnow': 'Eső havazással',
    'weather.mixedRainAndSleet': 'Eső havas esővel',
    'weather.mixedSnowAndSleet': 'Hó havas esővel',
    'weather.drizzle': 'Szitálás',
    'weather.scatteredShowers': 'Szórványos zápor',
    'weather.showers': 'Zápor',
    'weather.thunderstorms': 'Zivatar',
    'weather.tropicalStorm': 'Trópusi vihar',
    'weather.hurricane': 'Hurrikán',
    'weather.tornado': 'Tornádó',

    // --- Sleep -------------------------------------------------------------
    'sleep.title': 'Alvás',
    'sleep.subtitle':
      'Éjszakánként, szakaszokra bontva. A minőség-mutatók — hatékonyság, felébredések, szakasz-arányok — {derived} értékek a szakaszokból; a HealthKitben nincs „alvásminőség” mező. Egy éjszaka a folytonos szakaszok sora: három óránál hosszabb szünet után új tétel kezdődik, így a szunyókálás külön látszik.',
    'sleep.subtitle.derived': 'számított',
    'sleep.window.one': '{n} éjszaka',
    'sleep.window.other': '{n} éjszaka',
    'sleep.empty.title': 'Még nincs alvás-adat',
    'sleep.empty.hint':
      'Az alvás-szakaszokat a Watch rögzíti, és a párosított iPhone tölti fel.',
    'sleep.avgSleep.one': 'Átlagos alvásidő — {n} éjszaka',
    'sleep.avgSleep.other': 'Átlagos alvásidő — {n} éjszaka',
    'sleep.efficiency': 'Alvás-hatékonyság',
    'sleep.awakeningsPerNight': 'Felébredések / éjszaka',
    'sleep.deepRemShare': 'Mély + REM arány',
    'sleep.stagesChart': 'Szakaszok éjszakánként (perc)',
    'sleep.physio.title': 'Élettani mutatók az időszakban',
    'sleep.physio.note':
      'Ezek az egész időszak átlagai, nem kizárólag az alvás-ablakból — a minták alvás-ablakra szűrése a backend {insights} rétegére vár (docs/23 §5).',
    'sleep.night.title': '{date} — alvás {duration}',
    'sleep.night.latest': 'Múlt éjjel · {date} — alvás {duration}',
    'sleep.night.title.notRecorded': '{date} — az alvás hossza nincs rögzítve',
    'sleep.night.latest.notRecorded': 'Múlt éjjel · {date} — az alvás hossza nincs rögzítve',
    'sleep.nights.title.one': 'Az időszak éjszakája',
    'sleep.nights.title.other': 'Az időszak {n} éjszakája',
    'sleep.nights.hint':
      'Válassz egy éjszakát, és fent kinyílik. A sáv az adott éjszaka szakaszainak aránya; az utolsó két oszlop a hatékonyság és a felébredések száma.',
    'sleep.stagesChart.hint': 'Kattints egy oszlopra, és az az éjszaka nyílik meg fent.',
    'sleep.gap.one':
      'Az utolsó {n} éjszakából {nights} hordoz alvás-adatot. A többi olyan éjszaka, amiről semmi nem rögzült — nem alvás nélküli éjszaka.',
    'sleep.gap.other':
      'Az utolsó {n} éjszakából {nights} hordoz alvás-adatot. A többi olyan éjszaka, amiről semmi nem rögzült — nem alvás nélküli éjszaka.',
    'sleep.night.aria': 'Alvás-szakaszok {date}',
    'sleep.overlap':
      'A források {duration} átfedést írtak erre az éjszakára; az átfedés egyszer számít, ezért az összesen kevesebb, mint a szakaszok összege.',
    'sleep.inBed': 'Ágyban',
    'sleep.efficiencyShort': 'Hatékonyság',
    'sleep.onset': 'Elalvás',
    'sleep.wakeUp': 'Ébredés',
    'sleep.awakenings': 'Felébredések',
    'sleep.deepRem': 'Mély + REM',
    'sleep.col.stage': 'Szakasz',
    'sleep.col.length': 'Hossz',
    'sleep.col.shareOfSleep': 'Arány az alvásidőn belül',
    'sleep.col.start': 'Kezdet',
    'sleep.col.end': 'Vége',
    'sleep.raw.one': 'Nyers szakaszok ({n})',
    'sleep.raw.other': 'Nyers szakaszok ({n})',

    // --- Nutrition ---------------------------------------------------------
    'nutrition.title': 'Táplálkozás',
    'nutrition.subtitle':
      'Bevitt energia, makrók és mikrotápanyagok. A Health-be egy étkezés-naplózó app írja őket; a Helsa csak olvassa.',
    'nutrition.range.day': 'Ma',
    'nutrition.range.week': 'Hét',
    'nutrition.range.month': '30 nap',
    'nutrition.degraded.title': 'A napi összegek helyett mintánkénti átlagot mutat a szerver',
    'nutrition.degraded.body':
      'A táplálkozási típusok mind összegzendők, de a backend csak öt metrika aggregációját ismeri név szerint ({file}), a többire átlagot ad vissza darabszám nélkül. A napi bevitel ebből nem állítható helyre, ezért az itt látszó számok egy-egy bejegyzés átlagát jelentik, nem a napi összeget.',
    'nutrition.empty.title': 'Még nincs táplálkozási adat',
    'nutrition.empty.hint':
      'A HealthKit magától nem gyűjt étkezést — egy naplózó app (pl. kalóriaszámláló) írja a Health-be, és onnan tölti fel az iPhone.',
    'nutrition.headline.sampleAverage': 'Mintánkénti átlag',
    'nutrition.headline.todayTotal': 'Ma összesen',
    'nutrition.headline.dailyAverage': 'Napi átlag',
    'nutrition.stat': '{metric} — {headline}',
    'nutrition.macroSplit.title': 'Makró-bontás (energia szerint)',
    'nutrition.macroSplit.aria': 'Makró-arány energia szerint',
    'nutrition.macroSplit.note':
      'A fenti grammokból számolt energia {computed} kcal (4 / 4 / 9 kcal per gramm). A HealthKit külön mért {field} értéke {measured} kcal — a kettő eltérhet, ha a naplózó app nem minden tételhez rögzít makrókat.',
    'nutrition.chart.perBucket': 'Makrók energiája bucketenként (kcal)',
    'nutrition.chart.perDay': 'Makrók energiája naponta (kcal)',
    'nutrition.section.macros': 'Makrók részletesen',
    'nutrition.section.minerals': 'Ásványi anyagok',
    'nutrition.section.vitamins': 'Vitaminok',
    'nutrition.col.nutrient': 'Tápanyag',
    'nutrition.col.periodTotal': 'Időszak összesen',
    'nutrition.col.unit': 'Egység',
    'nutrition.hideEmpty': 'Az adat nélküli tápanyagok elrejtése',
    'nutrition.showEmpty.one': 'Az adat nélküli {n} tápanyag mutatása',
    'nutrition.showEmpty.other': 'Az adat nélküli {n} tápanyag mutatása',

    // --- Havi kihívás ------------------------------------------------------
    'challenge.title': 'Havi kihívás',
    'challenge.subtitle':
      'A hónap lépésszáma a saját mérföldköveidhez mérve. A mérföldköveket a telefonon állítod be; itt csak az látszik, ami fel is töltődött.',
    'challenge.prevMonth': 'Előző hónap',
    'challenge.nextMonth': 'Következő hónap',
    'challenge.notStarted': 'Ez a hónap még el sem kezdődött.',
    'challenge.empty.title': 'Ebből a hónapból még nincs mérés',
    'challenge.empty.hint':
      'Ez nem nulla lépés: egyetlen nap sem érkezett meg. A feltöltő egyedül az iPhone — amint szinkronizál, megjelenik itt.',
    'challenge.steps': 'A hónap lépésszáma',
    'challenge.stepsPerDay': 'Naponta, az eltelt napokra osztva',
    'challenge.ofGoal': 'A célból',
    'challenge.daysRemaining': 'Hátralévő napok (a maival együtt)',
    'challenge.goalLabel': 'Cél: {steps} lépés',
    'challenge.complete': 'A cél megvan.',
    'challenge.overshoot': '{steps} lépéssel a célon túl.',
    'challenge.milestones.title': 'Mérföldkövek',
    'challenge.milestones.empty':
      'Egyetlen mérföldkő sincs beállítva, így nincs mihez mérni a hónapot.',
    'challenge.milestones.reached': 'megvan',
    'challenge.milestones.next': 'A következő {steps} lépésnél van — {remaining} lépésre.',
    'challenge.source.title': 'Honnan jönnek a mérföldkövek',
    'challenge.source.default':
      'A gyári sor látszik: a telefon még nem mondta el ennek a szervernek, milyen mérföldköveket állítottál be. Ami a telefonon látszik, eltérhet ettől.',
    'challenge.source.achievement':
      'A telefon által legutóbb rögzített érem pillanatképéből. A mérföldkövek a telefonon élnek, külön nem szinkronizálódnak.',
    'challenge.days.title': 'Napról napra',
    'challenge.days.empty': 'Ebből a hónapból még egyetlen nap sem érkezett meg.',
    'challenge.days.gaps.one':
      '{n} nap mérés nélkül — az üres hely hiányzó adat, nem mozdulatlan nap.',
    'challenge.days.gaps.other':
      '{n} nap mérés nélkül — az üres helyek hiányzó adatok, nem mozdulatlan napok.',
    'challenge.streak.title': 'Napi sorozat',
    'challenge.streak.length.one': '{n} napos sorozat',
    'challenge.streak.length.other': '{n} napos sorozat',
    'challenge.streak.current': 'A most futó sorozat',
    'challenge.streak.none': 'Nincs élő sorozat.',
    'challenge.streak.noGoal': 'Cél nélkül nincs mihez mérni egy napot, így sorozatot sem állítunk.',
    'challenge.streak.dailyGoal': 'Napi cél',
    'challenge.streak.longest': 'A leghosszabb a vizsgált időszakban',
    'challenge.streak.window': 'A vizsgált időszak: {from} – {to}.',
    'challenge.streak.broken.missed': '{date} — a napi cél alatt maradt; a sorozat itt indult újra.',
    'challenge.streak.broken.noData':
      '{date} — erről a napról nem érkezett lépésszám. Nem kihagyott nap: egyszerűen nem tudunk róla.',
    'challenge.streak.broken.startOfHistory':
      'A sorozat a vizsgált időszak elejéig ér — az annál régebbi napokról nem állítunk semmit.',
    'challenge.streak.lowerBound.title': 'A telefon ennél többet tud',
    'challenge.streak.lowerBound.body':
      'A betegnapok és az általad megjelölt pihenőnapok nem törik meg a sorozatot — de egyik sem jut el a szerverig: a napló a telefonon marad, a pihenőnap pedig helyi beállítás. Az itteni sorozat ezért rövidebb lehet a telefonon látszónál, hosszabb soha.',

    // --- Settings ----------------------------------------------------------
    'settings.title': 'Beállítások',
    'settings.subtitle':
      'Egyfelhasználós rendszer — nincs bejelentkezés. A hozzáférés két rétegű: hálózati (WireGuard) és alkalmazás-szintű (eszköz-token).',
    'settings.token.title': 'Eszköz-token',
    'settings.token.present': 'Be van állítva ezen a gépen. Új gépen egyszer kell megadni.',
    'settings.token.clear': 'Token törlése',
    'settings.token.hint': 'Illeszd be a tokent — a böngésző tárolja, a szerver nem kér jelszót.',
    'settings.token.placeholder': 'eszköz-token',
    'settings.token.save': 'Mentés',
    'settings.devices.title': 'Eszközök és szinkron-frissesség',
    'settings.devices.empty': 'Még nincs regisztrált eszköz.',
    'settings.devices.col.device': 'Eszköz',
    'settings.devices.col.platform': 'Platform',
    'settings.devices.col.lastSync': 'Utolsó szinkron',
    'settings.goals.title': 'Célok',
    'settings.goals.empty': 'Még nincs cél-adat.',
    'settings.goals.note':
      'A három Apple gyűrű célja a HealthKitből jön (csak olvasható); a lépés-cél felhasználó által állított.',
    'settings.system.title': 'Rendszer',
    'settings.system.browserTz': 'Böngésző időzónája',
    'settings.system.serverTz': 'Szerver időzónája',
    'settings.system.units': 'Mértékegység',
    // --- Beállítások · térképforrás -----------------------------------------
    // ⚠️ A választás egy adatvédelmi alku, és nem a miénk: a csempekérés annak,
    // aki kiszolgálja, elárulja, hogy valaki épp azt a földdarabot nézi. Ezért a
    // képernyő MINDHÁROM lehetőségnél kimondja a következményt, mielőtt
    // választanál — és alapból a „semmit nem küld" állapotban áll.
    'settings.map.title': 'Térkép az útvonal alatt',
    'settings.map.intro':
      'Az edzés útvonala magától nem kap térképet. Ha kap, a csempéket valakinek ki kell szolgálnia — itt dől el, hogy kinek.',
    'settings.map.off.label': 'Nincs térkép',
    'settings.map.off.note': 'Csak a megrajzolt útvonal, ahogy eddig. Senki nem tud meg semmit. Ez az alapértelmezés.',
    'settings.map.own.label': 'Saját csempeszerver',
    'settings.map.own.note':
      'A te géped szolgálja ki a csempéket — a deploy/ mappában lévő opcionális konténer, vagy bármi más, ami a tiéd. Idegenhez semmi nem jut el.',
    'settings.map.public.label': 'Nyilvános, nyílt forrású szolgáltató',
    'settings.map.public.note':
      'OpenStreetMap-alapú csempék az internetről. A szolgáltató — egy idegen — látja a kérést: a Helsa szerverének címét és azt, melyik területet nézed.',
    'settings.map.url.label': 'A csempeszolgáltatás címe',
    'settings.map.url.ok': 'Ez a cím használható.',
    'settings.map.problem.empty': 'Adj meg egy címet, különben nem lesz térkép.',
    'settings.map.problem.scheme': 'Ennek http:// vagy https:// címnek kell lennie.',
    'settings.map.problem.placeholders':
      'A címben szerepelnie kell a {z}, {x} és {y} helyőrzőnek — ezekbe kerül a csempe koordinátája.',
    'settings.map.format.label': 'Milyen csempéket ad ez a cím',
    'settings.map.format.raster': 'Kép (png, jpg) — a nyilvános szolgáltatók jellemzően ilyet adnak',
    'settings.map.format.vector': 'Vektor (pbf, mvt) — a saját szerverek jellemzően ilyet adnak',
    // ⚠️ Ez a mondat minden választásnál ott van, és két külön dolgot mond ki. A
    // „csak a Helsa szerverével beszél" NEM azonos azzal, hogy „semmi nem jut ki".
    'settings.map.proxyNote':
      'A csempék mindig a Helsa szerverén keresztül jönnek, sosem közvetlenül a böngésződből: így a böngésződ egyetlen idegen géppel sem beszél. Amit a szolgáltató lát, az ezért a Helsa szerverének címe és a nézett terület — nem a tiéd.',
    'settings.map.saved': 'Elmentve. Ez a beállítás ebben a böngészőben él.',

    'settings.language.title': 'Nyelv',
    'settings.language.note':
      'A felület nyelve. Csak a böngészőben tárolódik — a szervertől érkező szöveg (insights-mondatok, hibaüzenetek) ettől függetlenül a szerver nyelvén marad.',

    // --- Metric picker -----------------------------------------------------
    'picker.search': 'Keresés {n} metrika közt…',
    'picker.searchAria': 'Metrika keresése',
    'picker.onlyWithData': 'Csak amire van adat',
    'picker.onlyWithDataTitle':
      'A HealthKit nem árulja el, hogy egy típusra nincs adat vagy nincs engedély — mindkettő üres.',
    'picker.all': 'Mind',
    'picker.noMatch': 'Nincs találat erre a szűrésre.',
    'picker.listAria': 'Metrikák',
    'picker.noDataYet': '{key} — még nincs adat',
    'picker.selected':
      'Kiválasztva: {name} · a {sum} jelű metrikák összegződnek az időszakra, az {avg} jelűek átlagolódnak.',

    // --- Observations ------------------------------------------------------
    // The two nav labels belong with the block above; they are down here because
    // several pages were being added at once and appending is the only way to do
    // that without three agents rewriting the same lines.
    'nav.insights': 'Megfigyelések',
    'nav.achievements': 'Érmek',

    'insights.title': 'Megfigyelések',
    'insights.subtitle':
      'Amit a szabályok a mért napokban találtak. Mozgóátlag, z-érték és korreláció — nincs mögötte modell, és egyetlen szabály sem tippel meg nem mért napot.',
    'insights.serverLanguage':
      'Az alábbi mondatokat a szerver fogalmazza, és azon a nyelven jelennek meg, amelyen a szerver beszél. A nyelvváltó ezt a felületet állítja, nem őket.',
    'insights.empty.title': 'Most nincs mit jelenteni',
    'insights.empty.hint':
      'Ez teljes válasz, nem hiba. Minden szabálynak van egy minimum mért napszáma, és amelyik ez alatt van, inkább hallgat, mint hogy kitaláljon valamit.',
    'insights.kind.anomaly': 'Eltérés a saját alapvonaladtól',
    'insights.kind.anomaly.about':
      'A közeli napok a saját, hosszabb alapvonal-ablakodhoz mérve.',
    'insights.kind.trend': 'Változás az előző ablakhoz képest',
    'insights.kind.trend.about': 'Egy ablak összevetve a közvetlenül előtte lévővel.',
    'insights.kind.correlation': 'Két sor együtt mozog',
    'insights.kind.correlation.about':
      'Együttmozgás egy hosszabb ablakon. Az együttmozgás nem azt jelenti, hogy az egyik okozza a másikat.',
    'insights.kind.pattern': 'Az ablak egy tulajdonsága',
    'insights.kind.pattern.about':
      'Nem időbeli változás: mennyire szórnak az értékek, miben tér el a hétvége a hétköznaptól.',
    'insights.kind.other': 'Egyéb megfigyelések',
    'insights.kind.other.about':
      'A szervernek van egy szabálycsaládja, amit a web ezen builde még nem ismer név szerint.',
    'insights.severity.info': 'Tájékoztatás',
    'insights.severity.notice': 'Érdemes ránézni',
    'insights.generatedAt': 'számítva: {when}',
    'insights.unnamed': 'A szerver nem küldött mondatot ehhez a szabályhoz.',
    'insights.values.summary': 'A szabály által számolt számok',
    'insights.values.note':
      'Ezek a megfigyeléssel együtt utaznak, hogy a kliens maga fogalmazhassa meg a mondatot. A szabály saját számításai, nem pontszám.',
    'insights.col.value': 'Érték',

    // --- Medals ------------------------------------------------------------
    'achievements.title': 'Érmek',
    'achievements.subtitle':
      'A már megszerzett mérföldkövek. Mindegyik történeti tény — egy adott pillanatban teljesült feltétel feljegyzése, úgy megőrizve, ahogy akkor állt.',
    'achievements.empty.title': 'Még nincs érem',
    'achievements.empty.hint':
      'Ezeket a telefon számolja ki és tölti fel; a web csak olvassa a listát. Eddig semmi nem érkezett.',
    'achievements.total.one': '{n} érem',
    'achievements.total.other': '{n} érem',
    'achievements.kind.month': 'Havi',
    'achievements.kind.year': 'Éves',
    'achievements.kind.streak': 'Sorozatok',
    'achievements.kind.record': 'Rekordok',
    'achievements.kind.milestone': 'Mérföldkövek',
    'achievements.kind.other': 'Egyéb érmek',
    'achievements.col.badge': 'Érem',
    'achievements.col.period': 'Időszak',
    'achievements.col.value': 'Érték a szerzéskor',
    'achievements.col.thresholds': 'Akkor érvényes küszöbök',
    'achievements.col.earned': 'Megszerezve',
    'achievements.code.complete': 'Teljesítve',
    'achievements.code.progress': 'Haladás',
    'achievements.code.bestMonth': 'Legjobb hónap',
    'achievements.code.streak': 'Sorozat',
    'achievements.code.total': 'Halmozott összeg',
    'achievements.months.one': '{n} hónap',
    'achievements.months.other': '{n} hónap',
    'achievements.thresholds.aria':
      'A szerzéskor érvényes küszöbök: {all}. Ebből elért: {reached}.',
    'achievements.thresholds.none': 'egyik sem',
    'achievements.thresholds.reached': 'elért',
    'achievements.thresholds.missed': 'nem elért',
    'achievements.thresholds.note':
      'A küszöbök pillanatfelvételek arról, mi volt érvényben az érem megszerzésekor — ezért nem veszíthet az értékéből egy érem, ha a célokat később átírják.',

    // --- Érmek · egy hónap kinyitva -------------------------------------------
    // A telefon `MonthMedalDetailView` / `MonthStepsCard` szövegei.
    'achievements.month.open': '{period} megnyitása',
    'achievements.month.back': '← Az összes érem',
    'achievements.month.notFound.title': 'Ehhez a hónaphoz nincs havi érem: {period}',
    'achievements.month.notFound.hint':
      'Az érmeket a telefon számolja ki és tölti fel; az általa küldött listában erre a hónapra nincs.',
    'achievements.month.total': 'Lépés, a megszerzéskor',
    'achievements.month.perDay': 'Naponta, a teljes hónapra',
    'achievements.month.milestonesReached': 'Elért mérföldkövek',
    'achievements.month.milestones.title': 'Mérföldkövek',
    'achievements.month.steps': '{steps} lépés',
    'achievements.month.days.title': 'Napról napra',
    'achievements.month.days.perDay': 'Átlagosan napi {steps} lépés a teljes hónapban.',
    'achievements.month.days.measured.one': 'Csak a mért {n} napot számolva napi {steps}.',
    'achievements.month.days.measured.other': 'Csak a mért {n} napot számolva napi {steps}.',
    'achievements.month.days.best': 'A legerősebb nap: {day} — {steps} lépés.',
    'achievements.month.days.goal': 'A telt oszlop olyan nap, ami elérte a napi {steps} lépéses célt.',
    'achievements.month.days.loading': 'Napok betöltése…',
    'achievements.month.days.error': 'A napi bontás nem töltődött be: {error}',
    'achievements.month.days.empty': 'Ennek a hónapnak egyik napján sem volt lépésmérés.',
    'achievements.month.textOnly.title': 'A hónap',
    'achievements.month.textOnly.body':
      'Ez az érem nem őrizte meg a mérföldköveket, amikkel megszerezted, ezért nem tudjuk megmutatni őket.',
    'achievements.month.foot.locked':
      'A számok azok maradnak, amikkel az érmet megszerezted — ha ma átírsz egy mérföldkövet, ezeket az nem írja át.',
    'achievements.month.foot.fresh':
      'A napi bontást minden alkalommal frissen olvassuk be: ez az egyetlen dolog, amit az érem nem tárol el.',
    // --- Adat-teljesség ----------------------------------------------------
    'coverage.title': 'Adat-teljesség',
    'coverage.subtitle': 'Melyik mérésed érkezik ide, és ki írja őket.',
    // ⚠️ Szándékosan úgy fogalmazva, hogy egyik szám se kapjon toldalékot: a
    // magyar illeszkedés a számnév UTOLSÓ kimondott tagjához igazodik, tehát
    // nincs egyetlen jó konstans (egy**re**, harminchét**re**, százhúsz**ra**).
    'coverage.headline':
      'A megnézett {total} típusból {measured} hozott adatot az elmúlt {days} napban.',
    'coverage.window.30': '30 nap',
    'coverage.window.90': '90 nap',
    'coverage.window.365': 'Egy év',
    'coverage.window.aria': 'A vizsgált időszak hossza',
    'coverage.limits.title': 'Mit mond ez az oldal, és mit nem',
    'coverage.limits.body':
      'Ez az, ami a szerverre megérkezett. Az engedélyeket nem látja: egy típus, amire sosem adtál engedélyt, egy típus, ami mögött nincs érzékelő, és egy típus, amit a telefon nem tudott feltölteni, innen nézve egyformán néz ki — hiányként. A telefonon lévő app meg tudja különböztetni őket, és típusonként ki is mondja.',
    'coverage.state.measured': 'Van adat',
    'coverage.state.outside_window': 'Ebben az időszakban semmi',
    'coverage.state.never_arrived': 'Soha nem érkezett',
    'coverage.col.metric': 'Metrika',
    'coverage.col.state': 'Állapot',
    'coverage.col.days': 'Mért napok',
    'coverage.col.samples': 'Minták',
    'coverage.col.last': 'Utoljára',
    'coverage.col.sources': 'Ki írja',
    'coverage.group.count': '{total} típusból {measured} hoz adatot',
    'coverage.group.empty': 'Ebből a körből még semmi nem érkezett ide.',
    'coverage.notInCatalog': 'nincs a katalógusban',
    'coverage.notInCatalogTitle':
      'Ez a típus megérkezett, de a katalógus nem ismeri — valószínűleg egy újabb iOS-ből jön. Inkább felsoroljuk, mint hogy eldobjuk.',
    'coverage.device.watch': 'óra',
    'coverage.device.iphone': 'telefon',
    'coverage.device.unknown': 'nem mondta meg, milyen eszköz',
    'coverage.device.unknownTitle':
      'A feltöltés nem mondta meg, milyen eszközről jött. Ez pontosan ennyit jelent — nem azt, hogy a telefon mérte.',
    'coverage.gaps.title': 'Abbamaradt',
    'coverage.gaps.body':
      'Ezek eddig ritmusban érkeztek, és a ritmus megtört. Ez megfigyelés, nem hiba — nem tudjuk, miért, és lehet, hogy nincs is miért.',
    'coverage.gaps.silent.one': '{n} napja semmi',
    'coverage.gaps.silent.other': '{n} napja semmi',
    'coverage.gaps.cadence': 'eddig nagyjából {cadence} érkezett',
    'coverage.cadence.daily': 'naponta',
    'coverage.cadence.everyOtherDay': 'kétnaponta',
    'coverage.cadence.weekly': 'hetente',
    'coverage.cadence.fortnightly': 'kéthetente',
    'coverage.cadence.everyNDays': '{n} naponta',
    'coverage.empty.title': 'Még semmi nem érkezett',
    'coverage.empty.hint':
      'A katalógus egyetlen típusa sem jutott el erre a szerverre. Ha a telefon tölt fel, lehet, hogy az első szinkron még fut.',

    // --- Feltöltési sor ---------------------------------------------------
    // ⚠️ A számok mögé sehol nem kerül toldalék (lásd `coverage.headline`):
    // a mondatok úgy vannak fogalmazva, hogy a szám a végén vagy zárójelben álljon.
    'ingest.title': 'Feltöltési sor',
    'ingest.subtitle': 'Amit a telefon már átadott, de a szerver még nem írt be az adatbázisba. Amint a telefon átad egy részt, az ő dolga kész — ez az oldal az utána következő szakaszt mutatja.',
    'ingest.checkedAt': 'Frissítve: {time} · ötmásodpercenként frissül magától',
    'ingest.stale.title': 'Nem sikerült frissíteni',
    'ingest.stale.body': 'Ami lent látszik, az az utolsó sikeres lekérdezés (frissítve: {time}).',
    'ingest.unreachable.title': 'A sor most nem olvasható',
    'ingest.unreachable.body': 'A szerver nem éri el a sorát (RabbitMQ), így nincs mit mutatni — nem nulla, hanem semmi. Amíg ez tart, a szerver a feltöltéseket is elutasítja.',
    'ingest.unreachable.detail': 'A hiba: {error}',
    'ingest.dlq.title.one': '{n} részt nem sikerült beírni, ezért félre van téve',
    'ingest.dlq.title.other': '{n} részt nem sikerült beírni, ezért félre vannak téve',
    'ingest.dlq.body': 'Magától semmi nem próbálja újra őket, és a telefon már továbblépett, így ez az adat még nincs az adatbázisban.',
    'ingest.noConsumer.title': 'Részek várnak, és semmi nem írja be őket',
    'ingest.noConsumer.body': 'Lassúságnak tűnik, de nem az: amíg nem fut worker, a sor egyáltalán nem fogy. Nézd meg a worker konténert ({ps}, {logs}).',
    'ingest.noWorkerIdle.title': 'Nincs kapcsolódó worker',
    'ingest.noWorkerIdle.body':
      'A sor most üres, de a következő feltöltést senki nem fogja feldolgozni, amíg a worker nem fut.',
    'ingest.eta': 'Nagyjából {duration} van hátra.',
    'ingest.eta.note':
      'Becslés a mostani sorra, ha nem érkezik több: a várakozó részek (plusz a legtöbb, ami feldolgozás alatt lehet) osztva az elmúlt percek ütemével. A részek nem egyforma méretűek, és egy új feltöltés úgy növeli a sort, hogy ez a szám csak a következő lekérdezéskor követi.',
    'ingest.stalled.one':
      'Kötegek várnak, de az elmúlt {n} percben egy sem készült el — nincs ütem, amiből becsülni lehetne.',
    'ingest.stalled.other':
      'Kötegek várnak, de az elmúlt {n} percben egy sem készült el — nincs ütem, amiből becsülni lehetne.',
    'ingest.stalled.since':
      'Részek várnak, és az utolsó {when} készült el — azóta egy sem, így nincs friss ütem, amiből becsülni lehetne.',
    'ingest.rateUnknown':
      'Van kapcsolódó worker, de a számlálói nem olvashatók (a Redis nem válaszolt, vagy ez a worker túl régi, hogy jelentsen) — így nem tudni, halad-e a sor. Ez nem ugyanaz, mint hogy „nem halad”.',
    'ingest.settling':
      'Semmi nem vár kiosztásra. A worker még dolgozhat legfeljebb ennyi, már felvett részen: {n}. Az oldal akkor mondja, hogy „nincs több beírnivaló”, ha 30 másodpercig semmi nem készült el.',
    'ingest.settling.noBound':
      'Semmi nem vár kiosztásra. A worker még dolgozhat a már felvett részeken; az oldal akkor mondja, hogy „nincs több beírnivaló”, ha 30 másodpercig semmi nem készült el.',
    'ingest.idle':
      'Nincs több beírnivaló: semmi nem vár, és legalább 30 másodperce semmi nem készült el, tehát a workernél sincs félig beírt rész.',
    'ingest.idle.noWorker':
      'Semmi nem vár, és kapcsolódó worker nélkül félig beírt rész sem lehet: amit egy worker felvett, az a kapcsolat bontásakor visszakerül a sorba.',
    'ingest.stat.waiting': 'Várakozik',
    'ingest.stat.inFlight': '+ legfeljebb {n} feldolgozás alatt',
    'ingest.stat.deadLetter': 'Holtlevél-sor',
    'ingest.stat.consumers': 'Kapcsolódó worker',
    'ingest.stat.batchesPerMin': 'Köteg / perc',
    'ingest.stat.itemsPerMin': 'Elem / perc',
    'ingest.window.one': 'Az ütem az elmúlt {n} perc alapján.',
    'ingest.window.other': 'Az ütem az elmúlt {n} perc alapján.',
    'ingest.worker.title': 'Worker',
    'ingest.worker.started': 'Elindult',
    'ingest.worker.lastBatch': 'Utolsó feldolgozott köteg',
    'ingest.worker.batches': 'Kötegek az indulás óta',
    'ingest.worker.items': 'Elemek az indulás óta',
    'ingest.worker.failed': 'Feladott kötegek az indulás óta',
    'ingest.worker.itemsNote':
      'Egy elem egy minta, edzés, alvás-szakasz, aktivitás-összesítő vagy törlés. Ami megérkezett, nem feltétlenül új: az írás idempotens.',
    'ingest.worker.none': 'Ezzel a verzióval még egy worker sem jelentkezett.',
    'ingest.stats.unreachable.title': 'A worker számlálói nem olvashatók',
    'ingest.stats.unreachable.body':
      'Az ütem, a becslés és az utolsó köteg ideje ismeretlen, mert a Redis nem válaszolt. A sor mélysége ettől még pontos.',

    // --- A menü csoportjai ------------------------------------------------
    // A címek egy állítást fogalmaznak meg arról, mi tartozik össze — ezért
    // kettő közülük szó szerint az app sávneve (`DashboardBand.title`). Ha a
    // kettő szétcsúszik, ugyanaz a tartalom két nevet kap.
    'nav.aria': 'Szakaszok',
    'nav.group.longView': 'Hosszú táv',
    'nav.group.areas': 'Területek',
    'nav.group.status': 'Állapot',
    // A gomb, ami a keskeny elrendezésben ugyanezt a listát nyitja ki. Egy szó
    // mindkét állapotban — az `aria-expanded` és a nyíl mondja meg, melyikben
    // van; egy „Bezárás”-ra váltó felirat elmozdítaná a gombot az ujj alól.
    'nav.menu': 'Menü',

    // --- A Ma oldal sávjai -------------------------------------------------
    // A magyarázó mondatok az app `DashboardBand.explanation`-jei.
    'today.band.today': 'Ma rólad',
    'today.band.today.hint': 'A mai mérések, olvasásra.',
    'today.band.longView.hint': 'Hetek és hónapok — amit egyetlen nap nem mutat meg.',
    'today.band.status.hint': 'Hogy működik-e, ami az adatodat mozgatja.',

    // --- A Ma oldal kártyái ------------------------------------------------
    'today.workout.title': 'Legutóbbi edzés',
    'today.workout.empty': 'Még nem érkezett edzés.',
    'today.sleep.title': 'A múlt éjszaka',
    'today.sleep.titleLatest': 'Legutóbbi alvás',
    'today.sleep.empty': 'Az elmúlt két napra nem érkezett alvás-szakasz.',
    'today.sync.title': 'Szinkron',
    'today.insights.serverLanguage':
      'A mondatokat a szerver fogalmazza, azon a nyelven, amelyen beszél.',
    'today.insights.more.one': 'és további {n} megfigyelés',
    'today.insights.more.other': 'és további {n} megfigyelés',
    'today.medals.newest': 'Legutóbb: {badge} · {period}',
    'today.medals.newest.noPeriod': 'Legutóbb: {badge}',
    'today.coverage.gaps.one': '{n} mérés ritmusa megtört.',
    'today.coverage.gaps.other': '{n} mérés ritmusa megtört.',
    'today.coverage.noGaps': 'Egyetlen mérés ritmusa sem tört meg.',
    // A kártya-hiba egy sor, mert a 401 az egész oldalt viszi: ide már csak egy
    // végpont rossz napja jut el.
    'today.cardError': 'Nem sikerült betölteni: {reason}',

    // --- The sidebar: the queue badge and the footer ---------------------------
    'nav.badge.waiting.one': '{n} rész vár beírásra',
    'nav.badge.waiting.other': '{n} rész vár beírásra',
    'nav.badge.setAside.one': '{n} rész félretéve — nézz rá',
    'nav.badge.setAside.other': '{n} rész félretéve — nézz rá',
    'nav.badge.unknown': 'A sor most nem olvasható',
    'nav.serverAria':
      'Ez a szerver, és az időzóna, amely szerint az oldalak napokra bontanak',

    // --- Today: tiles, the queue pill, the sync card ---------------------------
    'today.tile.soFar': 'Eddig ma',
    'today.tile.average': 'A mai átlag',
    'today.tile.notMeasured': 'Ma még nem volt mérés',
    'today.sleep.asleep': 'alvás',
    'today.sleep.noStages':
      'Ehhez az éjszakához nincsenek alvásfázisok — az eszköz csak az alvást és az ébrenlétet rögzítette.',
    'today.sleep.notRecorded': 'Az alvás hossza nincs rögzítve',
    'today.sleep.inBedOnly':
      'Csak az ágyban töltött idő érkezett meg ({duration}), alvás-szakasz nélkül — így nem tudni, mennyit aludtál, és ez nem nulla.',
    'today.challenge.steps': 'lépés',
    'today.challenge.allMilestones': 'mind a(z) {n} mérföldkő megvan',
    'today.medals.earned.one': 'megszerzett érem',
    'today.medals.earned.other': 'megszerzett érem',
    'today.pill.upToDate': 'Naprakész — nincs több beírnivaló',
    'today.pill.writing': 'Íródnak a sorban álló részek',
    'today.pill.writingEta': 'Íródnak a sorban álló részek · a mostani sorra nagyjából {duration}',
    'today.pill.stalled': 'Részek várnak, és mostanában semmi nem készült el',
    'today.pill.noConsumer': 'Részek várnak, és semmi nem írja be őket',
    'today.pill.rateUnknown': 'Részek várnak · a haladás nem olvasható',
    'today.pill.settling': 'Semmi nem vár · a worker még befejezhet legfeljebb ennyit: {n}',
    'today.pill.settling.noBound': 'Semmi nem vár · a worker még befejezhet valamit',
    'today.pill.setAside.one': '{n} részt nem sikerült beírni',
    'today.pill.setAside.other': '{n} részt nem sikerült beírni',
    'today.pill.unknown': 'A sor most nem olvasható',
    'today.pill.apiOld': 'A szerver régebbi, mint ez az oldal',
    'today.sync.lastSeen': 'Eszköz utoljára látva {when}: {device}',
    'today.sync.writing.one': 'A sorban beírásra vár: {n} rész',
    'today.sync.writing.other': 'A sorban beírásra vár: {n} rész',
    'today.sync.writingEta.one':
      'A sorban beírásra vár: {n} rész · a mostani sorra, ha nem érkezik több, nagyjából {duration}',
    'today.sync.writingEta.other':
      'A sorban beírásra vár: {n} rész · a mostani sorra, ha nem érkezik több, nagyjából {duration}',
    'today.sync.stuck.one': 'A sorban vár {n} rész, és mostanában semmi nem készült el',
    'today.sync.stuck.other': 'A sorban vár {n} rész, és mostanában semmi nem készült el',
    'today.sync.rateUnknown.one': 'A sorban vár {n} rész; hogy halad-e, az nem olvasható',
    'today.sync.rateUnknown.other': 'A sorban vár {n} rész; hogy halad-e, az nem olvasható',
    'today.sync.allWritten': 'A sorban nincs több beírnivaló.',

    // --- Trends: the redesigned chart card -------------------------------------
    'trends.periodAria': 'Időszak',
    'trends.total': 'Összesen',
    'trends.perDay': 'Naponta · {n} mért nap átlaga',
    'trends.perMonth': 'Havonta · {n} mért hónap átlaga',
    'trends.legend.usualRange': 'a szokásos tartományod',
    'trends.legend.average': 'az átlagod',
    'trends.sources.title': 'Honnan jönnek ezek a számok',
    'trends.sources.body':
      'Ha ugyanazt az órát több eszköz vagy app is rögzítette, az az óra egyszer számít: a legnagyobb érték nyer. Az Egészség app finomabban fésüli össze a forrásokat, ezért a szerver kicsivel többet mutathat, mint a telefon.',
    'picker.searchLabel': 'Keresés {n} mérés között',
    'picker.groupLabel': 'Csoport',
    'picker.placeholder': 'Lépés, pulzus…',

    // --- Workouts: master/detail, filters, rows --------------------------------
    'workouts.detailAria': 'A kiválasztott edzés',
    'workouts.listAria': 'Edzéslista',
    'workout.route.toSettings': 'Térkép alá — Beállítások',
    'workout.hr.highest': 'Legmagasabb',
    'workout.weather.note': 'Ahogy a rögzítő app az edzéshez felírta.',
    'workouts.filter.type': 'Típus',
    'workouts.filter.allTypes': 'Minden típus',
    'workouts.filter.typesChosen.one': '{n} típus',
    'workouts.filter.typesChosen.other': '{n} típus',
    'workouts.filter.where': 'Hol',
    'workouts.filter.atLeast': 'Legalább',
    'workouts.filter.anyLength': 'bármilyen hosszú',
    'workouts.filter.more': 'További szűrők',
    'workouts.row.dup.aria': 'Valószínűleg {n} felvétel az Egészségben',
    'workouts.row.open': 'Megnyitás',
    'workouts.select.hint': 'Válassz egy edzést a listából.',
    'workouts.row.max': 'max',

    // --- Sync queue: the redesigned page, set-aside reasons and the retry ------
    'ingest.unreachable.lastGood': 'Utolsó sikeres lekérdezés: {time}.',
    'ingest.apiOld.title': 'A szerver API-ja régebbi, mint ez a weboldal',
    'ingest.apiOld.body':
      'Az oldal olyasmit kért a szervertől, amit az még nem ismer. Ez akkor történik, ha a web image előbb frissül, mint a backend image. Frissítsd a szervert, aztán töltsd újra az oldalt:',
    'ingest.apiOld.tech':
      'Technikailag: az API 404-et adott egy útvonalra, amire az oldal épít, miközben a többi része működik.',
    'ingest.hero.waiting': 'Beírásra vár',
    'ingest.hero.parts.one': 'rész',
    'ingest.hero.parts.other': 'rész',
    'ingest.hero.tech': 'köteg a(z) {name} sorban',
    'ingest.hero.etaLabel': 'A mostani sorra, ha nem érkezik több — becslés',
    'ingest.hero.eta': 'nagyjából {duration}',
    'ingest.hero.nothing': 'Nincs mire várni',
    'ingest.hero.notMoving': 'Nem halad',
    'ingest.hero.noEstimate': 'nincs becslés',
    'ingest.hero.rateUnknown': 'Az ütem ismeretlen',
    'ingest.hero.settling': 'Semmi nem vár kiosztásra',
    'ingest.tile.rate': 'Ütem',
    'ingest.tile.rateUnit': 'rész/perc',
    'ingest.tile.itemsRate': '≈ {n} elem percenként',
    'ingest.tile.noRate': 'Az időablakban semmi nem készült el',
    'ingest.tile.worker': 'Worker',
    'ingest.worker.state.working': 'Dolgozik',
    'ingest.worker.state.waiting': 'Vár',
    'ingest.worker.state.none': 'Nincs',
    'ingest.worker.state.noRecent': 'Mostanában semmi nem készült el',
    'ingest.worker.state.connected': 'Kapcsolódik',
    'ingest.worker.state.finishing': 'Talán még befejez valamit',
    'ingest.worker.line.none': 'Egy worker sem kapcsolódik',
    'ingest.worker.line.connected.one': '{n} worker kapcsolódik',
    'ingest.worker.line.connected.other': '{n} worker kapcsolódik',
    'ingest.tile.last': 'Utoljára beírva',
    'ingest.tile.lastNone': 'A worker indulása óta semmi nem íródott be',
    'ingest.tile.setAside': 'Félretéve',
    'ingest.tile.setAsideNote': 'Nem sikerült beírni; magától nem próbálja újra',
    'ingest.tile.setAsideTech': 'a holtlevél-sor',
    'ingest.since.title': 'Beírva a worker indulása óta · {when}',
    'ingest.since.parts': 'rész',
    'ingest.since.items': 'elem',
    'ingest.since.setAside': 'félretéve',
    'ingest.dlq.tech':
      'Technikailag: a RabbitMQ holtlevél-sora, {name}. Minden rész teljes hibaüzenete a worker naplójában van:',
    'ingest.dlq.resync':
      'Ha az újrapróbálás nem segít, a telefonon a „Teljes újraszinkron” ugyanazt az adatot küldi el újra — a beírás idempotens, így semmi nem tárolódik kétszer.',
    'ingest.redrive.button.one': '{n} félretett rész újrapróbálása',
    'ingest.redrive.button.other': '{n} félretett rész újrapróbálása',
    'ingest.redrive.buttonCapped': '{max} félretett rész újrapróbálása (összesen {n})',
    'ingest.redrive.confirmAria': 'Az újrapróbálás megerősítése',
    'ingest.redrive.confirm.one':
      'Újrapróbálod a(z) {n} részt? A beírás idempotens: ami már az adatbázisban van, az csak frissül.',
    'ingest.redrive.confirm.other':
      'Újrapróbálod a(z) {n} részt? A beírás idempotens: ami már az adatbázisban van, az csak frissül.',
    'ingest.redrive.limit':
      'Egy újrapróbálás legfeljebb {max} részt mozgat. Ha több van félretéve, a maradékhoz nyomd meg újra.',
    'ingest.redrive.confirmYes': 'Újrapróbálás',
    'ingest.redrive.cancel': 'Mégse',
    'ingest.redrive.running': 'Újrapróbálás…',
    'ingest.redrive.result':
      '{moved} visszakerült a sorba · {remaining} még félre van téve',
    'ingest.redrive.resultUnknown':
      '{moved} visszakerült a sorba · hogy mennyi van még félretéve, azt nem sikerült kiolvasni',
    'ingest.redrive.stopped':
      'Félúton megállt: {reason}. A fenti szám csak a biztosan átmozgatott részeket számolja. Ha az ok mást nem mond, az éppen mozgatott rész félretéve maradt; ha azt mondja, hogy most mindkét sorban ott van, az a másolat ártalmatlan — a beírás idempotens.',
    'ingest.redrive.repeated.one':
      'Közülük {n} már legalább a harmadik újrapróbálásánál tart — a korábbiak nem segítettek, így amíg az ok nincs javítva, ez is aligha fog.',
    'ingest.redrive.repeated.other':
      'Közülük {n} már legalább a harmadik újrapróbálásánál tart — a korábbiak nem segítettek, így amíg az ok nincs javítva, ezek is aligha fognak.',
    'ingest.redrive.watch':
      'Visszakerültek a sorba, a már várakozók mögé; hogy mikor íródnak be, az a workeren és a fenti soron múlik. Ami a tartalma miatt bukik el, újra itt lesz — az oldal magától frissül.',
    'ingest.redrive.busy':
      'Már fut egy újrapróbálás. Várd meg a végét, aztán nézz rá újra.',
    'ingest.redrive.brokerDown': 'A RabbitMQ nem volt elérhető, így semmi nem mozdult.',
    'ingest.redrive.failed':
      'A szerver elutasította az újrapróbálást, így semmi nem mozdult: {reason}',
    'ingest.redrive.unknown':
      'Nem jött válasz, így nem tudni, lefutott-e az újrapróbálás ({reason}). A félretett részek számát újra lekérdezzük — mielőtt újra megnyomod, nézd meg.',
    'ingest.redrive.tooOld':
      'Az innen indított újrapróbáláshoz újabb szerver-API kell. Frissítsd a szervert ({cmd}), aztán töltsd újra az oldalt.',
    'ingest.reasons.title': 'Legutóbbi hibák — napló, nem a sor tartalma',
    'ingest.reasons.hint':
      'A worker feljegyzése a mostanában félretett részekről, a legfrissebb elöl. Egy bejegyzés akkor is megmarad, ha a részét már újrapróbálták, és egy régebbi worker által félretett résznek nincs bejegyzése — így ebből nem derül ki, mely részek vannak most félretéve.',
    'ingest.reason.transient':
      'Abban a pillanatban nem volt elérhető az adatbázis vagy a hálózat — az újrapróbálás általában sikerül.',
    'ingest.reason.rejected':
      'Az adatbázis visszautasította a tartalmát — amíg az ok nincs javítva, ugyanez a rész újra el fog bukni.',
    'ingest.reason.undecodable': 'A worker egyáltalán nem tudta kiolvasni ezt a részt.',
    'ingest.reason.other': 'A worker nem tudta beírni.',
    'ingest.reason.items.one': '{n} elem',
    'ingest.reason.items.other': '{n} elem',
    'ingest.reason.samples.one': '{n} minta',
    'ingest.reason.samples.other': '{n} minta',
    'ingest.reason.workouts.one': '{n} edzés',
    'ingest.reason.workouts.other': '{n} edzés',
    'ingest.reason.sleep.one': '{n} alvás-szakasz',
    'ingest.reason.sleep.other': '{n} alvás-szakasz',
    'ingest.reason.activity.one': '{n} aktivitás-összesítő',
    'ingest.reason.activity.other': '{n} aktivitás-összesítő',
    'ingest.reason.deletions.one': '{n} törlés',
    'ingest.reason.deletions.other': '{n} törlés',
    'ingest.reason.repeated': 'Újra elbukott, ennyi újrapróbálás után: {n}',
    'ingest.reason.raw': 'A worker üzenete',
    'ingest.reason.batch': 'Köteg: {id}',
    'ingest.reason.lastRedrive': 'Legutóbbi újrapróbálás vége: {when}, visszakerült: {moved}.',
  },

  // --- Metric group names ---------------------------------------------------
  group: {
    activity: 'Aktivitás',
    heart: 'Szív',
    respiratory: 'Légzés',
    body: 'Testösszetétel',
    macro: 'Táplálkozás — makrók',
    mineral: 'Táplálkozás — ásványi',
    vitamin: 'Táplálkozás — vitaminok',
    mobility: 'Mobilitás',
    environment: 'Környezet',
    other: 'Egyéb',
  },

  // --- Workout activity types (HealthKit `activity_type`) -------------------
  // ⚠️ A dróton a RÖVID szótár utazik, amit a telefon ír
  // (`HealthKitMapping.workoutName`): running · walking · cycling · swimming ·
  // hiking · yoga · strength · hiit · other. A lenti hosszú HealthKit-nevek soha
  // nem érkeznek meg; a `strength` és a `hiit` viszont igen, és amíg nem voltak
  // itt, az oldal a nyers drót-kulcsot mutatta az olvasónak.
  activity: {
    running: 'Futás',
    strength: 'Erősítés',
    hiit: 'HIIT',
    walking: 'Séta',
    cycling: 'Kerékpár',
    hiking: 'Túra',
    swimming: 'Úszás',
    strengthTraining: 'Erősítés',
    functionalStrengthTraining: 'Funkcionális erősítés',
    traditionalStrengthTraining: 'Súlyzós edzés',
    yoga: 'Jóga',
    rowing: 'Evezés',
    elliptical: 'Elliptikus',
    highIntensityIntervalTraining: 'HIIT',
    other: 'Egyéb',
  },

  // --- Sleep stages ---------------------------------------------------------
  stage: {
    deep: 'Mély',
    rem: 'REM',
    core: 'Alap',
    light: 'Könnyű',
    awake: 'Ébren',
    inBed: 'Ágyban',
    asleep: 'Alvás',
  },

  // --- Units ----------------------------------------------------------------
  //
  // The catalog and the server both speak the same canonical unit tokens
  // (`min`, `count/min`, …); anything not listed here is printed verbatim,
  // because `kcal`, `mg` and `°C` read the same in both languages.
  unit: {
    count: '', // a step count needs no unit
    'count/min': '/perc',
    min: 'perc',
    h: 'óra',
    'kcal/hr/kg': 'kcal/ó/kg',
    'ml/kg/min': 'ml/kg/perc',
    'L/min': 'L/perc',
  },

  // --- Metric display names -------------------------------------------------
  //
  // The keys mirror `lib/metrics.ts`; `MetricKey` is derived from this record,
  // so the catalog cannot name a metric that has no translation.
  metric: {
    // 3.1 Activity and movement
    stepCount: 'Lépés',
    distanceWalkingRunning: 'Gyaloglás/futás táv',
    distanceCycling: 'Kerékpáros táv',
    distanceSwimming: 'Úszott táv',
    distanceWheelchair: 'Kerekesszékes táv',
    distanceDownhillSnowSports: 'Lesiklott táv',
    pushCount: 'Tolások',
    swimmingStrokeCount: 'Úszótempók',
    flightsClimbed: 'Megmászott emelet',
    activeEnergy: 'Aktív energia',
    basalEnergyBurned: 'Alapanyagcsere-energia',
    appleExerciseTime: 'Edzésidő',
    appleMoveTime: 'Mozgásidő',
    appleStandTime: 'Állásidő',
    // The two goal metrics /v1/goals names differently from the catalog. They
    // are not in METRIC_LIST, only in this dictionary — `tMetric()` looks names
    // up by string, so the goal rings resolve too.
    exerciseTime: 'Edzésidő',
    standHours: 'Állásórák',
    nikeFuel: 'Nike Fuel',
    physicalEffort: 'Fizikai megterhelés',
    // ⚠️ Ez a tizenöt benne van a szerver katalógusában (és az appéban is), de a
    // `lib/metrics.ts`-ben NINCS: a webes katalógus 105 típusnál megállt, míg a
    // másik kettő 120-ra nőtt. A nevek azért kellenek ide, hogy az adat-teljesség
    // oldal — ami minden típust felsorol, amit a szerver ismer — ne gépi angolt
    // mutasson magyar olvasónak. A `numberOfAlcoholicBeverages` mögött már van
    // valódi adat, az volt az elmászás látható fele.
    distanceCrossCountrySkiing: 'Sífutott táv',
    distancePaddleSports: 'Kajak-kenu táv',
    distanceRowing: 'Evezett táv',
    distanceSkatingSports: 'Korcsolyázott táv',
    cyclingCadence: 'Kerékpáros kadencia',
    cyclingPower: 'Kerékpáros teljesítmény',
    cyclingFunctionalThresholdPower: 'Funkcionális küszöbteljesítmény',
    cyclingSpeed: 'Kerékpáros sebesség',
    crossCountrySkiingSpeed: 'Sífutás-sebesség',
    paddleSportsSpeed: 'Kajak-kenu sebesség',
    rowingSpeed: 'Evezési sebesség',
    workoutEffortScore: 'Edzés-megterhelés',
    estimatedWorkoutEffortScore: 'Becsült edzés-megterhelés',

    // 3.2 Heart and circulation
    heartRate: 'Pulzus',
    restingHeartRate: 'Nyugalmi pulzus',
    walkingHeartRateAverage: 'Séta közbeni pulzus',
    hrv: 'HRV (SDNN)',
    heartRateRecoveryOneMinute: 'Pulzus-visszaállás (1 perc)',
    atrialFibrillationBurden: 'Pitvarfibrilláció-arány',
    bloodPressureSystolic: 'Vérnyomás — szisztolés',
    bloodPressureDiastolic: 'Vérnyomás — diasztolés',
    peripheralPerfusionIndex: 'Perifériás perfúziós index',
    vo2Max: 'VO₂max',

    // 3.3 Respiration and blood oxygen
    respiratoryRate: 'Légzésszám',
    oxygenSaturation: 'Véroxigén (SpO₂)',
    forcedVitalCapacity: 'Erőltetett vitálkapacitás',
    forcedExpiratoryVolume1: 'FEV1',
    peakExpiratoryFlowRate: 'Kilégzési csúcsáramlás',
    inhalerUsage: 'Inhalátor-használat',
    appleSleepingBreathingDisturbances: 'Alvási légzészavarok',

    // 3.4 Body composition
    bodyMass: 'Testsúly',
    bodyMassIndex: 'BMI',
    bodyFatPercentage: 'Testzsír',
    leanBodyMass: 'Zsírmentes testtömeg',
    height: 'Testmagasság',
    waistCircumference: 'Derékbőség',
    appleSleepingWristTemperature: 'Alvási csuklóhőmérséklet',
    bodyTemperature: 'Testhőmérséklet',
    basalBodyTemperature: 'Bazális testhőmérséklet',

    // 3.5 Nutrition — macros
    dietaryEnergyConsumed: 'Bevitt energia',
    dietaryProtein: 'Fehérje',
    dietaryCarbohydrates: 'Szénhidrát',
    dietaryFatTotal: 'Zsír (összes)',
    dietaryFiber: 'Rost',
    dietarySugar: 'Cukor',
    dietaryFatSaturated: 'Telített zsír',
    dietaryFatMonounsaturated: 'Egyszeresen telítetlen zsír',
    dietaryFatPolyunsaturated: 'Többszörösen telítetlen zsír',
    dietaryCholesterol: 'Koleszterin',
    dietaryWater: 'Víz',
    dietaryCaffeine: 'Koffein',

    // 3.6 Nutrition — minerals
    dietaryCalcium: 'Kalcium',
    dietaryIron: 'Vas',
    dietaryMagnesium: 'Magnézium',
    dietaryPhosphorus: 'Foszfor',
    dietaryPotassium: 'Kálium',
    dietarySodium: 'Nátrium',
    dietaryZinc: 'Cink',
    dietaryChloride: 'Klorid',
    dietaryChromium: 'Króm',
    dietaryCopper: 'Réz',
    dietaryIodine: 'Jód',
    dietaryManganese: 'Mangán',
    dietaryMolybdenum: 'Molibdén',
    dietarySelenium: 'Szelén',

    // 3.7 Nutrition — vitamins
    dietaryVitaminA: 'A-vitamin',
    dietaryVitaminB6: 'B6-vitamin',
    dietaryVitaminB12: 'B12-vitamin',
    dietaryVitaminC: 'C-vitamin',
    dietaryVitaminD: 'D-vitamin',
    dietaryVitaminE: 'E-vitamin',
    dietaryVitaminK: 'K-vitamin',
    dietaryThiamin: 'Tiamin (B1)',
    dietaryRiboflavin: 'Riboflavin (B2)',
    dietaryNiacin: 'Niacin (B3)',
    dietaryFolate: 'Folát (B9)',
    dietaryBiotin: 'Biotin (B7)',
    dietaryPantothenicAcid: 'Pantoténsav (B5)',

    // 3.8 Mobility and gait
    walkingSpeed: 'Gyaloglási sebesség',
    walkingStepLength: 'Lépéshossz',
    walkingAsymmetryPercentage: 'Járás-aszimmetria',
    walkingDoubleSupportPercentage: 'Kettős támaszfázis',
    sixMinuteWalkTestDistance: '6 perces séta-teszt',
    stairAscentSpeed: 'Lépcsőn fel — sebesség',
    stairDescentSpeed: 'Lépcsőn le — sebesség',
    appleWalkingSteadiness: 'Járásstabilitás',
    runningSpeed: 'Futósebesség',
    runningPower: 'Futóteljesítmény',
    runningStrideLength: 'Futó lépéshossz',
    runningVerticalOscillation: 'Függőleges kilengés',
    runningGroundContactTime: 'Talajérintési idő',

    // 3.9 Environment and hearing
    environmentalAudioExposure: 'Környezeti hangterhelés',
    headphoneAudioExposure: 'Fejhallgató-hangterhelés',
    environmentalSoundReduction: 'Zajcsökkentés',
    timeInDaylight: 'Napfényben töltött idő',
    uvExposure: 'UV-terhelés',

    // 3.10 Other
    bloodGlucose: 'Vércukor',
    bloodAlcoholContent: 'Véralkohol',
    insulinDelivery: 'Inzulin-bevitel',
    numberOfTimesFallen: 'Elesések',
    electrodermalActivity: 'Bőrvezetés',
    waterTemperature: 'Vízhőmérséklet',
    underwaterDepth: 'Merülési mélység',
    numberOfAlcoholicBeverages: 'Alkoholos italok',
  },
}
// No `as const` on purpose: the key union is what we want to pin down, not the
// values. With literal value types `en: Dict` would demand the *same strings*.
