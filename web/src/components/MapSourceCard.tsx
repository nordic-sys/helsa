// The map-source setting: the one place where somebody decides whether a route
// gets a map, and who finds out about it if it does.
//
// # Why the whole thing is three options and a sentence each
//
// Putting a map under a GPS trace is a privacy trade-off, and the trade is not
// ours to make: a tile request tells whoever serves it that somebody is looking
// at that square of the world. A tile server on the reader's own LAN and a
// provider on the open internet are the same feature and completely different
// decisions, so the screen states the consequence of each **before** it is
// picked, and defaults to the one that sends nothing.
//
// ⚠️ **The sentence under "a public source" says the provider sees the request.**
// It is not softened into "may collect some data": a person choosing this is
// entitled to the plain version, and the plain version is short.
//
// # What is deliberately NOT here
//
// * No "recommended" badge and no default address for the private option — we do
//   not know what the reader runs, and guessing would be pretending to.
// * No test button that fetches the URL from the browser. ⛔ That would be the
//   one request in the whole feature that leaves the origin, and it would leave
//   it from the reader's machine — exactly what the proxy exists to prevent.
//   Whether the address works shows up where it matters: on a route.

import { useState } from 'react'
import { Card } from './ui'
import { useI18n, type UiKey } from '../i18n'
import {
  MAP_SOURCE_OFF,
  readMapSource,
  templateProblem,
  writeMapSource,
  type MapSource,
  type MapSourceMode,
  type TileFormat,
} from '../lib/routeMap'

/** The address the "public" option starts from, so the choice is concrete rather
 * than an empty box. OpenStreetMap's own tiles: the reference open-source source,
 * and the one whose terms the note below describes. */
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 11px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  font: 'inherit',
}

/** Which kind of tiles an address serves, guessed from how it ends. A guess is
 * right often enough to save most people a decision, and the select underneath
 * is there for when it is not. */
function guessFormat(url: string): TileFormat {
  return /\.(png|jpe?g|webp|avif)(\?|$)/i.test(url) ? 'raster' : 'vector'
}

export function MapSourceCard() {
  const { t } = useI18n()
  const [source, setSource] = useState<MapSource>(readMapSource)
  const [saved, setSaved] = useState(false)

  const apply = (next: MapSource) => {
    setSource(next)
    writeMapSource(next)
    setSaved(true)
  }

  const choose = (mode: MapSourceMode) => {
    if (mode === 'off') return apply(MAP_SOURCE_OFF)
    // Switching to the public option fills in OpenStreetMap; switching to your
    // own leaves the box empty, because only you know the address.
    const url = mode === 'public' && source.url.trim() === '' ? OSM_TILES : source.url
    apply({ mode, url, format: guessFormat(url) })
  }

  const problem = source.mode === 'off' ? undefined : templateProblem(source.url)
  const problemKey: UiKey | undefined = problem && (`settings.map.problem.${problem}` as UiKey)

  return (
    <Card title={t('settings.map.title')}>
      <p className="subtle" style={{ marginTop: 0 }}>
        {t('settings.map.intro')}
      </p>

      <div className="map-choices">
        {(['off', 'own', 'public'] as const).map((mode) => (
          <label key={mode} className={`map-choice${source.mode === mode ? ' is-chosen' : ''}`}>
            <input
              type="radio"
              name="map-source"
              checked={source.mode === mode}
              onChange={() => choose(mode)}
            />
            <span>
              <strong>{t(`settings.map.${mode}.label` as UiKey)}</strong>
              <span className="subtle">{t(`settings.map.${mode}.note` as UiKey)}</span>
            </span>
          </label>
        ))}
      </div>

      {source.mode !== 'off' && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="map-url" className="subtle">
            {t('settings.map.url.label')}
          </label>
          <input
            id="map-url"
            type="url"
            inputMode="url"
            spellCheck={false}
            value={source.url}
            placeholder={OSM_TILES}
            onChange={(e) => apply({ ...source, url: e.target.value, format: guessFormat(e.target.value) })}
            style={inputStyle}
          />
          <label htmlFor="map-format" className="subtle">
            {t('settings.map.format.label')}
          </label>
          <select
            id="map-format"
            value={source.format}
            onChange={(e) => apply({ ...source, format: e.target.value as TileFormat })}
            style={{ ...inputStyle, width: 'auto' }}
          >
            <option value="raster">{t('settings.map.format.raster')}</option>
            <option value="vector">{t('settings.map.format.vector')}</option>
          </select>
          {problemKey ? (
            <p className="subtle" style={{ margin: 0, color: 'var(--helsa-ember)' }}>
              {t(problemKey)}
            </p>
          ) : (
            <p className="subtle" style={{ margin: 0 }}>
              {t('settings.map.url.ok')}
            </p>
          )}
        </div>
      )}

      {/* ⚠️ The sentence that has to be on this card whatever is chosen: the
          browser's own request list never leaves the Helsa origin, and that is a
          different promise from "nothing leaves". Saying only the first would
          read as the second. */}
      <p className="subtle" style={{ margin: '14px 0 0' }}>
        {t('settings.map.proxyNote')}
      </p>
      {saved && (
        <p className="subtle" style={{ margin: '6px 0 0' }}>
          {t('settings.map.saved')}
        </p>
      )}
    </Card>
  )
}
