/**
 * The household screens (docs/36), photographed for a functional review.
 *
 * Not for the site: these pictures are the input of a reviewer (docs/prompts/
 * household-review-agy-*.md), and the set is the same every time, so a round can
 * be repeated weeks later. Everything is the fixture's invented household — Bob
 * the admin, Nóri a member, Panni added today with no phone — never a real server.
 *
 * Needs three things running (each in its own terminal):
 *   node site/scripts/web-fixture-api.mjs
 *   cd web && HELSA_API=http://127.0.0.1:18291 npx vite --port 5191 --strictPort
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
 *     --disable-gpu --hide-scrollbars --remote-debugging-port=9222 --user-data-dir=/tmp/hh-shot
 * then:
 *   node site/scripts/household-shots.mjs <out-dir>
 *
 * A step is a path plus what to do on it: a button's text to click (the last
 * visible one that contains it), or `type:<selector>=<value>` for an input. The
 * fixture's knobs (`/__as`, `/__legacy`, `/__mode`) choose who is signed in and
 * which state is shown. Uses Node's own WebSocket: no puppeteer.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2]
if (!out) {
  console.error('Usage: node site/scripts/household-shots.mjs <out-dir>')
  process.exit(1)
}
mkdirSync(out, { recursive: true })

const API = 'http://127.0.0.1:18291'
const WEB = 'http://localhost:5191'
const knob = (q) => fetch(`${API}${q}`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(lang, as, path, file, steps = []) {
  await knob(`/__as?u=${as}`)
  const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result ?? m.error)
      pending.delete(m.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id
      pending.set(i, r)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  const ev = async (expression) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await send('Page.navigate', { url: WEB + '/' })
  await wait(800)
  await ev(`(()=>{localStorage.setItem('helsa.lang','${lang}');localStorage.setItem('helsa.theme','light');return 1})()`)
  await send('Page.navigate', { url: WEB + path })
  await wait(2500)
  for (const step of steps) {
    if (step.startsWith('type:')) {
      const [sel, val] = step.slice(5).split('=')
      await ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(val)});
        el.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`)
    } else {
      const r = await ev(`(()=>{const els=[...document.querySelectorAll('button,a,[role=button],summary,label')]
        .filter(b=>b.offsetParent!==null&&b.textContent.trim().includes(${JSON.stringify(step)}));
        const b=els[els.length-1];if(!b)return 'missing';b.click();return 'ok'})()`)
      if (r !== 'ok') console.error(`${file}: no "${step}" to click`)
    }
    await wait(1200)
  }
  // The whole page, open dialogs included, capped so a runaway page cannot hang the capture.
  const h = await ev('Math.max(document.documentElement.scrollHeight, ...[...document.querySelectorAll("dialog[open]")].map(d=>d.scrollHeight))')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: Math.max(900, Math.min(h || 900, 4000)), deviceScaleFactor: 1, mobile: false })
  await wait(500)
  const png = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(out, file), Buffer.from(png.data, 'base64'))
  await send('Target.closeTarget', { targetId: target.id }).catch(() => {})
  ws.close()
  console.log(file)
}

// The set the review prompt describes by number — keep the names in step with it.
const hu = [
  ['none', '/login', 'hu-01-login.png'],
  ['none', '/login', 'hu-02-login-wrong-code.png', ['type:.code-input=ZZZZ-ZZZZ', 'Belépés']],
  ['none', '/login', 'hu-03-login-rate-limited.png', ['type:.code-input=YYYY-YYYY', 'Belépés']],
  ['nori', '/account', 'hu-04-account-member.png'],
  ['nori', '/account', 'hu-05-account-phone-code.png', ['Új telefon csatlakoztatása']],
  ['nori', '/account', 'hu-06-account-web-code.png', ['Belépés egy másik böngészőben']],
  ['nori', '/account', 'hu-06b-account-code-revoked.png', ['Belépés egy másik böngészőben', 'Kód visszavonása']],
  ['nori', '/account', 'hu-07-account-delete.png', ['Fiókom és adataim törlése…']],
  ['bob', '/account', 'hu-08-account-admin.png'],
  ['bob', '/household', 'hu-09-household.png'],
  ['bob', '/household', 'hu-10-household-new-member.png', ['+ Új tag']],
  ['bob', '/household/u-nori', 'hu-11-member-nori.png'],
  ['bob', '/household/u-nori', 'hu-12-member-disable.png', ['Letiltás']],
  ['bob', '/household/u-nori', 'hu-13-member-delete.png', ['Törlés…']],
  ['bob', '/household/u-panni', 'hu-14-member-new-no-phone.png'],
  ['bob', '/household/u-panni', 'hu-15-member-device-code.png', ['Eszköz csatlakoztatása']],
  ['nori', '/household', 'hu-16-household-as-member.png'],
]
for (const [as, path, file, steps] of hu) await shot('hu', as, path, file, steps)

await knob('/__legacy?on=1')
await shot('hu', 'bob', '/household', 'hu-17-household-old-signin.png')
await shot('hu', 'bob', '/household/u-nori', 'hu-18-member-old-signin-ask.png', ['Régi belépések visszavonása'])
await shot('hu', 'nori', '/account', 'hu-19-account-old-signin.png')
await knob('/__legacy?on=0')

await knob('/__mode?m=dlq')
await shot('hu', 'nori', '/ingest', 'hu-20-ingest-member-set-aside.png')
await knob('/__mode?m=noworker')
await shot('hu', 'nori', '/ingest', 'hu-21-ingest-member-no-worker.png')
await knob('/__mode?m=draining')

const en = [
  ['none', '/login', 'en-01-login.png'],
  ['nori', '/account', 'en-04-account-member.png'],
  ['nori', '/account', 'en-05-account-phone-code.png', ['Connect a new phone']],
  ['bob', '/household', 'en-09-household.png'],
  ['bob', '/household/u-nori', 'en-11-member-nori.png'],
  ['bob', '/household/u-panni', 'en-15-member-device-code.png', ['Connect a device']],
]
for (const [as, path, file, steps] of en) await shot('en', as, path, file, steps)
