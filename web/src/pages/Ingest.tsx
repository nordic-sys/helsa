// The ingest queue — "how much of what the phone sent is still waiting to be
// written, and is it going down".
//
// The page exists because of a real first install: the phone uploaded years of
// history in minutes, the worker then needed ~40 minutes to write it, and the
// only way to see that was `rabbitmqctl list_queues` over SSH. Meanwhile every
// other page looked like data was missing.
//
// ⚠️ **Three rules that are not style preferences.**
//
//  1. **An unmeasured number is never a zero.** When the API cannot reach
//     RabbitMQ the server leaves the queue out, and this page says "unknown"
//     instead of drawing an empty queue — those are opposite situations.
//  2. **A non-empty dead-letter queue is loud.** It is data that will not reach
//     the database unless somebody acts; it goes above everything else.
//  3. **The ETA is the server's estimate or nothing.** No estimate is derived
//     here, and it is always labelled as one.

import type { ReactNode } from 'react'
import { Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { IngestStatus } from '../api/types'
import { Card, ErrorState, Loading, Note, Stat } from '../components/ui'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'
import { deadLetters, etaMinutes, phase, rateDigits } from '../lib/ingest'

/** How often the page asks. A drain is measured in minutes; five seconds is
 * lively enough to watch and one cheap request per tick. */
export const POLL_MS = 5000

function Alert({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state error ingest-alert" role="alert">
      <strong>{title}</strong>
      {children}
    </div>
  )
}

function Rows({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((it) => (
        <Fragment key={it.label}>
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

function Status({ s }: { s: IngestStatus }) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const p = phase(s)
  const dlq = deadLetters(s)
  const q = s.queue
  const tput = s.throughput
  const eta = etaMinutes(s)
  const windowMin = tput ? Math.max(1, Math.round(tput.window_seconds / 60)) : undefined
  const rate = (v?: number) => (v == null ? '–' : f.fmt(v, rateDigits(v)))

  return (
    <>
      {/* The loud things first, in order of what costs data. */}
      {p === 'unreachable' && (
        <Alert title={t('ingest.unreachable.title')}>
          {t('ingest.unreachable.body')}
          {s.broker_error && (
            <p className="subtle" style={{ margin: '6px 0 0' }}>
              {t('ingest.unreachable.detail', { error: s.broker_error })}
            </p>
          )}
        </Alert>
      )}
      {dlq != null && dlq > 0 && (
        <Alert title={tp('ingest.dlq.title', dlq)}>
          {t('ingest.dlq.body', { name: s.dead_letter?.name ?? '' })}
        </Alert>
      )}
      {p === 'noConsumer' && (
        <Alert title={t('ingest.noConsumer.title')}>{t('ingest.noConsumer.body')}</Alert>
      )}
      {p === 'idle' && q?.consumers === 0 && (
        <Note title={t('ingest.noWorkerIdle.title')}>{t('ingest.noWorkerIdle.body')}</Note>
      )}
      {!s.stats_reachable && (
        <Note title={t('ingest.stats.unreachable.title')}>{t('ingest.stats.unreachable.body')}</Note>
      )}

      {/* The headline sentence: how long, or why there is no "how long". */}
      {p === 'draining' && eta != null && (
        <p className="cov-headline" data-testid="ingest-eta">
          <strong>{t('ingest.eta', { duration: f.duration(eta) })}</strong>{' '}
          <span className="subtle">{t('ingest.eta.note')}</span>
        </p>
      )}
      {/* Stalled without the worker's counters is already said by the note
          above; only a measured empty window gets a sentence of its own. */}
      {p === 'stalled' && tput && windowMin != null && (
        <p className="cov-headline">{tp('ingest.stalled', windowMin)}</p>
      )}
      {p === 'idle' && <p className="cov-headline">{t('ingest.idle')}</p>}

      <div className="sections">
        {/* ⛔ Without a broker reading there are no queue tiles at all — not
            tiles with zeros in them. */}
        {(q || tput) && (
          <div className="grid grid-stats">
            {q && (
              <>
                <Stat
                  label={t('ingest.stat.waiting')}
                  value={f.num(q.ready)}
                  unit={
                    q.in_flight_max
                      ? t('ingest.stat.inFlight', { n: f.num(q.in_flight_max) })
                      : undefined
                  }
                />
                <Stat
                  label={t('ingest.stat.deadLetter')}
                  value={f.num(dlq)}
                  color={dlq ? 'var(--helsa-pulse)' : undefined}
                />
                <Stat
                  label={t('ingest.stat.consumers')}
                  value={f.num(q.consumers)}
                  color={q.consumers === 0 && q.ready > 0 ? 'var(--helsa-pulse)' : undefined}
                />
              </>
            )}
            {tput && (
              <>
                <Stat label={t('ingest.stat.batchesPerMin')} value={rate(tput.batches_per_minute)} />
                <Stat label={t('ingest.stat.itemsPerMin')} value={rate(tput.items_per_minute)} />
              </>
            )}
          </div>
        )}
        {tput && windowMin != null && (
          <p className="subtle" style={{ margin: 0 }}>
            {tp('ingest.window', windowMin)}
          </p>
        )}

        {s.stats_reachable && (
          <Card title={t('ingest.worker.title')}>
            {s.worker ? (
              <>
                <Rows
                  items={[
                    {
                      label: t('ingest.worker.lastBatch'),
                      value: s.worker.last_batch_at
                        ? `${f.relative(s.worker.last_batch_at)} · ${f.dateTime(s.worker.last_batch_at)}`
                        : '–',
                    },
                    { label: t('ingest.worker.started'), value: f.dateTime(s.worker.started_at) },
                    { label: t('ingest.worker.batches'), value: f.num(s.worker.batches_since_start) },
                    { label: t('ingest.worker.items'), value: f.num(s.worker.items_since_start) },
                    { label: t('ingest.worker.failed'), value: f.num(s.worker.failed_since_start) },
                  ]}
                />
                <p className="subtle" style={{ margin: '10px 0 0' }}>
                  {t('ingest.worker.itemsNote')}
                </p>
              </>
            ) : (
              <p className="subtle" style={{ margin: 0 }}>
                {t('ingest.worker.none')}
              </p>
            )}
          </Card>
        )}
      </div>
    </>
  )
}

export default function Ingest() {
  const { t, locale } = useI18n()
  // With seconds: on a page that refreshes every five, "12:30" cannot show that
  // it is still moving.
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const q = useQuery({
    queryKey: ['ingest-status'],
    queryFn: () => api.ingestStatus(),
    refetchInterval: POLL_MS,
  })

  return (
    <>
      <h1>{t('ingest.title')}</h1>
      <p className="subtle">
        {t('ingest.subtitle')}
        {q.data && (
          <>
            <br />
            {t('ingest.checkedAt', { time: clock(q.data.checked_at) })}
          </>
        )}
      </p>

      {q.isLoading ? (
        <Loading rows={3} />
      ) : q.isError && !q.data ? (
        <ErrorState error={q.error} />
      ) : q.data ? (
        <>
          {/* A failed refresh keeps the last reading on screen, but says so: a
              number that stopped updating must not look live. */}
          {q.isError && (
            <Note title={t('ingest.stale.title')}>
              {t('ingest.stale.body', { time: clock(q.data.checked_at) })}
            </Note>
          )}
          <Status s={q.data} />
        </>
      ) : null}
    </>
  )
}
