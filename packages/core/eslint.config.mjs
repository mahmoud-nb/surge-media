// @ts-check
/**
 * ESLint (`pnpm lint`, `pnpm lint:fix`) : configuration de @nuxt/eslint, générée par `nuxt prepare` dans
 * .nuxt/eslint.config.mjs (règles JavaScript, TypeScript, Vue et Nuxt, style @stylistic réglé dans
 * nuxt.config.ts), complétée ici par les conventions établies du projet.
 */
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    // Fichiers générés ou construits (.nuxt et .output sont déjà ignorés par @nuxt/eslint).
    ignores: ['server/generated/**', 'dist/**', 'data/**', 'coverage/**', 'CHANGELOG.md'],
  },
  {
    rules: {
      // Gabarits Vue : plusieurs attributs par ligne, retour à la ligne quand elle devient longue.
      'vue/max-attributes-per-line': 'off',
      // Rappel d'une ligne (`set: v => { if (!v) x = null }`) et `case X: a = f(); break` admis.
      '@stylistic/max-statements-per-line': ['error', { max: 2 }],
      // `catch {}` : erreur volontairement ignorée (meilleur effort), sans commentaire obligatoire.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['tests/**'],
    rules: {
      // Restauration de process.env après un test.
      '@typescript-eslint/no-dynamic-delete': 'off',
    },
  },
)
