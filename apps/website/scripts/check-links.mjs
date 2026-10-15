/**
 * Checks the internal links of the built site (`dist/`): every `<a href>` and `src` under the base
 * path must point to an existing file, and every `#anchor` to an existing id. Run after `astro build`,
 * with the same BASE_PATH: `pnpm --filter @surge-media/website check:links`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const base = `${(process.env.BASE_PATH ?? '/surge-media').replace(/\/$/, '')}/`;

const pages = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.html')) pages.push(path);
  }
};
walk(dist);

const ids = new Map();
const idsOf = (file) => {
  if (!ids.has(file)) ids.set(file, new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return ids.get(file);
};
const fileFor = (path) => {
  const relative = decodeURIComponent(path.slice(base.length));
  return [join(dist, relative), join(dist, relative, 'index.html')].find((c) => existsSync(c) && statSync(c).isFile());
};

const problems = [];
let checked = 0;
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const urls = [...html.matchAll(/<a\s[^>]*?href="([^"]+)"|\ssrc="([^"]+)"/g)].map((m) => (m[1] ?? m[2]).replace(/&amp;/g, '&'));
  for (const url of urls) {
    let path = null;
    let hash = null;
    if (url.startsWith('#')) hash = url.slice(1);
    else if (url.startsWith(base)) [path, hash = null] = url.split('#');
    else if (url.startsWith('/') && !url.startsWith('//')) {
      problems.push(`${page}: ${url} (missing base path ${base})`);
      continue;
    } else continue;
    checked++;
    const target = path ? fileFor(path.split('?')[0]) : page;
    if (!target) problems.push(`${page}: ${url} (no such page)`);
    else if (hash && hash !== '_top' && !idsOf(target).has(decodeURIComponent(hash))) problems.push(`${page}: ${url} (no such anchor)`);
  }
}

for (const problem of problems) console.error(`✗ ${problem}`);
console.log(`${pages.length} pages, ${checked} internal links checked, ${problems.length} broken.`);
process.exit(problems.length > 0 ? 1 : 0);
