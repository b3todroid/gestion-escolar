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

export default defineConfig({
  define: { __VERSION_APP__: JSON.stringify(VERSION_APP) },
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
        background_color: '#f7f9f8',
        theme_color: '#1f4d3a',
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2,xlsx}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
