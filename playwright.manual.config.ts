import { defineConfig, devices } from '@playwright/test';

/**
 * CAPTURAS del manual de uso (docs/manual). No es una prueba de aceptación: recorre la app con datos
 * FICTICIOS y guarda imágenes en manual-capturas/img. Origen propio (puerto 4190).
 *   npx playwright test -c playwright.manual.config.ts   →   node scripts/manual/generar.mjs
 */
const PUERTO = 4190;
export default defineConfig({
  testDir: 'tests/manual',
  testMatch: 'capturas.spec.ts',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PUERTO}`, deviceScaleFactor: 1.5, actionTimeout: 20_000, timezoneId: 'America/Mexico_City', locale: 'es-MX' },
  webServer: { command: `npm run build && npx vite preview --port ${PUERTO} --strictPort`, url: `http://localhost:${PUERTO}`, reuseExistingServer: false, timeout: 180_000 },
});
