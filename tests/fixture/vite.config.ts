import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// Serves tests/fixture: the skin from src/ on a plain <video>, for the Playwright tests.
export default defineConfig({
  root: path('.'),
  resolve: { alias: { '@': path('../../src') } },
  server: { fs: { allow: [path('../..')] } },
});
