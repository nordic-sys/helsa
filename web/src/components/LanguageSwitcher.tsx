// The language switcher.
//
// Two buttons rather than a <select>: with two options a dropdown costs a click
// and tells you less. The current language is carried by `aria-pressed`, so a
// screen reader states it without a separate label.

import { LANGS, useI18n } from '../i18n'

const SHORT: Record<string, string> = { hu: 'HU', en: 'EN' }

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n()

  return (
    <div className="lang-switch" role="group" aria-label={t('lang.aria')}>
      {LANGS.map((l) => (
        <button
          key={l}
          className="seg"
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          title={t(l === 'hu' ? 'lang.hu' : 'lang.en')}
          lang={l}
        >
          {SHORT[l]}
        </button>
      ))}
    </div>
  )
}
