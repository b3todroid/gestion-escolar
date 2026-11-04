import { defineConfig } from 'vite';

/**
 * Compilación del servidor (Node 22). Se empaqueta con Vite para REUTILIZAR el código de la
 * aplicación (src/services, src/domain, src/validators, src/models) sin copiarlo.
 * Las dependencias de node_modules quedan externas (no se incrustan).
 */
export default defineConfig({
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist-servidor',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        principal: 'servidor/src/principal.ts',
        cli: 'servidor/src/cli.ts',
        servidorPruebas: 'servidor/herramientas/servidorPruebas.ts',
        demo: 'servidor/herramientas/demo.ts',
        piloto: 'servidor/herramientas/piloto.ts',
        servidorPiloto: 'servidor/herramientas/servidorPiloto.ts',
      },
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: 'compartido/[name]-[hash].mjs' },
    },
  },
  define: { __VERSION_APP__: JSON.stringify('servidor') },
});
