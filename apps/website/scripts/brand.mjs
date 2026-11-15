/**
 * SurgeMedia brand assets: the pictogram (wave and dot in a rounded square) and the wordmark.
 * The wordmark comes from the owner's artwork in scripts/brand-sources/ (white letters cut out of a black
 * background, one inline and one square version): the background is removed and each word becomes its own
 * evenodd path (letters + counters), so it takes the theme colours ("Surge" = text colour, "Media" = indigo).
 *
 *   pnpm --filter @surge-media/website brand
 *
 * Writes public/brand/ (logo = pictogram + inline wordmark, inline and square wordmarks, pictogram; light,
 * dark and monochrome `currentColor` versions) and src/assets/logo-{light,dark}.svg (Starlight header).
 * The admin component (apps/core/app/components/app/Logo.vue) and scripts/og-image.svg embed the same path
 * data: after a change here, copy it from public/brand/surgemedia-wordmark-light.svg.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const file = (path) => new URL(path, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const r2 = (n) => Math.round(n * 100) / 100;

/** Splits potrace path data (M/m, l, c, z; y up, ×10) into subpaths with absolute starts and a bounding box. */
function subpaths(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+/g);
  const out = [];
  let i = 0;
  let cmd = '';
  let cur = null;
  let pos = [0, 0];
  let lastStart = [0, 0];
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'm') {
      const x = num();
      const y = num();
      const start = cmd === 'M' ? [x, y] : [lastStart[0] + x, lastStart[1] + y];
      pos = [...start];
      cur = { start, body: '', pts: [[...start]] };
      out.push(cur);
      cmd = cmd === 'M' ? 'L' : 'l';
      continue;
    }
    if (cmd === 'z' || cmd === 'Z') {
      cur.body += 'z';
      pos = [...cur.start];
      lastStart = cur.start;
      continue;
    }
    const n = { l: 2, c: 6, L: 2, C: 6 }[cmd];
    const a = Array.from({ length: n }, num);
    cur.body += `${cmd}${a.join(' ')}`;
    const rel = cmd === 'l' || cmd === 'c';
    for (let k = 0; k < n; k += 2) cur.pts.push(rel ? [pos[0] + a[k], pos[1] + a[k + 1]] : [a[k], a[k + 1]]);
    pos = rel ? [pos[0] + a[n - 2], pos[1] + a[n - 1]] : [a[n - 2], a[n - 1]];
  }
  for (const s of out) {
    const xs = s.pts.map((p) => p[0]);
    const ys = s.pts.map((p) => p[1]);
    s.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    s.d = `M${s.start[0]} ${s.start[1]}${s.body}`;
  }
  return out;
}

/**
 * A wordmark from a source SVG: `surge` and `media` path data (source units), the transform that maps them
 * to view units (`inner`), and the tight view box.
 */
function wordmark(source, isMedia) {
  const src = readFileSync(file(source), 'utf8');
  const height = Number(src.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1]);
  const all = [...src.matchAll(/<path d="([^"]+)"/g)].flatMap((m) => subpaths(m[1].replace(/\s+/g, ' ')));
  const shapes = all.filter((s) => !(s.box[0] === 0 && s.box[1] === 0)); // the black background
  const view = (s) => ({ cx: (s.box[0] + s.box[2]) / 20, cy: height - (s.box[1] + s.box[3]) / 20 });
  const surge = shapes.filter((s) => !isMedia(view(s))).map((s) => s.d).join('');
  const media = shapes.filter((s) => isMedia(view(s))).map((s) => s.d).join('');
  const b = [0, 1, 2, 3].map((k) => (k < 2 ? Math.min : Math.max)(...shapes.map((s) => s.box[k])));
  const pad = 2;
  const box = [b[0] / 10 - pad, height - b[3] / 10 - pad, (b[2] - b[0]) / 10 + 2 * pad, (b[3] - b[1]) / 10 + 2 * pad].map(r2);
  return { surge, media, inner: `translate(0 ${height}) scale(0.1 -0.1)`, box };
}

