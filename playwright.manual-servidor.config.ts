import { defineConfig } from '@playwright/test';

/**
 * CAPTURAS del manual que dependen del SERVIDOR ESCOLAR, contra la PREPRODUCCIÓN local en contenedores
 * (https://localhost:8443, DEMO-001 ficticia). Antes: deploy/scripts/reiniciar-preproduccion.sh deploy/preproduccion.env
 */
export default defineConfig({
  testDir: 'tests/manual',
  testMatch: 'servidor.spec.ts',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { actionTimeout: 20_000, ignoreHTTPSErrors: true, launchOptions: { args: ['--ignore-certificate-errors'] } },
});
