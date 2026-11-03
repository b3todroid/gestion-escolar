import { defineConfig, devices } from '@playwright/test';

// Revisión de interfaz en tres tamaños con la escuela ficticia de volumen (Fase 9). No corre con `npm run test:e2e`.
export default defineConfig({
  testDir: 'tests/ux',
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 30 * 60_000,
  use: { baseURL: 'http://localhost:4176', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run build && npx vite preview --port 4176 --strictPort', url: 'http://localhost:4176', reuseExistingServer: false, timeout: 120_000 },
});
