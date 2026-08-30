/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Frontend-Dev ruft /api → Backend (Port aus VITE_API_TARGET oder 3000)
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Nur Unit-Tests unter src/ — Playwright-E2E (e2e/) laufen über `npm run test:e2e`.
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      // Coverage misst die reine Logik-Schicht (lib/ + feature-Logik in .ts).
      // React-.tsx-Seiten/Komponenten werden über visuelle/E2E-Tests abgedeckt,
      // nicht über sprödes DOM-Snapshotting hier.
      include: ['src/lib/**/*.ts', 'src/features/**/*.ts'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/**/*.d.ts',
      ],
    },
  },
});
