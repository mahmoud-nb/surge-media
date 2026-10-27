/**
 * FAQ (`/faq/`): one Markdown file per question and per language in `src/content/faq/<lang>/<theme>/<slug>.md`.
 * The theme comes from the folder and the order from the frontmatter; the same file name in every language
 * gives the question the same anchor (`#security-sso-mfa`), so a shared link works in any language. A
 * question missing in a language is shown in English, as Starlight does for whole pages.
 */

/** Themes, in the order of the page. Their titles and descriptions are props of the FAQ page (MDX). */
export const FAQ_THEMES = ['start', 'architecture', 'developers', 'security', 'operations', 'compliance', 'licensing'] as const;
export type FaqTheme = (typeof FAQ_THEMES)[number];

/** State of the feature a question is about, shown as a badge; informational questions have none. */
export const FAQ_STATUSES = ['available', 'partial', 'planned'] as const;
export type FaqStatus = (typeof FAQ_STATUSES)[number];

/** Language of the default locale, which has no folder prefix in the URLs (`root`). */
export const FAQ_DEFAULT_LANG = 'en';

export interface FaqEntryLike {
  id: string;
  body?: string;
  data: { question: string; order: number; status?: FaqStatus; keywords: string[] };
}

export interface FaqQuestion<E extends FaqEntryLike> {
  entry: E;
  theme: FaqTheme;
  /** Anchor of the question, the same in every language: `<theme>-<slug>`. */
  anchor: string;
  /** Shown in the default language because the page's language has no translation yet. */
  fallback: boolean;
}

/** `fr/security/sso-mfa` → `{ lang: 'fr', theme: 'security', slug: 'sso-mfa' }`. */
function parseId(id: string): { lang: string; theme: FaqTheme; slug: string } | null {
  const [lang, theme, ...rest] = id.split('/');
  if (!lang || !theme || rest.length === 0 || !(FAQ_THEMES as readonly string[]).includes(theme)) return null;
  return { lang, theme: theme as FaqTheme, slug: rest.join('-') };
}

/**
 * Questions of a language, grouped by theme and sorted by `order`: the translation when it exists,
 * otherwise the default language. Prints the questions missing in a language during the build.
 */
export function faqQuestions<E extends FaqEntryLike>(entries: E[], lang: string): Map<FaqTheme, FaqQuestion<E>[]> {
  const byKey = new Map<string, { [lang: string]: E }>();
  for (const entry of entries) {
    const parsed = parseId(entry.id);
    if (!parsed) {
      console.warn(`[faq] ${entry.id}: expected src/content/faq/<lang>/<theme>/<slug>.md with a known theme`);
      continue;
    }
    const key = `${parsed.theme}/${parsed.slug}`;
    byKey.set(key, { ...byKey.get(key), [parsed.lang]: entry });
  }

  const groups = new Map<FaqTheme, FaqQuestion<E>[]>(FAQ_THEMES.map((theme) => [theme, []]));
  const missing: string[] = [];
  for (const [key, versions] of byKey) {
    const entry = versions[lang] ?? versions[FAQ_DEFAULT_LANG];
    if (!entry) continue;
    if (!versions[lang]) missing.push(key);
    const [theme, slug] = key.split('/') as [FaqTheme, string];
    groups.get(theme)!.push({ entry, theme, anchor: `${theme}-${slug}`, fallback: !versions[lang] });
  }
  if (missing.length > 0) console.warn(`[faq] not translated in "${lang}" (shown in English): ${missing.join(', ')}`);
  for (const questions of groups.values()) questions.sort((a, b) => a.entry.data.order - b.entry.data.order);
  return groups;
}

/** Markdown reduced to plain text, for the structured data and the search index. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Search form of a text: lower case, without accents (`Éléphant` → `elephant`). Same rule in the browser. */
export function searchText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
