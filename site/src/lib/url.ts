/**
 * Join a path onto the configured base.
 *
 * The site is published under `/helsa`, so every internal link has to carry
 * that prefix. Astro exposes it as BASE_URL with a trailing slash, and getting
 * this wrong produces a site that builds cleanly and 404s on every click —
 * the exact failure the Jekyll config warned about in its own comments.
 */
export function url(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
