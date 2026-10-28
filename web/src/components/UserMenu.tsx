// Who is signed in, and the way out (docs/36 §5.2, v1: the name, My account,
// Sign out). The v2 person-switcher for shared views goes here too, which is why
// it is a menu and not two links.

import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '../i18n'
import { useSession } from '../session'

export const ACCOUNT_PATH = '/account'

export function UserMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n()
  const { me, signOut } = useSession()
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const name = me.display_name ?? me.handle ?? ''

  // A click anywhere else closes it — a menu that stays open over the page it
  // was not asked about is in the way.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div
      className="user-menu"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          // ⚠️ Not up to the sidebar: Escape there closes the whole bar panel.
          e.stopPropagation()
          setOpen(false)
          button.current?.focus()
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="user-menu-button"
        aria-expanded={open}
        aria-controls="user-menu-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="user-menu-name">{name}</span>
        <span className="sr-only">{t('menu.aria')}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d={open ? 'M3 10 L8 5 L13 10' : 'M3 6 L8 11 L13 6'}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="user-menu-panel" id="user-menu-panel">
          <div className="user-menu-who">
            <strong>{t('menu.you', { name })}</strong>
            <span>
              {me.handle} · {me.role === 'admin' ? t('role.admin') : t('role.member')}
            </span>
          </div>
          <NavLink
            to={ACCOUNT_PATH}
            className="user-menu-item"
            onClick={() => {
              setOpen(false)
              onNavigate?.()
            }}
          >
            {t('nav.account')}
          </NavLink>
          <button
            type="button"
            className="user-menu-item"
            onClick={() => {
              setFailed(false)
              signOut().catch(() => setFailed(true))
            }}
          >
            {t('menu.signOut')}
          </button>
          {failed && <p className="form-error user-menu-error">{t('menu.signOutFailed')}</p>}
        </div>
      )}
    </div>
  )
}
