import { defineConfig } from 'vite';

export default defineConfig({
  base: '/katta-lab/',
  build: { outDir: 'docs', emptyOutDir: false, assetsDir: 'assets', target: 'es2022' },
  worker: { format: 'es' },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] },
} as never);
