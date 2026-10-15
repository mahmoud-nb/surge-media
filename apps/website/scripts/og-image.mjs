/**
 * Renders the social preview image (public/og.png, 1200 × 630) from scripts/og-image.svg.
 * Run after editing the SVG: `pnpm --filter @surge-media/website og-image`. Text uses the fonts
 * installed on the machine (Inter if available, then Segoe UI or Arial).
 */
import sharp from 'sharp';

const source = new URL('./og-image.svg', import.meta.url);
const target = new URL('../public/og.png', import.meta.url);

await sharp(source.pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  .png({ compressionLevel: 9 })
  .toFile(target.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
console.log('public/og.png written');
