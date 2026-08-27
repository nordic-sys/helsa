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

Two shells share one set of design tokens:

| | Owns | Lives in |
|---|---|---|
| **Hand-built pages** | `/`, `/the-app/`, `/privacy/`, `/disclaimer/`, `/support/` | `src/pages/`, `src/layouts/`, `src/components/` |
| **Starlight** | `/getting-started/`, `/deployment/`, `/api/`, `/integrations/` | `src/content/docs/` |

- `src/styles/tokens.css` is the only place colours, type and spacing are
  defined. A literal colour anywhere else is a bug.
- `src/styles/starlight.css` re-points Starlight's own variables at those
  tokens. It does not restyle the theme's components, so the theme stays
  upgradable.
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
