/**
 * surgeMedia brand assets: the pictogram (wave and dot in a rounded square) and the monoline wordmark.
 * The wordmark is pure geometry (circles, ellipses, lines; one stroke width, round ends, the same
 * stroke as the pictogram's wave): no font is needed to draw or display it. Its M is the wave and
 * the dot of the i is the wave's dot.
 *
 *   pnpm --filter @surge-media/website brand
 *
 * Writes public/brand/ (logo = pictogram + wordmark, wordmark alone, pictogram alone; light, dark and
 * monochrome `currentColor` versions) and src/assets/logo-{light,dark}.svg (Starlight header).
 * The admin component (apps/core/app/components/app/Logo.vue) and scripts/og-image.svg embed the
 * same path data: after a change here, copy it from public/brand/surgemedia-logo-light.svg.
 *
 * Units: font size 100 (x-height 54.6, cap height 72.75), y pointing down, baseline at y = 0.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const XH = 54.6;
const CAP = 72.75;
const SW = 9; // stroke width of the letters
const O = SW / 2;
const T = -(XH - O); // x-height, stroke centre
const B = -O; // baseline, stroke centre
const CAPC = -(CAP - O); // cap height and ascender, stroke centre
const MID = (T + B) / 2;
const R = (B - T) / 2; // bowl radius (a, d, e, g)
const GAP = 7.5; // space between letters, before optical adjustments

const r2 = (n) => Math.round(n * 100) / 100;
const rad = (d) => (d * Math.PI) / 180;

/** Elliptical arc from angle a0 to a1, in degrees (y down: increasing angle = clockwise on screen). */
function arc(cx, cy, rx, ry, a0, a1, move = true) {
  const p = (a) => [r2(cx + rx * Math.cos(rad(a))), r2(cy + ry * Math.sin(rad(a)))];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `${move ? `M${x0} ${y0}` : ''}A${r2(rx)} ${r2(ry)} 0 ${large} ${sweep} ${x1} ${y1}`;
}
const circle = (cx, cy, r) =>
  `M${r2(cx - r)} ${r2(cy)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0`;

/** The M as a wave: two stems, two round crests at cap height, a smooth trough between them. */
function waveM(ox, { width = 78, valley = 30, crestR = 13 } = {}) {
  const x0 = ox + O;
  const x1 = ox + width - O;
  const mid = (x0 + x1) / 2;
  const top = CAPC;
  const k = 0.5523 * crestR;
  const kk = (mid - (x0 + crestR)) * 0.48;
  const v = -valley;
  return [
    `M${r2(x0)} ${r2(B)}V${r2(top + crestR)}`,
    `C${r2(x0)} ${r2(top + crestR - k)} ${r2(x0 + crestR - k)} ${r2(top)} ${r2(x0 + crestR)} ${r2(top)}`,
    `C${r2(x0 + crestR + kk)} ${r2(top)} ${r2(mid - kk)} ${r2(v)} ${r2(mid)} ${r2(v)}`,
    `C${r2(mid + kk)} ${r2(v)} ${r2(x1 - crestR - kk)} ${r2(top)} ${r2(x1 - crestR)} ${r2(top)}`,
    `C${r2(x1 - crestR + k)} ${r2(top)} ${r2(x1)} ${r2(top + crestR - k)} ${r2(x1)} ${r2(top + crestR)}`,
    `V${r2(B)}`,
  ].join('');
}

