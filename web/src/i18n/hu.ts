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
    'nav.journey': 'Virtuális túra',
    'nav.coverage': 'Adatteljesség',
    'nav.ingest': 'Feltöltési sor',
    'nav.settings': 'Beállítások',
    'lang.aria': 'Nyelvválasztás',
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
    'dashboard.lastSync': 'eszköz utolsó jelentkezése: {when}',
    'dashboard.empty.title': 'Még nincs adat',
    'dashboard.empty.hint':
      'Az iPhone az egyetlen feltöltő — amint szinkronizál, itt megjelenik.',
    'dashboard.rings.title': 'Aktivitásgyűrűk',
    'dashboard.rings.move': 'Mozgás',
    'dashboard.rings.exercise': 'Edzés',
    'dashboard.rings.stand': 'Állás',
    'dashboard.rings.empty.title': 'Nincs gyűrűadat',
    'dashboard.rings.empty.hint': 'A HealthKit napi aktivitás-összesítője még nem érkezett meg.',

    // --- Trends ------------------------------------------------------------
    'trends.title': 'Trendek',
    'trends.subtitle': 'Hosszabb távú alakulás, a saját időzónád szerint szakaszokra bontva.',
    'trends.metric': 'Metrika',
    'trends.degraded.title': 'Ez a típus mintánkénti átlagként érkezik, nem napi összegként',
    'trends.degraded.body':
      '{metric}: ezt összegezni kellene, de a szerver név szerint csak azt az öt típust ismeri, amelyeknek rögzített összesítési módja van — a többire átlagot, minimumot és maximumot ad vissza, darabszámot nem. Ebből napi összeget nem lehet visszaállítani, ezért itt az egy mintára jutó átlag látszik. A javítás helye a backend {file} fájljának metricMeta táblája.',
    'trends.empty.title': 'Nincs adat ebben az időszakban: {metric}',
    'trends.empty.hintElsewhere':
      'Erre a típusra van adat, csak nem ebben az ablakban — válts időtávot.',
    'trends.empty.hintNever':
      'Erre a típusra még nem érkezett minta. A HealthKit nem különbözteti meg a „nincs adat” és a „nincs engedély” esetet — mindkettő üres.',
    'trends.extremes': 'Szélsőértékek',
    'trends.periodAverage': 'Átlag az időszakban',
    'trends.periodTotal': 'Összesen az időszakban',
    'trends.bandNote': '· a halvány sáv a szakaszon belüli minimum–maximum',

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
    'trends.drill.toMonth': 'Koppints a grafikonra: megnyílik a hónap, amelyikbe az a pont esik.',
    'trends.drill.toWeek':
      'Koppints a grafikonra: megnyílik a kiválasztott naphoz tartozó hét — az oszlopok napokat mutatnak, de többnyire hetekben gondolkodunk.',
    'trends.drill.toDay': 'Koppints a grafikonra: megnyílik az adott nap, óránkénti bontásban.',
    'trends.table.hint':
      'Billentyűzettel a grafikon alatti táblázat ugyanezeket az időszakokat nyitja meg.',
    'trends.table.summary': 'A grafikon számai',
    'trends.table.period': 'Időszak',
    'trends.table.value': 'Érték',
    'trends.table.notMeasured': 'nincs mérés',
    'trends.table.open': 'Megnyitás: {period}',
    'trends.loading': 'Az új időszak töltődik…',
    'trends.chartDesc':
      'Szakaszonként egy oszlop vagy pont, {period}. Az üres szakaszokban nem volt mérés. A grafikon alatti táblázat ugyanezeket a számokat sorolja fel.',

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
      'A két átlag nagyon eltérő számú mérésen alapul, ezért a különbséget fenntartással kezeld.',

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
      'A széles sáv a szokásos sávod: az utolsó {days} mért nap közepe, plusz-mínusz az ezeken a napokon mért szórás.',
    'trends.usual.pending':
      'Még nincs elég mért nap a szokásos sávhoz ({days}/{min}). Addig nem rajzolunk sávot: kevesebb nap alapján sem tűnne óvatosabb becslésnek, hanem pont ugyanolyan biztosnak látszana.',
    'trends.usual.flat':
      'Nincs mit sávként rajzolni: a viszonyítási időszak mindegyik mért napján ugyanaz volt az érték ({value}), összesen {days} napon, így nincs szórás, amiből sáv lenne. Ez nem adathiány.',
    'trends.usual.unavailable':
      'A szerver nem küldött szokásos sávot ehhez a mutatóhoz, pedig {days} napon volt mérés.',
    'trends.standing.wellBelow': 'Jóval a szokásod alatt',
    'trends.standing.below': 'A szokásod alatt',
    'trends.standing.typical': 'A szokásos sávodban',
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
      'Az edzések hónapokba rendezve, a legfrissebbel kezdve. Egy összecsukott hónap egyetlen sor, és egy két készülékkel rögzített edzés is egyetlen sor.',
    'workouts.empty.title': 'Még nincs edzés',
    'workouts.empty.hint':
      'A Watch edzései a párosított iPhone HealthKitjébe kerülnek, onnan töltődnek fel.',
    'workouts.col.type': 'Típus',
    'workouts.col.when': 'Mikor',
    'workouts.col.duration': 'Időtartam',
    'workouts.col.energy': 'Energia',
    'workouts.col.distance': 'Táv',
    'workouts.col.avgHr': 'Átlagpulzus',
    'workouts.col.maxHr': 'Max. pulzus',
    'workouts.hrNote':
      'Üres pulzusoszlop: a HealthKit-mintákban csak a(z) {field} mező szerepel, a szerveroldali edzésazonosítóhoz pedig a feldolgozó (ingest worker) köti őket.',
    'workouts.filter.title': 'Szűrő',
    'workouts.filter.place': 'Helyszín',
    'workouts.place.any': 'Bárhol',
    'workouts.place.indoor': 'Beltéri',
    'workouts.place.outdoor': 'Szabadtéri',
    'workouts.filter.minDuration': 'Legalább ennyi ideig',
    'workouts.filter.minDistance': 'Legalább ennyi táv',
    'workouts.filter.minEnergy': 'Legalább ennyi energia',
    'workouts.filter.minHr': 'Átlagpulzus legalább',
    'workouts.filter.maxHr': 'Átlagpulzus legfeljebb',
    'workouts.filter.noLimit': 'Nincs korlát',
    'workouts.filter.clear': 'Szűrő törlése',
    'workouts.filter.count.one': '{n} edzésből {shown} látszik',
    'workouts.filter.count.other': '{n} edzésből {shown} látszik',
    'workouts.filter.none.title': 'Egyetlen edzés sem felel meg a szűrőnek',
    'workouts.filter.none.hint.one': '{n} edzés van a listában — próbáld tágítani a szűrőt.',
    'workouts.filter.none.hint.other': '{n} edzés van a listában — próbáld tágítani a szűrőt.',
    'workouts.filter.missingNote':
      'Ha egy edzésnél hiányzik az az adat, amelyre szűrsz, a szűrő nem rejti el. Egy erősítő edzésnek nincs távja, ezért a „legalább 5 km” bent hagyja, és nem veszi nullának a hiányzó távot.',
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
      '{sessions} edzés úgy fest, mintha egynél többször érkezett volna meg az Egészség appba: azonos tevékenység, átfedő időben (az átfedés legalább az együttes időtartamuk 70%-a, vagy legfeljebb 5 perc eltéréssel kezdődtek). Az Egészség app nem köti össze az ilyen felvételeket, így ez következtetés. A lista mindegyikről egyetlen sort mutat, így a havi összegek nem duplázódnak; további {extra} felvétel áll ezek mögött.',
    'workouts.loading.title': 'Még töltődnek a korábbi edzések',
    'workouts.loading.body.one':
      'Eddig {n} felvétel. A régebbi hónapok még érkeznek, az összegük tehát még nem végleges.',
    'workouts.loading.body.other':
      'Eddig {n} felvétel. A régebbi hónapok még érkeznek, az összegük tehát még nem végleges.',
    'workouts.truncated.title': 'Itt véget ér a lista',
    'workouts.truncated.body':
      'A régebbi edzések nincsenek ebben a listában: a lapozás elérte a korlátját. Ami efölött látható, az teljes — innen lefelé viszont van még.',

    // --- One workout, opened -----------------------------------------------
    'workout.back': '← Vissza az edzésekhez',
    'workout.missing.title': 'Nincs ilyen edzés',
    'workout.missing.hint':
      'A hivatkozás olyan edzésre mutat, amely ezen a szerveren nincs meg. Lehet, hogy törölted az Egészség appban, vagy a link egy másik szerverről való.',

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
      'Az edzést rögzítették, de egyetlen számadat sem érkezett vele. Ez a felvétel hiányossága, nem nulla érték.',

    'workout.route.title': 'Útvonal',
    'workout.route.loading': 'Töltődik az útvonal…',
    'workout.route.none': 'Ehhez az edzéshez nincs útvonal.',
    'workout.route.failed.title': 'Az útvonalat nem sikerült betölteni',
    'workout.route.failed.body':
      'Ez sikertelen lekérés, nem hiányzó útvonal — az edzésnek nagyon is lehet útvonala.',
    'workout.route.start': 'Rajt',
    'workout.route.finish': 'Cél',
    'workout.route.startFinish': 'Rajt / Cél',
    'workout.route.aria': 'Az útvonal alakja: {points} rögzített pont, {length}.',
    'workout.route.dropped.one': '{n} pontatlan pont kimaradt.',
    'workout.route.dropped.other': '{n} pontatlan pont kimaradt.',
    // ⚠️ Négy állapot, és pontosan egy igaz belőlük egyszerre. A „nincs térkép"
    // az ALAPÉRTELMEZETT, és aki soha nem nyitja meg a beállítást, ebben marad.
    'workout.route.noTiles':
      'Csak a rögzített koordinátákból rajzolva: térkép nincs alatta, mert nincs bekapcsolva. A Beállításokban választhatsz forrást — ott az is olvasható, melyik forrás kinek mit árul el.',
    'workout.route.viaOwn':
      'A térkép a saját csempeszerveredről jön, a Helsa szerverén keresztül. A böngésződ csak a Helsa szerverével beszél, és a csempéket kiszolgáló gép is a tiéd.',
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
      'Ebbe az edzésbe egyetlen pulzusmérés esik — ebből se görbét, se átlagot nem lehet számolni.',
    'workout.hr.noWindow':
      'Ennek a felvételnek nincs befejezési ideje, így nincs időablak, amelyből a pulzust ki lehetne olvasni.',
    'workout.hr.failed.title': 'A pulzusmérések nem tölthetők be',
    'workout.hr.failed.body': 'Sikertelen lekérés, nem hiányzó mérés.',
    'workout.hr.average': 'Átlag',
    'workout.hr.peak': 'Csúcs',
    'workout.hr.lowest': 'Legalacsonyabb',
    'workout.hr.fromWindow':
      'A görbe és a fölötte álló három szám minden olyan pulzusmérés, amit az alkalom időablakában bármelyik készülék vagy app rögzített. Egy mérés nincs felvételhez kötve, így egy másik készülék ugyanazon percekből származó mérései is benne vannak.',
    'workout.hr.truncated':
      'A görbe félbemarad: ebben az edzésben több mérés van, mint amennyit egy lekérés beolvas.',

    'workout.laps.title': 'Részidők',
    'workout.laps.col.index': '#',
    'workout.laps.note':
      'A részidőket a rögzítő alkalmazás adja meg. Ha az edzés egyetlen részből áll, nem jelenik meg semmi: ez csak a rendszer alapegysége, nem te osztottad részekre.',

    'workout.weather.title': 'Időjárás',
    'workout.weather.condition': 'Állapot',
    'workout.weather.temperature': 'Hőmérséklet',
    'workout.weather.humidity': 'Páratartalom',

    'workout.dup.title': 'Talán ugyanez az edzés, máshol is rögzítve',
    'workout.dup.body.one':
      'Ez az edzés úgy fest, mintha {n} alkalommal szerepelne az Egészség appban.',
    'workout.dup.body.other':
      'Ez az edzés úgy fest, mintha {n} alkalommal szerepelne az Egészség appban: azonos tevékenység felvételei átfedő időben — egy órától és egy apptól, vagy két apptól. Az Egészség app nem köti össze őket, így ez következtetés. A lista egy sort mutat belőle; itt vannak a többiek, pontosan úgy, ahogy rögzítették őket.',
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
      'Az átvitt adatokban csak a mintákhoz tartozik forráskészülék, így ebből csak az derül ki, melyik eszköz rögzítette a pulzust, más nem. Hogy melyik app rögzítette magát az edzést és az útvonalat, az csak a telefonon, a HealthKitben látszik — a szerverhez nem jut el.',

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
      'Éjszakánként, szakaszokra bontva. A minőségi mutatók — hatékonyság, felébredések, szakaszarányok — {derived} értékek a szakaszokból; a HealthKitben nincs „alvásminőség” mező. Egy éjszaka a folytonos szakaszok sora: három óránál hosszabb szünet után új tétel kezdődik, így a szunyókálás külön látszik.',
    'sleep.subtitle.derived': 'számított',
    'sleep.window.one': '{n} éjszaka',
    'sleep.window.other': '{n} éjszaka',
    'sleep.empty.title': 'Még nincs alvásadat',
    'sleep.empty.hint':
      'Az alvásszakaszokat a Watch rögzíti, és a párosított iPhone tölti fel.',
    'sleep.avgSleep.one': 'Átlagos alvásidő — {n} éjszaka',
    'sleep.avgSleep.other': 'Átlagos alvásidő — {n} éjszaka',
    'sleep.efficiency': 'Alváshatékonyság',
    'sleep.awakeningsPerNight': 'Felébredések / éjszaka',
    'sleep.deepRemShare': 'Mély + REM arány',
    'sleep.stagesChart': 'Szakaszok éjszakánként (perc)',
    'sleep.physio.title': 'Élettani mutatók az időszakban',
    'sleep.physio.note':
      'Ezek az egész időszak átlagai, nem kizárólag az alvásablakból — a minták alvásablakra szűrése a backend {insights} rétegére vár (docs/23 §5).',
    'sleep.night.title': '{date} — alvás {duration}',
    'sleep.night.latest': 'Múlt éjjel · {date} — alvás {duration}',
    'sleep.night.title.notRecorded': '{date} — az alvás hossza nincs rögzítve',
    'sleep.night.latest.notRecorded': 'Múlt éjjel · {date} — az alvás hossza nincs rögzítve',
    'sleep.night.newest': 'Legutóbbi alvás · {date} — alvás {duration}',
    'sleep.night.newest.notRecorded': 'Legutóbbi alvás · {date} — az alvás hossza nincs rögzítve',
    'sleep.nights.title.one': 'Az időszak éjszakája',
    'sleep.nights.title.other': 'Az időszak {n} éjszakája',
    'sleep.nap': 'Szunyókálás',
    'sleep.naps.count.one': '{n} szunyókálás',
    'sleep.naps.count.other': '{n} szunyókálás',
    'sleep.naps.note.one':
      'Ezen felül {n} szunyókálás ({duration} alvás) — a fenti éjszakai számokban nincs benne.',
    'sleep.naps.note.other':
      'Ezen felül {n} szunyókálás, összesen {duration} alvás — a fenti éjszakai számokban nincs benne.',
    'sleep.nights.hint':
      'Válassz egy éjszakát, és fent kinyílik. A csík az adott éjszaka szakaszainak aránya; az utolsó két oszlop a hatékonyság és a felébredések száma.',
    'sleep.stagesChart.hint': 'Kattints egy oszlopra, és az az éjszaka nyílik meg fent.',
    'sleep.gap.one':
      'Az utolsó {n} éjszakából {nights} tartalmaz alvásadatot. A többiről nincs feljegyzés — ezek nem átvirrasztott éjszakák.',
    'sleep.gap.other':
      'Az utolsó {n} éjszakából {nights} tartalmaz alvásadatot. A többiről nincs feljegyzés — ezek nem átvirrasztott éjszakák.',
    'sleep.night.aria': 'Alvásszakaszok: {date}',
    'sleep.overlap':
      'A források {duration} átfedéssel rögzítettek adatot erre az éjszakára; az átfedés csak egyszer számít, ezért a teljes alvásidő kevesebb, mint a szakaszok összege.',
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
    // --- Virtual journey ---------------------------------------------------
    'journey.title':
      'Virtuális túra',
    'journey.subtitle':
      'Az útvonal, amit a telefonon jársz, és hogy a megtett táv meddig vitt el rajta.',
    'journey.unknown.title':
      'A telefon még nem küldte el a túrádat',
    'journey.unknown.hint':
      'Az app az 1.0 (7) verziótól küldi el, melyik útvonalat járod és melyik naptól, a következő szinkronnál. Addig ez a szerver nem tudja, fut-e túra.',
    'journey.none.title':
      'A telefonon nem fut virtuális túra',
    'journey.none.hint':
      'Indíts egyet az appban (Ma ▸ Virtuális túra); a következő szinkron után itt is megjelenik.',
    'journey.unknownRoute.title':
      'Olyan útvonal, amit ez a felület nem ismer',
    'journey.unknownRoute.body':
      'A telefon ezt az útvonalat járja: „{id}”, de ez nincs benne ennek a felületnek az útvonallistájában — az app újabb a szervernél. Inkább nem rajzolunk semmit, mint valami rosszat; frissítsd a szervert, és megjelenik az útvonal.',
    'journey.since':
      'Ettől a naptól számoljuk: {date} · {movement} táv',
    'journey.movement.walking':
      'gyalogolt és futott',
    'journey.movement.cycling':
      'kerékpáros',
    'journey.travelled':
      'Megtett táv',
    'journey.ofRoute':
      'Az útvonalból',
    'journey.remaining':
      'Hátralévő',
    'journey.length':
      'Hossz (publikált)',
    'journey.notStarted':
      'A túra ekkor indul: {date}.',
    'journey.noData.title':
      'Ehhez a túrához még nem érkezett táv',
    'journey.noData.hint':
      'Ez nem nulla kilométer: a kezdőnap óta nem volt mérés, vagy még nem szinkronizálódott.',
    'journey.complete':
      'Célba értél.',
    'journey.overshoot':
      '{km} túl rajta.',
    'journey.next':
      'Következik: {name}, {km} múlva.',
    'journey.milestones':
      'Mérföldkövek',
    'journey.reached':
      'elérve',
    'journey.map':
      'Az útvonal',
    'journey.mapAria':
      'Az útvonal, a már megtett szakasz kiemelésével',
    'journey.here':
      'Itt tartasz',
    'journey.sketchNote':
      'Az útvonalrajz vázlatos: a mérföldköveket közelítő koordinátákon egyenes szakaszok kötik össze — ez nem a valódi nyomvonal. A távolságok viszont a publikált szakaszhosszakból jönnek.',
    'journey.trackNote':
      'A rajz a valódi nyomvonal, egyszerűsítve. A haladásodat viszont a publikált hosszhoz mérjük, nem a rajzolt vonaléhoz.',
    'journey.openSource':
      'Forrás megnyitása',
    'journey.serverNote':
      'A táv az, amit ez a szerver megkapott, forrásonként összefésülve. A telefon közvetlenül az Egészség appból olvas, ezért az ott látható szám kicsit eltérhet.',
    'nutrition.title': 'Táplálkozás',
    'nutrition.subtitle':
      'Bevitt energia, makrók és mikrotápanyagok. Az Egészség appba egy étkezésnaplózó app írja őket; a Helsa csak olvassa.',
    'nutrition.range.day': 'Ma',
    'nutrition.range.week': 'Hét',
    'nutrition.range.month': '30 nap',
    'nutrition.degraded.title': 'A napi összegek helyett mintánkénti átlagot mutat a szerver',
    'nutrition.degraded.body':
      'A táplálkozási adatokat mind összegezni kellene, de a backend csak öt mutató összesítési módját ismeri név szerint ({file}), a többire átlagot ad vissza darabszám nélkül. A napi bevitel ebből nem állítható vissza, ezért az itt látható számok az egy bejegyzésre jutó átlagot jelentik, nem a napi összeget.',
    'nutrition.empty.title': 'Még nincs táplálkozási adat',
    'nutrition.empty.hint':
      'A HealthKit magától nem gyűjt étkezést — egy naplózó app (pl. kalóriaszámláló) írja az Egészség appba, és onnan tölti fel az iPhone.',
    'nutrition.headline.sampleAverage': 'Mintánkénti átlag',
    'nutrition.headline.todayTotal': 'Ma összesen',
    'nutrition.headline.dailyAverage': 'Napi átlag',
    'nutrition.stat': '{metric} — {headline}',
    'nutrition.water.title':
      'Víz a célodhoz mérve',
    'nutrition.water.unknown':
      'A telefon még nem küldött vízcélt ennek a szervernek. Az app az 1.0 (7) verziótól küldi, a következő szinkronnál — addig itt nincs mihez mérni.',
    'nutrition.water.none':
      'A telefonon nincs beállított vízcél, és itt nincs testsúly, amiből javasolni lehetne egyet.',
    'nutrition.water.goal.chosen':
      'A napi célod, ahogy a telefonon beállítottad: {goal}.',
    'nutrition.water.goal.suggested':
      'Javasolt napi mennyiség: {goal} — a testsúlyodból számolva, nem te állítottad be.',
    'nutrition.water.suggestionNotice':
      'Ez nem orvosi tanács — csak egy elterjedt kiindulópont (kb. 33 ml testsúlykilogrammonként). A telefon is ezt a javaslatot mutatja, amíg nem állítasz be sajátot.',
    'nutrition.water.today':
      'Ma eddig {amount}, a cél {goal}.',
    'nutrition.water.nothingToday':
      'Ma még nincs rögzítve semmi.',
    'nutrition.water.days':
      'A cél {met} napon teljesült; vizet {measured} napon rögzítettél.',
    'nutrition.water.nothingInPeriod':
      'Ebben az időszakban nincs rögzített víz.',
    'nutrition.water.notComparable':
      'Az itt látható vízmennyiség nem vethető össze a céllal: a szerver nem napi mennyiségként, olvasható mértékegységben küldte.',
    'nutrition.macroSplit.title': 'Makróbontás (energia szerint)',
    'nutrition.macroSplit.aria': 'Makróarány energia szerint',
    'nutrition.macroSplit.note':
      'A fenti grammokból számolt energia {computed} kcal (grammonként 4 / 4 / 9 kcal). A HealthKit külön mért {field} értéke {measured} kcal — a kettő eltérhet, ha a naplózó app nem minden tételhez rögzít makrókat.',
    'nutrition.chart.perBucket': 'Makrók energiája szakaszonként (kcal)',
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
    'challenge.milestones.next': 'A következő {steps} lépésnél van — még {remaining} lépés hiányzik.',
    'challenge.source.title': 'Honnan jönnek a mérföldkövek',
    'challenge.source.default':
      'A gyári mérföldkövek látszanak: a telefon még nem mondta el ennek a szervernek, milyen mérföldköveket állítottál be. Az app az 1.0 (7) verziótól küldi el őket, a következő szinkronnál. Ami a telefonon látszik, eltérhet ettől.',
    'challenge.source.achievement':
      'A legjobb becslésünk: a telefon által legutóbb rögzített érem mérföldkövei. A telefon még nem küldte el a beállításait — az app az 1.0 (7) verziótól küldi —, így a telefonon látszók eltérhetnek.',
    'challenge.source.settings': 'A saját mérföldköveid, ahogy a telefon legutóbb elküldte őket ({date}).',
    'challenge.source.settingsUndated': 'A saját mérföldköveid, ahogy a telefon legutóbb elküldte őket.',
    'challenge.days.title': 'Napról napra',
    'challenge.days.empty': 'Ebből a hónapból még egyetlen nap sem érkezett meg.',
    'challenge.days.gaps.one':
      '{n} nap mérés nélkül — az üres hely hiányzó adat, nem mozdulatlan nap.',
    'challenge.days.gaps.other':
      '{n} nap mérés nélkül — az üres helyek hiányzó adatok, nem mozdulatlan napok.',
    'challenge.streak.title': 'Napi sorozat',
    'challenge.streak.length.one': '{n} napos sorozat',
    'challenge.streak.length.other': '{n} napos sorozat',
    'challenge.streak.current': 'Jelenlegi sorozat',
    'challenge.streak.none': 'Most nincs futó sorozat.',
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
    'challenge.streak.broken.restOverBudget':
      '{date} — pihenőnapnak jelölted, de a heti keret (két nap) addigra elfogyott, így ez megszakította a sorozatot.',
    'challenge.streak.active.one': '{n} nap mozgással',
    'challenge.streak.active.other': '{n} nap mozgással',
    'challenge.streak.rest.one': '{n} pihenőnap',
    'challenge.streak.rest.other': '{n} pihenőnap',
    'challenge.streak.restDays': 'Pihenőnapok ebben a sorozatban, ahogy a telefonon jelölted őket: {days}.',
    'challenge.streak.lowerBound.body':
      'A betegnapok és az általad megjelölt pihenőnapok nem szakítják meg a sorozatot — de egyik sem jutott el ehhez a szerverhez: a napló a telefonon marad, a pihenőnapjaidat pedig a telefon még nem küldte el (az app az 1.0 (7) verziótól küldi). Az itteni sorozat ezért rövidebb lehet a telefonon látszónál, hosszabb soha.',
    'challenge.streak.lowerBound.illnessOnly':
      'Az általad jelölt pihenőnapokat itt is pontosan úgy számoljuk, mint a telefon — hét napon belül legfeljebb kettőt. A betegnapokat nem: a napló a telefonon marad, így ha beteg voltál egy nap, az itt sima kihagyott napnak számít. Az itteni sorozat rövidebb lehet a telefonon látszónál, hosszabb soha.',

    // --- Settings ----------------------------------------------------------
    'settings.title': 'Beállítások',
    'settings.subtitle':
      'Egyfelhasználós rendszer — nincs bejelentkezés. A hozzáférés kétrétegű: hálózati (WireGuard) és alkalmazásszintű (eszköztoken).',
    'settings.token.title': 'Eszköztoken',
    'settings.token.present': 'Be van állítva ezen a gépen. Új gépen egyszer kell megadni.',
    'settings.token.clear': 'Token törlése',
    'settings.token.hint': 'Illeszd be a tokent — a böngésző tárolja, a szerver nem kér jelszót.',
    'settings.token.placeholder': 'eszköz-token',
    'settings.token.save': 'Mentés',
    'settings.devices.title': 'Eszközök és a szinkronizálás frissessége',
    'settings.devices.empty': 'Még nincs regisztrált eszköz.',
    'settings.devices.col.device': 'Eszköz',
    'settings.devices.col.platform': 'Platform',
    'settings.devices.col.lastSync': 'Utolsó szinkron',
    'settings.goals.title': 'Célok',
    'settings.goals.empty': 'Még nincs céladat.',
    'settings.goals.note':
      'A három Apple-gyűrű célja a HealthKitből jön (csak olvasható); a lépéscélt te állítod be.',
    'settings.system.title': 'Rendszer',
    'settings.system.browserTz': 'Böngésző időzónája',
    'settings.system.serverTz': 'Szerver időzónája',
    'settings.system.units': 'Mértékegységrendszer',
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
    'settings.map.saved': 'Elmentve. Ez a beállítás csak ebben a böngészőben érvényes.',

    'settings.language.title': 'Nyelv',
    'settings.language.note':
      'A felület nyelve. Csak a böngészőben tárolódik — a szervertől érkező szöveg (a megfigyelések mondatai, hibaüzenetek) ettől függetlenül a szerver nyelvén marad.',

    // --- Beállítások · export ------------------------------------------------
    // Ahol illik, a telefon szerverexport-szövegei (`ExportView.swift`). A web
    // csak a szerveres felet tudja: nincs HealthKit, amiből olvasna.
    'settings.export.title': 'Export',
    'settings.export.intro':
      'A nyers mintáid a szerverről, soronként egy mérés — minden egyes pulzusmérés, nem napi összesítők. A szerver szinkron módon készíti: a válasz maga a fájl.',
    'settings.export.format': 'Formátum',
    'settings.export.format.csvNote':
      'Soronként egy minta: időpont, típus, érték, mértékegység, forráseszköz. Táblázatkezelőben is megnyílik.',
    'settings.export.format.jsonNote':
      'A minták, mellettük az időszak edzései és alvásszakaszai, egyetlen fájlban.',
    'settings.export.period': 'Időszak',
    'settings.export.days.one': '{n} nap',
    'settings.export.days.other': '{n} nap',
    'settings.export.year': '1 év',
    'settings.export.custom': 'Dátumok megadása',
    'settings.export.from': 'Ettől',
    'settings.export.to': 'Eddig (bezárólag)',
    'settings.export.periodNote':
      'A mai nappal bezárólag visszafelé. Minél hosszabb az időszak, annál tovább tart — egy évnyi pulzus önmagában több százezer sor.',
    'settings.export.customNote':
      'Naptári napok a szerver időzónájában; az utolsó nap is benne van.',
    'settings.export.badRange': 'Az első nap nem lehet későbbi az utolsónál.',
    'settings.export.metrics': 'Metrikák',
    'settings.export.metrics.all': 'Minden metrika',
    'settings.export.metrics.some': 'Csak a bejelöltek',
    'settings.export.metrics.selected.one': '{n} kiválasztva',
    'settings.export.metrics.selected.other': '{n} kiválasztva',
    'settings.export.metrics.listing': 'Az adattal rendelkező metrikák listázása…',
    'settings.export.metrics.none': 'Jelölj be legalább egy metrikát, vagy válaszd mindet.',
    'settings.export.metrics.note':
      'Ez csak a mintákat szűkíti. A JSON-fájlban az edzések és az alvásszakaszok mindenképp a teljes időszakra jönnek.',
    'settings.export.download': 'Letöltés a szerverről',
    'settings.export.cancel': 'Leállítás',
    'settings.export.waiting': 'Várjuk, hogy a szerver elkezdje küldeni a fájlt…',
    'settings.export.receiving': 'Érkezik: eddig {size}, {seconds} mp',
    'settings.export.noTotal':
      'A szerver úgy küldi a fájlt, hogy előre nem mondja meg a méretét, ezért nincs százalék — csak az látszik, ami már megérkezett.',
    'settings.export.done': 'Átadva a böngészőnek: {file} ({size}).',
    'settings.export.cancelled': 'Leállítva. Nem mentettünk el semmit.',
    'settings.export.failed': 'Az export nem sikerült: {error}',
    'settings.export.truncated':
      'A fájl csonkán érkezett: a szerver elkezdte küldeni, aztán abbahagyta. Nem mentettük el — próbáld újra, vagy rövidebb időszakkal.',
    'settings.export.footer':
      'A PDF szerepel az API-szerződésben, de még nincs megvalósítva — ezért nem kínáljuk fel. Egy félbeszakadt CSV nem különböztethető meg egy teljestől; a JSON-fájlnál mentés előtt ellenőrizzük a záró zárójelet.',

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
      'Ez teljes válasz, nem hiba. Minden szabálynak kell valamennyi mért nap, és amelyiknek ennyi nincs meg, az inkább hallgat, mint hogy kitaláljon valamit.',
    'insights.kind.anomaly': 'Eltérés a saját alapvonaladtól',
    'insights.kind.anomaly.about':
      'Az utóbbi napok a saját, hosszabb viszonyítási időszakodhoz mérve.',
    'insights.kind.trend': 'Változás az előző ablakhoz képest',
    'insights.kind.trend.about': 'Egy ablak összevetve a közvetlenül előtte lévővel.',
    'insights.kind.correlation': 'Két adatsor együtt mozog',
    'insights.kind.correlation.about':
      'Együttmozgás egy hosszabb időablakban. Az együttmozgás nem azt jelenti, hogy az egyik okozza a másikat.',
    'insights.kind.pattern': 'Az ablak egy tulajdonsága',
    'insights.kind.pattern.about':
      'Nem időbeli változás: mennyire szórnak az értékek, miben tér el a hétvége a hétköznaptól.',
    'insights.kind.other': 'Egyéb megfigyelések',
    'insights.kind.other.about':
      'A szervernek van egy szabálycsaládja, amelyet a webes felület ezen változata még nem ismer név szerint.',
    'insights.severity.info': 'Tájékoztatás',
    'insights.severity.notice': 'Érdemes ránézni',
    'insights.generatedAt': 'számítva: {when}',
    'insights.unnamed': 'A szerver nem küldött mondatot ehhez a szabályhoz.',
    'insights.values.summary': 'A szabály számításai',
    'insights.values.note':
      'Ezek a megfigyeléssel együtt érkeznek, hogy a kliens maga fogalmazhassa meg a mondatot. A szabály saját számításai, nem pontszám.',
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
      'Az érmeket a telefon számolja ki és tölti fel; a küldött listában erre a hónapra egy sincs.',
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
    'achievements.month.days.goal': 'A kitöltött oszlop olyan nap, amelyen elérted a napi {steps} lépéses célt.',
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
    'coverage.title': 'Adatteljesség',
    'coverage.subtitle': 'Melyik mérésed érkezik ide, és ki írja őket.',
    // ⚠️ Szándékosan úgy fogalmazva, hogy egyik szám se kapjon toldalékot: a
    // magyar illeszkedés a számnév UTOLSÓ kimondott tagjához igazodik, tehát
    // nincs egyetlen jó konstans (egy**re**, harminchét**re**, százhúsz**ra**).
    'coverage.headline':
      'A vizsgált {total} típusból {measured} típushoz érkezett adat az elmúlt {days} napban.',
    'coverage.window.30': '30 nap',
    'coverage.window.90': '90 nap',
    'coverage.window.365': 'Egy év',
    'coverage.window.aria': 'A vizsgált időszak hossza',
    'coverage.limits.title': 'Mit mond ez az oldal, és mit nem',
    'coverage.limits.body':
      'Ez az, ami a szerverre megérkezett. A szerver az engedélyeket nem látja: egy típus, amelyre sosem adtál engedélyt, egy típus, amely mögött nincs érzékelő, és egy típus, amelyet a telefon nem tudott feltölteni, innen nézve mind egyszerű hiánynak látszik. A telefonon lévő app meg tudja különböztetni őket, és típusonként meg is mutatja.',
    'coverage.state.measured': 'Van adat',
    'coverage.state.outside_window': 'Ebben az időszakban semmi',
    'coverage.state.never_arrived': 'Soha nem érkezett',
    'coverage.col.metric': 'Metrika',
    'coverage.col.state': 'Állapot',
    'coverage.col.days': 'Mért napok',
    'coverage.col.samples': 'Minták',
    'coverage.col.last': 'Utoljára',
    'coverage.col.sources': 'Ki írja',
    'coverage.group.count': '{total} típusból {measured} típusra érkezik adat',
    'coverage.group.empty': 'Ebből a csoportból még semmi nem érkezett ide.',
    'coverage.notInCatalog': 'nincs a katalógusban',
    'coverage.notInCatalogTitle':
      'Ez a típus megérkezett, de a katalógus nem ismeri — valószínűleg egy újabb iOS-ből jön. Inkább felsoroljuk, mint hogy eldobjuk.',
    'coverage.device.watch': 'óra',
    'coverage.device.iphone': 'telefon',
    'coverage.device.unknown': 'nincs megadva az eszköz',
    'coverage.device.unknownTitle':
      'A feltöltés nem mondta meg, milyen eszközről jött. Ez pontosan ennyit jelent — nem azt, hogy a telefon mérte.',
    'coverage.gaps.title': 'Abbamaradt',
    'coverage.gaps.body':
      'Ezek eddig ritmusban érkeztek, és a ritmus megtört. Ez megfigyelés, nem hiba — nem tudjuk, miért, és lehet, hogy nincs is olyan oka, amelyet érdemes tudni.',
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
    'ingest.subtitle': 'Amit a telefon már átadott, de a szerver még nem írt be az adatbázisba. Amint a telefon átad egy részt, a dolga ezzel véget ér — ez az oldal az utána következő szakaszt mutatja.',
    'ingest.checkedAt': 'Frissítve: {time} · ötmásodpercenként frissül magától',
    'ingest.stale.title': 'Nem sikerült frissíteni',
    'ingest.stale.body': 'Ami lent látszik, az az utolsó sikeres lekérdezés (frissítve: {time}).',
    'ingest.unreachable.title': 'A sor most nem olvasható',
    'ingest.unreachable.body': 'A szerver nem éri el a sorát (RabbitMQ), így nincs mit mutatni — nem nulla, hanem semmi. Amíg ez tart, a szerver a feltöltéseket is elutasítja.',
    'ingest.unreachable.detail': 'A hiba: {error}',
    'ingest.dlq.title.one': '{n} részt nem sikerült beírni, ezért félretettük',
    'ingest.dlq.title.other': '{n} részt nem sikerült beírni, ezért félretettük',
    'ingest.dlq.body': 'Magától semmi nem próbálja újra őket, és a telefon már továbblépett, így ez az adat még nincs az adatbázisban.',
    'ingest.noConsumer.title': 'Részek várnak, és semmi nem írja be őket',
    'ingest.noConsumer.body': 'Lassúságnak tűnik, de nem az: amíg nem fut worker, a sor egyáltalán nem fogy. Nézd meg a worker-konténert ({ps}, {logs}).',
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
      'Van kapcsolódó worker, de a számlálói nem olvashatók (a Redis nem válaszolt, vagy ez a worker túl régi ahhoz, hogy jelentse őket) — így nem tudni, halad-e a sor. Ez nem ugyanaz, mint hogy „nem halad”.',
    'ingest.settling':
      'Semmi nem vár kiosztásra. A worker még befejezheti a már felvett részeket (legfeljebb {n} darabot). Az oldal akkor mondja, hogy „nincs több beírnivaló”, ha 30 másodpercig semmi nem készült el.',
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
      'Egy elem egy minta, edzés, alvásszakasz, aktivitás-összesítő vagy törlés. Ami megérkezett, nem feltétlenül új: az írás idempotens.',
    'ingest.worker.none': 'Ezzel a verzióval még egy worker sem jelentkezett.',
    'ingest.stats.unreachable.title': 'A worker számlálói nem olvashatók',
    'ingest.stats.unreachable.body':
      'Az ütem, a becslés és az utolsó köteg ideje ismeretlen, mert a Redis nem válaszolt. A sor mélysége ettől még pontos.',

    // --- A menü csoportjai ------------------------------------------------
    // A címek egy állítást fogalmaznak meg arról, mi tartozik össze — ezért
    // kettő közülük szó szerint az app sávneve (`DashboardBand.title`). Ha a
    // kettő szétcsúszik, ugyanaz a tartalom két nevet kap.
    'nav.aria': 'Oldalak',
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
    'today.sleep.empty': 'Az elmúlt két napra nem érkezett alvásszakasz.',
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
      'Ehhez az éjszakához nincsenek alvásszakaszok — az eszköz csak az alvást és az ébrenlétet rögzítette.',
    'today.sleep.notRecorded': 'Az alvás hossza nincs rögzítve',
    'today.sleep.inBedOnly':
      'Csak az ágyban töltött idő érkezett meg ({duration}), alvásszakasz nélkül — így nem tudni, mennyit aludtál, de ez nem nullát jelent.',
    'today.challenge.steps': 'lépés',
    'today.challenge.allMilestones': 'minden mérföldkő megvan ({n})',
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
    'today.sync.lastSeen': 'Utoljára jelentkezett eszköz: {device}, {when}',
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
    'trends.legend.usualRange': 'a szokásos sávod',
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
    'workout.route.toSettings': 'Térkép az útvonal alá — Beállítások',
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
    'workouts.row.dup.aria': 'Lehet, hogy {n} felvétel is van róla az Egészség appban',
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
    'ingest.hero.tech': 'köteg ebben a sorban: {name}',
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
    'ingest.worker.state.connected': 'Kapcsolódva',
    'ingest.worker.state.finishing': 'Talán még befejez valamit',
    'ingest.worker.line.none': 'Nincs kapcsolódó worker',
    'ingest.worker.line.connected.one': 'Kapcsolódó worker: {n}',
    'ingest.worker.line.connected.other': 'Kapcsolódó worker: {n}',
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
      'Újrapróbálod a félretett {n} részt? A beírás idempotens: ami már az adatbázisban van, az csak frissül.',
    'ingest.redrive.confirm.other':
      'Újrapróbálod a félretett {n} részt? A beírás idempotens: ami már az adatbázisban van, az csak frissül.',
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
      'Közülük {n} már legalább a harmadik újrapróbálásánál tart — a korábbiak nem segítettek, így amíg az ok nincs kijavítva, ez az újrapróbálás is aligha segít.',
    'ingest.redrive.repeated.other':
      'Közülük {n} már legalább a harmadik újrapróbálásánál tart — a korábbiak nem segítettek, így amíg az ok nincs kijavítva, ez az újrapróbálás is aligha segít.',
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
    'ingest.reason.sleep.one': '{n} alvásszakasz',
    'ingest.reason.sleep.other': '{n} alvásszakasz',
    'ingest.reason.activity.one': '{n} aktivitás-összesítő',
    'ingest.reason.activity.other': '{n} aktivitás-összesítő',
    'ingest.reason.deletions.one': '{n} törlés',
    'ingest.reason.deletions.other': '{n} törlés',
    'ingest.reason.repeated': 'Újra elbukott, ennyi újrapróbálás után: {n}',
    'ingest.reason.raw': 'A worker üzenete',
    'ingest.reason.batch': 'Köteg: {id}',
    'ingest.reason.lastRedrive': 'Legutóbbi újrapróbálás vége: {when}, visszakerült: {moved}.',

    // --- Training progress (pages/Training.tsx) -------------------------------
    // The phone's Hungarian (HelsaKit Localizable.xcstrings) wherever the phone
    // says the same thing; web-only lines are the ones about the server. The
    // "Edzés-" prefix is the web's own: the phone's bare "Előrehaladás" sits
    // inside the Workouts tab, while a sidebar entry has to say progress in WHAT.
    'nav.training': 'Edzés-előrehaladás',
    'training.title': 'Edzés-előrehaladás',
    'training.subtitle':
      'Amit az Egészség app már tud, hétről hétre megszámolva: milyen gyakran, mennyi ideig, milyen keményen. Pontszám és tanács nélkül.',
    'training.spanAria': 'Időszak',
    'training.span.4': '4 hét',
    'training.span.12': '3 hónap',
    'training.span.52': 'Év',
    'training.step.back': 'Előző időszak',
    'training.step.forward': 'Következő időszak',
    'training.step.now': 'Vissza a mához',
    'training.window.last': 'Az elmúlt {n} hét',
    'training.window.past': '{n} hét',
    'training.empty': 'Ebben az időszakban nem volt edzés.',
    'training.sessions.title': 'Alkalmak',
    'training.weeksTrained.title': 'Hetek edzéssel',
    'training.weeksOf': '{total} hétből {active} hétben',
    'training.perWeek': 'hetente',
    'training.workoutIn': '{total} hétből {active} hétben volt edzés.',
    'training.chartAria': 'Grafikon',
    'training.chart.grid': 'Heti rács',
    'training.chart.bars': 'Oszlopok',
    'training.grid.aria': 'Alkalmak hetente',
    'training.legend.rest': 'nincs edzés',
    'training.legend.max': '4+ alkalom',
    'training.cell.one': '{date}: {n} alkalom, {time}',
    'training.cell.other': '{date}: {n} alkalom, {time}',
    'training.cell.rest': '{date}: nincs edzés',
    'training.cell.partial': '(a mostani hét, még nem ért véget)',
    'training.week': '{date} kezdetű hét',
    'training.table.summary': 'A hetek táblázatként',
    'training.table.week': 'A hét kezdete',
    'training.cat.strength': 'Erősítés',
    'training.cat.cardio': 'Kardió',
    'training.cat.other': 'Egyéb',
    'training.typical': 'Egy szokásos hét: {sessions} alkalom, {time} ({n} hét mediánja).',
    'training.gapRule':
      'Az edzés nélküli hét résként marad a grafikonon, és beleszámít az átlagba. A mostani hét csak akkor számít bele, ha már véget ért. A két eszközzel rögzített edzés egynek számít.',
    'training.time.title': 'Edzésidő',
    'training.inTypical': 'egy szokásos héten',
    'training.total.one': 'Összesen {time}, {n} alkalommal.',
    'training.total.other': 'Összesen {time}, {n} alkalommal.',
    'training.compare.same': 'Ugyanannyi, mint az előző {n} hétben.',
    'training.compare.diff': 'Az előző {n} héthez képest: {diff}',
    'training.rest.title': 'Leghosszabb szünet',
    'training.rest.none': 'Nem volt edzés nélküli hét',
    'training.rest.span.one': '{n} hét, {from} – {to}',
    'training.rest.span.other': '{n} hét, {from} – {to}',
    'training.rest.hint': 'Csak a lezárult hetek — a mostani hét még nem szünet.',
    'training.types.title': 'Típus szerint',
    'training.types.row': '{n} × · {time}',
    'training.types.hint': 'A típust a rögzítő app adta meg. Az oszlop hossza az edzésidő.',
    'training.zone.title': '3. zóna és fölötte',
    'training.zone.aria': 'Percek a 3. zónában és fölötte, hetente',
    'training.zone.minutes': 'Perc',
    'training.zone.loading': 'A szerver számolja a perceket…',
    'training.zone.noMaximum':
      'Az elmúlt évben kevesebb mint {n} edzés rögzített maximális pulzust, ezért a zónákat még nem lehet kiszámolni.',
    'training.zone.method':
      'Ez nem pontszám: azok a percek, amikor a pulzusod legalább {threshold} szívverés/perc volt. Ez 70 százaléka annak a pulzusnak ({max} szívverés/perc), amely az elmúlt év edzéseinek második legmagasabb értéke volt ({n} edzésből). Ha még sosem edzettél teljes erőből, a valódi maximumod magasabb, így itt több perc jön ki, mint ha a maximumodat laborban mérték volna.',
    'training.zone.window':
      'A pulzust az idő köti az edzéshez, nem egy hivatkozás: minden mérés számít, amely az edzés kezdete és vége közé esik, bármelyik eszközről. Az edzés közben mért, de hozzá nem kapcsolt érték tehát szintén beleszámít.',
    'training.zone.unmeasured.one': '{n} edzésnél nem volt pulzusmérés, ez nem számít bele a percekbe.',
    'training.zone.unmeasured.other': '{n} edzésnél nem volt pulzusmérés, ezek nem számítanak bele a percekbe.',
    'training.vitals.title': 'Közben a nyugalmi pulzusod',
    'training.vitals.rhr': 'Nyugalmi pulzus',
    'training.vitals.hrv': 'HRV',
    'training.vitals.start': 'Az időszak elején: {v}',
    'training.vitals.notEnough': 'Nincs elég mérés.',
    'training.vitals.hint':
      'Ez minden napra megvan, az edzés nélküli heteken is, ezért itt nincs rés. Együtt mozog az edzéssel, de ebből nem következik, hogy az edzés okozta.',
    'training.history.loading': 'Még töltődik az edzésnapló — a legrégebbi hetek még kiegészülhetnek.',
    'training.history.capped':
      'Az edzésnapló betöltése az időszak eleje előtt megállt, ezért a legrégebbi hetekből hiányozhatnak alkalmak.',
    'training.source':
      'Forrás: az edzések, a pulzus, a nyugalmi pulzus és a HRV, amit a telefon erre a szerverre küldött. Ehhez az oldalhoz semmi nem tárolódik.',
    // --- Egészségösszesítő (pages/Report.tsx) ------------------------------------
    // ⚠️ Ahol a telefon összesítőjén ugyanaz a mondat áll (HelsaKit `Report/`), a
    // szöveg onnan jön szóról szóra: egy orvos két nyomtatott lapon ne olvasson
    // két megfogalmazást ugyanarról.
    'nav.report': 'Egészségösszesítő',
    'report.title': 'Egészségösszesítő',
    'report.subtitle':
      'A telefon orvosnak szánt, nyomtatható összesítője abból, ami a szerveren van. Nyomtasd ki, vagy a nyomtatási ablakban mentsd PDF-be.',
    'report.periodAria': 'Időszak',
    'report.days.30': '30 nap',
    'report.days.90': '3 hónap',
    'report.days.180': '6 hónap',
    'report.days.365': '1 év',
    // The file name "Save as PDF" offers — impersonal on purpose (`ReportContent.fileName`).
    'report.fileName': 'helsa-osszesito-{day}',
    'report.print': 'Nyomtatás vagy mentés PDF-be',
    'report.printHint':
      'A PDF a böngésző nyomtatási ablakából jön: nyomtatóként a „Mentés PDF-ként” lehetőséget válaszd. A szerver maga még nem készít PDF-et.',
    'report.metrics.title': 'A lapon szereplő mérések',
    'report.metrics.add': 'Mérés hozzáadása',
    'report.metrics.remove': '{metric} eltávolítása',
    'report.metrics.reset': 'Vissza az alapkészlethez',
    'report.metrics.withData': 'Van adat',
    'report.metrics.noData': 'Még nincs adat',
    'report.metrics.defaultNote':
      'Az alapkészlet kiindulópont, nem ajánlás: hogy miről szól a vizit, azt te választod.',
    'report.metrics.none': 'Válassz legalább egy mérést.',
    'report.made': 'Készült: {when}',
    'report.period': '{range} · {n} nap',
    'report.changes.title': 'Az előző, ugyanilyen hosszú időszakhoz képest:',
    'report.changes.line': '{name}: {from} → {to} ({pct})',
    'report.changes.lineNoPct': '{name}: {from} → {to}',
    'report.changes.withheld':
      'Nincs összevetve, mert a két időszakban nagyon eltérő arányban volt mérés: {list}.',
    'report.changes.withheldItem': '{name} (most {now} / {days} napon, előtte {then} / {days} napon)',
    'report.journal.title': 'Amit feljegyeztem',
    'report.table.title': 'Mérések',
    'report.col.measurement': 'Mérés',
    'report.col.average': 'Napi átlag',
    'report.col.extremes': 'Szélsőértékek',
    'report.col.usual': 'Szokásos sáv',
    'report.col.days': 'Mért napok',
    'report.noMeasurement': 'nincs mérés',
    'report.usual.none': 'nincs saját mérés',
    'report.usual.little': 'kevés adat ({n} nap)',
    'report.coverage': '{n} / {of} napon van mérés',
    'report.sub.latest': 'legutóbbi mérés: {value}',
    'report.sub.middle': 'szokásos közép: {value}',
    'report.sub.total': 'időszaki összeg: {value}',
    'report.sub.degraded': 'mintánkénti átlagként érkezik, nem napi összegként',
    'report.empty': 'Ebben az időszakban nincs mérés: {list}.',
    'report.nothing': 'Ebben az időszakban nincs rögzített mérés és edzés. Ez is válasz: nem kell fejből elmondanod.',
    'report.baselineFailed':
      'A szokásos sávot nem sikerült az elmúlt évből beolvasni, ezért csak ebből az időszakból számoltuk, és összevetés sincs.',
    'report.unit.bpm': 'szívverés/perc',
    'report.unit.breaths': 'légzés/perc',
    'report.unit.steps': 'lépés',
    'report.unit.floors': 'emelet',
    'report.unit.mmHg': 'Hgmm',
    'report.unit.minutes': 'perc',
    'report.events.title': 'Rögzített események',
    'report.events.body':
      'A telefon csak akkor küldi el az eseményeit, ha a Napló és események kapcsolója be van kapcsolva, és erre a szerverre még nem küldött — ezért erről az időszakról ez a lap nem tud mit mondani. Az elesést és a szokatlan vérnyomást a telefon állítja össze, ezek sosem kerülnek ide.',
    'report.workouts.title': 'Edzések',
    'report.workouts.col.time': 'Időpont',
    'report.workouts.col.type': 'Típus',
    'report.workouts.col.duration': 'Időtartam',
    'report.workouts.col.distance': 'Táv',
    'report.workouts.col.pulse': 'Pulzus',
    'report.workouts.count.one': '{n} edzés',
    'report.workouts.count.other': '{n} edzés',
    'report.workouts.inTotal': 'összesen {d}',
    'report.workouts.avgHr': 'átl. {n} szívverés/perc',
    'report.workouts.none': 'Ebben az időszakban nincs rögzített edzés.',
    'report.workouts.notLoaded': 'Az edzéseket nem sikerült beolvasni, ezért erről a lap nem tud mit mondani.',
    'report.workouts.over': 'Az időszakban {all} edzés volt, ebből a legutóbbi {shown} szerepel itt.',
    'report.prov.made':
      'Ezt az oldalt a Helsa webes felülete állította össze az Egészség appban tárolt saját adataimból, amelyeket a telefonom a saját szerveremre küldött.',
    'report.prov.self':
      'Saját rögzítésű adat: viselhető eszköz, telefon, otthoni mérőeszköz és saját bejegyzések. Ez nem klinikai mérés.',
    'report.prov.usual':
      'A „szokásos sáv” a saját napi értékeim középső 80%-a (10–90. percentilis) az utolsó {n} napból. Nem orvosi referenciatartomány.',
    'report.prov.noAssessment':
      'A lapon nincs értékelés, minősítés, diagnózis vagy javaslat: csak mért számok és dátumok.',
    'report.prov.gaps':
      'Ahol nincs mérés, ott nincs adat: a hiányzó nap nem nulla, hanem kimarad az átlagból. A szélsőértékek a pillanatnyi méréseknél az egyes mérések, a gyűjtő jellegűeknél a napi összegek szélsőértékei.',
    'report.prov.notMedical':
      'A Helsa nem orvosi eszköz: ezen a lapon semmi sem diagnózis, figyelmeztetés vagy riasztás.',

    // --- Napló és események (pages/Journal, és az összefoglaló két szakasza) ---
    // Csak akkor van adat, ha a telefon opt-in kapcsolója elküldte (1.0 (7)-től).
    'nav.journal': 'Napló és események',
    'journal.title': 'Napló és események',
    'journal.subtitle':
      'Amit a telefonon feljegyeztél — közérzet, tünetek, címkék —, és a jelzések, amelyeket az órád rögzített. Napló, nem diagnózis.',
    'journal.periodAria': 'Időszak',
    'journal.days.30': '30 nap',
    'journal.days.90': '3 hónap',
    'journal.days.365': '1 év',
    'journal.never.title': 'A telefon még nem küldte el a naplóját erre a szerverre',
    'journal.never.body':
      'A napló és az események csak akkor hagyják el a telefont, ha bekapcsolod: az iPhone-appban Beállítások ▸ Export ▸ Saját szerver ▸ Napló és események (1.0 (7)-es verziótól). Alapból ki van kapcsolva, mert ez az adataid legszemélyesebb része. Addig ezen a lapon nincs mit mutatni — és ez semmit nem mond arról, mit jegyeztél fel.',
    'journal.lastReceived': 'Utoljára érkezett a telefonról: {when}',
    'journal.coverage':
      'Feljegyzés: {of} napból {n} napon — a többi napon nincs bejegyzés, ami nem ugyanaz, mint hogy nem volt mit feljegyezni.',
    'journal.emptyWindow':
      'Ebben az időszakban nincs feljegyzés. Ez nem ugyanaz, mint hogy semmi nem történt: naplót akkor ír az ember, amikor eszébe jut.',
    'journal.moods.title': 'Közérzet, napról napra',
    'journal.moods.aria': 'A közérzet az időszak minden napján',
    'journal.moods.cell': '{date}: {mood}',
    'journal.moods.noNote': 'nincs jelölés',
    'journal.episodes.title': 'Betegségepizódok',
    'journal.episodes.none':
      'Ebben az időszakban nincs betegségepizód. Egy epizód olyan napon kezdődik, amelyen fertőzésre jellemző tünet szerepel (láz, torokfájás, köhögés…); a fáradtság vagy a fejfájás önmagában nem nyit epizódot.',
    'journal.episodes.days.one': '{n} nap',
    'journal.episodes.days.other': '{n} nap',
    'journal.episodes.ongoing': 'még tart',
    'journal.episodes.rule':
      'Egy epizódon belül egy bejegyzés nélküli napot áthidalunk, kettő lezárja — a telefon szabálya szerint. A naplóból számolva, nem diagnózis.',
    'journal.events.title': 'Események',
    'journal.events.none':
      'Ebben az időszakban nincs pulzus-, hangoskörnyezet- vagy járásstabilitás-jelzés, és megjelölt pillanat sem.',
    'journal.events.marked': 'Feljegyezve: {list}',
    'journal.events.followUp': '{h} óra múlva: {list}',
    'journal.events.followUpGone': '{h} óra múlva: semmi nem maradt',
    'journal.events.level': '{n} dB',
    'journal.events.note':
      'Az elesés mérés, a Mérések között találod; a szokatlan vérnyomást a telefon számolja ki, ezen a listán nem szerepel.',
    'journal.daysList.title': 'Napról napra',
    'journal.daysList.day': 'Nap',
    'journal.daysList.symptoms': 'Tünetek',
    'journal.daysList.mood': 'Közérzet és címkék',
    'journal.delete.title': 'A szerveren lévő másolat',
    'journal.delete.body':
      'A szerver {n} naplóbejegyzést tárol. A törlés a telefon Egészség appjához nem nyúl; ha a telefon kapcsolója még be van kapcsolva, a következő szinkron újra elküldi őket.',
    'journal.delete.button': 'Napló törlése erről a szerverről',
    'journal.delete.confirm': 'Törlöd az összes közérzet-, tünet- és jelzésbejegyzést erről a szerverről?',
    'journal.delete.done': '{n} bejegyzés törölve.',
    'report.journal.never':
      'A telefon még nem küldte el a naplóját erre a szerverre (a Napló és események kapcsoló ki van kapcsolva, vagy az app régebbi az 1.0 (7)-esnél), ezért ez a lap nem tudja megmutatni, mit jegyeztél fel — és ez nem jelenti azt, hogy semmit. A telefonos appban készült összefoglalón rajta van.',
    'report.journal.tooOld':
      'Ez a szerver régebbi a naplónál, ezért ez a lap nem tudja megmutatni, mit jegyeztél fel — frissítsd a szervert. A telefonos appban készült összefoglalón rajta van.',
    'report.journal.none':
      'Az időszak {n} napjának egyikén sincs feljegyzés. Ez nem ugyanaz, mint hogy nem volt mit feljegyezni.',
    'report.journal.item.one': '{name} ({n} nap)',
    'report.journal.item.other': '{name} ({n} nap)',
    'report.journal.symptoms': 'Tünetek: {list}.',
    'report.journal.symptomsMore': 'Tünetek: {list}, és még {n}.',
    'report.journal.tags': 'Címkék: {list}.',
    'report.journal.tagsMore': 'Címkék: {list}, és még {n}.',
    'report.journal.run': 'A tünetes napok leghosszabb sora: {n} nap, kezdete: {date}.',
    'report.journal.omitted': 'További {n} feljegyzett nap nem fért a listára.',
    'report.events.none':
      'Ebben az időszakban nem rögzült pulzus-, hangoskörnyezet- vagy járásstabilitás-jelzés.',
    'report.events.note':
      'Az elesést és a szokatlan vérnyomást a telefon állítja össze, ezen a listán nem szerepelnek.',

    // --- Év a számokban + évről évre (pages/PeriodSummary, pages/YearByYear) ---
    'nav.period': 'Év a számokban',
    'nav.years': 'Évről évre',
    'period.title.year': '{year} számokban',
    'period.title.month': '{month} számokban',
    'period.subtitle':
      'Egy naptári időszak egyben: az összesítések, az éjszakák, az edzések és az érmek — azzal együtt, hogy mennyiről van adat, és meddig jutott az időszak.',
    'period.unitAria': 'Év vagy hónap',
    'period.unit.year': 'Év',
    'period.unit.month': 'Hónap',
    'period.extent.running.year':
      '{period} még tart: az összegzés a meglévő adatból készült (eddig: {through}), nem a teljes évből.',
    'period.extent.running.month':
      '{period} még tart: az összegzés a meglévő adatból készült (eddig: {through}), nem a teljes hónapból.',
    'period.empty.title': 'Egyetlen mérés sem érkezett',
    'period.empty.hint':
      'Ez nem hiba és nem nulla: erről az időszakról nem tudunk semmit. Ha az adat később ér fel a szerverre, itt magától megjelenik.',
    'period.coverage.nothingElapsed': 'Ebből az időszakból még semmi nem telt el.',
    'period.coverage.none.month': 'Az eddig eltelt {elapsed} hónap egyikéről sincs adat.',
    'period.coverage.none.day': 'Az eddig eltelt {elapsed} nap egyikéről sincs adat.',
    'period.coverage.all.month': 'Az eddig eltelt {elapsed} hónap mindegyikéről van adat.',
    'period.coverage.all.day': 'Az eddig eltelt {elapsed} nap mindegyikéről van adat.',
    'period.coverage.some.month': 'Az eddig eltelt {elapsed} hónap közül {measured} esetében van adat.',
    'period.coverage.some.day': 'Az eddig eltelt {elapsed} nap közül {measured} esetében van adat.',
    'period.compare.previous': '{period}: {value}',
    'period.compare.none':
      '{period} idejéről nincs mért adat, amihez mérni lehetne — ez hiány, nem visszaesés nullára.',
    'period.compare.withheld':
      'Nincs összevetés ezzel: {period} ({value}). A kettőben nagyon eltérő arányban volt mérés, és kevesebb mért szakasz összege már ettől is kisebb.',
    'period.compare.caveat.month': 'Nem azonos a lefedettség: most {now}, akkor {then} hónapról van adat.',
    'period.compare.caveat.day': 'Nem azonos a lefedettség: most {now}, akkor {then} napról van adat.',
    'period.compare.matched':
      'Az összehasonlítás {period} azonos szakaszára szól ({from} – {to}), hogy a két időszak ugyanolyan hosszú legyen.',
    'period.compare.emptyPeriod':
      '{period} azonos szakaszában nincs adat, ezért nincs mihez mérni ezt az időszakot.',
    'period.compare.notLoaded': 'Az előző időszak nem tölthető be, ezért nincs összehasonlítás.',
    'period.noDataFor': 'Nem érkezett adat: {list}.',
    'period.peaks.title': 'Csúcsok',
    'period.peaks.best.year': 'Legjobb hónap — {metric}',
    'period.peaks.best.month': 'Legjobb nap — {metric}',
    'period.peaks.sleep': 'Leghosszabb alvás',
    'period.peaks.workout': 'Leghosszabb edzés',
    'period.peaks.distance': 'Leghosszabb táv',
    'period.sleep.title': 'Alvás',
    'period.sleep.average': 'Átlagos éjszaka',
    'period.sleep.nights': 'Mért éjszakák',
    'period.sleep.total': 'Összes alvás',
    'period.sleep.overMeasured': 'Az átlag a mért éjszakákra vonatkozik.',
    'period.sleep.none': 'Ebben az időszakban egyetlen alvásszakasz sem érkezett.',
    'period.sleep.notLoaded':
      'Az alvásadat nem tölthető be — ez nem azt jelenti, hogy nem aludtál, hanem hogy nem tudjuk megnézni.',
    'period.sleep.open': 'Minden éjszaka — Alvás',
    'period.workouts.title': 'Edzések',
    'period.workouts.count': 'Edzések',
    'period.workouts.time': 'Összes idő',
    'period.workouts.distance': 'Összes táv',
    'period.workouts.none':
      'Ebben az időszakban nincs edzés. Ez nem hiba — a séta és a lépésszám nem edzés.',
    'period.workouts.notLoaded': 'Az edzéslista nem tölthető be.',
    'period.workouts.noEnd.one': '{n} edzésnek nincs záró időpontja — az nem számít bele az összes időbe.',
    'period.workouts.noEnd.other': '{n} edzésnek nincs záró időpontja — azok nem számítanak bele az összes időbe.',
    'period.workouts.folded.one':
      'További {n} felvétel egy már megszámolt edzésről (két eszköz, egy edzés) — egyszer számít, ahogy az Edzések oldalon is.',
    'period.workouts.folded.other':
      'További {n} felvétel már megszámolt edzésekről (két eszköz, egy edzés) — egyszer számítanak, ahogy az Edzések oldalon is.',
    'period.workouts.loading':
      'A régebbi edzések olvasása még tart — amíg be nem fejeződik, a szám csak alsó határ.',
    'period.workouts.capped':
      'Az edzésszám csak alsó határ: az előzmény hosszabb annál, amit az oldal egy menetben beolvas.',
    'period.workouts.open': 'Minden edzés — Edzések',
    'period.medals.title': 'Érmek',
    'period.medals.none': 'Egyetlen érem sem szól erre az időszakra.',
    'period.medals.notLoaded': 'Az érmek nem tölthetők be.',
    'period.medals.onlyPeriod':
      'Csak azok az érmek, amelyek erre az időszakra szólnak. Egy mérföldkőnek nincs saját időszaka, ezért az nincs itt.',
    'period.toYears': 'Ugyanezek az évek egymás mellett:',
    'years.title': 'Évről évre',
    'years.subtitle':
      'A kiválasztott mérések, minden naptári év a többi mellett — legfeljebb öt évre visszamenőleg, ameddig van adat.',
    'years.span': 'Mért adat ezekre az évekre van: {span}',
    'years.partial':
      'Az idei év még tart — minden évet átlagos hónapként hasonlítunk össze, nem összegként, így egy csonka év is odaállhat egy teljes mellé.',
    'years.none.title': 'Nincs semmi kiválasztva',
    'years.none.hint': 'Válassz legalább egy mérést, vagy nyomd meg az Ajánlottak gombot.',
    'years.empty.title': 'Egyik évben sincs még elég adat',
    'years.empty.hint':
      'Egy évhez legalább {min} mért hónap kell, mielőtt egy másik mellé állítjuk. Válassz más méréseket, vagy ellenőrizd, hogy a szinkron lefutott-e.',
    'years.table.aria': 'A kiválasztott mérések évről évre',
    'years.table.metric': 'Mérés',
    'years.table.soFar': 'eddig',
    'years.table.change': 'Az elsőtől az utolsóig',
    'years.table.legend':
      'Az összeadódó mérés átlagos hónapként szerepel, az átlagolt az átlagával — mindkettő csak azokból a hónapokból, amelyekről van adat. Ha egy évben kevesebb mért hónap van, mint {min}, az év nem kap számot. Az oszlop egy mérés éveit veti össze egymással, sosem két mérést.',
    'years.kind.sum': 'átlagos hónap',
    'years.kind.avg': 'átlag',
    'years.cell.none': 'nincs mérés',
    'years.cell.tooFew.one': '{n} hónap · túl kevés',
    'years.cell.tooFew.other': '{n} hónap · túl kevés',
    'years.cell.months.one': '{n} hónap',
    'years.cell.months.other': '{n} hónap',
    'years.cell.ofElapsed': '/ {n}',
    'years.change.title': '{from} és {to} között',
    'years.change.uneven': 'nagyon eltérő lefedettség — fenntartással kezeld',
    'years.noDataFor': 'Egyik évben sincs adat: {list}.',
    'years.degraded':
      'Legalább egy összeadódó mérés csak mintánkénti átlagként érkezett, ezért az átlagos hónapja itt nem rakható össze.',
    'years.why.title': 'Miért kell a telefonon gombot nyomni, itt pedig nem',
    'years.why.body':
      'A telefonon a hosszú visszatekintés évről évre végigolvassa az Egészség-előzményeidet, és közben fogyasztja az akkut — ezért megvárja, hogy kérd. Itt a számok már a szerveren vannak, és az egész egyetlen lekérdezés.',
    'years.toPeriod': 'Egy év részletesen — Év a számokban',
    'years.picker.title': 'Mire terjed ki',
    'years.picker.count': '({n} kiválasztva)',
    'years.picker.recommended': 'Ajánlottak',
    'years.picker.all': 'Mindet',
    'years.picker.clear': 'Egyiket sem',
    'years.picker.note':
      'Az ajánlás az a néhány mérés, amelyik évek távlatában is mond valamit. ⚠️ Az alvás nincs köztük: nem ugyanonnan jön, mint a többi, ezért üresen jelenne meg.',
    'years.picker.groupTake': 'Az egész csoport kijelölése: {group}',
    'years.picker.groupClear': 'Az egész csoport törlése: {group}',
    'years.picker.stored': 'A választás csak ebben a böngészőben marad meg. A telefon a sajátját őrzi.',

    // --- Mérések: a telefon Egészség fülének kártyarácsa --------------------
    // A szakasz- és alcsoportnevek, a vérnyomás- és a járásmondatok a telefon
    // saját magyar szövegei (`Localizable.xcstrings`).
    'nav.measurements': 'Mérések',
    'meas.title': 'Mérések',
    'meas.subtitle':
      'Minden mérés az alváson és a táplálkozáson kívül, a telefon csoportjai szerint: a legutóbbi érték, mikor készült, és a választott időszak íve.',
    'meas.span.aria': 'A kis grafikonok időszaka',
    'meas.span.week': '7 nap',
    'meas.span.month': '30 nap',
    'meas.span.year': '12 hónap',
    'meas.showAll': 'Adat nélküli mérések megjelenítése',
    'meas.jump.aria': 'Csoportok',
    'meas.elsewhere': 'Az alvásnak és a táplálkozásnak saját oldala van: {sleep} · {nutrition}.',
    'meas.latestOld':
      'Amíg a szervert nem frissíted, a kártyák a legutóbbi mérés helyett az elmúlt 30 nap utolsó mért napjának értékét mutatják — a 30 napnál régebbi mérésekhez itt nem jelenik meg szám.',
    'meas.foot':
      'A napokat a te időzónád szerint bontjuk ({tz}). Ami nem érkezett meg, az hézag, sosem nulla — és egyik kártya sem mondja meg, melyik irány a jó.',
    'meas.empty.title': 'Még nincs mérés',
    'meas.empty.hint':
      'Az alváson és a táplálkozáson kívül semmi sem érkezett meg a szerverre. Kapcsold be az „Adat nélküli mérések megjelenítése” kapcsolót, hogy lásd, mi jelenhetne meg itt.',
    'meas.empty.section': 'Ebben a csoportban nincs mérés',
    'meas.section.count': 'Van adat: {n} / {m}',
    'meas.section.activity': 'Aktivitás',
    'meas.section.heart': 'Szív',
    'meas.section.respiratory': 'Légzés',
    'meas.section.body': 'Test',
    'meas.section.mobility': 'Mobilitás',
    'meas.section.environment': 'Környezet',
    'meas.section.other': 'Egyéb mérések',
    'meas.empty.activity':
      'A lépéseket, a távolságot és az elégetett energiát a telefon és az óra rögzíti — egyikről sem érkezett még semmi erre a szerverre.',
    'meas.empty.heart':
      'A pulzust és a hozzá tartozó értékeket az óra méri, a vérnyomást külön mandzsetta — egyikről sem érkezett még semmi erre a szerverre.',
    'meas.empty.respiratory':
      'A légzésszámot és a véroxigént az óra alvás közben méri; a tüdőfunkciós értékek külön eszközről vagy kézi rögzítésből származnak.',
    'meas.empty.body':
      'A testsúly, a testzsír és a derékbőség mérlegről vagy kézi rögzítésből származik — az óra ezeket nem méri.',
    'meas.empty.mobility':
      'A járás- és futásformát a zsebedben hordott iPhone és a csuklódon lévő óra méri — egyikről sem érkezett még semmi erre a szerverre.',
    'meas.empty.environment':
      'A hangterhelést és a napfényes időt a telefon és az óra rögzíti, amíg magadnál hordod őket — egyikről sem érkezett még semmi erre a szerverre.',
    'meas.empty.other':
      'Ezeket az értékeket külön eszköz méri, vagy kézzel kell rögzíteni — egyik sem érkezett még meg erre a szerverre.',
    'meas.sub.dailyMovement': 'Napi mozgás',
    'meas.sub.energy': 'Energia',
    'meas.sub.distancesBySport': 'Sportági távolságok',
    'meas.sub.composition': 'Testösszetétel',
    'meas.sub.proportions': 'Testarányok',
    'meas.sub.temperature': 'Testhőmérséklet',
    'meas.sub.walking': 'Séta',
    'meas.sub.stairs': 'Lépcső',
    'meas.sub.runningForm': 'Futóforma',
    'meas.sub.sound': 'Hangterhelés',
    'meas.sub.daylight': 'Napfény és UV',
    'meas.sub.moreActivity': 'További aktivitásadatok',
    'meas.sub.moreBody': 'További testadatok',
    'meas.sub.moreMovement': 'További mozgásadatok',
    'meas.sub.moreEnvironment': 'További környezeti adatok',
    'meas.sub.more': 'További mérések',
    'meas.head.none': 'Semmi sem érkezett meg a szerverre',
    'meas.head.sample': 'Legutóbbi mérés · {when} · {ago}',
    'meas.head.todaySoFar': 'Ma eddig — a nap még nem ért véget',
    'meas.head.dayTotal': 'Napi összeg: {date} · {ago}',
    'meas.head.dayAverage': 'Napi átlag: {date} · {ago}',
    'meas.head.noFigure': 'Utoljára ekkor érkezett: {when}, de annak a napnak az összegét nem sikerült kiolvasni',
    'meas.stale': 'Ebben az időszakban nincs mérés — a legutóbbi: {ago}.',
    'meas.spark.aria': '{metric}, {span}',
    'meas.usual.band': 'Szokásos sávod: {low}–{high} {unit} (az elmúlt 60 napból {n} mért nap alapján)',
    'meas.usual.bandSum': 'A szokásos napod: {low}–{high} {unit} (az elmúlt 60 napból {n} mért nap alapján)',
    'meas.usual.notEnough': 'Még nincs szokásos sáv: az elmúlt 60 napból {n} napon van mérés, {min} kellene.',
    'meas.usual.noVariation': 'Az elmúlt 60 nap minden mért napján ugyanaz volt az érték, így nincs mit sávként rajzolni.',
    'meas.usual.year': 'A szokásos sáv napi alapú, ezért csak a 7 és a 30 napos nézeten rajzoljuk meg.',
    'meas.degraded': 'A szerver ezt a típust mintánkénti átlagként küldi, így az oszlopok nem napi összegek.',
    'meas.toTrends': 'Teljes grafikon a Trendekben →',
    'meas.bp.title': 'Vérnyomás',
    'meas.bp.unit': 'Hgmm',
    'meas.bp.none.title': 'Nincs vérnyomásadat',
    'meas.bp.none.body':
      'Az Apple Watch nem mér vérnyomást — ehhez külön mandzsetta kell, ami az Egészség appba ír. A hiánya tehát nem hiba.',
    'meas.bp.older': 'Az elmúlt 90 napban nincs mérés. A legutóbbi ekkor érkezett: {when}.',
    'meas.bp.upper': 'a felső (szisztolés)',
    'meas.bp.lower': 'az alsó (diasztolés)',
    'meas.bp.half.title': 'Hiányos vérnyomásmérés',
    'meas.bp.half.body':
      'Csak {present} értékre érkezett adat, {missing} hiányzik. A vérnyomás két összetartozó érték: az egyiket a másik nélkül megmutatni félrevezető lenne, ezért itt nem jelenik meg szám.',
    'meas.bp.noPair.title': 'Nincs teljes mérés',
    'meas.bp.noPair.body':
      'Mindkét értékre van adat, de nincs olyan időpont, amikor a kettő együtt készült volna — így egyetlen teljes vérnyomásmérés sem áll össze.',
    'meas.bp.latest': 'Legutóbbi — {when} · {ago}',
    'meas.bp.systolic': 'Szisztolés',
    'meas.bp.diastolic': 'Diasztolés',
    'meas.bp.average': 'Átlag',
    'meas.bp.pulsePressure': 'Pulzusnyomás',
    'meas.bp.map': 'MAP',
    'meas.bp.count.one':
      '{n} teljes mérés az elmúlt 90 napban. Csak azok az időpontok számítanak, amikor mindkét érték megvan.',
    'meas.bp.count.other':
      '{n} teljes mérés az elmúlt 90 napban. Csak azok az időpontok számítanak, amikor mindkét érték megvan.',
    'meas.bp.mapNote':
      'A pulzusnyomás a két érték különbsége; a MAP (artériás középnyomás) a szokásos közelítés: alsó + (felső − alsó) / 3.',
    'meas.bp.chart.aria': 'A teljes vérnyomásmérések az elmúlt 90 napban',
    'meas.bp.unusual.title': 'A saját méréseid közül kilógó értékek',
    'meas.bp.unusual.notEnough':
      'A méréseket akkor hasonlítjuk egymáshoz, ha az elmúlt 90 napban legalább {min} van belőlük — most {n}. Addig nem mondunk róluk semmit, ami nem azt jelenti, hogy szokásosak voltak.',
    'meas.bp.unusual.none': 'Az elmúlt 90 nap méréseiből ({n}) egyik sem lóg ki a többi közül.',
    'meas.bp.unusual.lead': 'Ez a mérés eltér a saját átlagodtól: ',
    'meas.bp.unusual.axis': '{axis} {amount} Hgmm-rel {direction} a szokásosnál (általában {usual} körül)',
    'meas.bp.axis.systolic': 'a felső érték',
    'meas.bp.axis.diastolic': 'az alsó érték',
    'meas.bp.higher': 'magasabb',
    'meas.bp.lowerWord': 'alacsonyabb',
    'meas.bp.unusual.rule':
      'Minden mérést a saját többi, elmúlt 90 napos méréseddel vetünk össze — legalább 1,5 szórásnyi és 8 (felső), illetve 5 (alsó) Hgmm eltérésnél —, sosem klinikai határértékkel. Ez leírás, nem értékelés.',
    'meas.gait.title': 'Járás — az öt mérés egy időtengelyen',
    'meas.gait.lead':
      'Az utolsó 7 lezárt nap az azt megelőző 28-hoz képest. A sáv a saját korábbi napjaid átlaga és szórása. Nem normálérték, és nem cél.',
    'meas.gait.legend.band': 'A saját sávod',
    'meas.gait.legend.mean': 'Korábbi átlag',
    'meas.gait.legend.fall': 'Elesés',
    'meas.gait.explain.walkingSpeed':
      'A sétatempód sík terepen, ahogy az órád vagy a telefonod méri. Nem a futásra vonatkozik.',
    'meas.gait.explain.walkingStepLength': 'Egy lépés hossza sétálás közben, méterben.',
    'meas.gait.explain.walkingAsymmetryPercentage':
      'A járás idejének hány százalékában tér el a két láb lépésideje egymástól.',
    'meas.gait.explain.walkingDoubleSupportPercentage':
      'A járás idejének hány százalékában van egyszerre mindkét talp a földön.',
    'meas.gait.explain.appleWalkingSteadiness':
      'Az Apple saját összevont mutatója, több járásjellemzőből számolva. Ez az ő számításuk — mi csak megjelenítjük, nem mi találtuk ki.',
    'meas.gait.latest': 'Legutóbbi nap: {value} · {date}',
    'meas.gait.nothing': 'Az elmúlt {n} napban nincs mérés.',
    'meas.gait.notEnough': 'Nincs elég mért nap',
    'meas.gait.notComparable': 'Nincs mihez hasonlítani',
    'meas.gait.unchanged': 'A szokásos szinten',
    'meas.gait.moved': '{delta} {direction}, mint a megelőző {n} nap',
    'meas.gait.delta.speed': ' m/s-mal',
    'meas.gait.delta.length': ' méterrel',
    'meas.gait.delta.points': ' százalékponttal',
    'meas.gait.detail.notEnough':
      'Az elmúlt {recentDays} napból {recent}, az azt megelőző {baselineDays} napból {baseline} napon van mérés. Az összehasonlításhoz legalább {minRecent}, illetve {minBaseline} kell — addig nem mondunk róla semmit. Ez nem azt jelenti, hogy rendben van: azt, hogy nem néztük meg.',
    'meas.gait.detail.notComparable':
      'A korábbi napok átlaga nulla, így nincs mihez viszonyítani. Ez általában adathiba, nem mérési eredmény.',
    'meas.gait.detail.unchanged':
      'Az elmúlt {recentDays} nap átlaga {recent}, a megelőző {baselineDays} napé {baseline}. A különbség kisebb annál, amit ennél a mérésnél változásnak neveznénk.',
    'meas.gait.detail.moved':
      'Az elmúlt {recentDays} nap átlaga {recent}, a megelőző {baselineDays} napé {baseline}. Ez leírás, nem értékelés — a járásadatokat a cipő, a terep, a teher és a napszak is befolyásolja.',
    'meas.gait.band':
      'A saját sávod {low} és {high} között van ({n} nap átlaga ± szórása). Ez nem normálérték, hanem a te eddigi napjaid szórása.',
    'meas.gait.chart.aria': '{metric} az elmúlt {n} napban',
    'meas.gait.falls.one': '{n} elesés az időszakban, pontozott vonallal jelölve.',
    'meas.gait.falls.other': '{n} elesés az időszakban, pontozott vonalakkal jelölve.',
    'meas.gait.fallsNote':
      'Ezek ugyanazon az időtengelyen látszanak, mint a görbe. Ez nem jelenti azt, hogy közük van egymáshoz — csak azt, hogy egymás mellett láthatod őket.',
    'meas.gait.noFalls':
      'Az elmúlt {n} napban nem érkezett adat elesésről erre a szerverre. Lehet, hogy egyszerűen nem estél el — de az is lehet, hogy az esésérzékelés ki van kapcsolva vagy nem olvasható: innen nézve a kettő ugyanúgy fest.',
    'meas.gait.steadinessEvents':
      'Az Apple járásstabilitás-értesítései nincsenek ezen a tengelyen: ezek egy másfajta HealthKit-bejegyzés (kategóriaminta), amelyet a telefon nem tölt fel — ilyet egyedül az alvásból küld. A telefon a saját járásképernyőjén rajzolja ki őket.',
    'meas.gait.apple':
      'A „járásstabilitás” és a szintjei az Apple számítása és az Apple besorolása, nem a miénk. Ezt mindenhol kiírjuk, ahol megjelenik.',
    'meas.gait.description':
      'Ez leírás, nem diagnózis és nem kockázatbecslés. A járásadatokat a cipő, a terep, a teher és a napszak is befolyásolja.',
  },

  // --- Metric group names ---------------------------------------------------
  group: {
    activity: 'Aktivitás',
    heart: 'Szív',
    respiratory: 'Légzés',
    body: 'Testösszetétel',
    macro: 'Táplálkozás — makrók',
    mineral: 'Táplálkozás — ásványi anyagok',
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
    // A szerver katalógusa `degC`-nek írja a Celsiust (backend internal/metrics).
    degC: '°C',
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
    flightsClimbed: 'Megmászott emeletek',
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
    workoutEffortScore: 'Edzésmegterhelés',
    estimatedWorkoutEffortScore: 'Becsült edzésmegterhelés',

    // 3.2 Heart and circulation
    heartRate: 'Pulzus',
    restingHeartRate: 'Nyugalmi pulzus',
    walkingHeartRateAverage: 'Séta közbeni pulzus',
    hrv: 'HRV (SDNN)',
    heartRateRecoveryOneMinute: 'Pulzus-visszatérés (1 perc)',
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
    inhalerUsage: 'Inhalátorhasználat',
    appleSleepingBreathingDisturbances: 'Alvási légzészavarok',

    // 3.4 Body composition
    bodyMass: 'Testtömeg',
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
    walkingAsymmetryPercentage: 'Járásaszimmetria',
    walkingDoubleSupportPercentage: 'Kettős támaszfázis',
    sixMinuteWalkTestDistance: '6 perces sétateszt',
    stairAscentSpeed: 'Sebesség lépcsőn felfelé',
    stairDescentSpeed: 'Sebesség lépcsőn lefelé',
    appleWalkingSteadiness: 'Járásstabilitás',
    runningSpeed: 'Futósebesség',
    runningPower: 'Futóteljesítmény',
    runningStrideLength: 'Lépéshossz futáskor',
    runningVerticalOscillation: 'Függőleges kilengés',
    runningGroundContactTime: 'Talajérintési idő',

    // 3.9 Environment and hearing
    environmentalAudioExposure: 'Környezeti hangterhelés',
    headphoneAudioExposure: 'Fejhallgató-hangterhelés',
    environmentalSoundReduction: 'Zajcsökkentés',
    timeInDaylight: 'Napfényben töltött idő',
    uvExposure: 'UV-expozíció',

    // 3.10 Other
    bloodGlucose: 'Vércukor',
    bloodAlcoholContent: 'Véralkoholszint',
    insulinDelivery: 'Inzulinbevitel',
    numberOfTimesFallen: 'Elesések',
    electrodermalActivity: 'Bőrvezetés',
    waterTemperature: 'Vízhőmérséklet',
    underwaterDepth: 'Merülési mélység',
    numberOfAlcoholicBeverages: 'Alkoholos italok',
  },
}
// No `as const` on purpose: the key union is what we want to pin down, not the
// values. With literal value types `en: Dict` would demand the *same strings*.
