// The workout history: months you can close, a filter, and one row per session.
//
// # What was wrong with it
//
// One `<table>`, one page of the API, 4474 pixels tall. Three separate problems
// wearing one costume:
//
//   1. **It was not the history.** The page asked for 100 workouts and drew
//      whatever came back, ignoring `next_cursor` — so a year of training ended
//      somewhere in the summer with nothing on screen saying so.
//   2. **It showed sessions twice.** A watch and a gym machine writing the same
//      hour are two rows here and one on the phone. The list was the longer of
//      the two AND the wrong one.
//   3. **It could not be navigated.** No headings, no filter: finding March
//      meant scrolling for it and knowing you had arrived.
//
// # The shape it has now
//
// Months, newest first, all but the newest closed — a closed month is one row
// instead of a hundred, and it still says how many sessions and how many hours
// it holds, so a shut month is not a blank. Above them a filter, because
// "when did I last swim" is a question about a type, not about a date.
//
// ⚠️ The order is **filter, then fold, then months**, which is the phone's order
// and not an accident: folding first and filtering the primaries would let a
// filter that matches the OTHER recording of a session drop the session
// entirely. Months are built from the primaries, which is what keeps the header
// totals honest — a doubly recorded hour is in the list once, so it is in the
// total once.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Empty, ErrorState, Loading, Note } from '../components/ui'
import { useI18n } from '../i18n'
import type { UiKey } from '../i18n'
import { useFormat } from '../lib/format'
import { useWorkoutHistory } from '../lib/workoutHistory'
import {
  EMPTY_FILTER,
  STEPS,
  activityTypesIn,
  byMonth,
  duplicateTally,
  durationMin,
  groupSessions,
  initiallyExpanded,
  isEmptyFilter,
  matches,
  type Filter,
  type Place,
  type WorkoutGroup,
  type WorkoutMonth,
} from '../lib/workouts'

/** The place options, in the order they are offered. */
const PLACES: { key: Place; label: UiKey }[] = [
  { key: 'any', label: 'workouts.place.any' },
  { key: 'indoor', label: 'workouts.place.indoor' },
  { key: 'outdoor', label: 'workouts.place.outdoor' },
]

export default function Workouts() {
  const { t, tp, tx } = useI18n()
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER)
  /** Which months the READER has opened or closed. `null` until they touch one,
   * so the default below keeps applying as the history pages in. */
  const [expandedOverride, setExpandedOverride] = useState<Set<string> | null>(null)

  // The walk lives in `lib/workoutHistory` — it runs itself rather than waiting
  // for a "load more" click, because a filter over a truncated list does not
  // show less, it ANSWERS WRONGLY and nobody can tell from the answer.
  const { items, isLoading, isError, error, capped, stillLoading } = useWorkoutHistory()

  const types = useMemo(() => activityTypesIn(items), [items])
  const allSessions = useMemo(() => groupSessions(items), [items])
  const visible = useMemo(() => items.filter((w) => matches(filter, w)), [items, filter])
  const groups = useMemo(() => groupSessions(visible), [visible])
  const months = useMemo(() => byMonth(groups), [groups])
  const tally = useMemo(() => duplicateTally(groups), [groups])

  const expanded = expandedOverride ?? initiallyExpanded(months)
  const toggle = (id: string) => {
    // The first click materialises the override from whatever is on screen, so
    // the months the reader did NOT touch keep the state they were shown in.
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedOverride(next)
  }

  if (isLoading) return <Loading rows={1} />
  if (isError) return <ErrorState error={error} />

  if (items.length === 0) {
    return (
      <>
        <h1>{t('workouts.title')}</h1>
        <Empty title={t('workouts.empty.title')} hint={t('workouts.empty.hint')} />
      </>
    )
  }



  return (
    <>
      <h1>{t('workouts.title')}</h1>
      <p className="subtle">{t('workouts.subtitle')}</p>

      <FilterBar
        filter={filter}
        onChange={setFilter}
        types={types}
        shown={groups.length}
        total={allSessions.length}
      />

      {/* ⚠️ The months stay one under another, however wide the window is, and
          that is a decision rather than an omission. A month is a seven-column
          table of sessions — wide by nature — and two of them side by side would
          each be scrolling sideways inside a card. The other half of the reason
          is that this list is chronological: months in two columns have to be
          read in a Z, and "when did I last swim" is a question you answer by
          going down. */}
      {groups.length === 0 ? (
        <Empty
          title={t('workouts.filter.none.title')}
          hint={tp('workouts.filter.none.hint', allSessions.length)}
        />
      ) : (
        <div className="sections" style={{ marginTop: 16 }}>
          {months.map((m) => (
            <MonthSection
              key={m.id}
              month={m}
              open={expanded.has(m.id)}
              onToggle={() => toggle(m.id)}
            />
          ))}
        </div>
      )}

      <div className="grid" style={{ marginTop: 16 }}>
        {stillLoading && (
          <Note title={t('workouts.loading.title')}>
            {tp('workouts.loading.body', items.length)}
          </Note>
        )}
        {capped && (
          <Note title={t('workouts.truncated.title')}>{t('workouts.truncated.body')}</Note>
        )}
      </div>

      {/* Said once, under the list rather than on every affected row: the
          explanation is about the person's setup, not about any one workout.
          ⚠️ It has to be said at all — without it somebody who owns two devices
          sees a list half the length of the one the Health app shows them, and
          has no way to tell whether we lost something. */}
      {tally.sessions > 0 && (
        <p className="subtle" style={{ marginTop: 12 }}>
          {t('workouts.dupNote', { sessions: tally.sessions, extra: tally.extra })}
        </p>
      )}
      {visible.some((w) => w.avg_heart_rate == null) && (
        <p className="subtle" style={{ marginTop: 8 }}>
          {tx('workouts.hrNote', { field: <code>source_uuid</code> })}
        </p>
      )}
    </>
  )
}

