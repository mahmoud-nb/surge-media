import { defineConfig } from 'tsdown'

// Build du client : ESM seul, types, aucune dépendance d'exécution (navigateur, Node, edge).
export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  fixedExtension: true,
  dts: true,
  sourcemap: true,
  clean: true,
})