// Inline: "Media" starts at the M; the letters are italic, so the split follows a slanted line.
const INLINE = wordmark('./brand-sources/surgemedia-inline.svg', ({ cx, cy }) => cx > 465.6 - 0.21 * cy);
// Square: "Surge" on the first line, "Media" on the second.
const SQUARE = wordmark('./brand-sources/surgemedia-square.svg', ({ cy }) => cy > 138);

const THEMES = {
  light: { fg: '#111827', primary: '#3b4cc0', iconBg: '#3b4cc0', iconFg: '#ffffff' },
  dark: { fg: '#e6e9ef', primary: '#8b9cf7', iconBg: '#8b9cf7', iconFg: '#0c111b' },
  mono: { fg: 'currentColor', primary: 'currentColor', iconBg: 'currentColor', iconFg: null },
};

const WAVE = 'M7 19.5c2.2-5.3 4.4-5.3 6.6 0s4.4 5.3 6.6 0 3.3-6 4.8-7.5';

/** The pictogram in a 32 × 32 box. Monochrome: wave and dot are cut out of the square. */
function iconSvg(t) {
  if (t.iconFg)
    return `<rect width="32" height="32" rx="9" fill="${t.iconBg}"/><path d="${WAVE}" fill="none" stroke="${t.iconFg}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="27" cy="10" r="2.4" fill="${t.iconFg}"/>`;
  return `<mask id="sm-cut"><rect width="32" height="32" fill="#fff"/><path d="${WAVE}" fill="none" stroke="#000" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="27" cy="10" r="2.4" fill="#000"/></mask><rect width="32" height="32" rx="9" fill="${t.iconBg}" mask="url(#sm-cut)"/>`;
}

function wordSvg(w, t) {
  return `<g transform="${w.inner}" fill-rule="evenodd"><path fill="${t.fg}" d="${w.surge}"/><path fill="${t.primary}" d="${w.media}"/></g>`;
}

/** Logo: pictogram (32 units) + inline wordmark at 0.85 of its height, centred, 8 units apart. */
const WORD_H = 32 * 0.85;
const GAP = 8;
const scale = WORD_H / INLINE.box[3];
export const LOGO = {
  box: [0, 0, r2(32 + GAP + INLINE.box[2] * scale), 32],
  word: `translate(${r2(32 + GAP - INLINE.box[0] * scale)} ${r2((32 - WORD_H) / 2 - INLINE.box[1] * scale)}) scale(${Math.round(scale * 10000) / 10000})`,
};

const svg = (box, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(' ')}" role="img" aria-label="SurgeMedia"><title>SurgeMedia</title>${body}</svg>\n`;

const isMain = process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''));
if (isMain) {
  mkdirSync(file('../public/brand/'), { recursive: true });
  const files = {};
  for (const [mode, t] of Object.entries(THEMES)) {
    files[`../public/brand/surgemedia-logo-${mode}.svg`] = svg(LOGO.box, `${iconSvg(t)}<g transform="${LOGO.word}">${wordSvg(INLINE, t)}</g>`);
    files[`../public/brand/surgemedia-wordmark-${mode}.svg`] = svg(INLINE.box, wordSvg(INLINE, t));
    files[`../public/brand/surgemedia-wordmark-square-${mode}.svg`] = svg(SQUARE.box, wordSvg(SQUARE, t));
    files[`../public/brand/surgemedia-icon-${mode}.svg`] = svg([0, 0, 32, 32], iconSvg(t));
  }
  // Starlight header: the full logo replaces the site title (alt text and title stay in the page).
  files['../src/assets/logo-light.svg'] = files['../public/brand/surgemedia-logo-light.svg'];
  files['../src/assets/logo-dark.svg'] = files['../public/brand/surgemedia-logo-dark.svg'];
  for (const [path, content] of Object.entries(files)) writeFileSync(file(path), content);
  console.log(`${Object.keys(files).length} files written; logo ${LOGO.box.join(' ')}; wordmark transform ${LOGO.word}`);
}
