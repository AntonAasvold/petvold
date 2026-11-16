/**
 * Copies the icons the back office uses from @fortawesome/fontawesome-free to
 * public/icons, so <wa-icon> loads them from the app itself and never from a
 * CDN. Runs before dev and build. Font Awesome Free: icons CC BY 4.0, code MIT.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const source = dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
const list = JSON.parse(readFileSync(new URL('../icons.json', import.meta.url), 'utf8'));
const out = new URL('../public/icons/', import.meta.url).pathname;

rmSync(out, { recursive: true, force: true });
let n = 0;
for (const variant of ['solid', 'regular']) {
  mkdirSync(join(out, variant), { recursive: true });
  for (const name of list[variant]) {
    copyFileSync(join(source, 'svgs', variant, `${name}.svg`), join(out, variant, `${name}.svg`));
    n++;
  }
}
copyFileSync(join(source, 'LICENSE.txt'), join(out, 'LICENSE.txt'));
console.log(`Copied ${n} icons to public/icons`);
