import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Política de seguridad de contenido (sólo en la compilación: el servidor de
 * desarrollo necesita estilos en línea y WebSocket para recarga en caliente).
 * La app no carga recursos externos ni envía datos a terceros.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Recursos del OCR local (Tesseract.js): worker, motor WebAssembly (sólo LSTM)
 * e idioma español. Se sirven desde la propia aplicación en `ocr/`; nunca desde
 * un CDN. En desarrollo se sirven desde node_modules; al compilar se copian.
 */
const RECURSOS_OCR: Record<string, string> = {
  'ocr/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'ocr/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'ocr/tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'ocr/tesseract-core-relaxedsimd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'ocr/lang/spa.traineddata.gz': 'node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz',
};
function recursosOcr(): Plugin {
  return {
    name: 'recursos-ocr',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const ruta = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
        const origen = RECURSOS_OCR[ruta];
        if (!origen) { next(); return; }
        res.setHeader('Content-Type', ruta.endsWith('.gz') ? 'application/octet-stream' : 'text/javascript');
        res.end(readFileSync(origen));
      });
    },
    generateBundle() {
      for (const [destino, origen] of Object.entries(RECURSOS_OCR)) this.emitFile({ type: 'asset', fileName: destino, source: readFileSync(origen) });
    },
  };
}

function politicaSeguridad(): Plugin {
  return {
    name: 'politica-seguridad',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}

// Configuración de compilación y PWA.
// El Service Worker precachea todos los recursos de la app (local-first):
// tras la primera carga, la aplicación funciona sin conexión.
const VERSION_APP = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

// Servidor escolar (Fase 8B, opcional): la API se sirve en el MISMO origen (/api) a través
// de este intermediario, para que la sesión viaje en una cookie HttpOnly y la CSP siga en 'self'.
// Si el servidor no está en marcha, la aplicación sigue en modo local.
const SERVIDOR_API = process.env.SERVIDOR_API ?? 'http://127.0.0.1:8787';
const intermediario = { '/api': { target: SERVIDOR_API, changeOrigin: false } };

export default defineConfig({
  define: { __VERSION_APP__: JSON.stringify(VERSION_APP) },
  server: { proxy: intermediario },
  preview: { proxy: intermediario },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  plugins: [
    politicaSeguridad(),
    recursosOcr(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // se registra manualmente en src/pwa.ts
      includeAssets: ['icono.svg'],
      manifest: {
        name: 'Gestión Escolar',
        short_name: 'Escolar',
        description: 'Configuración y gestión escolar local, sin conexión permanente.',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f7f9f8',
        theme_color: '#1f4d3a',
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest,woff2,xlsx}'],
        // El OCR (≈ 6 MB por dispositivo) no se precarga: se descarga la primera vez que se usa
        // y queda guardado para trabajar sin conexión. Sólo archivos de la biblioteca, nunca datos escolares.
        globIgnores: ['ocr/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [{
          urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/ocr\/[\w.-]+(\/[\w.-]+)?$/.test(url.pathname),
          handler: 'CacheFirst',
          options: { cacheName: 'recursos-ocr', expiration: { maxEntries: 8 } },
        }],
        navigateFallback: 'index.html',
        // Las direcciones del servidor (inicio de sesión institucional, API) nunca las responde el Service Worker.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
