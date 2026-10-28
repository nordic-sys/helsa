// The sync queue — "how much of what the phone sent is still waiting to be
// written, and is it going down".
//
// The page exists because of a real first install: the phone uploaded years of
// history in minutes, the worker then needed ~40 minutes to write it, and the
// only way to see that was `rabbitmqctl list_queues` over SSH. Meanwhile every
// other page looked like data was missing.
//
// ⚠️ **Four rules that are not style preferences.**
//
//  1. **An unmeasured number is never a zero.** When the API cannot reach
//     RabbitMQ the server leaves the queue out, and this page says "no numbers"
//     instead of drawing an empty queue — those are opposite situations.
//  2. **A non-empty dead-letter queue is loud.** It is data that will not reach
//     the database unless somebody acts; it goes above everything else.
//  3. **The ETA is the server's estimate or nothing.** No estimate is derived
//     here, and it is always labelled as one.
//  4. **Nothing on the page claims what the API does not send.** The mockup drew
//     a progress bar ("3,958 of 5,375 parts of this upload") and a per-minute
//     chart; the status endpoint knows neither the size of an upload nor a
//     per-minute history, so neither is drawn. A bar against an invented total
//     would be the most confident-looking lie on the page.
//
// # Words
//
// # Who reads it (docs/36 §5.8)
//
// The queue is the whole household's. An admin sees it as before; a member gets
// the same numbers, but only THEIR OWN set-aside parts listed (the server filters
// `recent_failures`), and no retry button: a retry moves every member's stuck
// parts, so it is an admin's act (authz.go answers 403 to anyone else anyway).
//
// The page speaks to the person who owns the server, not to RabbitMQ: a batch is
// a "part", the dead-letter queue is "set aside", a consumer is a "worker". The
// technical name is always there in secondary text, because it is what the logs
// and the documentation use.

