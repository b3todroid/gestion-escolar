import { defineConfig } from 'vitest/config';

// Pruebas del servidor con PostgreSQL real (ver servidor/pruebas/entorno.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['servidor/pruebas/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
