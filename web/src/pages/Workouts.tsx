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
//
// # Master and detail (2026-10 redesign)
//
// On a screen wide enough for both, the list sits on the left and the opened
// session on the right, and a row is a BUTTON (`aria-pressed`) that selects it;
// the selection lives in `?w=` so it survives a reload and can be linked. Below
// that width a row is a LINK to `/workouts/:id`, exactly as before — a detail
// squeezed beside a list on a phone is two unreadable halves.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ActivityIcon, PlaceIcon } from '../components/ActivityIcon'
import { Empty, ErrorState, Loading, Note, PageHead } from '../components/ui'
import { useI18n } from '../i18n'
import type { UiKey } from '../i18n'
import { useFormat } from '../lib/format'
import { useMediaQuery } from '../lib/useMediaQuery'
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
  isIndoor,
  matches,
  type Filter,
  type Place,
  type WorkoutGroup,
  type WorkoutMonth,
} from '../lib/workouts'
import { WorkoutDetailView } from './WorkoutDetail'

/** The place options, in the order they are offered. */
const PLACES: { key: Place; label: UiKey }[] = [
  { key: 'any', label: 'workouts.place.any' },
  { key: 'outdoor', label: 'workouts.place.outdoor' },
  { key: 'indoor', label: 'workouts.place.indoor' },
]

/** Where the list and the detail fit side by side. Exported for the tests. */
export const MASTER_DETAIL_QUERY = '(min-width: 1100px)'

export default function Workouts() {
  const { t, tp, tx } = useI18n()
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER)
  /** Which months the READER has opened or closed. `null` until they touch one,
   * so the default below keeps applying as the history pages in. */
  const [expandedOverride, setExpandedOverride] = useState<Set<string> | null>(null)
  const wide = useMediaQuery(MASTER_DETAIL_QUERY)
  const [params, setParams] = useSearchParams()
  const selectedParam = params.get('w')

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

  /**
   * The session in the right-hand panel: the one in the URL, or the newest one
   * on screen. ⚠️ A `?w=` naming a recording that is not a primary (the Today
   * card links the newest workout, which may be the folded twin) is still
   * honoured — the detail shows exactly the recording asked for — and the row
   * of its session is the one marked.
   */
  // `months` is newest first; `groups` is in the history's own order.
  const selectedId = selectedParam ?? months[0]?.groups[0]?.primary.id ?? null
  const selectedGroupId = groups.find(
    (g) => g.primary.id === selectedId || g.others.some((o) => o.id === selectedId),
  )?.id

  const select = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('w', id)
        return next
      },
      { replace: false },
    )

  if (isLoading) return <Loading rows={1} />
  if (isError) return <ErrorState error={error} />

  if (items.length === 0) {
    return (
      <>
        <PageHead title={t('workouts.title')} />
        <Empty title={t('workouts.empty.title')} hint={t('workouts.empty.hint')} />
      </>
    )
  }

  const list = (
    <section className="wo-list" aria-label={t('workouts.listAria')}>
      {groups.length === 0 ? (
        <Empty
          title={t('workouts.filter.none.title')}
          hint={tp('workouts.filter.none.hint', allSessions.length)}
        />
      ) : (
        months.map((m) => (
          <MonthSection
            key={m.id}
            month={m}
            open={expanded.has(m.id)}
            onToggle={() => toggle(m.id)}
            mode={wide ? 'select' : 'link'}
            selectedGroupId={selectedGroupId}
            onSelect={select}
          />
        ))
      )}

      {stillLoading && (
        <Note title={t('workouts.loading.title')}>{tp('workouts.loading.body', items.length)}</Note>
      )}
      {capped && <Note title={t('workouts.truncated.title')}>{t('workouts.truncated.body')}</Note>}

      {/* Said once, under the list rather than on every affected row: the
          explanation is about the person's setup, not about any one workout.
          ⚠️ It has to be said at all — without it somebody who owns two devices
          sees a list half the length of the one the Health app shows them. */}
      {tally.sessions > 0 && (
        <p className="subtle" style={{ margin: 0 }}>
          {t('workouts.dupNote', { sessions: tally.sessions, extra: tally.extra })}
        </p>
      )}
      {visible.some((w) => w.avg_heart_rate == null) && (
        <p className="subtle" style={{ margin: 0 }}>
          {tx('workouts.hrNote', { field: <code>source_uuid</code> })}
        </p>
      )}
    </section>
  )

  return (
    <>
      <PageHead title={t('workouts.title')} subtitle={t('workouts.subtitle')} />

      <div style={{ marginTop: -16, marginBottom: 20 }}>
        <FilterBar
          filter={filter}
          onChange={setFilter}
          types={types}
          shown={groups.length}
          total={allSessions.length}
        />
      </div>

      {wide ? (
        <div className="master-detail">
          {list}
          <div style={{ minWidth: 0 }}>
            {selectedId ? (
              // Keyed on the id so a new selection starts from the top of its
              // own loading states rather than flashing the previous session.
              <WorkoutDetailView
                key={selectedId}
                id={selectedId}
                embedded
                hrefFor={(id) => `/workouts?w=${encodeURIComponent(id)}`}
              />
            ) : (
              <Empty title={t('workouts.select.hint')} />
            )}
          </div>
        </div>
      ) : (
        list
      )}
    </>
  )
}