import { Fragment, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { ApiError } from '../api/client'
import type { IngestFailure, IngestRedriveResult, IngestStatus } from '../api/types'
import { Alert, Card, ErrorState, Loading, PageHead } from '../components/ui'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'
import {
  REDRIVE_MAX_PER_CALL,
  REPEATED_REDRIVES,
  deadLetters,
  etaMinutes,
  failureKind,
  failureLog,
  isApiTooOld,
  phase,
  rateDigits,
  redriveErrorKind,
} from '../lib/ingest'
import { INGEST_STATUS_KEY, useIngestStatus } from '../lib/useIngestStatus'
import { useSession } from '../session'

/** How often the page asks. A drain is measured in minutes; five seconds is
 * lively enough to watch and one cheap request per tick. */
export const POLL_MS = 5000

/** The command that updates a server whose API is older than the web. */
const UPDATE_COMMAND = 'make prod-pull && make prod-up'

/** Where the full error of a set-aside part is. */
const LOG_COMMAND = 'docker compose logs worker | grep "process batch"'

function Code({ children }: { children: ReactNode }) {
  return <code className="block">{children}</code>
}

/** The version-skew explanation — shared by the status read and the retry. */
function ApiTooOld() {
  const { t } = useI18n()
  return (
    <Alert tone="warn" title={t('ingest.apiOld.title')}>
      <p>{t('ingest.apiOld.body')}</p>
      <Code>{UPDATE_COMMAND}</Code>
      <p className="alert-tech">{t('ingest.apiOld.tech')}</p>
    </Alert>
  )
}

function Status({
  s,
  lastGood,
  redrive,
  canRedrive,
}: {
  s: IngestStatus
  lastGood?: string
  redrive: RedriveState
  canRedrive: boolean
}) {
  const { t, tp, tx, locale } = useI18n()
  const f = useFormat()
  const p = phase(s)
  const dlq = deadLetters(s)
  const q = s.queue
  const tput = s.throughput
  const eta = etaMinutes(s)
  const windowMin = tput ? Math.max(1, Math.round(tput.window_seconds / 60)) : undefined
  const rate = (v?: number) => (v == null ? '–' : f.fmt(v, rateDigits(v)))
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  // The worker's state in one word, from what the snapshot actually says —
  // "working" only with a recent completion behind it (see `phase`).
  const connectedWord: Record<string, string> = {
    draining: t('ingest.worker.state.working'),
    stalled: t('ingest.worker.state.noRecent'),
    rateUnknown: t('ingest.worker.state.connected'),
    settling: t('ingest.worker.state.finishing'),
  }
  const workerState: { word: string; dot: string; line: string } | null = q
    ? q.consumers === 0
      ? {
          word: t('ingest.worker.state.none'),
          dot: q.ready > 0 ? 'var(--helsa-ember)' : 'var(--text-faint)',
          line: t('ingest.worker.line.none'),
        }
      : {
          word: connectedWord[p] ?? t('ingest.worker.state.waiting'),
          dot: p === 'stalled' ? 'var(--helsa-ember)' : 'var(--helsa-move)',
          line: tp('ingest.worker.line.connected', q.consumers),
        }
    : null

  return (
    <div className="sections">
      {/* The loud things first, in order of what costs data. */}
      {p === 'unreachable' && (
        <Alert tone="unknown" title={t('ingest.unreachable.title')}>
          <p>{t('ingest.unreachable.body')}</p>
          {lastGood && <p>{t('ingest.unreachable.lastGood', { time: clock(lastGood) })}</p>}
          {s.broker_error && (
            <p className="alert-tech">{t('ingest.unreachable.detail', { error: s.broker_error })}</p>
          )}
        </Alert>
      )}
      {dlq != null && dlq > 0 && <DeadLetterAlert s={s} count={dlq} redrive={redrive} canRedrive={canRedrive} />}
      {/* ⚠️ Outside the alert, and always mounted: a retry that empties the
          dead-letter queue unmounts the alert, and must not take its own result
          and its announcement with it. */}
      <RedriveResultRegion outcome={redrive.outcome} />
      {p === 'noConsumer' && (
        <Alert tone="warn" title={t('ingest.noConsumer.title')}>
          <p>
            {tx('ingest.noConsumer.body', {
              ps: <code>docker compose ps</code>,
              logs: <code>docker compose logs worker</code>,
            })}
          </p>
        </Alert>
      )}
      {p === 'idle' && q?.consumers === 0 && (
        <Alert tone="info" title={t('ingest.noWorkerIdle.title')} live={false}>
          <p>{t('ingest.noWorkerIdle.body')}</p>
        </Alert>
      )}
      {!s.stats_reachable && (
        <Alert tone="info" title={t('ingest.stats.unreachable.title')} live={false}>
          <p>{t('ingest.stats.unreachable.body')}</p>
        </Alert>
      )}

      {/* ⛔ Without a broker reading there are no queue figures at all — not
          figures with zeros in them. */}
      {q && (
        <section className="card queue-hero" aria-labelledby="queue-waiting">
          <div className="queue-hero-row">
            <div>
              <span className="queue-label" id="queue-waiting">
                {t('ingest.hero.waiting')}
              </span>
              <span className="queue-big" data-testid="ingest-waiting">
                {f.num(q.ready)}
                <small>{tp('ingest.hero.parts', q.ready)}</small>
              </span>
              <span className="stat-note">
                {q.in_flight_max ? `${t('ingest.stat.inFlight', { n: f.num(q.in_flight_max) })} · ` : ''}
                {t('ingest.hero.tech', { name: q.name })}
              </span>
            </div>
            <div className="queue-eta">
              {p === 'draining' && eta != null ? (
                <>
                  <span className="queue-label">{t('ingest.hero.etaLabel')}</span>
                  <span className="figure" data-testid="ingest-eta">
                    {t('ingest.hero.eta', { duration: f.duration(eta) })}
                  </span>
                </>
              ) : p === 'idle' || p === 'settling' ? (
                <>
                  <span className="queue-label">
                    {p === 'idle' ? t('ingest.hero.nothing') : t('ingest.hero.settling')}
                  </span>
                  <span className="figure">–</span>
                </>
              ) : (
                <>
                  <span className="queue-label">
                    {p === 'noConsumer' || p === 'stalled'
                      ? t('ingest.hero.notMoving')
                      : p === 'rateUnknown'
                        ? t('ingest.hero.rateUnknown')
                        : t('ingest.hero.etaLabel')}
                  </span>
                  <span className="figure">{t('ingest.hero.noEstimate')}</span>
                </>
              )}
            </div>
          </div>
          {/* The headline sentence: how long, or why there is no "how long". */}
          <p className="stat-note" style={{ maxWidth: '78ch' }}>
            {p === 'draining' && eta != null
              ? t('ingest.eta.note')
              : p === 'stalled' && s.worker?.last_batch_at && tput?.batches
                ? t('ingest.stalled.since', { when: f.relative(s.worker.last_batch_at) })
                : p === 'stalled' && windowMin != null
                  ? tp('ingest.stalled', windowMin)
                  : p === 'rateUnknown'
                    ? t('ingest.rateUnknown')
                    : p === 'settling'
                      ? q.in_flight_max
                        ? t('ingest.settling', { n: f.num(q.in_flight_max) })
                        : t('ingest.settling.noBound')
                      : p === 'idle'
                        ? q.consumers === 0
                          ? t('ingest.idle.noWorker')
                          : t('ingest.idle')
                        : null}
          </p>
        </section>
      )}

      {(q || tput || s.worker) && (
        <div className="grid grid-4">
          {tput && (
            <article className="card card-sm">
              <h2 className="card-title">{t('ingest.tile.rate')}</h2>
              <p className="figure">
                {rate(tput.batches_per_minute)}
                {tput.batches_per_minute != null && (
                <small style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-dim)' }}>
                  {t('ingest.tile.rateUnit')}
                </small>
                )}
              </p>
              <p className="stat-note">
                {tput.items_per_minute != null
                  ? t('ingest.tile.itemsRate', { n: rate(tput.items_per_minute) })
                  : t('ingest.tile.noRate')}
              </p>
              {windowMin != null && <p className="stat-note">{tp('ingest.window', windowMin)}</p>}
            </article>
          )}
          {workerState && (
            <article className="card card-sm">
              <h2 className="card-title">{t('ingest.tile.worker')}</h2>
              <p className="figure">
                <span className="dot" aria-hidden="true" style={{ background: workerState.dot, width: 10, height: 10 }} />
                {workerState.word}
              </p>
              <p className="stat-note">{workerState.line}</p>
            </article>
          )}
          {s.stats_reachable && (
            <article className="card card-sm">
              <h2 className="card-title">{t('ingest.tile.last')}</h2>
              <p className="figure">
                {s.worker?.last_batch_at ? f.relative(s.worker.last_batch_at) : '–'}
              </p>
              <p className="stat-note">
                {s.worker?.last_batch_at
                  ? f.dateTime(s.worker.last_batch_at)
                  : s.worker
                    ? t('ingest.tile.lastNone')
                    : t('ingest.worker.none')}
              </p>
            </article>
          )}
          {q && (
            <article className="card card-sm">
              <h2 className="card-title">{t('ingest.tile.setAside')}</h2>
              <p
                className="figure"
                style={dlq ? { color: 'var(--error-icon)' } : undefined}
                data-testid="ingest-dlq"
              >
                {f.num(dlq)}
              </p>
              <p className="stat-note">{t('ingest.tile.setAsideNote')}</p>
              <p className="stat-note">{t('ingest.tile.setAsideTech')}</p>
            </article>
          )}
        </div>
      )}

      {s.stats_reachable && s.worker && (
        <Card
          title={
            s.worker.started_at
              ? t('ingest.since.title', {
                  when: `${f.dateTime(s.worker.started_at)} (${f.relative(s.worker.started_at)})`,
                })
              : t('ingest.worker.title')
          }
        >
          <div className="grid grid-stats" style={{ gap: 12 }}>
            {[
              { n: s.worker.batches_since_start, label: t('ingest.since.parts') },
              { n: s.worker.items_since_start, label: t('ingest.since.items') },
              { n: s.worker.failed_since_start, label: t('ingest.since.setAside') },
            ].map((x) => (
              <div key={x.label}>
                <p className="figure figure-sm">{f.num(x.n)}</p>
                <p className="stat-note">{x.label}</p>
              </div>
            ))}
          </div>
          <p className="subtle" style={{ margin: '12px 0 0' }}>
            {t('ingest.worker.itemsNote')}
          </p>
        </Card>
      )}
    </div>
  )
}

