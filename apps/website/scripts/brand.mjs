/**
 * SurgeMedia brand assets: the pictogram (wave and dot in a rounded square) and the wordmark.
 * The wordmark is drawn, not typed: square monospaced letters with rounded outer corners, flat ends and
 * one stroke width (the lettering the owner picked, redrawn as geometry). No font is needed to draw or
 * display it. The dot of the i is the accent colour, like the pictogram's dot.
 *
 *   pnpm --filter @surge-media/website brand
 *
 * Writes public/brand/ (logo = pictogram + wordmark, wordmark alone, pictogram alone; light, dark and
 * monochrome `currentColor` versions) and src/assets/logo-{light,dark}.svg (Starlight header).
 * The admin component (apps/core/app/components/app/Logo.vue) and scripts/og-image.svg embed the
 * same path data: after a change here, copy it from public/brand/surgemedia-logo-light.svg.
 *
 * Units: cap height 72.75, y pointing down, baseline at y = 0.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const CAP = 72.75;
const K = CAP / 27; // the lettering was measured on a 27 px cap height
const XH = 16.5 * K; // x-height
const ASC = 25 * K; // ascender of the d, a little under the cap height
const DESC = 6 * K; // descender of the g
const SW = 8; // stroke width
const O = SW / 2;
const RC = 6.5; // corner radius on the stroke centre (outer ≈ 10.5, inner ≈ 2.5)
const W = 40; // centre-line width of a lowercase letter
const ADV = 24 * K; // monospaced advance
const M_ADV = 27.5 * K; // the M gets a wider cell
const M_W = 52; // centre-line width of the M

const T = -(XH - O); // x-height, stroke centre
const B = -O; // baseline, stroke centre
const C = -(CAP - O); // cap height, stroke centre
const D = DESC - O; // descender, stroke centre
const MID = (T + B) / 2;
const XT = -XH; // x-height, outer edge (flat stem tops)

const r2 = (n) => Math.round(n * 100) / 100;

/** Polyline through `pts` (shifted by ox), with corners rounded to radius `rc` on the stroke centre. */
function poly(ox, pts, rc = RC) {
  const p = pts.map(([x, y]) => [x + ox, y]);
  let d = `M${r2(p[0][0])} ${r2(p[0][1])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [px, py] = p[i - 1];
    const [cx, cy] = p[i];
    const [nx, ny] = p[i + 1];
    const l1 = Math.hypot(cx - px, cy - py);
    const l2 = Math.hypot(nx - cx, ny - cy);
    const u1 = [(cx - px) / l1, (cy - py) / l1];
    const u2 = [(nx - cx) / l2, (ny - cy) / l2];
    const turn = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
    if (turn < 1e-6) {
      d += `L${r2(cx)} ${r2(cy)}`;
      continue;
    }
    const t = Math.min(rc * Math.tan(turn / 2), l1 * (i === 1 ? 1 : 0.5), l2 * (i === p.length - 2 ? 1 : 0.5));
    const r = t / Math.tan(turn / 2);
    const sweep = u1[0] * u2[1] - u1[1] * u2[0] > 0 ? 1 : 0;
    d += `L${r2(cx - u1[0] * t)} ${r2(cy - u1[1] * t)}A${r2(r)} ${r2(r)} 0 0 ${sweep} ${r2(cx + u2[0] * t)} ${r2(cy + u2[1] * t)}`;
  }
  const [lx, ly] = p[p.length - 1];
  return `${d}L${r2(lx)} ${r2(ly)}`;
}

/** Each glyph: (left edge of its centre line) => { d, w } (w = centre-line width), plus `dot` for the i. */
const GLYPHS = {
  // Capital S: its middle bar sits above the centre (smaller upper half), as on the mock-up.
  S: (x) => ({ d: poly(x, [[W, -20 * K], [W, C], [0, C], [0, -15.5 * K], [W, -15.5 * K], [W, B], [0, B], [0, -7.5 * K]]), w: W }),
  u: (x) => ({ d: poly(x, [[0, XT], [0, B], [W, B]]) + poly(x, [[W, XT], [W, 0]]), w: W }),
  r: (x) => ({ d: poly(x, [[0, 0], [0, T], [W, T], [W, T + 12]]), w: W }),
  g: (x) => {
    const bowl = B - 6.5; // the bowl sits a little above the baseline
    return { d: poly(x, [[W, bowl], [0, bowl], [0, T], [W, T], [W, D], [0, D], [0, D - 10.5]]), w: W };
  },
  e: (x) => ({ d: poly(x, [[W, B - 10], [W, B], [0, B], [0, T], [W, T], [W, MID], [0, MID]]), w: W }),
  M: (x) => ({ d: poly(x, [[0, 0], [0, C], [M_W, C], [M_W, 0]]) + poly(x, [[M_W / 2, C], [M_W / 2, -37.5]]), w: M_W }),
  d: (x) => ({ d: poly(x, [[W, T], [0, T], [0, B], [W, B]]) + poly(x, [[W, -ASC], [W, 0]]), w: W }),
  i: (x) => {
    const stem = W / 2 + 2;
    return {
      d: poly(x, [[stem - 13, T], [stem, T], [stem, B]]) + poly(x, [[stem - 16.5, B], [stem + 16.5, B]]),
      w: W,
      dot: { x: x + stem - O, y: -ASC, w: SW, h: 6 * K },
    };
  },
  a: (x) => ({ d: poly(x, [[W, 0], [W, T], [0, T], [0, B], [18, B], [W, -24.2]]), w: W }),
};

/** The wordmark, monospaced (each letter centred in its cell): `Surge` and `Media` as two stroked paths, plus the dot of the i. */
export function wordmark() {
  const first = (ADV - W) / 2 - O; // space before the first letter's outer edge, trimmed
  let cell = 0;
  let surge = '';
  let media = '';
  let dot = null;
  [...'SurgeMedia'].forEach((ch, index) => {
    const adv = ch === 'M' ? M_ADV : ADV;
    const width = ch === 'M' ? M_W : W;
    const glyph = GLYPHS[ch](cell + (adv - width) / 2 - first);
    if (index < 5) surge += glyph.d;
    else media += glyph.d;
    if (glyph.dot) dot = glyph.dot;
    cell += adv;
  });
  return {
    surge,
    media,
    dot: { x: r2(dot.x), y: r2(dot.y), w: r2(dot.w), h: r2(dot.h) },
    width: r2(cell - 2 * first),
    top: r2(-CAP),
    bottom: r2(DESC),
  };
}

const THEMES = {
  light: { fg: '#111827', primary: '#3b4cc0', accent: '#7a5af5', iconBg: '#3b4cc0', iconFg: '#ffffff' },
  dark: { fg: '#e6e9ef', primary: '#8b9cf7', accent: '#b692f6', iconBg: '#8b9cf7', iconFg: '#0c111b' },
  mono: { fg: 'currentColor', primary: 'currentColor', accent: 'currentColor', iconBg: 'currentColor', iconFg: null },
};

const WAVE = 'M7 19.5c2.2-5.3 4.4-5.3 6.6 0s4.4 5.3 6.6 0 3.3-6 4.8-7.5';
const ICON_H = CAP * 1.62; // pictogram height in the logo
const ICON_Y = -CAP - (ICON_H - CAP) / 2; // centred on the capital letters
const ICON_GAP = CAP * 0.42;

/** The pictogram in a 32 × 32 box. Monochrome: wave and dot are cut out of the square. */
function iconSvg(t) {
  if (t.iconFg)
    return `<rect width="32" height="32" rx="9" fill="${t.iconBg}"/><path d="${WAVE}" fill="none" stroke="${t.iconFg}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="25" cy="10" r="2.2" fill="${t.iconFg}"/>`;
  return `<mask id="sm-cut"><rect width="32" height="32" fill="#fff"/><path d="${WAVE}" fill="none" stroke="#000" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="25" cy="10" r="2.2" fill="#000"/></mask><rect width="32" height="32" rx="9" fill="${t.iconBg}" mask="url(#sm-cut)"/>`;
}