// --- The filter --------------------------------------------------------------

function FilterBar({
  filter,
  onChange,
  types,
  shown,
  total,
}: {
  filter: Filter
  onChange: (f: Filter) => void
  types: string[]
  shown: number
  total: number
}) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const empty = isEmptyFilter(filter)

  const toggleType = (type: string) => {
    const on = filter.activityTypes.includes(type)
    onChange({
      ...filter,
      activityTypes: on
        ? filter.activityTypes.filter((x) => x !== type)
        : [...filter.activityTypes, type],
    })
  }

  return (
    <Card title={t('workouts.filter.title')}>
      <div className="controls" style={{ marginBottom: 4 }}>
        {types.map((type) => (
          <button
            key={type}
            type="button"
            className="seg"
            aria-pressed={filter.activityTypes.includes(type)}
            onClick={() => toggleType(type)}
          >
            {f.activityName(type)}
          </button>
        ))}
      </div>

      <div className="filter-row">
        <Choice
          label={t('workouts.filter.place')}
          value={filter.place}
          onChange={(v) => onChange({ ...filter, place: (v as Place) || 'any' })}
          options={PLACES.map((p) => ({ value: p.key, label: t(p.label) }))}
          includeAny={false}
        />
        <Choice
          label={t('workouts.filter.minDuration')}
          value={filter.minMinutes == null ? '' : String(filter.minMinutes)}
          onChange={(v) => onChange({ ...filter, minMinutes: v === '' ? null : Number(v) })}
          options={STEPS.minutes.map((m) => ({ value: String(m), label: f.duration(m) }))}
        />
        <Choice
          label={t('workouts.filter.minDistance')}
          value={filter.minKm == null ? '' : String(filter.minKm)}
          onChange={(v) => onChange({ ...filter, minKm: v === '' ? null : Number(v) })}
          options={STEPS.kilometres.map((km) => ({
            value: String(km),
            label: f.km(km * 1000),
          }))}
        />
        <Choice
          label={t('workouts.filter.minEnergy')}
          value={filter.minKcal == null ? '' : String(filter.minKcal)}
          onChange={(v) => onChange({ ...filter, minKcal: v === '' ? null : Number(v) })}
          options={STEPS.energyKcal.map((k) => ({ value: String(k), label: `${f.num(k)} kcal` }))}
        />
        <Choice
          label={t('workouts.filter.minHr')}
          value={filter.minHr == null ? '' : String(filter.minHr)}
          onChange={(v) => onChange({ ...filter, minHr: v === '' ? null : Number(v) })}
          options={STEPS.heartRate.map((hr) => ({ value: String(hr), label: f.num(hr) }))}
        />
        <Choice
          label={t('workouts.filter.maxHr')}
          value={filter.maxHr == null ? '' : String(filter.maxHr)}
          onChange={(v) => onChange({ ...filter, maxHr: v === '' ? null : Number(v) })}
          options={STEPS.heartRate.map((hr) => ({ value: String(hr), label: f.num(hr) }))}
        />
      </div>

      {/* ⚠️ Without this line a filter left on from yesterday reads as an empty
          history today — the most confusing state this page can be in, and the
          cheapest one to prevent. */}
      <div className="filter-summary">
        <span className="subtle">{tp('workouts.filter.count', total, { shown })}</span>
        {!empty && (
          <button type="button" className="linkish" onClick={() => onChange(EMPTY_FILTER)}>
            {t('workouts.filter.clear')}
          </button>
        )}
      </div>

      {/* The rule that makes this filter honest, said where it is doing its work. */}
      <p className="subtle" style={{ margin: '8px 0 0' }}>
        {t('workouts.filter.missingNote')}
      </p>
    </Card>
  )
}

