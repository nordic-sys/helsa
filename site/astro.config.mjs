// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

// ---------------------------------------------------------------------------
// Published on its own domain, so the site sits at the root and `base` is '/'.
//
// It used to be a GitHub Pages *project* page at nordic-sys.github.io/helsa/,
// where every URL carried the repo name as a prefix and `base` was '/helsa'.
// Moving to helsa.nordic-sys.com is what removed that prefix.
//
// ⚠️ If `base` disagrees with how the site is published, it still builds
// cleanly and every internal link 404s. That is the first thing to check when
// the published site renders as unstyled text or every click fails.
//
// The DNS side: a CNAME for `helsa` pointing at `nordic-sys.github.io.` — the
// user/org domain, with no repo path. GitHub finds the repo from the Host
// header. The record is edited in Plesk, which syncs it to DigitalOcean; the
// authoritative nameservers are DigitalOcean's, so `dig @ns1.digitalocean.com`
// is what proves a change landed.
// ---------------------------------------------------------------------------
const site = 'https://helsa.nordic-sys.com';
const base = '/';

// The old `page.html` addresses are kept alive by scripts/legacy-redirects.mjs,
// which runs before every build and writes redirecting files into public/. See
// that file for why Astro's own `redirects` option does not work here.

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  build: {
    // `/privacy/` rather than `/privacy.html`. The old form is preserved by the
    // redirects above rather than by the build format.
    format: 'directory',
  },
  integrations: [
    starlight({
      title: 'Helsa',
      description:
        'Self-hosted backend for the Helsa app. Your Apple Health data, on a server you run. MIT licensed. Not a medical device.',
      logo: {
        src: './src/assets/logo.svg',
        alt: 'Helsa',
        replacesTitle: false,
      },
      favicon: '/favicon.svg',
      // Starlight only renders the documentation sections. The landing page,
      // the screenshot tour and the legal pages are custom routes in src/pages/.
      sidebar: [
        {
          label: 'Getting started',
          items: [{ autogenerate: { directory: 'getting-started' } }],
        },
        {
          label: 'Deployment',
          items: [{ autogenerate: { directory: 'deployment' } }],
        },
        {
          label: 'API',
          items: [{ autogenerate: { directory: 'api' } }],
        },
        {
          label: 'Integrations',
          items: [{ autogenerate: { directory: 'integrations' } }],
        },
        {
          label: 'About',
          items: [
            { label: 'The app', link: '/the-app/' },
            { label: 'Support', link: '/support/' },
            { label: 'Privacy', link: '/privacy/' },
            { label: 'Disclaimer', link: '/disclaimer/' },
          ],
        },
      ],
      social: [
        {
          icon: 'github',
          label: 'Source on GitHub',
          href: 'https://github.com/nordic-sys/helsa',
        },
      ],
      customCss: ['./src/styles/tokens.css', './src/styles/starlight.css'],
      // Nothing on this site is user-generated and nothing is measured, so
      // there is no analytics, no comment widget and no third-party script.
      credits: false,
      editLink: {
        baseUrl: 'https://github.com/nordic-sys/helsa/edit/main/site/',
      },
      lastUpdated: true,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    }),
    sitemap(),
  ],
});
