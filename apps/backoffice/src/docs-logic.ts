/**
 * The system documentation in the back office: the pages in docs/ on business
 * processes and rules, functions and decisions, read at build time, split into
 * sections, and searched in the browser. Pure, so it is tested without a
 * browser. The docs are Swedish whatever the interface's language.
 */

export type DocSection = 'processer' | 'funktion' | 'adr';

export const DOC_SECTIONS: DocSection[] = ['processer', 'funktion', 'adr'];

export interface DocPage {
  section: DocSection;
  /** The file name without .md, e.g. premier. README is the section's start page. */
  slug: string;
  title: string;
  markdown: string;
}

export interface DocPart {
  heading: string;
  /** The heading's anchor, as the docs site makes it. */
  anchor: string;
  level: number;
  text: string;
}

export interface DocHit {
  page: DocPage;
  part: DocPart;
  snippet: string;
  score: number;
}

/** The pages from files keyed by path, e.g. '../../../docs/funktion/premier.md'. Sorted: README first, then by title. */
export function pagesFrom(files: Record<string, string>): DocPage[] {
  const out: DocPage[] = [];
  for (const [path, markdown] of Object.entries(files)) {
    const m = /docs\/(processer|funktion|adr)\/([^/]+)\.md$/.exec(path);
    // 0000 is the template for a new decision, not a decision.
    if (!m || m[2]!.startsWith('0000')) continue;
    const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? m[2]!;
    out.push({ section: m[1] as DocSection, slug: m[2]!, title, markdown });
  }
  return out.sort((a, b) => DOC_SECTIONS.indexOf(a.section) - DOC_SECTIONS.indexOf(b.section) || (a.slug === 'README' ? -1 : b.slug === 'README' ? 1 : a.slug.localeCompare(b.slug, 'sv')));
}

/** A heading's anchor, the same as the docs site's (scripts/build-site.ts). */
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** The page split at its headings (#, ## and ###), the text without Markdown's marks. */
export function partsOf(page: DocPage): DocPart[] {
  const parts: DocPart[] = [];
  let cur: DocPart = { heading: page.title, anchor: '', level: 1, text: '' };
  let inCode = false;
  for (const line of page.markdown.split('\n')) {
    if (line.startsWith('```')) inCode = !inCode;
    const h = !inCode && /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      // The page's title starts the first part, which has no anchor.
      if (h[1] === '#' && parts.length === 0 && !cur.text.trim()) continue;
      parts.push(cur);
      cur = { heading: plain(h[2]!), anchor: slugify(h[2]!), level: h[1]!.length, text: '' };
      continue;
    }
    cur.text += `${plain(line)}\n`;
  }
  parts.push(cur);
  return parts.filter((p, i) => i === 0 || p.text.trim() || p.level > 1);
}

/** Text without links, emphasis and table pipes. */
function plain(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\|/g, ' ')
    .replace(/^\s*[-:]{3,}\s*$/g, '');
}

/**
 * The parts where every word of the query is found, best first: a word in the
 * page's title counts most, then in the heading and at the start of a line,
 * then each time in the text. A rule id like PREM-03 is a word, and the row
 * that defines it ranks above one that refers to it. Pure.
 */
export function search(pages: readonly DocPage[], query: string, limit = 30): DocHit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (!terms.length) return [];
  const hits: DocHit[] = [];
  for (const page of pages) {
    for (const part of partsOf(page)) {
      const title = page.title.toLowerCase();
      const heading = part.heading.toLowerCase();
      const text = part.text.toLowerCase();
      if (!terms.every((t) => title.includes(t) || heading.includes(t) || text.includes(t))) continue;
      let score = 0;
      for (const t of terms) score += (title.includes(t) ? 10 : 0) + (heading.includes(t) ? 5 : 0) + count(text, t) + (startsLine(text, t) ? 5 : 0);
      hits.push({ page, part, snippet: snippet(part.text, terms), score });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title, 'sv')).slice(0, limit);
}

/** A line that starts with the word, like the table row where a rule id is defined, not where it is referred to. */
function startsLine(text: string, term: string): boolean {
  return text.split('\n').some((l) => l.trimStart().startsWith(term));
}

function count(text: string, term: string): number {
  let n = 0;
  for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + term.length)) n++;
  return n;
}

/** About 180 characters of the text around the first word found, on one line. */
export function snippet(text: string, terms: readonly string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const at = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0), flat.length);
  const from = Math.max(0, at - 60);
  const out = flat.slice(from, from + 180);
  return `${from > 0 ? '…' : ''}${out}${from + 180 < flat.length ? '…' : ''}`;
}

/**
 * Links between the pages lead within the documentation; a link to a page
 * outside it (technical docs, the build log) keeps only its text. Pure.
 */
export function rewriteLinks(markdown: string, page: DocPage, known: ReadonlySet<string>): string {
  return markdown.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (all, bang: string, text: string, href: string) => {
    if (bang || /^[a-z]+:/i.test(href) || href.startsWith('#')) return all;
    const [path, anchor] = href.split('#') as [string, string | undefined];
    const m = /^(?:\.\.\/(processer|funktion|adr)\/)?([^/]+)\.md$/.exec(path);
    if (!m) return text;
    const section = (m[1] ?? page.section) as DocSection;
    const key = `${section}/${m[2]}`;
    if (!known.has(key)) return text;
    return `[${text}](/docs/${key}${anchor ? `#${anchor}` : ''})`;
  });
}
