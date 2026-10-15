import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/**
 * Tests des composants (`pnpm test`) : rendu serveur (`vue/server-renderer`) et montage dans happy-dom.
 * Le client est lu depuis ses sources (pas besoin de le construire avant).
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@surge-media/client': fileURLToPath(new URL('../client/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'happy-dom',
  },
})
