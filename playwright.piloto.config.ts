import { defineConfig, devices } from '@playwright/test';

/**
 * PILOTO de la Fase 10 (sólo dispositivo) con ESCUELA DEMO GESTIÓN ESCOLAR (DEMO-001, datos FICTICIOS).
 * Origen propio (puerto 4180): el almacenamiento del piloto está separado del de desarrollo (5173)
 * y del de las demás pruebas. Cada prueba empieza con un navegador vacío.
 * Android y tableta: EMULACIÓN de Chromium (no son dispositivos físicos).
 */
const PUERTO = 4180;
export default defineConfig({
  testDir: 'tests/piloto',
  testMatch: /local\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/piloto-resultados.json' }]],
  timeout: 3 * 60_000,
  use: { baseURL: `http://localhost:${PUERTO}`, trace: 'retain-on-failure', actionTimeout: 20_000, timezoneId: 'America/Mexico_City', locale: 'es-MX' },
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'tableta', use: { ...devices['Galaxy Tab S4'] } },
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: { command: `npm run build && npx vite preview --port ${PUERTO} --strictPort`, url: `http://localhost:${PUERTO}`, reuseExistingServer: false, timeout: 120_000 },
});