// --- The filter --------------------------------------------------------------

/**
 * The three restrictions people actually reach for — type, place, minimum length
 * — in one row, and the other four behind "More filters", open by itself
 * whenever one of them is set so that no restriction is ever hidden while it
 * acts.
 */
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
  const moreActive =
    filter.minKm != null || filter.minKcal != null || filter.minHr != null || filter.maxHr != null
  const [moreOpen, setMoreOpen] = useState(moreActive)
  const showMore = moreOpen || moreActive
  const moreId = useId()

  return (
    <div className="filter-wrap">
      <div className="filter-bar" role="search">
        <TypePicker
          types={types}
          chosen={filter.activityTypes}
          onChange={(activityTypes) => onChange({ ...filter, activityTypes })}
        />

        <div className="segmented" role="group" aria-label={t('workouts.filter.place')}>
          {PLACES.map((p) => (
            <button
              key={p.key}
              type="button"
              className="seg"
              aria-pressed={filter.place === p.key}
              onClick={() => onChange({ ...filter, place: p.key })}
            >
              {t(p.label)}
            </button>
          ))}
        </div>

        <Choice
          label={t('workouts.filter.minDuration')}
          visibleLabel={t('workouts.filter.atLeast')}
          anyLabel={t('workouts.filter.anyLength')}
          value={filter.minMinutes == null ? '' : String(filter.minMinutes)}
          onChange={(v) => onChange({ ...filter, minMinutes: v === '' ? null : Number(v) })}
          options={STEPS.minutes.map((m) => ({ value: String(m), label: f.duration(m) }))}
        />

        <button
          type="button"
          className="seg"
          aria-expanded={showMore}
          aria-controls={moreId}
          onClick={() => setMoreOpen((v) => !v)}
          disabled={moreActive}
        >
          {t('workouts.filter.more')}
        </button>

        {/* ⚠️ Without this line a filter left on from yesterday reads as an empty
            history today — the most confusing state this page can be in. */}
        <span className="filter-count">
          <span>{tp('workouts.filter.count', total, { shown })}</span>
          {!empty && (
            <button type="button" className="linkish" onClick={() => onChange(EMPTY_FILTER)}>
              {t('workouts.filter.clear')}
            </button>
          )}
        </span>
      </div>

      {showMore && (
        <div className="filter-row more-filters" id={moreId}>
          <Choice
            label={t('workouts.filter.minDistance')}
            value={filter.minKm == null ? '' : String(filter.minKm)}
            onChange={(v) => onChange({ ...filter, minKm: v === '' ? null : Number(v) })}
            options={STEPS.kilometres.map((km) => ({ value: String(km), label: f.km(km * 1000) }))}
            stacked
          />
          <Choice
            label={t('workouts.filter.minEnergy')}
            value={filter.minKcal == null ? '' : String(filter.minKcal)}
            onChange={(v) => onChange({ ...filter, minKcal: v === '' ? null : Number(v) })}
            options={STEPS.energyKcal.map((k) => ({ value: String(k), label: `${f.num(k)} kcal` }))}
            stacked
          />
          <Choice
            label={t('workouts.filter.minHr')}
            value={filter.minHr == null ? '' : String(filter.minHr)}
            onChange={(v) => onChange({ ...filter, minHr: v === '' ? null : Number(v) })}
            options={STEPS.heartRate.map((hr) => ({ value: String(hr), label: f.num(hr) }))}
            stacked
          />
          <Choice
            label={t('workouts.filter.maxHr')}
            value={filter.maxHr == null ? '' : String(filter.maxHr)}
            onChange={(v) => onChange({ ...filter, maxHr: v === '' ? null : Number(v) })}
            options={STEPS.heartRate.map((hr) => ({ value: String(hr), label: f.num(hr) }))}
            stacked
          />
        </div>
      )}

      {/* The rule that makes this filter honest, said where it is doing its work. */}
      {!empty && (
        <p className="subtle" style={{ margin: '10px 0 0' }}>
          {t('workouts.filter.missingNote')}
        </p>
      )}
    </div>
  )
}

