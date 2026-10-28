// The household — an admin's list of who uploads to this server (docs/36 §5.3).
//
// ⚠️ **Account metadata, never health data.** Name, role, how many devices, when
// the last upload arrived — that is everything the admin's routes return, and the
// database holds them to it (the admin policies exist on the account tables only,
// docs/36 §10). The subtitle says so, because "the admin sees everything" is the
// first thing a member would assume.
//
// Admins only: the sidebar entry is hidden for a member (`nav.tsx`, `adminOnly`),
// the route sends a member home, and the server answers 403 regardless.

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ApiError } from '../api/client'
import type { Member } from '../api/types'
import { Card, ErrorState, Loading, PageHead } from '../components/ui'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'
import { useSession } from '../session'

export const MEMBERS_KEY = ['household', 'members'] as const

/** What the handle may be — the contract's pattern (`MemberCreate.handle`). */
const HANDLE = /^[a-z0-9][a-z0-9_-]{0,31}$/

export default function Household() {
  const { t } = useI18n()
  const f = useFormat()
  const { me } = useSession()
  const [adding, setAdding] = useState(false)
  const members = useQuery({ queryKey: MEMBERS_KEY, queryFn: () => api.members() })

  return (
    <>
      <PageHead
        title={t('household.title')}
        subtitle={t('household.subtitle')}
        aside={
          !adding && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              {t('household.add')}
            </button>
          )
        }
      />

      {adding && <AddMember onCancel={() => setAdding(false)} />}

      {members.isLoading ? (
        <Loading rows={1} />
      ) : members.isError ? (
        <ErrorState error={members.error} />
      ) : (
        <Card>
          <div className="table-wrap table-wrap--anchor">
            <table>
              <thead>
                <tr>
                  <th>{t('household.col.name')}</th>
                  <th>{t('household.col.role')}</th>
                  <th className="num">{t('household.col.devices')}</th>
                  <th>{t('household.col.lastUpload')}</th>
                  <th>
                    <span className="sr-only">{t('household.col.link')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(members.data ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>
                      {memberName(m)}
                      {m.id === me.id && <span className="subtle"> {t('household.you')}</span>}
                      {m.deleting ? (
                        <span className="chip chip--warn">{t('household.deleting')}</span>
                      ) : (
                        m.disabled && <span className="chip chip--warn">{t('household.disabled')}</span>
                      )}
                    </td>
                    <td>{m.role === 'admin' ? t('role.admin') : t('role.member')}</td>
                    <td className="num">{f.num(m.devices ?? 0)}</td>
                    <td>{m.last_upload_at ? f.relative(m.last_upload_at) : t('household.never')}</td>
                    <td className="num">
                      {!m.deleting && (
                        <Link to={`/household/${m.id}`}>
                          {(m.devices ?? 0) === 0 && m.id !== me.id
                            ? t('household.connect')
                            : t('household.details')}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}

export function memberName(m: Pick<Member, 'display_name' | 'handle'>): string {
  return m.display_name?.trim() || m.handle
}

function AddMember({ onCancel }: { onCancel: () => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = HANDLE.test(handle.trim())

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) {
      setError(t('household.new.handleRule'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const m = await api.addMember({ handle: handle.trim(), display_name: name.trim() || undefined })
      await qc.invalidateQueries({ queryKey: MEMBERS_KEY })
      // Straight to the member's page: the next thing to do is give them a code.
      navigate(`/household/${m.id}`)
    } catch (err) {
      const status = (err as ApiError).status
      setError(
        status === 409 ? t('household.new.taken', { handle: handle.trim() }) : t('household.new.failed'),
      )
      setBusy(false)
    }
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <Card title={t('household.new.title')}>
        <form className="form-grid" onSubmit={submit} noValidate>
          <label className="form-field">
            <span>{t('household.new.name')}</span>
            <input
              className="text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              autoFocus
              placeholder={t('household.new.namePlaceholder')}
            />
          </label>
          <label className="form-field">
            <span>{t('household.new.handle')}</span>
            <input
              className="text-input"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              maxLength={32}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="nori"
              aria-describedby="handle-hint"
            />
            <small id="handle-hint" className="subtle">
              {t('household.new.handleHint')}
            </small>
          </label>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('household.new.submit')}
            </button>
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              {t('common.cancel')}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </form>
      </Card>
    </div>
  )
}
