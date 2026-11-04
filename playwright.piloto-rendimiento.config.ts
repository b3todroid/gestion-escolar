import { defineConfig, devices } from '@playwright/test';

// Rendimiento del piloto (Fase 10): DEMO-001 en varias escalas (PILOTO_ESCALAS=0.1,0.5,1).
// «android-lento» = Pixel 7 EMULADO con la CPU 4× más lenta (no es un teléfono físico).
export default defineConfig({
  testDir: 'tests/piloto',
  testMatch: /rendimiento\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 30 * 60_000,
  use: { baseURL: 'http://localhost:4182', trace: 'off' },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-lento', use: { ...devices['Pixel 7'] } },
  ],
  webServer: { command: 'npm run build && npx vite preview --port 4182 --strictPort', url: 'http://localhost:4182', reuseExistingServer: false, timeout: 120_000 },
});
