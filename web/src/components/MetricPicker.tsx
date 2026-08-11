// The metric picker, for ~100 types.
//
// As a row of buttons this list would be useless, so three narrowing layers sit
// side by side: free-text search, a group filter, and an "only what has data"
// toggle. The last of these is on by default, so in practice you see a handful of
// entries — with the full catalog one click behind them.

import { useMemo, useState } from 'react'
import {
  METRIC_GROUPS,
  METRIC_LIST,
  metricDef,
  type MetricDef,
  type MetricGroupKey,
} from '../lib/metrics'
import type { Availability } from '../lib/useAvailability'

/** An accent-insensitive, lower-case key for the search: "légzés" ~ "legzes". */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

type Props = {
  value: string
  onChange: (key: string) => void
  availability: Availability
}

export function MetricPicker({ value, onChange, availability }: Props) {
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState<MetricGroupKey | 'all'>('all')
  const [onlyWithData, setOnlyWithData] = useState(true)

  // If not a single metric has data (a fresh install), the filter would produce an
  // empty list — in that case show the whole catalog instead.
  const filterByData = onlyWithData && availability.count > 0

  const needle = fold(search.trim())
  const visible = useMemo(() => {
    const matches = METRIC_LIST.filter((d) => {
      if (d.key === value) return true // the selected one must never disappear
      if (group !== 'all' && d.group !== group) return false
      if (filterByData && !availability.has(d.key)) return false
      if (!needle) return true
      return fold(d.label).includes(needle) || fold(d.key).includes(needle)
    })
    // Whatever has data goes first; within that, the catalog order is preserved.
    return matches
      .map((d, i) => ({ d, i, has: availability.has(d.key) }))
      .sort((a, b) => Number(b.has) - Number(a.has) || a.i - b.i)
      .map((x) => x.d)
  }, [availability, filterByData, group, needle, value])

  const grouped = useMemo(() => {
    const out = new Map<MetricGroupKey, MetricDef[]>()
    for (const d of visible) out.set(d.group, [...(out.get(d.group) ?? []), d])
    return METRIC_GROUPS.filter((g) => out.has(g.key)).map((g) => ({
      group: g,
      items: out.get(g.key)!,
    }))
  }, [visible])

  const selected = metricDef(value)

  return (
    <div className="picker">
      <div className="picker-toolbar">
        <input
          className="field"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Keresés ${METRIC_LIST.length} metrika közt…`}
          aria-label="Metrika keresése"
        />
        <button
          className="seg"
          aria-pressed={filterByData}
          onClick={() => setOnlyWithData((v) => !v)}
          title="A HealthKit nem árulja el, hogy egy típusra nincs adat vagy nincs engedély — mindkettő üres."
        >
          Csak amire van adat
          {availability.known ? ` (${availability.count})` : availability.isLoading ? ' …' : ''}
        </button>
      </div>

      <div className="picker-toolbar">
        <button className="seg" aria-pressed={group === 'all'} onClick={() => setGroup('all')}>
          Mind
        </button>
        {METRIC_GROUPS.map((g) => (
          <button
            key={g.key}
            className="seg"
            aria-pressed={group === g.key}
            onClick={() => setGroup(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="subtle" style={{ margin: '4px 0 0' }}>
          Nincs találat erre a szűrésre.
        </p>
      ) : (
        <div className="picker-list" role="group" aria-label="Metrikák">
          {grouped.map(({ group: g, items }) => (
            <div key={g.key}>
              <div className="picker-group">{g.label}</div>
              {items.map((d) => {
                const has = availability.has(d.key)
                return (
                  <button
                    key={d.key}
                    className={`picker-item${has || !availability.known ? '' : ' dim'}`}
                    aria-pressed={d.key === value}
                    onClick={() => onChange(d.key)}
                    title={has ? d.key : `${d.key} — még nincs adat`}
                  >
                    <span className="picker-dot" style={{ background: d.color }} />
                    <span>{d.label}</span>
                    <span className="picker-agg" aria-hidden="true">
                      {d.agg === 'sum' ? 'Σ' : 'ø'}
                    </span>
                    <span className="picker-unit">{d.unit || '—'}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      <p className="subtle" style={{ margin: '10px 0 0' }}>
        Kiválasztva: <strong>{selected.label}</strong> · a <span aria-hidden="true">Σ</span> jelű
        metrikák összegződnek az időszakra, az <span aria-hidden="true">ø</span> jelűek átlagolódnak.
      </p>
    </div>
  )
}