function Choice({
  label,
  value,
  onChange,
  options,
  includeAny = true,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  includeAny?: boolean
}) {
  const { t } = useI18n()
  return (
    <label className="filter-field">
      <span className="subtle">{label}</span>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {includeAny && <option value="">{t('workouts.filter.noLimit')}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// --- A month -----------------------------------------------------------------

function MonthSection({
  month,
  open,
  onToggle,
}: {
  month: WorkoutMonth
  open: boolean
  onToggle: () => void
}) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const title = f.monthYearLong(month.startIso)

  return (
    <div className="card month">
      <button
        type="button"
        className="month-head"
        aria-expanded={open}
        onClick={onToggle}
        aria-label={`${title}, ${tp('workouts.month.count', month.count)}`}
      >
        <Chevron open={open} />
        <strong>{title}</strong>
        {/* The count and the total, so a CLOSED month still says something. A
            header that is only a name makes opening every one of them the only
            way to find anything. */}
        <span className="month-summary subtle">
          {tp('workouts.month.count', month.count)} · {f.duration(month.totalMin)}
          {/* ⚠️ A session with no end time contributes nothing to the total. Said
              out loud, because a total that is quietly short of something looks
              exactly like a total that is not. */}
          {month.withoutDuration > 0 && ` · ${tp('workouts.month.open', month.withoutDuration)}`}
        </span>
      </button>

      {open && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>{t('workouts.col.type')}</th>
                <th>{t('workouts.col.when')}</th>
                <th>{t('workouts.col.duration')}</th>
                <th>{t('workouts.col.energy')}</th>
                <th>{t('workouts.col.distance')}</th>
                <th>{t('workouts.col.avgHr')}</th>
                <th>{t('workouts.col.maxHr')}</th>
              </tr>
            </thead>
            <tbody>
              {month.groups.map((g) => (
                <SessionRows key={g.id} group={g} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SessionRows({ group }: { group: WorkoutGroup }) {
  const { tp } = useI18n()
  const f = useFormat()
  const w = group.primary
  const minutes = durationMin(w)

  return (
    <>
      <tr>
        {/* The way in. It is the activity cell rather than the whole row because
            a row is not a link and faking one costs the keyboard its focus
            order — but the accessible name carries the date too, so a screen
            reader hears which session it is opening rather than "Running" nine
            times. */}
        <td>
          <Link
            className="row-link"
            to={`/workouts/${w.id ?? ''}`}
            aria-label={`${f.activityName(w.activity_type)}, ${f.dateTime(w.started_at)}`}
          >
            {f.activityName(w.activity_type)}
          </Link>
        </td>
        <td>{f.dateTime(w.started_at)}</td>
        {/* ⚠️ `durationMin` returns null for a recording with no end, and null
            prints as a dash. A zero here would be a claim that it lasted no time. */}
        <td className="num">{minutes == null ? '–' : f.duration(minutes)}</td>
        <td className="num">
          {w.total_energy_kcal != null ? `${f.num(w.total_energy_kcal)} kcal` : '–'}
        </td>
        <td className="num">{f.km(w.total_distance_m)}</td>
        <td className="num" style={{ color: 'var(--helsa-pulse)' }}>
          {f.num(w.avg_heart_rate)}
        </td>
        <td className="num" style={{ color: 'var(--helsa-pulse)' }}>
          {f.num(w.max_heart_rate)}
        </td>
      </tr>
      {/* The folded row says what happened rather than hiding it — and which of
          the two things happened, because "the numbers differ" is worth knowing
          and "they are identical" is a different fact about the same session. */}
      {group.count > 1 && (
        <tr className="fold-caption">
          <td colSpan={7} className="subtle">
            {tp(group.identical ? 'workouts.fold.identical' : 'workouts.fold.differ', group.count)}
          </td>
        </tr>
      )}
    </>
  )
}

/** Drawn rather than typed, for the same reason as `PeriodStepper`'s: "›" is
 * punctuation to a screen reader, and the button already carries its name. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d={open ? 'M3 6 L8 11 L13 6' : 'M6 3 L11 8 L6 13'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
