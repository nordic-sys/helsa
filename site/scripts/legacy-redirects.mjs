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
 *      which produced the wrong address for as long as this site had a base.
 *
 * Files in public/ are copied verbatim, so writing them there sidesteps both.
 * They are generated rather than committed: the list below is the single source
 * of truth, and public/ is gitignored for these paths.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const BASE = '';  // The site is served from the root of its own domain.
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

// Pages that MOVED inside this site, old path → new path. ⚠️ Unlike the list above these redirect
// the directory URL itself (`/deployment/tls-mtls/`), which is what every existing link uses, and
// they carry the `#anchor` across — sections like "Installing on the phone" are linked by fragment
// from other pages and from outside. A meta refresh drops the fragment, hence the script.
const MOVED = {
  // 2026-10-27: certificates became step 3 of Getting started. Following the docs on a fresh VM,
  // the reader hit "First sync" and had to go looking for a page under Deployment (helsa docs/34).
  'deployment/tls-mtls': 'getting-started/certificates',
};

const moved = (target) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Redirecting…</title>
<link rel="canonical" href="${target}">
<meta name="robots" content="noindex">
<script>location.replace(${JSON.stringify(target)} + location.hash)</script>
<meta http-equiv="refresh" content="0; url=${target}">
</head>
<body>
<p>This page moved to <a href="${target}">${target}</a>.</p>
</body>
</html>
`;

for (const [from, to] of Object.entries(MOVED)) {
  for (const file of [join(PUBLIC_DIR, from, 'index.html'), join(PUBLIC_DIR, `${from}.html`)]) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, moved(`${BASE}/${to}/`), 'utf8');
  }
}

for (const path of PATHS) {
  const file = join(PUBLIC_DIR, `${path}.html`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, page(`${BASE}/${path}/`), 'utf8');
}

console.log(`wrote ${PATHS.length} legacy and ${Object.keys(MOVED).length} moved-page redirects into public/`);
