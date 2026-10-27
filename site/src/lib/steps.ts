/**
 * The four Getting started steps, in order.
 *
 * One list for everything that shows the linear path: the numbers in the
 * docs sidebar, the "step N of 4" bar above those four pages, the numbered
 * prev/next links under them, and the four cards on the landing page.
 *
 * ⚠️ Position only, never completion. The site knows which page is open; it
 * cannot know whether Docker started or a token was issued, so nothing here
 * marks a step "done" — opening Certificates directly must not tick off the
 * two steps before it.
 */
export const STEPS = [
  { n: 1, id: 'getting-started/quick-start', label: 'Quick start', where: 'On the server', blurb: 'Docker, git, the .env file, the stack up.' },
  { n: 2, id: 'getting-started/device-token', label: 'Device token', where: 'On the server', blurb: 'One user, a token per device.' },
  { n: 3, id: 'getting-started/certificates', label: 'Certificates', where: 'On your own computer', blurb: 'A private CA — on your own computer, not the server.' },
  { n: 4, id: 'getting-started/first-sync', label: 'First sync', where: 'On the phone', blurb: 'The phone sends; the queue page shows it land.' },
] as const;

export type Step = (typeof STEPS)[number];

const trim = (s: string) => s.replace(/^\/+|\/+$/g, '').replace(/\/index$/, '');

/** The step a docs entry id (`getting-started/certificates`) or href is, if any. */
export function stepOf(idOrHref: string | undefined): Step | undefined {
  if (!idOrHref) return undefined;
  const key = trim(idOrHref);
  return STEPS.find((s) => s.id === key);
}
