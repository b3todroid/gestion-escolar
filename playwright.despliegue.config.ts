import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de DESPLIEGUE (Fase 11) contra la preproducción local en contenedores (no la levanta: ver
 * docs/GUIA_PUBLICACION.md §2). HTTPS con el certificado propio de Caddy (TLS=internal): por eso se
 * aceptan certificados no públicos SÓLO en estas pruebas.
 */
export default defineConfig({
  testDir: 'tests/despliegue',
  workers: 1,
  retries: 0,
  timeout: 5 * 60_000,
  reporter: [['list'], ['json', { outputFile: 'test-results/despliegue-resultados.json' }]],
  use: { trace: 'retain-on-failure', actionTimeout: 20_000, ignoreHTTPSErrors: true, timezoneId: 'America/Mexico_City', locale: 'es-MX' },
  projects: [{ name: 'android', use: { ...devices['Pixel 7'], launchOptions: { args: ['--ignore-certificate-errors'] } } }],
});
