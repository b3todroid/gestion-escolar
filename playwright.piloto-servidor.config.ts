import { defineConfig, devices } from '@playwright/test';

/**
 * PILOTO MULTIUSUARIO (Fase 10) con un servidor REAL y una base PostgreSQL temporal que contiene
 * ESCUELA DEMO GESTIÓN ESCOLAR (DEMO-001, datos FICTICIOS); se borra al terminar.
 * Cada persona usa un CONTEXTO de navegador distinto (almacenamiento propio): son dispositivos
 * distintos, no pestañas que comparten IndexedDB. Requiere PRUEBAS_POSTGRES_URL.
 */
const PUERTO_APP = 4181;
const PUERTO_API = 8789;
export default defineConfig({
  testDir: 'tests/piloto',
  testMatch: /multiusuario\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 3 * 60_000,
  reporter: [['list'], ['json', { outputFile: 'test-results/piloto-multiusuario-resultados.json' }]],
  use: { baseURL: `http://localhost:${PUERTO_APP}`, trace: 'retain-on-failure', actionTimeout: 20_000, timezoneId: 'America/Mexico_City', locale: 'es-MX' },
  projects: [{ name: 'android', use: { ...devices['Pixel 7'] } }],
  webServer: [
    {
      command: 'npm run servidor:compilar && node dist-servidor/servidorPiloto.mjs',
      env: { PUERTO_PRUEBAS: String(PUERTO_API), URL_PUBLICA_PRUEBAS: `http://localhost:${PUERTO_APP}` },
      url: `http://127.0.0.1:${PUERTO_API}/api/salud`,
      reuseExistingServer: false,
      timeout: 120_000,
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