/**
 * The type filter: looks like a dropdown, opens a list of checkboxes — because
 * it takes several types at once, and a `<select multiple>` is unusable. Escape
 * and a click outside close it.
 */
function TypePicker({
  types,
  chosen,
  onChange,
}: {
  types: string[]
  chosen: string[]
  onChange: (types: string[]) => void
}) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const summary =
    chosen.length === 0
      ? t('workouts.filter.allTypes')
      : chosen.length === 1
        ? f.activityName(chosen[0])
        : tp('workouts.filter.typesChosen', chosen.length)

  return (
    <div
      className="multi filter-inline"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <span aria-hidden="true">{t('workouts.filter.type')}</span>
      <button
        type="button"
        className="multi-btn"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${t('workouts.filter.type')}: ${summary}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{summary}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M3 6 L8 11 L13 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <fieldset className="multi-panel" id={panelId} style={{ margin: 0 }}>
          <legend className="sr-only">{t('workouts.filter.type')}</legend>
          {types.map((type) => (
            <label key={type}>
              <input
                type="checkbox"
                checked={chosen.includes(type)}
                onChange={() =>
                  onChange(
                    chosen.includes(type) ? chosen.filter((x) => x !== type) : [...chosen, type],
                  )
                }
              />
              {f.activityName(type)}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}

function Choice({
  label,
  visibleLabel,
  anyLabel,
  value,
  onChange,
  options,
  stacked = false,
}: {
  /** The accessible name — the full sentence the old filter used. */
  label: string
  /** A shorter word drawn beside the select, when it differs. */
  visibleLabel?: string
  anyLabel?: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  stacked?: boolean
}) {
  const { t } = useI18n()
  const select = (
    <select
      className="field"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={visibleLabel ? label : undefined}
    >
      <option value="">{anyLabel ?? t('workouts.filter.noLimit')}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
  if (stacked) {
    return (
      <label className="filter-field">
        <span className="subtle">{label}</span>
        {select}
      </label>
    )
  }
  return (
    <label className="filter-inline">
      <span aria-hidden={visibleLabel ? true : undefined}>{visibleLabel ?? label}</span>
      {select}
    </label>
  )
}

// --- A month -----------------------------------------------------------------

function MonthSection({
  month,
  open,
  onToggle,
  mode,
  selectedGroupId,
  onSelect,
}: {
  month: WorkoutMonth
  open: boolean
  onToggle: () => void
  mode: 'select' | 'link'
  selectedGroupId?: string
  onSelect: (id: string) => void
}) {
  const { tp } = useI18n()
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
        {/* The count and the total, so a CLOSED month still says something. */}
        <span className="month-summary subtle">
          {tp('workouts.month.count', month.count)} · {f.duration(month.totalMin)}
          {/* ⚠️ A session with no end time contributes nothing to the total.
              Said out loud, because a total quietly short of something looks
              exactly like one that is not. */}
          {month.withoutDuration > 0 && ` · ${tp('workouts.month.open', month.withoutDuration)}`}
        </span>
      </button>

      {open && (
        <ul className="wo-rows">
          {month.groups.map((g) => (
            <li key={g.id}>
              <SessionRow
                group={g}
                mode={mode}
                selected={g.id === selectedGroupId}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * One session: its icon, its name with the place mark, what it measured, and
 * when. ⛔ Only what was measured goes on the figures line — a session with no
 * distance has no "0 km", and one with no end time has a dash where its length
 * would be, never a zero.
 */
function SessionRow({
  group,
  mode,
  selected,
  onSelect,
}: {
  group: WorkoutGroup
  mode: 'select' | 'link'
  selected: boolean
  onSelect: (id: string) => void
}) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const w = group.primary
  const minutes = durationMin(w)
  const indoor = isIndoor(w)
  const name = f.activityName(w.activity_type)

  const facts: string[] = [minutes == null ? '–' : f.duration(minutes)]
  if (w.total_distance_m != null && w.total_distance_m > 0) facts.push(f.km(w.total_distance_m))
  if (w.total_energy_kcal != null && w.total_energy_kcal > 0)
    facts.push(`${f.num(w.total_energy_kcal)} kcal`)
  if (w.avg_heart_rate != null && w.avg_heart_rate > 0)
    facts.push(`${f.num(w.avg_heart_rate)} ${t('unit.bpm')}`)
  // The maximum stays in the detail: the row is one line of what a session
  // was, and the peak is a property of how it went.

  // The fold, said rather than hidden — and which of the two things happened,
  // because "the numbers differ" and "they are identical" are different facts.
  const foldText =
    group.count > 1
      ? tp(group.identical ? 'workouts.fold.identical' : 'workouts.fold.differ', group.count)
      : null

  const inner = (
    <>
      <span className="wo-icon">
        <ActivityIcon type={w.activity_type} />
      </span>
      <span className="wo-text">
        <span className="wo-name">
          {name}
          {indoor !== null && (
            <PlaceIcon
              indoor={indoor}
              label={t(indoor ? 'workouts.place.indoor' : 'workouts.place.outdoor')}
            />
          )}
        </span>
        <span className="wo-line">{facts.join(' · ')}</span>
        <span className="wo-date">
          {f.dateTime(w.started_at)}
          {w.ended_at ? `–${f.time(w.ended_at)}` : ''}
        </span>
        {/* The ×2 chip says it to the eye; this says it — and which of the two
            facts it is — to a screen reader. */}
        {foldText && <span className="sr-only">{foldText}</span>}
      </span>
      {group.count > 1 && (
        <span className="dup-chip" title={foldText ?? undefined} aria-hidden="true">
          ×{group.count}
        </span>
      )}
    </>
  )

  // No `aria-label`: the row's own text — name, place, figures, date, fold — IS
  // its accessible name, so a screen reader hears which session it is rather
  // than "Running" nine times, and loses none of what the eye gets.
  return mode === 'select' ? (
    <button
      type="button"
      className="wo-row"
      aria-pressed={selected}
      onClick={() => onSelect(w.id ?? '')}
    >
      {inner}
    </button>
  ) : (
    // ⚠️ The PRIMARY's id — the recording the row is showing. Linking to the
    // other one would open a page whose numbers do not match the row.
    <Link className="wo-row" to={`/workouts/${w.id ?? ''}`}>
      {inner}
    </Link>
  )
}

/** Drawn rather than typed: "›" is punctuation to a screen reader, and the
 * button already carries its name. */
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
