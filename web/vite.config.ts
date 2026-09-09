import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the shared package to its TypeScript source rather than its
      // CommonJS build output. Vite compiles it directly, so `npm run dev` picks
      // up edits to shared types immediately without a rebuild, and Rollup can
      // tree-shake it properly at build time.
      '@derf/shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
