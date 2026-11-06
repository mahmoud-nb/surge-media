import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

// Build de la CLI `surge-media` (bin du package) : les dépendances restent externes. `#shared` : alias de Nuxt,
// utilisé par le code du serveur que la CLI reprend (vérification de licence de `surge-media diagnose`).
export default defineConfig({
  entry: { index: 'cli/index.ts' },
  outDir: 'dist/cli',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) },
})
