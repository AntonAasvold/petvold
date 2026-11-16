/**
 * Builds the documentation site published on GitHub Pages: every Markdown file
 * in docs/ plus the root README as HTML, and a clickable API page generated from
 * the contract (modules/api/openapi.yaml) with Scalar.
 *
 * Output: _site/ (not committed). Links between Markdown files become links
 * between pages; links to code point at the file on GitHub.
 *
 * Usage: npm run site
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { Marked } from 'marked';
import { parse } from 'yaml';
import { docsPage } from '../modules/api/src/docs.ts';

const OUT = '_site';
const REPO = process.env.GITHUB_REPOSITORY ?? 'AntonAasvold/petvold';
const BRANCH = process.env.GITHUB_REF_NAME ?? 'main';
const SPEC = 'modules/api/openapi.yaml';

interface Page {
  /** Source path, e.g. docs/adr/0024-djurregister.md. */
  src: string;
  /** Output path, e.g. docs/adr/0024-djurregister.html. */
  out: string;
  title: string;
  markdown: string;
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = posix.join(dir, name);
      if (statSync(p).isDirectory()) return markdownFiles(p);
      return p.endsWith('.md') ? [p] : [];
    });
}

const outPath = (src: string) => (src === 'README.md' ? 'index.html' : src.replace(/\.md$/, '.html'));

const pages: Page[] = ['README.md', ...markdownFiles('docs')].map((src) => {
  const markdown = readFileSync(src, 'utf8');
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? posix.basename(src, '.md');
  return { src, out: outPath(src), title, markdown };
});
const bySrc = new Map(pages.map((p) => [p.src, p]));
const apiTitle = (parse(readFileSync(SPEC, 'utf8')) as { info: { title: string } }).info.title;

/** GitHub-style heading ids, so links like #anrop keep working. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Links to a file or heading that does not exist. The build fails on any. */
const broken: string[] = [];
/** The heading ids of a page, as the renderer gives them. */
function headingIds(page: Page): Set<string> {
  const ids = new Set<string>();
  const used = new Map<string, number>();
  for (const m of page.markdown.replace(/```[\s\S]*?```/g, '').matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = slug(new Marked().parseInline(m[1]!.trim(), { async: false }) as string);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    ids.add(n ? `${base}-${n}` : base);
  }
  return ids;
}

/** Rewrites a link found in `from` so it works on the site. */
function rewrite(from: Page, href: string): string {
  if (href.startsWith('#')) {
    if (!headingIds(from).has(decodeURI(href.slice(1)))) broken.push(`${from.src}: ${href}`);
    return href;
  }
  if (/^([a-z]+:|\/\/)/i.test(href)) return href;
  const [path = '', hash] = href.split('#', 2);
  const suffix = hash === undefined ? '' : `#${hash}`;
  let target = posix.normalize(posix.join(posix.dirname(from.src), decodeURI(path)));
  if (target.endsWith('/')) target = target.slice(0, -1);
  if (existsSync(target) && statSync(target).isDirectory() && bySrc.has(posix.join(target, 'README.md'))) {
    target = posix.join(target, 'README.md');
  }
  const page = bySrc.get(target);
  if (page && hash !== undefined && !headingIds(page).has(decodeURI(hash))) broken.push(`${from.src}: ${href}`);
  if (page) return posix.relative(posix.dirname(from.out), page.out) + suffix;
  if (!existsSync(target)) broken.push(`${from.src}: ${href}`);
  return `https://github.com/${REPO}/blob/${BRANCH}/${encodeURI(target)}${suffix}`;
}

function render(page: Page): string {
  const used = new Map<string, number>();
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const base = slug(html);
        const n = used.get(base) ?? 0;
        used.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        return `<h${depth} id="${esc(id)}">${html}</h${depth}>\n`;
      },
    },
    walkTokens(token) {
      if (token.type === 'link' || token.type === 'image') token.href = rewrite(page, token.href);
    },
  });
  return md.parse(page.markdown, { async: false });
}

