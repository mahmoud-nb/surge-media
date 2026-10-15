import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * Build de la bibliothèque (mode bibliothèque de Vite) : un module ESM (Vue et le client restent
 * externes, dédoublonnés chez l'application) et une feuille de style facultative `dist/style.css`
 * (thème et styles des composants, dans `@layer surge-media`). Non minifié : l'application minifie.
 */
export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'es2022',
    minify: false,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/entry.ts',
      formats: ['es'],
      fileName: () => 'index.mjs',
      cssFileName: 'style',
    },
    rollupOptions: {
      external: ['vue', '@surge-media/client'],
    },
  },
})
