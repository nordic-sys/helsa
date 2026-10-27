// Journal and events — what the phone's journal holds, from the server's copy.
//
// The web's view of the phone's daily journal (`DailyContextView`), its event
// timeline (`HealthEventsView`) and its illness episodes
// (`IllnessEpisodesView`), drawn from `GET /journal`. The rules are the phone's,
// copied in `lib/journal.ts`; this file only lays them out.
//
// # ⛔️ The three empties, kept apart
//
// The phone sends the journal only when its owner turns on "Journal and events"
// (off by default — it is the most sensitive data the product holds). So the
// page has three different nothings to say, and must never draw one as another:
//
//   * a 404 — this server predates the endpoint: "update the server";
//   * `last_received_at` absent — the phone never sent a journal here: the
//     switch is off or the app is older; the page says where the switch is,
//     and that the empty page says nothing about what was noted;
//   * entries exist, none in the window — "nothing noted in this period", which
//     is not "nothing happened".
//
// And every count comes after the coverage line (the phone's `ReportJournal`):
// an unmarked day is not a symptom-free day.
//
// # What it deliberately does not do
//
// No score, no "your mood is improving", no correlation with the measurements.
// The phone draws the journal as stripes and lists, and says nothing about it;
// the web is not the place to be bolder.

import { useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, browserTz } from '../api/client'
import { Alert, Card, ErrorState, Loading, PageHead } from '../components/ui'
import { useI18n, type UiKey } from '../i18n'
import { useFormat } from '../lib/format'
import { isApiTooOld } from '../lib/ingest'
import {
  addDay,
  episodeSymptoms,
  eventTitle,
  illnessEpisodes,
  journalDays,
  journalEvents,
  moodName,
  neverReceived,
  steadinessText,
  symptomName,
  symptomText,
  tagName,
  type JournalDay,
  type MoodLevel,
} from '../lib/journal'
import { reportWindow } from '../lib/report'
import { useToday } from '../lib/useToday'
import '../styles/journal.css'

const UPDATE_COMMAND = 'make prod-pull && make prod-up'

export const JOURNAL_SPANS = [30, 90, 365] as const
type Span = (typeof JOURNAL_SPANS)[number]

/** The mood colours: the five steps of one diverging scale, never red/green
 * alone — the name is always in the tooltip and the list. */
const MOOD_COLOR: Record<MoodLevel, string> = {
  [-2]: 'var(--mood-n2)',
  [-1]: 'var(--mood-n1)',
  0: 'var(--mood-0)',
  1: 'var(--mood-p1)',
  2: 'var(--mood-p2)',
}

