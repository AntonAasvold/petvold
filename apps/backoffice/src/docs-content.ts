/**
 * The documentation's pages, read from docs/ when the back office is built, so
 * docs/ stays the one source. Only processes and rules, functions and
 * decisions; the technical docs and the build log are for developers.
 */
import { pagesFrom, type DocPage } from './docs-logic.ts';

const files = {
  ...import.meta.glob<string>('../../../docs/processer/*.md', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../../../docs/funktion/*.md', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../../../docs/adr/*.md', { query: '?raw', import: 'default', eager: true }),
};

export const DOC_PAGES: DocPage[] = pagesFrom(files);
