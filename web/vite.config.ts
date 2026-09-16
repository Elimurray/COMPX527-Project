import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  /**
   * `amazon-cognito-identity-js` depends on buffer@4.9.2, which references Node's
   * `global`. That identifier does not exist in a browser, so without this the
   * bundle throws "global is not defined" before the app ever renders.
   * `globalThis` is the standard equivalent and is available everywhere we target.
   */
  define: {
    global: 'globalThis',
  },
  // Read .env from the repo root rather than web/, so the whole monorepo shares
  // one env file — the same one `.env.example` documents. Without this, Vite
  // looks only in web/ and silently sees none of the VITE_* values.
  envDir: fileURLToPath(new URL('..', import.meta.url)),
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
