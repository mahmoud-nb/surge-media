// @ts-check
/**
 * ESLint (`pnpm lint`) : mêmes règles que le core (@nuxt/eslint-config, style @stylistic : 2 espaces,
 * guillemets simples, sans point-virgule) et mêmes conventions (apps/core/eslint.config.mjs).
 */
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({ features: { stylistic: true } }).append(
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    rules: {
      '@stylistic/max-statements-per-line': ['error', { max: 2 }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