function wordSvg(w, t) {
  const stroke = `fill="none" stroke-width="${SW}" stroke-linecap="butt" stroke-linejoin="round"`;
  return `<path d="${w.surge}" ${stroke} stroke="${t.fg}"/><path d="${w.media}" ${stroke} stroke="${t.primary}"/><rect x="${w.dot.x}" y="${w.dot.y}" width="${w.dot.w}" height="${w.dot.h}" rx="2" fill="${t.accent}"/>`;
}

const svg = (box, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.map(r2).join(' ')}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

export function logoBox(w) {
  const top = Math.min(ICON_Y, w.top);
  const bottom = Math.max(ICON_Y + ICON_H, w.bottom);
  return [0, top, ICON_H + ICON_GAP + w.width, bottom - top];
}

export function logoBody(w, t) {
  const k = ICON_H / 32;
  return `<g transform="translate(0 ${r2(ICON_Y)}) scale(${r2(k)})">${iconSvg(t)}</g><g transform="translate(${r2(ICON_H + ICON_GAP)} 0)">${wordSvg(w, t)}</g>`;
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''));
if (isMain) {
  const w = wordmark();
  const out = (path) => new URL(path, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  mkdirSync(out('../public/brand/'), { recursive: true });
  const wordBox = [-0.5, w.top - 0.5, w.width + 1, w.bottom - w.top + 1];
  const files = {};
  for (const [mode, t] of Object.entries(THEMES)) {
    files[`../public/brand/surgemedia-logo-${mode}.svg`] = svg(logoBox(w), logoBody(w, t), 'SurgeMedia');
    files[`../public/brand/surgemedia-wordmark-${mode}.svg`] = svg(wordBox, wordSvg(w, t), 'SurgeMedia');
    files[`../public/brand/surgemedia-icon-${mode}.svg`] = svg([0, 0, 32, 32], iconSvg(t), 'SurgeMedia');
  }
  // Starlight header: the full logo replaces the site title (alt text and title stay in the page).
  files['../src/assets/logo-light.svg'] = files['../public/brand/surgemedia-logo-light.svg'];
  files['../src/assets/logo-dark.svg'] = files['../public/brand/surgemedia-logo-dark.svg'];
  for (const [path, content] of Object.entries(files)) writeFileSync(out(path), content);
  console.log(`${Object.keys(files).length} files written (wordmark ${w.width} × ${r2(w.bottom - w.top)} units)`);
}
