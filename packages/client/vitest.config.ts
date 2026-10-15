import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Tests du client (`pnpm test`) : modules purs et appels HTTP simulés. Les tests de contrat et de
 * recoupement importent des modules purs du core (`#shared`, transform-plan.ts) : le client doit
 * produire exactement ce que le serveur attend.
 */
export default defineConfig({
  resolve: {
    alias: { '#shared': fileURLToPath(new URL('../../apps/core/shared', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
