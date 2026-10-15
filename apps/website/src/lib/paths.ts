/**
 * The site is served under a base path on GitHub Pages (`/surge-media/`) and possibly at the root of a
 * custom domain later. Starlight prefixes its own links (sidebar, language picker) but not the links
 * written in frontmatter or in our components: they go through `withBase`.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** `/pricing/` → `/surge-media/pricing/`. External links, anchors and relative links are returned as is. */
export function withBase(href: string): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  if (BASE && (href === BASE || href.startsWith(`${BASE}/`))) return href;
  return `${BASE}${href}`;
}

/** Path of a page in a locale: `localePath('/pricing/', 'fr')` → `/surge-media/fr/pricing/`. */
export function localePath(path: string, locale: string | undefined): string {
  return withBase(locale ? `/${locale}${path}` : path);
}

/** Path of the current page in another locale (`undefined` = root locale, English). */
export function switchLocale(url: URL, from: string | undefined, to: string | undefined): string {
  let path = url.pathname.startsWith(`${BASE}/`) ? url.pathname.slice(BASE.length) : url.pathname;
  if (from && (path === `/${from}/` || path.startsWith(`/${from}/`))) path = path.slice(from.length + 1);
  return localePath(path, to);
}