/** Navigation: the root page, the API page, the top-level docs and one group per folder in docs/. */
function nav(current: Page | null): string {
  const base = current ? posix.dirname(current.out) : 'api';
  const link = (out: string, title: string, active: boolean) =>
    `<a href="${esc(posix.relative(base, out) || '.')}"${active ? ' aria-current="page"' : ''}>${esc(title)}</a>`;
  const top = pages.filter((p) => p.src === 'README.md' || posix.dirname(p.src) === 'docs');
  const folders = [...new Set(pages.map((p) => posix.dirname(p.src)).filter((d) => d.startsWith('docs/')))];
  const groups = folders.map((dir) => {
    const readme = bySrc.get(posix.join(dir, 'README.md'));
    const items = pages.filter((p) => posix.dirname(p.src) === dir && p !== readme);
    const open = current !== null && posix.dirname(current.src) === dir;
    return `<details${open ? ' open' : ''}><summary>${esc(readme?.title ?? posix.basename(dir))}</summary>
${readme ? link(readme.out, readme.title, readme === current) : ''}
${items.map((p) => link(p.out, p.title, p === current)).join('\n')}
</details>`;
  });
  return [
    ...top.map((p) => link(p.out, p.title, p === current)),
    link('api/index.html', apiTitle, current === null),
    ...groups,
  ].join('\n');
}

const CSS = `
:root { --bg: #fbfbfa; --surface: #ffffff; --ink: #1c2329; --muted: #5b6670; --line: #dde2e6; --accent: #1f5f99; --code: #f1f3f5; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #12171c; --surface: #181f26; --ink: #e3e9ee; --muted: #9aa7b2; --line: #2a343e; --accent: #79b0e6; --code: #1f2830; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #12171c; --surface: #181f26; --ink: #e3e9ee; --muted: #9aa7b2; --line: #2a343e; --accent: #79b0e6; --code: #1f2830; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); }
.layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 100vh; }
nav { border-right: 1px solid var(--line); background: var(--surface); padding: 20px 16px; font-size: 14px; display: flex; flex-direction: column; gap: 2px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
nav a { display: block; padding: 4px 8px; border-radius: 6px; text-decoration: none; color: var(--ink); }
nav a:hover { background: var(--code); }
nav a[aria-current="page"] { background: var(--accent); color: var(--surface); }
nav details { margin-top: 10px; }
nav summary { cursor: pointer; font-weight: 600; padding: 4px 8px; color: var(--muted); }
nav details a { padding-left: 18px; }
main { padding: 32px 40px 80px; max-width: 920px; }
h1, h2, h3 { line-height: 1.25; }
code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--code); padding: 1px 4px; border-radius: 4px; }
pre { background: var(--code); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; display: block; overflow-x: auto; margin: 16px 0; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: var(--code); }
blockquote { margin: 0; padding-left: 14px; border-left: 3px solid var(--line); color: var(--muted); }
footer { margin-top: 48px; font-size: 13px; color: var(--muted); }
@media (max-width: 800px) {
  .layout { grid-template-columns: 1fr; }
  nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
  main { padding: 20px 16px 60px; }
}
`;

function shell(page: Page): string {
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(page.title)} · Petvold</title>
<style>${CSS}</style>
</head>
<body>
<div class="layout">
<nav>${nav(page)}</nav>
<main>
${render(page)}
<footer><a href="https://github.com/${REPO}/blob/${BRANCH}/${encodeURI(page.src)}">${esc(page.src)}</a></footer>
</main>
</div>
</body>
</html>
`;
}

rmSync(OUT, { recursive: true, force: true });
for (const page of pages) {
  const file = join(OUT, page.out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, shell(page));
}
mkdirSync(join(OUT, 'api'), { recursive: true });
cpSync(SPEC, join(OUT, 'api', 'openapi.yaml'));
// The events' contract (ADR 0033), next to the API's.
cpSync('modules/api/asyncapi.yaml', join(OUT, 'api', 'asyncapi.yaml'));
writeFileSync(join(OUT, 'api', 'index.html'), docsPage({ specUrl: 'openapi.yaml' }));
writeFileSync(join(OUT, '.nojekyll'), '');

const missing = pages.flatMap((p) =>
  [...render(p).matchAll(/href="([^"#]+)/g)]
    .map((m) => m[1]!)
    .filter((h) => !/^[a-z]+:/i.test(h) && !existsSync(join(OUT, posix.dirname(p.out), h)))
    .map((h) => `${p.src}: ${h}`),
);
if (missing.length) {
  console.error(`Broken links:\n${missing.join('\n')}`);
  process.exit(1);
}
const brokenLinks = [...new Set(broken)];
if (brokenLinks.length) {
  console.error(`Broken links (${brokenLinks.length}):\n${brokenLinks.map((b) => `  ${b}`).join('\n')}`);
  process.exit(1);
}
console.log(`OK – ${pages.length} pages and the API page in ${relative('.', OUT)}/, no broken links`);
