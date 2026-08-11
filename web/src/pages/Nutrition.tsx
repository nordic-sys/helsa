// Nutrition — energy consumed, macros, minerals, vitamins.
//
// HealthKit does not measure any of this: a meal-logging app writes it into Health
// and Helsa only reads it. So this view often stays empty — the emphasis is on
// making the emptiness readable too, rather than forty "–" signs stacked up.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, browserTz } from '../api/client'
import type { Range } from '../api/types'
import { Card, Empty, ErrorState, Legend, Loading, Note, Stat } from '../components/ui'
import { fmt, percent } from '../lib/format'
import {
  metricDef,
  metricsOfGroup,
  pickSeries,
  readSeries,
  type MetricDef,
  type ReadSeries,
} from '../lib/metrics'

const MACROS = metricsOfGroup('macro')
const MINERALS = metricsOfGroup('mineral')
const VITAMINS = metricsOfGroup('vitamin')
const NUTRIENTS = [...MACROS, ...MINERALS, ...VITAMINS]
const WIRE = NUTRIENTS.flatMap((d) => [d.key, ...d.aliases])

// The Atwater factors: this is how much energy each of the three macros yields per
// gram. We use them to break the protein/carbohydrate/fat grams down into energy —
// HealthKit offers no such breakdown, this is a computed value.
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 }

const ENERGY = metricDef('dietaryEnergyConsumed')
const PROTEIN = metricDef('dietaryProtein')
const CARBS = metricDef('dietaryCarbohydrates')
const FAT = metricDef('dietaryFatTotal')
const WATER = metricDef('dietaryWater')

// For a year the bucket is a month, so the "daily average" would not come out
// without a division — and with nutrition it is precisely the daily figure that is
// interesting. Hence only day/week/month here.
const RANGES: { key: Range; label: string }[] = [
  { key: 'day', label: 'Ma' },
  { key: 'week', label: 'Hét' },
  { key: 'month', label: '30 nap' },
]

/**
 * The headline value: normally the daily intake, but for a degraded series only
 * the per-sample average — no daily total can be made of that, so we do not call it
 * one either (the caller spells out what is being shown via `headlineLabel`).
 */
function daily(r: ReadSeries, range: Range): number | null {
  if (!r.hasData || r.total == null) return null
  if (r.effectiveAgg === 'avg') return r.total
  if (range === 'day') return r.total
  const days = r.points.filter((p) => p.value != null).length
  return days === 0 ? null : r.total / days
}

const headlineLabel = (degraded: boolean, range: Range) =>
  degraded ? 'Mintánkénti átlag' : range === 'day' ? 'Ma összesen' : 'Napi átlag'

