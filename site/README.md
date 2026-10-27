# The Helsa site

The public site at <https://helsa.nordic-sys.com> — landing page, the
screenshot tour, the legal pages, and the documentation.

Built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build),
published by `.github/workflows/pages.yml`.

## Running it

```bash
cd site
npm install
npm run dev      # http://localhost:4321/
npm run build    # -> dist/
npm run preview  # serves dist/ exactly as it will be published
```

Node 22.12 or newer.

## How it is put together

Two shells share one set of design tokens — the server web's (`web/src/styles/tokens.css`),
carried over role for role, so the site, the docs and the dashboard look like one product:

| | Owns | Lives in |
|---|---|---|
| **Hand-built pages** | `/`, `/the-app/`, `/privacy/`, `/disclaimer/`, `/support/`, the 404 | `src/pages/`, `src/layouts/`, `src/components/` |
| **Starlight** | `/getting-started/`, `/deployment/`, `/dashboard/`, `/api/`, `/integrations/`, `/troubleshooting/` | `src/content/docs/` |

- `src/styles/tokens.css` is the only place colours, type and spacing are
  defined, light on `:root` and dark as an override. A literal colour anywhere
  else is a bug.
- `src/styles/sl-palette.css` re-points Starlight's colour variables at those
  tokens **by role** (which variable draws links, borders, surfaces), on both
  shells. `src/styles/starlight.css` restyles what a variable cannot reach —
  asides as the dashboard's banners, tables, the header frame.
- Four Starlight components are overridden, in `src/components/starlight/`:
  `Header` (the shared header with Starlight's own search inside), `Sidebar`,
  `PageTitle` (the "step N of 4" bar) and `Pagination`. Each says why at the
  top. Layout, offsets and the mobile menu stay Starlight's.
- One header, `src/components/SiteHeader.astro`, on both shells. The Pagefind
  search trigger is in it on the hand-built pages too; `search-bridge.css`
  supplies the few Starlight variables it needs there.
- Code blocks are Expressive Code frames, dark in both themes; a Getting
  started block's location is its `title="On your computer"` / `"On the
  server"` / `"On the phone"` in the Markdown. ⚠️ After changing the
  `expressiveCode` options, delete `node_modules/.astro` — the content cache
  keeps the old rendering and the pages then link a stylesheet that no longer
  exists.
- Both shells read the theme from one `localStorage` key (`starlight-theme`),
  so switching it on the landing page switches it in the docs.

## Things worth knowing before you change something

**The base path.** The site is served from the root of its own domain, so
`base` is `/` in `astro.config.mjs`. It used to be `/helsa`, back when this was
a project page at `nordic-sys.github.io/helsa/`. Get `base` wrong and the site
builds cleanly while every internal link 404s. Use the `url()` helper in
`src/lib/url.ts` for internal links in `.astro` files — it is what made the
domain move a three-line change.

**The domain.** `helsa.nordic-sys.com` is a CNAME to `nordic-sys.github.io.`
(the user/org domain, no repo path). The record is edited in Plesk, which syncs
it to DigitalOcean; DigitalOcean holds the authoritative nameservers, so
`dig @ns1.digitalocean.com helsa.nordic-sys.com CNAME` is what proves a change
landed rather than a local resolver's cache.

**Old addresses.** The Jekyll site served `page.html`; this one serves `page/`.
`scripts/legacy-redirects.mjs` writes a redirecting file for each old address
into `public/` before every build — those files are generated and gitignored.
The list inside that script is the source of truth. Astro's own `redirects`
option does not work here; the file explains why.

**Whitespace in `.astro` files.** A line ending in a word followed by a line
starting with `<strong>` loses the space between them. Write `{' '}` at the end
of the first line. To catch it:

```bash
grep -rhoE "[a-zA-Z,.]<(strong|code|em|a)[ >]" dist/**/*.html
```

**Screenshots.** The five images named in `SCREENSHOTS.md` are generated
placeholders, not real captures. Overwrite the file in place; nothing else needs
to change.

## Checking a change

`scripts/shot.mjs` takes screenshots over the DevTools Protocol, including
full-page ones and either theme:

```bash
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  --headless=new --disable-gpu --hide-scrollbars \
  --remote-debugging-port=9222 --user-data-dir=/tmp/edge-shot &

node scripts/shot.mjs http://localhost:4321/ /tmp/home.png 1440 dark
node scripts/shot.mjs http://localhost:4321/ /tmp/home-phone.png 390 light
```