// --- Set aside: the alert, the reasons, and the retry ------------------------

function DeadLetterAlert({
  s,
  count,
  redrive,
  canRedrive,
}: {
  s: IngestStatus
  count: number
  redrive: RedriveState
  canRedrive: boolean
}) {
  const { t, tp, tx } = useI18n()
  const f = useFormat()
  const log = failureLog(s)
  const last = s.dead_letter?.last_redrive

  return (
    <Alert tone="error" title={tp('ingest.dlq.title', count, { n: f.num(count) })}>
      <p>{t('ingest.dlq.body')}</p>

      {canRedrive ? (
        <RedriveControls count={count} redrive={redrive} />
      ) : (
        <p>{t('ingest.redrive.memberNote')}</p>
      )}

      {/* ⚠️ A LOG, said as one: nothing in the snapshot says which of these is
          still in the queue (see `failureLog`), so nothing here claims it. */}
      {log.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <h3 className="alert-title" style={{ fontSize: 'var(--fs-body)' }}>
            {t('ingest.reasons.title')}
          </h3>
          <p className="subtle" style={{ margin: 0 }}>
            {t('ingest.reasons.hint')}
          </p>
          <ul className="failure-list">
            {log.map((fl, i) => (
              <FailureRow key={fl.batch_id ?? `${fl.failed_at}-${i}`} failure={fl} />
            ))}
          </ul>
        </div>
      )}

      {last && (
        <p className="alert-tech">
          {t('ingest.reason.lastRedrive', { when: f.dateTime(last.at), moved: f.num(last.moved) })}
        </p>
      )}

      <p className="alert-tech">
        {tx('ingest.dlq.tech', { name: <code>{s.dead_letter?.name ?? ''}</code> })}
      </p>
      <Code>{LOG_COMMAND}</Code>
      <p className="alert-tech">{t('ingest.dlq.resync')}</p>
    </Alert>
  )
}

