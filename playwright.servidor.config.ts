import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas funcionales de la cuenta del servidor escolar (Fase 8B) con un servidor REAL
 * y una base PostgreSQL de prueba que se crea y se borra (requiere PRUEBAS_POSTGRES_URL).
 */
const PUERTO_APP = 4174;
const PUERTO_API = 8788;
export default defineConfig({
  testDir: 'tests/e2e-servidor',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PUERTO_APP}`, trace: 'retain-on-failure' },
  projects: [{ name: 'movil', use: { ...devices['Pixel 7'] } }],
  webServer: [
    {
      command: `npm run servidor:compilar && node dist-servidor/servidorPruebas.mjs`,
      env: { PUERTO_PRUEBAS: String(PUERTO_API), URL_PUBLICA_PRUEBAS: `http://localhost:${PUERTO_APP}` },
      url: `http://127.0.0.1:${PUERTO_API}/api/salud`,
      reuseExistingServer: false,
      timeout: 60_000,
      // Señal ordenada para que el servidor borre su base de prueba al terminar.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
    {
      command: `npm run build && npx vite preview --port ${PUERTO_APP} --strictPort`,
      env: { SERVIDOR_API: `http://127.0.0.1:${PUERTO_API}` },
      url: `http://localhost:${PUERTO_APP}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