/** Each glyph: (left edge) => { d, w } (w = outer width), plus `dot` for the i. */
const GLYPHS = {
  s: (ox) => {
    const rx = 15.5;
    const ry = (B - T) / 4;
    const cx = ox + O + rx;
    return { d: arc(cx, T + ry, rx, ry, -28, -270) + arc(cx, B - ry, rx, ry, -90, 152, false), w: 2 * rx + SW };
  },
  u: (ox) => {
    const xl = ox + O;
    const xr = xl + 2 * R;
    return { d: `M${r2(xl)} ${r2(T)}V${r2(MID)}${arc(xl + R, MID, R, R, 180, 0, false)}M${r2(xr)} ${r2(T)}V${r2(B)}`, w: 2 * R + SW };
  },
  r: (ox) => {
    const xl = ox + O;
    const rr = 17;
    return { d: `M${r2(xl)} ${r2(B)}V${r2(T)}M${r2(xl)} ${r2(T + rr)}${arc(xl + rr, T + rr, rr, rr, 180, 270, false)}h3`, w: rr + 3 + SW };
  },
  g: (ox) => {
    const cx = ox + O + R;
    const xr = cx + R;
    const hookY = B + 4;
    return { d: `${circle(cx, MID, R)}M${r2(xr)} ${r2(T)}V${r2(hookY)}${arc(cx, hookY, R, 15, 0, 155, false)}`, w: 2 * R + SW };
  },
  e: (ox) => {
    const cx = ox + O + R;
    return { d: `M${r2(cx - R)} ${r2(MID)}H${r2(cx + R)}${arc(cx, MID, R, R, 0, -318, false)}`, w: 2 * R + SW };
  },
  M: (ox) => ({ d: waveM(ox), w: 78 }),
  d: (ox) => {
    const cx = ox + O + R;
    return { d: `${circle(cx, MID, R)}M${r2(cx + R)} ${r2(CAPC)}V${r2(B)}`, w: 2 * R + SW };
  },
  i: (ox) => ({ d: `M${r2(ox + O)} ${r2(T)}V${r2(B)}`, w: SW, dot: [ox + O, T - 15.5] }),
  a: (ox) => {
    const cx = ox + O + R;
    return { d: `${circle(cx, MID, R)}M${r2(cx + R)} ${r2(T)}V${r2(B)}`, w: 2 * R + SW };
  },
};
/** Optical spacing: [before, after] each letter, added to GAP. */
const SPACING = { s: [0, 0], u: [0, 0], r: [0, -3], g: [-1, 0], e: [-1, -1], M: [3, 3], d: [-1, 0], i: [0, 0], a: [-1, 0] };

/** The wordmark: `surge` and `Media` as two stroked paths, plus the dot of the i. */
export function wordmark() {
  let x = 0;
  let surge = '';
  let media = '';
  let dot = null;
  [...'surgeMedia'].forEach((ch, index) => {
    x += SPACING[ch][0];
    const glyph = GLYPHS[ch](x);
    if (index < 5) surge += glyph.d;
    else media += glyph.d;
    if (glyph.dot) dot = glyph.dot;
    x += glyph.w + SPACING[ch][1] + GAP;
  });
  const dotR = SW * 0.85; // same ratio as the pictogram (dot r 2.2, stroke 2.6)
  return {
    surge,
    media,
    dot: { cx: r2(dot[0]), cy: r2(dot[1]), r: r2(dotR) },
    width: r2(x - GAP),
    top: r2(Math.min(-CAP, dot[1] - dotR)),
    bottom: r2(B + 4 + 15 + O), // descender of the g
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
  const stroke = `fill="none" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"`;
  return `<path d="${w.surge}" ${stroke} stroke="${t.fg}"/><path d="${w.media}" ${stroke} stroke="${t.primary}"/><circle cx="${w.dot.cx}" cy="${w.dot.cy}" r="${w.dot.r}" fill="${t.accent}"/>`;
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
    files[`../public/brand/surgemedia-logo-${mode}.svg`] = svg(logoBox(w), logoBody(w, t), 'surgeMedia');
    files[`../public/brand/surgemedia-wordmark-${mode}.svg`] = svg(wordBox, wordSvg(w, t), 'surgeMedia');
    files[`../public/brand/surgemedia-icon-${mode}.svg`] = svg([0, 0, 32, 32], iconSvg(t), 'surgeMedia');
  }
  // Starlight header: the full logo replaces the site title (alt text and title stay in the page).
  files['../src/assets/logo-light.svg'] = files['../public/brand/surgemedia-logo-light.svg'];
  files['../src/assets/logo-dark.svg'] = files['../public/brand/surgemedia-logo-dark.svg'];
  for (const [path, content] of Object.entries(files)) writeFileSync(out(path), content);
  console.log(`${Object.keys(files).length} files written (wordmark ${w.width} × ${r2(w.bottom - w.top)} units)`);
}
