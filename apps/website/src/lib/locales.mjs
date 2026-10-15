/**
 * Languages of the site, shared by astro.config.mjs and the components. English is the root locale
 * (`/`), the others live under `/<code>/`. A page missing in a language falls back to English with a
 * notice, so a translation never blocks a release.
 */
export const LOCALES = {
  root: { label: 'English', lang: 'en' },
  fr: { label: 'Français', lang: 'fr' },
};
