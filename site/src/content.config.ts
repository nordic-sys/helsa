// Starlight owns the `docs` collection: every Markdown file under
// src/content/docs/ becomes a documentation page with the shared sidebar,
// search and table of contents.
//
// The marketing and legal pages are deliberately NOT in here — they live in
// src/pages/ and get their own layout, because they are read by people who
// have not decided to run anything yet.
import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
