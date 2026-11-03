import { defineConfig, devices } from '@playwright/test';

// Mediciones de rendimiento con datos ficticios de volumen (Fase 9). No corre con `npm run test:e2e`.
export default defineConfig({
  testDir: 'tests/rendimiento',
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 30 * 60_000,
  use: { baseURL: 'http://localhost:4175', trace: 'off' },
  projects: [{ name: 'escritorio', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run build && npx vite preview --port 4175 --strictPort', url: 'http://localhost:4175', reuseExistingServer: false, timeout: 120_000 },
});
