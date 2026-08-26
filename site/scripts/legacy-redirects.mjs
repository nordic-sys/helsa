/**
 * Writes a redirecting HTML file for every URL the Jekyll site used to serve.
 *
 * Astro's own `redirects` config cannot do this job here, for two reasons found
 * by inspecting its output:
 *
 *   1. With `build.format: 'directory'` it emits `privacy.html/index.html` — a
 *      *directory* named `privacy.html` — so the old address only resolves with
 *      a trailing slash appended, which no existing link has.
 *   2. It prefixes the base onto the redirect's source but not onto its target,
 *      producing `/privacy/` where this site needs `/helsa/privacy/`.
 *
 * Files in public/ are copied verbatim, so writing them there sidesteps both.
 * They are generated rather than committed: the list below is the single source
 * of truth, and public/ is gitignored for these paths.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const BASE = '/helsa';
const PUBLIC_DIR = new URL('../public/', import.meta.url).pathname;

// Every page the Jekyll site published as `<name>.html`. The section index
// pages are absent on purpose: Jekyll served those as `<dir>/` already, which
// is the address Astro produces too, so they never moved.
const PATHS = [
  'disclaimer',
  'privacy',
  'support',
  'the-app',
  'getting-started/quick-start',
  'getting-started/device-token',
  'getting-started/first-sync',
  'api/authentication',
  'api/ingest',
  'api/reading-data',
  'api/insight-vectors',
  'deployment/tls-mtls',
  'deployment/reverse-proxy',
  'deployment/backups',
  'deployment/hardening',
  'integrations/home-assistant',
  'integrations/rest-fallback',
];

const page = (target) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Redirecting…</title>
<link rel="canonical" href="${target}">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${target}">
</head>
<body>
<p>This page moved to <a href="${target}">${target}</a>.</p>
</body>
</html>
`;

for (const path of PATHS) {
  const file = join(PUBLIC_DIR, `${path}.html`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, page(`${BASE}/${path}/`), 'utf8');
}

console.log(`wrote ${PATHS.length} legacy redirects into public/`);
