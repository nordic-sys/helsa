// A workout's pictogram, and the indoor/outdoor mark beside its name.
//
// Line drawings in one stroke weight, so a list of them reads as a column of
// shapes rather than a column of logos. They are decoration: the activity's name
// is always written next to the icon, so each one is `aria-hidden`. The
// indoor/outdoor mark is NOT decoration — it is the only place in a list row that
// says where the session was — so it carries a label of its own.
//
// ⚠️ Unknown types get the generic figure rather than nothing: HealthKit has
// eighty-odd activity types and the server passes any of them through.

type Glyph = string

const RUN = 'M14 4a1.8 1.8 0 1 0 0 .1M9 21l2.5-6.5L14 17v4M7 12l3-3.5 4 1.5 2 3'
const WALK = 'M13 4a1.8 1.8 0 1 0 0 .1M10 21l1.5-6 2.5 2v4M9 11l2-2.5 3 1 1 3'
const HIKE = 'M12 4a1.8 1.8 0 1 0 0 .1M8 21l2.5-7 3 3v4M7.5 11l3-3 3.5 1.5M16 9l2 12'
const BIKE =
  'M5.5 17.5a3.5 3.5 0 1 0 0 .1M18.5 17.5a3.5 3.5 0 1 0 0 .1M5.5 17.5L10 9h5l3.5 8.5M10 9l2.5 8.5'
const LIFT = 'M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10'
const YOGA = 'M12 4a1.8 1.8 0 1 0 0 .1M12 8v6M6 11l6-1 6 1M9 21l3-7 3 7'
const SWIM = 'M15 5a1.8 1.8 0 1 0 0 .1M6 11l4-3 3 3-3 2M3 17c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0'
const ROW = 'M4 18h16M7 15l5-6 5 6M12 9V5'
const HIIT = 'M13 2L5 14h6l-1 8 8-12h-6z'
const ELLIPTICAL = 'M12 4a1.8 1.8 0 1 0 0 .1M8 20l3-8 4 3M6 20h12M10 9l4 1'
const GENERIC = 'M12 4a1.8 1.8 0 1 0 0 .1M12 8v7M8 11h8M9 21l3-6 3 6'

const BY_TYPE: Record<string, Glyph> = {
  running: RUN,
  walking: WALK,
  hiking: HIKE,
  cycling: BIKE,
  swimming: SWIM,
  yoga: YOGA,
  rowing: ROW,
  elliptical: ELLIPTICAL,
  hiit: HIIT,
  highIntensityIntervalTraining: HIIT,
  strength: LIFT,
  strengthTraining: LIFT,
  functionalStrengthTraining: LIFT,
  traditionalStrengthTraining: LIFT,
}

export function ActivityIcon({ type, size = 22 }: { type?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={(type && BY_TYPE[type]) || GENERIC} />
    </svg>
  )
}

const OUTDOOR =
  'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2'
const INDOOR = 'M4 11l8-6 8 6M6 10v9h12v-9'

/** The sun or the roof. Drawn only when HealthKit said which — a missing flag
 * means the recording app never wrote one, not open sky. */
export function PlaceIcon({ indoor, label }: { indoor: boolean; label: string }) {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <path d={indoor ? INDOOR : OUTDOOR} />
    </svg>
  )
}
