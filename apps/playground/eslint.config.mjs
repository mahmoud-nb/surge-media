// @ts-check
/** ESLint (`pnpm lint`) : mêmes règles que le core et les paquets (@nuxt/eslint-config, style @stylistic). */
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({ features: { stylistic: true } }).append(
  {
    ignores: ['dist/**'],
  },
  {
    rules: {
      'vue/max-attributes-per-line': 'off',
      '@stylistic/max-statements-per-line': ['error', { max: 2 }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
