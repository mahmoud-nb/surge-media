import { defineConfig } from 'tsdown'

// Build du client : ESM seul, types, aucune dépendance d'exécution (navigateur, Node, edge). Deux entrées :
// le client (`.`) et l'aide côté serveur (`./server`, clé secrète), que l'entrée principale n'importe jamais.
export default defineConfig({
  entry: { index: 'src/index.ts', server: 'src/server.ts' },
  outDir: 'dist',
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  fixedExtension: true,
  dts: true,
  sourcemap: true,
  clean: true,
})
