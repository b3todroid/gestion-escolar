import { defineConfig, devices } from '@playwright/test';

/**
 * Fase 12 — FLUJO FUNCIONAL contra la PREPRODUCCIÓN local (https://localhost:8443, imágenes de contenedor,
 * Caddy con TLS=internal). Reutiliza SIN CAMBIOS las pruebas funcionales existentes; cada una crea su
 * propia escuela FICTICIA en el navegador (contexto nuevo): no toca DEMO-001 ni ningún registro existente.
 * No levanta servidor: la preproducción debe estar en marcha (docs/CONFIGURACION_PREPRODUCCION.md).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: ['flujo-integral.spec.ts', 'catalogos.spec.ts', 'horarios.spec.ts', 'docente.spec.ts', 'prefectura.spec.ts', 'respaldos.spec.ts'],
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/preproduccion-flujo.json' }]],
  use: { baseURL: process.env.URL_PREPRODUCCION ?? 'https://localhost:8443', ignoreHTTPSErrors: true, trace: 'retain-on-failure' },
  projects: [{ name: 'movil', use: { ...devices['Pixel 7'], launchOptions: { args: ['--ignore-certificate-errors'] } } }],
});