export default function Journal() {
  const tz = browserTz()
  const { t, tp, lang } = useI18n()
  const f = useFormat()
  const today = useToday()
  const [span, setSpan] = useState<Span>(90)
  const win = useMemo(() => reportWindow(span, new Date()), [span, today])
  const qc = useQueryClient()

  const q = useQuery({
    queryKey: ['journal', tz, win.from, win.to],
    queryFn: () => api.journal(win.from, win.to, tz),
    placeholderData: keepPreviousData,
  })
  const del = useMutation({
    mutationFn: () => api.deleteJournal(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journal'] }),
  })

  const data = q.data
  const days = useMemo(() => (data ? journalDays(data.entries, data.tz) : []), [data])
  const events = useMemo(() => (data ? journalEvents(data.entries) : []), [data])
  // Episodes are read over the whole answer, but a run that started before the
  // window is still cut at the window's edge — the page does not reach back.
  const episodes = useMemo(() => illnessEpisodes(days, today).reverse(), [days, today])

  let body
  if (q.isLoading) {
    body = <Loading rows={4} />
  } else if (q.isError && isApiTooOld(q.error)) {
    body = (
      <Alert tone="warn" title={t('ingest.apiOld.title')} live={false}>
        <p>{t('ingest.apiOld.body')}</p>
        <code className="block">{UPDATE_COMMAND}</code>
        <p className="alert-tech">{t('ingest.apiOld.tech')}</p>
      </Alert>
    )
  } else if (q.isError) {
    body = <ErrorState error={q.error} />
  } else if (data && neverReceived(data)) {
    body = (
      <Alert tone="info" title={t('journal.never.title')} live={false}>
        <p data-testid="journal-never">{t('journal.never.body')}</p>
      </Alert>
    )
  } else if (data) {
    body = (
      <div className="sections">
        <p className="subtle" style={{ margin: 0 }} data-testid="journal-coverage">
          {days.length === 0
            ? t('journal.emptyWindow')
            : t('journal.coverage', { n: days.length, of: win.days })}
          {data.last_received_at && (
            <>
              {' '}
              {t('journal.lastReceived', { when: f.relative(data.last_received_at) })}
            </>
          )}
        </p>

        <Card title={t('journal.moods.title')}>
          <MoodStrip days={days} from={win.from} count={win.days} />
        </Card>

        <div className="flow flow-wide">
          <Card title={t('journal.episodes.title')}>
            {episodes.length === 0 ? (
              <p className="card-lead">{t('journal.episodes.none')}</p>
            ) : (
              <ul className="journal-list" data-testid="journal-episodes">
                {episodes.map((ep) => (
                  <li key={ep.start}>
                    <strong>
                      {f.date(ep.start)}
                      {ep.end !== ep.start ? ` – ${f.date(ep.end)}` : ''}
                    </strong>{' '}
                    <span className="subtle">
                      {tp('journal.episodes.days', ep.dayCount)}
                      {ep.ongoing ? ` · ${t('journal.episodes.ongoing')}` : ''}
                    </span>
                    <div className="journal-sub">
                      {episodeSymptoms(ep)
                        .slice(0, 5)
                        .map((s) => symptomName(s.key, lang))
                        .join(', ')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="subtle" style={{ marginBottom: 0 }}>
              {t('journal.episodes.rule')}
            </p>
          </Card>

          <Card title={t('journal.events.title')}>
            {events.length === 0 ? (
              <p className="card-lead">{t('journal.events.none')}</p>
            ) : (
              <ul className="journal-list" data-testid="journal-events">
                {events.map((e) => (
                  <li key={e.id}>
                    <strong>{eventTitle(e, lang)}</strong>{' '}
                    <span className="subtle">
                      {f.dateTime(e.at)}
                      {e.audioLevel != null ? ` · ${t('journal.events.level', { n: f.num(e.audioLevel) })}` : ''}
                    </span>
                    {steadinessText(e.value, lang) && <div className="journal-sub">{steadinessText(e.value, lang)}</div>}
                    {e.marked.length > 0 && (
                      <div>
                        {t('journal.events.marked', {
                          list: e.marked.map((m) => symptomText(m.key, m.severity, lang)).join(', '),
                        })}
                      </div>
                    )}
                    {e.followUps.map((fu) => (
                      <div key={fu.hours} className="journal-sub">
                        {fu.symptoms.length === 0
                          ? t('journal.events.followUpGone', { h: fu.hours })
                          : t('journal.events.followUp', {
                              h: fu.hours,
                              list: fu.symptoms.map((m) => symptomText(m.key, m.severity, lang)).join(', '),
                            })}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            <p className="subtle" style={{ marginBottom: 0 }}>
              {t('journal.events.note')}
            </p>
          </Card>
        </div>

        {days.length > 0 && (
          <Card title={t('journal.daysList.title')}>
            <div className="table-wrap">
              <table className="journal-days" data-testid="journal-days">
                <thead>
                  <tr>
                    <th scope="col">{t('journal.daysList.day')}</th>
                    <th scope="col">{t('journal.daysList.symptoms')}</th>
                    <th scope="col">{t('journal.daysList.mood')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...days].reverse().map((d) => (
                    <tr key={d.day}>
                      <td>{f.date(d.day)}</td>
                      <td>{d.symptoms.map((s) => symptomText(s.key, s.severity, lang)).join(', ')}</td>
                      <td>{contextLine(d, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card title={t('journal.delete.title')}>
          <p>{t('journal.delete.body', { n: f.num(data.total) })}</p>
          <button
            type="button"
            className="btn btn-danger"
            disabled={del.isPending || data.total === 0}
            onClick={() => {
              if (window.confirm(t('journal.delete.confirm'))) del.mutate()
            }}
          >
            {t('journal.delete.button')}
          </button>
          {del.isSuccess && (
            <p className="subtle" role="status">
              {t('journal.delete.done', { n: f.num(del.data.deleted) })}
            </p>
          )}
          {del.isError && <ErrorState error={del.error} />}
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHead
        title={t('journal.title')}
        subtitle={t('journal.subtitle')}
        aside={
          <div className="segmented" role="group" aria-label={t('journal.periodAria')}>
            {JOURNAL_SPANS.map((d) => (
              <button key={d} type="button" className="seg" aria-pressed={span === d} onClick={() => setSpan(d)}>
                {t(`journal.days.${d}` as UiKey)}
              </button>
            ))}
          </div>
        }
      />
      {body}
    </div>
  )
}

/** "Neutral · Work, Family" — the day's mood and tags, as the phone's report prints it. */
function contextLine(d: JournalDay, lang: 'hu' | 'en'): string {
  const parts: string[] = []
  if (d.mood != null) parts.push(moodName(d.mood, lang))
  if (d.tags.length) parts.push(d.tags.map((x) => tagName(x, lang)).join(', '))
  return parts.join(' · ')
}

/**
 * One cell per day of the window, coloured by the day's mood; a day without a
 * note is an empty outline, never a neutral colour — the gap is the point
 * (`ContextHistory.strip`).
 */
function MoodStrip({ days, from, count }: { days: JournalDay[]; from: string; count: number }) {
  const { t, lang } = useI18n()
  const f = useFormat()
  const byDay = new Map(days.map((d) => [d.day, d]))
  const cells = Array.from({ length: count }, (_, i) => addDay(from, i))
  return (
    <>
      <div className="mood-strip" role="img" aria-label={t('journal.moods.aria')} data-testid="journal-moods">
        {cells.map((day) => {
          const d = byDay.get(day)
          const mood = d?.mood
          // The tooltip names what the day carries: the mood, else its symptoms,
          // else that nothing was noted.
          const what =
            mood != null
              ? moodName(mood, lang)
              : d && d.symptoms.length
                ? d.symptoms.map((s) => symptomName(s.key, lang)).join(', ')
                : t('journal.moods.noNote')
          const label = t('journal.moods.cell', { date: f.date(day), mood: what })
          return (
            <span
              key={day}
              className={`mood-cell${mood == null ? ' mood-cell--empty' : ''}${d && d.symptoms.length ? ' mood-cell--symptom' : ''}`}
              style={mood != null ? { background: MOOD_COLOR[mood] } : undefined}
              title={label}
            />
          )
        })}
      </div>
      <div className="legend">
        {([-2, -1, 0, 1, 2] as MoodLevel[]).map((m) => (
          <span className="legend-item" key={m}>
            <span className="swatch" style={{ background: MOOD_COLOR[m] }} />
            {moodName(m, lang)}
          </span>
        ))}
        <span className="legend-item">
          <span className="swatch mood-cell--empty" />
          {t('journal.moods.noNote')}
        </span>
      </div>
    </>
  )
}
