// A signed-in person for tests that render a page or the frame.
//
// The real gate (`session.tsx`, `SessionGate`) asks `/me` before it lets
// anything mount; a page test is about the page, so it hands the page a person
// directly. The gate itself is tested in `session.test.tsx`.

import type { ReactNode } from 'react'
import type { User } from '../api/types'
import { SessionContext, type Session } from '../session'

export const ADMIN: User = {
  id: 'u-bob',
  handle: 'bob',
  display_name: 'Bob',
  role: 'admin',
  capabilities: { household: true, can_delete_self: false },
  ha_publish: true,
}

export const MEMBER: User = {
  id: 'u-nori',
  handle: 'nori',
  display_name: 'Nóri',
  role: 'member',
  capabilities: { household: true, can_delete_self: true },
  ha_publish: false,
}

export function testSession(me: User = ADMIN, over: Partial<Session> = {}): Session {
  return {
    me,
    isAdmin: me.role === 'admin',
    signOut: async () => {},
    forget: () => {},
    setMe: () => {},
    legacyNotice: false,
    dismissLegacyNotice: () => {},
    ...over,
  }
}

export function TestSession({
  me = ADMIN,
  session,
  children,
}: {
  me?: User
  session?: Session
  children: ReactNode
}) {
  return <SessionContext.Provider value={session ?? testSession(me)}>{children}</SessionContext.Provider>
}