/**
 * One logged failure: what kind of failure it reads as, in words, then when and
 * how big, then — on request — the worker's own message and the batch id.
 */
function FailureRow({ failure }: { failure: IngestFailure }) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const kind = failureKind(failure)
  const parts: string[] = []
  if (failure.samples) parts.push(tp('ingest.reason.samples', failure.samples, { n: f.num(failure.samples) }))
  if (failure.workouts) parts.push(tp('ingest.reason.workouts', failure.workouts, { n: f.num(failure.workouts) }))
  if (failure.sleep_segments)
    parts.push(tp('ingest.reason.sleep', failure.sleep_segments, { n: f.num(failure.sleep_segments) }))
  if (failure.activity_summaries)
    parts.push(tp('ingest.reason.activity', failure.activity_summaries, { n: f.num(failure.activity_summaries) }))
  if (failure.deletions) parts.push(tp('ingest.reason.deletions', failure.deletions, { n: f.num(failure.deletions) }))

  return (
    <li>
      <strong>{t(`ingest.reason.${kind}`)}</strong>
      <p className="subtle">
        {f.dateTime(failure.failed_at)} · {tp('ingest.reason.items', failure.items, { n: f.num(failure.items) })}
        {parts.length > 0 && ` (${parts.join(', ')})`}
      </p>
      {failure.redriven >= REPEATED_REDRIVES && (
        <p className="tone-error" style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 600 }}>
          {t('ingest.reason.repeated', { n: failure.redriven })}
        </p>
      )}
      <details>
        <summary>{t('ingest.reason.raw')}</summary>
        <pre>{failure.error}</pre>
        {failure.batch_id && <p className="subtle">{t('ingest.reason.batch', { id: failure.batch_id })}</p>}
      </details>
    </li>
  )
}

