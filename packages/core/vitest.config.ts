import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Tests unitaires des modules purs (sans Nuxt, sans base ni stockage) : moteur de rôles et de
 * portées, liens signés, identifiants de projet… Lancer : `pnpm test` (ou `pnpm test --watch`).
 */
export default defineConfig({
  resolve: {
    alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
