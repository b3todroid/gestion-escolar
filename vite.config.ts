import { defineConfig, type Plugin } from 'vite';
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
export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  plugins: [
    politicaSeguridad(),
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
        background_color: '#f7f7f4',
        theme_color: '#1d4e89',
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