export default function Nutrition() {
  const tz = browserTz()
  const [range, setRange] = useState<Range>('week')
  const [showAll, setShowAll] = useState(false)

  const q = useQuery({
    queryKey: ['nutrition', range, tz],
    queryFn: () => api.summary(range, WIRE, tz),
  })

  if (q.isLoading) return <Loading rows={2} />
  if (q.isError) return <ErrorState error={q.error} />

  const metrics = q.data?.metrics
  const read = new Map<string, ReadSeries>(
    NUTRIENTS.map((d) => [d.key, readSeries(d, pickSeries(d, metrics))]),
  )
  const of = (d: MetricDef) => read.get(d.key)!

  const withData = NUTRIENTS.filter((d) => of(d).hasData)
  const degraded = withData.some((d) => of(d).degraded)

  // The macro-energy breakdown from the period totals (the proportions are the same
  // as from the daily averages, but with fewer rounding steps).
  const gProtein = of(PROTEIN).total ?? 0
  const gCarbs = of(CARBS).total ?? 0
  const gFat = of(FAT).total ?? 0
  const kcal = {
    protein: gProtein * KCAL_PER_G.protein,
    carbs: gCarbs * KCAL_PER_G.carbs,
    fat: gFat * KCAL_PER_G.fat,
  }
  const kcalTotal = kcal.protein + kcal.carbs + kcal.fat
  const macroSplit = [
    { def: PROTEIN, grams: gProtein, kcal: kcal.protein },
    { def: CARBS, grams: gCarbs, kcal: kcal.carbs },
    { def: FAT, grams: gFat, kcal: kcal.fat },
  ]

  // The daily stacked bar: the energy of the three macros combed together per bucket.
  const byDay = new Map<string, { t: string; protein: number; carbs: number; fat: number }>()
  const collect = (d: MetricDef, field: 'protein' | 'carbs' | 'fat', factor: number) => {
    for (const p of of(d).points) {
      if (p.value == null) continue
      const row = byDay.get(p.t) ?? { t: p.t, protein: 0, carbs: 0, fat: 0 }
      row[field] = p.value * factor
      byDay.set(p.t, row)
    }
  }
  collect(PROTEIN, 'protein', KCAL_PER_G.protein)
  collect(CARBS, 'carbs', KCAL_PER_G.carbs)
  collect(FAT, 'fat', KCAL_PER_G.fat)
  const daysChart = [...byDay.values()].sort((a, b) => a.t.localeCompare(b.t))

  const headline = headlineLabel(degraded, range)

  return (
    <>
      <h1>Táplálkozás</h1>
      <p className="subtle">
        Bevitt energia, makrók és mikrotápanyagok. A Health-be egy étkezés-naplózó app
        írja őket; a Helsa csak olvassa.
      </p>

      <div className="controls">
        {RANGES.map((x) => (
          <button
            key={x.key}
            className="seg"
            aria-pressed={range === x.key}
            onClick={() => setRange(x.key)}
          >
            {x.label}
          </button>
        ))}
      </div>

      {degraded && (
        <Note title="A napi összegek helyett mintánkénti átlagot mutat a szerver">
          A táplálkozási típusok mind összegzendők, de a backend csak öt metrika
          aggregációját ismeri név szerint (<code>internal/summary/summary.go</code>),
          a többire átlagot ad vissza darabszám nélkül. A napi bevitel ebből nem
          állítható helyre, ezért az itt látszó számok egy-egy bejegyzés átlagát
          jelentik, nem a napi összeget.
        </Note>
      )}

      {withData.length === 0 ? (
        <Empty
          title="Még nincs táplálkozási adat"
          hint="A HealthKit magától nem gyűjt étkezést — egy naplózó app (pl. kalóriaszámláló) írja a Health-be, és onnan tölti fel az iPhone."
        />
      ) : (
        <>
          <div className="grid" style={{ marginBottom: 18 }}>
            <Stat
              label={`Bevitt energia — ${headline}`}
              value={fmt(daily(of(ENERGY), range), 0)}
              unit={of(ENERGY).unit}
              color={ENERGY.color}
            />
            <Stat
              label={`Fehérje — ${headline}`}
              value={fmt(daily(of(PROTEIN), range), 1)}
              unit={of(PROTEIN).unit}
              color={PROTEIN.color}
            />
            <Stat
              label={`Szénhidrát — ${headline}`}
              value={fmt(daily(of(CARBS), range), 1)}
              unit={of(CARBS).unit}
              color={CARBS.color}
            />
            <Stat
              label={`Zsír — ${headline}`}
              value={fmt(daily(of(FAT), range), 1)}
              unit={of(FAT).unit}
              color={FAT.color}
            />
            <Stat
              label={`Víz — ${headline}`}
              value={fmt(daily(of(WATER), range), 0)}
              unit={of(WATER).unit}
              color={WATER.color}
            />
          </div>

          {kcalTotal > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Card title="Makró-bontás (energia szerint)">
                <div className="split-bar" role="img" aria-label="Makró-arány energia szerint">
                  {macroSplit.map((m) => (
                    <div
                      key={m.def.key}
                      style={{ width: `${(m.kcal / kcalTotal) * 100}%`, background: m.def.color }}
                      title={`${m.def.label}: ${percent(m.kcal / kcalTotal)}`}
                    />
                  ))}
                </div>
                <Legend
                  items={macroSplit.map((m) => ({
                    label: m.def.label,
                    color: m.def.color,
                    value: `${percent(m.kcal / kcalTotal)} · ${fmt(m.grams, 1)} g`,
                  }))}
                />
                <p className="subtle" style={{ margin: '12px 0 0' }}>
                  A fenti grammokból számolt energia {fmt(kcalTotal, 0)} kcal (4 / 4 / 9 kcal
                  per gramm). A HealthKit külön mért <code>dietaryEnergyConsumed</code> értéke{' '}
                  {fmt(of(ENERGY).total, 0)} kcal — a kettő eltérhet, ha a naplózó app nem
                  minden tételhez rögzít makrókat.
                </p>
              </Card>
            </div>
          )}

          {daysChart.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <Card title={degraded ? 'Makrók energiája bucketenként (kcal)' : 'Makrók energiája naponta (kcal)'}>
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={daysChart} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                      <CartesianGrid
                        stroke="var(--border)"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="t"
                        tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                        stroke="var(--border)"
                        tickFormatter={(v: string) =>
                          range === 'day' ? v.slice(11, 16) : v.slice(5, 10)
                        }
                      />
                      <YAxis
                        tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                        stroke="var(--border)"
                        width={58}
                        tickFormatter={(v: number) => fmt(v, 0)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 10,
                          color: 'var(--text)',
                        }}
                        labelStyle={{ color: 'var(--text-dim)' }}
                        labelFormatter={(v: string) => (range === 'day' ? v.slice(11, 16) : v.slice(0, 10))}
                        formatter={(v: number, name: string) => [`${fmt(v, 0)} kcal`, name]}
                      />
                      {macroSplit.map((m, i) => (
                        <Bar
                          key={m.def.key}
                          dataKey={i === 0 ? 'protein' : i === 1 ? 'carbs' : 'fat'}
                          name={m.def.label}
                          stackId="macro"
                          fill={m.def.color}
                          stroke="var(--surface)"
                          strokeWidth={1.5}
                          maxBarSize={38}
                          radius={i === 2 ? [4, 4, 0, 0] : undefined}
                          isAnimationActive={false}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Legend
                  items={macroSplit.map((m) => ({ label: m.def.label, color: m.def.color }))}
                />
              </Card>
            </div>
          )}

          {(
            [
              ['Makrók részletesen', MACROS],
              ['Ásványi anyagok', MINERALS],
              ['Vitaminok', VITAMINS],
            ] as const
          ).map(([title, defs]) => (
            <NutrientTable
              key={title}
              title={title}
              defs={defs}
              read={read}
              range={range}
              showAll={showAll}
              degraded={degraded}
            />
          ))}

          <button className="seg" onClick={() => setShowAll((v) => !v)} aria-pressed={showAll}>
            {showAll
              ? 'Az adat nélküli tápanyagok elrejtése'
              : `Az adat nélküli ${NUTRIENTS.length - withData.length} tápanyag mutatása`}
          </button>
        </>
      )}
    </>
  )
}

function NutrientTable({
  title,
  defs,
  read,
  range,
  showAll,
  degraded,
}: {
  title: string
  defs: readonly MetricDef[]
  read: Map<string, ReadSeries>
  range: Range
  showAll: boolean
  degraded: boolean
}) {
  const rows = defs.filter((d) => showAll || read.get(d.key)!.hasData)
  if (rows.length === 0) return null

  return (
    <div style={{ marginBottom: 16 }}>
      <Card title={title}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tápanyag</th>
                <th>{headlineLabel(degraded, range)}</th>
                {/* For a degraded series there is no "period total": the server
                    returned an average, and making a sum out of that would be a lie. */}
                {!degraded && <th>Időszak összesen</th>}
                <th>Egység</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const r = read.get(d.key)!
                return (
                  <tr key={d.key} style={r.hasData ? undefined : { opacity: 0.5 }}>
                    <td>
                      <span className="picker-dot" style={{ background: d.color }} />{' '}
                      {d.label}
                    </td>
                    <td className="num">{fmt(daily(r, range), d.digits)}</td>
                    {!degraded && <td className="num">{fmt(r.total, d.digits)}</td>}
                    <td className="num">{r.unit}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
