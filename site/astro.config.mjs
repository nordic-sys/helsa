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
      // The site's own 404 (src/pages/404.astro), in the hand-built shell, so a
      // dead link lands on a page in the same language as the rest of the site.
      disable404Route: true,
      // The docs wear the server web's chrome. Each override says why in its
      // header comment; together they are the whole of what is replaced:
      //  - Header:     the shared site header, with Starlight's own search inside
      //  - Sidebar:    the dashboard's sidebar — headings, a pill, numbered steps
      //  - PageTitle:  "Getting started · step N of 4" above those four pages
      //  - Pagination: previous / next, the next one as the primary action
      components: {
        Header: './src/components/starlight/Header.astro',
        Sidebar: './src/components/starlight/Sidebar.astro',
        PageTitle: './src/components/starlight/PageTitle.astro',
        Pagination: './src/components/starlight/Pagination.astro',
      },
      // Code blocks are an intentionally dark well in both themes, as in the
      // design. One syntax theme, so no colour depends on which theme is on; the
      // frame colours are CSS variables from tokens.css, which is what makes
      // them follow the light/dark switch. A block's location ("On your
      // computer", "On the server", "On the phone") is its `title` in the
      // Markdown — CSS cannot know where a command runs.
      expressiveCode: {
        themes: ['github-dark'],
        useStarlightUiThemeColors: false,
        useStarlightDarkModeSwitch: false,
        styleOverrides: {
          borderRadius: '16px',
          borderWidth: '1px',
          borderColor: 'var(--helsa-code-border)',
          codeBackground: 'var(--helsa-code-bg)',
          codeFontFamily: 'var(--helsa-font-mono)',
          codeFontSize: '14px',
          codeLineHeight: '1.7',
          codePaddingBlock: '16px',
          codePaddingInline: '18px',
          uiFontFamily: 'var(--helsa-font-sans)',
          uiFontSize: '13px',
          frames: {
            frameBoxShadowCssValue: 'none',
            editorBackground: 'var(--helsa-code-bg)',
            editorTabBarBackground: 'var(--helsa-code-bar)',
            editorTabBarBorderColor: 'transparent',
            editorTabBarBorderBottomColor: 'transparent',
            editorActiveTabBackground: 'var(--helsa-code-bar)',
            editorActiveTabForeground: 'var(--helsa-code-bar-fg)',
            editorActiveTabBorderColor: 'transparent',
            editorActiveTabIndicatorTopColor: 'transparent',
            editorActiveTabIndicatorBottomColor: 'transparent',
            terminalBackground: 'var(--helsa-code-bg)',
            terminalTitlebarBackground: 'var(--helsa-code-bar)',
            terminalTitlebarForeground: 'var(--helsa-code-bar-fg)',
            terminalTitlebarBorderBottomColor: 'transparent',
            inlineButtonForeground: '#eef2f5',
            inlineButtonBorder: '#5c6670',
            tooltipSuccessBackground: '#1f7a46',
            tooltipSuccessForeground: '#ffffff',
          },
        },
      },
      // Starlight only renders the documentation sections. The landing page,
      // the screenshot tour and the legal pages are custom routes in src/pages/.
      sidebar: [
        // The product itself, above everything about running it: a reader who arrives
        // in the docs from a search engine otherwise never meets it.
        { label: 'The app', link: '/the-app/' },
        {
          label: 'Getting started',
          items: [{ autogenerate: { directory: 'getting-started' } }],
        },
        // ⚠️ Deployment BEFORE the dashboard, and the order is the reader's rather than
        // the subject's. The dashboard is served by the proxy and the proxy does not
        // start until the certificates exist, so a reader sent from "First sync"
        // straight to the dashboard is shown a thing they cannot yet open. Run it,
        // expose it, then use it.
        {
          label: 'Deployment',
          items: [{ autogenerate: { directory: 'deployment' } }],
        },
        {
          label: 'The web dashboard',
          items: [{ autogenerate: { directory: 'dashboard' } }],
        },
        {
          label: 'API',
          items: [{ autogenerate: { directory: 'api' } }],
        },
        {
          label: 'Integrations',
          items: [{ autogenerate: { directory: 'integrations' } }],
        },
        // A symptom index rather than a section: the explanations stay where they are,
        // and this is the page that knows which one owns a given symptom.
        { label: 'When it does not work', link: '/troubleshooting/' },
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
      customCss: ['./src/styles/tokens.css', './src/styles/sl-palette.css', './src/styles/starlight.css'],
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
