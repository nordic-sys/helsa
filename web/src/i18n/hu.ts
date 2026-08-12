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
  },
}
// No `as const` on purpose: the key union is what we want to pin down, not the
// values. With literal value types `en: Dict` would demand the *same strings*.
