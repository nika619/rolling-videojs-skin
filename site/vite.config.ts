import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// The entry pages: `/` plays Kīlauea 2026 in walnut. The workbench builds into dist/workbench after this.
export default defineConfig({
  root: path('.'),
  base: './',
  resolve: { alias: { '@': path('../src') } },
  server: { fs: { allow: [path('..')] } },
  build: {
    outDir: path('../dist'),
    emptyOutDir: true,
    rolldownOptions: { input: { index: path('./index.html') } },
  },
});
