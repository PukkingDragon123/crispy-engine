// Dev server for automated play-tests: no HMR / file watching so concurrent edits don't reload the page.
import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { hmr: false, watch: { ignored: ['**/*'] }, port: 5174, strictPort: true },
});
