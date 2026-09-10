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
    'nav.today': 'Ma',
    'nav.trends': 'Trendek',
    'nav.workouts': 'Edzések',
    'nav.sleep': 'Alvás',
    'nav.nutrition': 'Táplálkozás',
    'nav.challenge': 'Havi kihívás',
    'nav.coverage': 'Adat-teljesség',
    'nav.settings': 'Beállítások',
    'lang.aria': 'Nyelv megválasztása',
    'lang.hu': 'Magyar',
    'lang.en': 'Angol',

    // --- Shared units and separators ---------------------------------------
    'unit.minShort': 'p',
    'unit.hourShort': 'ó',

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
    'dashboard.lastSync': 'utolsó szinkron: {when}',
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
    'trends.standing.wellBelow': 'Jóval a szokásod alatt',
    'trends.standing.below': 'A szokásod alatt',
    'trends.standing.typical': 'A szokásos tartományodban',
    'trends.standing.above': 'A szokásod fölött',
    'trends.standing.wellAbove': 'Jóval a szokásod fölött',

    // --- Workouts ----------------------------------------------------------
    'workouts.title': 'Edzések',
    'workouts.subtitle': 'A legutóbbi edzések, a legfrissebbel kezdve.',
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
  activity: {
    running: 'Futás',
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
