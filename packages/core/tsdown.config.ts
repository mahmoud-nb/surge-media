import { defineConfig } from 'tsdown'

// Build de la CLI `surge-media` (bin du package) : les dépendances restent externes.
export default defineConfig({
  entry: { index: 'cli/index.ts' },
  outDir: 'dist/cli',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
})