type RedriveOutcome =
  | { kind: 'done'; result: IngestRedriveResult }
  | { kind: 'busy' }
  | { kind: 'brokerDown' }
  | { kind: 'tooOld' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unknown'; reason: string }

type RedriveState = {
  outcome: RedriveOutcome | null
  pending: boolean
  start: () => void
}

/**
 * "Retry set-aside parts": run, report, refresh.
 *
 * ⚠️ Nothing on this page retries anything by itself — only the button, only
 * when pressed. The answer is reported as the server gave it: `moved` exactly,
 * `remaining` only when the server could read it, and a run that stopped
 * part-way as the partial success it is. A request whose answer never arrived is
 * reported as UNKNOWN, not as "did not run" (see `redriveErrorKind`). The status
 * is re-read straight after either way.
 *
 * The state lives in the page, not in the alert: the alert is drawn only while
 * the dead-letter queue holds something, and a retry that empties it would
 * otherwise erase its own result.
 */
function useRedrive(): RedriveState {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [outcome, setOutcome] = useState<RedriveOutcome | null>(null)
  const run = useMutation({
    mutationFn: () => api.redriveDeadLetters(),
    onSuccess: (result) => setOutcome({ kind: 'done', result }),
    onError: (err) => {
      const e = err as ApiError
      const reason = e?.detail ?? e?.message ?? t('error.generic.title')
      const kind = redriveErrorKind(e)
      if (kind === 'rejected' || kind === 'unknown') setOutcome({ kind, reason })
      else setOutcome({ kind })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: INGEST_STATUS_KEY }),
  })
  return {
    outcome,
    pending: run.isPending,
    start: () => {
      setOutcome(null)
      run.mutate()
    },
  }
}

function RedriveControls({ count, redrive }: { count: number; redrive: RedriveState }) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const [confirming, setConfirming] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  // One call moves at most this many; the button says so rather than offering all.
  const capped = count > REDRIVE_MAX_PER_CALL
  const max = f.num(REDRIVE_MAX_PER_CALL)

  // An older server has no such endpoint: the button goes, and says why.
  if (redrive.outcome?.kind === 'tooOld') {
    return <p className="alert-tech">{t('ingest.redrive.tooOld', { cmd: UPDATE_COMMAND })}</p>
  }

  const close = () => {
    setConfirming(false)
    // Back to the button that opened the question, for keyboard users.
    requestAnimationFrame(() => trigger.current?.focus())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '4px 0' }}>
      {confirming ? (
        <div className="confirm" role="group" aria-label={t('ingest.redrive.confirmAria')}>
          <p style={{ margin: 0 }}>{tp('ingest.redrive.confirm', Math.min(count, REDRIVE_MAX_PER_CALL), { n: f.num(Math.min(count, REDRIVE_MAX_PER_CALL)) })}</p>
          <p style={{ margin: 0 }}>{t('ingest.redrive.limit', { max })}</p>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                close()
                redrive.start()
              }}
            >
              {t('ingest.redrive.confirmYes')}
            </button>
            <button type="button" className="btn" onClick={close}>
              {t('ingest.redrive.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row">
          <button
            ref={trigger}
            type="button"
            className="btn btn-primary"
            disabled={redrive.pending}
            aria-busy={redrive.pending || undefined}
            onClick={() => setConfirming(true)}
          >
            {redrive.pending
              ? t('ingest.redrive.running')
              : capped
                ? t('ingest.redrive.buttonCapped', { max, n: f.num(count) })
                : tp('ingest.redrive.button', count, { n: f.num(count) })}
          </button>
        </div>
      )}
    </div>
  )
}

/** The retry's answer — always mounted, so it is announced and it stays. */
function RedriveResultRegion({ outcome }: { outcome: RedriveOutcome | null }) {
  return (
    <div aria-live="polite" data-testid="redrive-region">
      {outcome && outcome.kind !== 'tooOld' && (
        <div className="card card-sm">
          <OutcomeText outcome={outcome} />
        </div>
      )}
    </div>
  )
}

function OutcomeText({ outcome }: { outcome: RedriveOutcome }) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const line = (text: ReactNode, strong = false) => (
    <p style={{ margin: 0, fontWeight: strong ? 600 : undefined }}>{text}</p>
  )
  switch (outcome.kind) {
    case 'busy':
      return line(t('ingest.redrive.busy'))
    case 'brokerDown':
      return line(t('ingest.redrive.brokerDown'))
    case 'rejected':
      return line(t('ingest.redrive.failed', { reason: outcome.reason }))
    case 'unknown':
      return line(t('ingest.redrive.unknown', { reason: outcome.reason }))
    case 'tooOld':
      return null
    case 'done': {
      const r = outcome.result
      return (
        <div data-testid="redrive-result" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {line(
            r.remaining != null
              ? t('ingest.redrive.result', { moved: f.num(r.moved), remaining: f.num(r.remaining) })
              : t('ingest.redrive.resultUnknown', { moved: f.num(r.moved) }),
            true,
          )}
          {r.stopped_early && line(t('ingest.redrive.stopped', { reason: r.stopped_early }))}
          {r.repeated > 0 && line(tp('ingest.redrive.repeated', r.repeated, { n: f.num(r.repeated) }))}
          {r.moved > 0 && line(t('ingest.redrive.watch'))}
        </div>
      )
    }
  }
}

export default function Ingest() {
  const { t, locale } = useI18n()
  // With seconds: on a page that refreshes every five, "12:30" cannot show that
  // it is still moving.
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const q = useIngestStatus(POLL_MS)
  const redrive = useRedrive()
  const { isAdmin } = useSession()

  // The last reading in which the broker answered — so "no numbers" can say how
  // old the last real ones are. Kept in a ref: it is a memory of this page's
  // visit, not state anything renders from on its own.
  const lastGood = useRef<string | undefined>(undefined)
  if (q.data?.broker_reachable) lastGood.current = q.data.checked_at

  return (
    <>
      <PageHead
        title={t('ingest.title')}
        subtitle={
          <>
            {t('ingest.subtitle')}
            {q.data && (
              <>
                <br />
                <span style={{ fontSize: 13 }}>{t('ingest.checkedAt', { time: clock(q.data.checked_at) })}</span>
              </>
            )}
          </>
        }
      />

      {q.isLoading ? (
        <Loading rows={3} />
      ) : q.isError && isApiTooOld(q.error) ? (
        // ⚠️ A 404 here is version skew, not a broken link: the web image
        // landed before the backend image. Say which, and what to run.
        <ApiTooOld />
      ) : q.isError && !q.data ? (
        <ErrorState error={q.error} />
      ) : q.data ? (
        <Fragment>
          {/* A failed refresh keeps the last reading on screen, but says so: a
              number that stopped updating must not look live. */}
          {q.isError && (
            <div style={{ marginBottom: 16 }}>
              <Alert tone="warn" title={t('ingest.stale.title')}>
                <p>{t('ingest.stale.body', { time: clock(q.data.checked_at) })}</p>
              </Alert>
            </div>
          )}
          <Status s={q.data} lastGood={lastGood.current} redrive={redrive} canRedrive={isAdmin} />
        </Fragment>
      ) : null}
    </>
  )
}
