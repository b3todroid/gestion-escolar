// Genera docs/manual/MANUAL_GESTION_ESCOLAR.pdf con las capturas de manual-capturas/img (datos FICTICIOS).
//   npx playwright test -c playwright.manual.config.ts          (capturas locales)
//   deploy/scripts/reiniciar-preproduccion.sh deploy/preproduccion.env && npx playwright test -c playwright.manual-servidor.config.ts
//   node scripts/manual/generar.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SECCIONES } from './contenido.mjs';

const RAIZ = resolve(import.meta.dirname, '../..');
const ORIGEN = resolve(RAIZ, 'manual-capturas/img');
const SALIDA = resolve(RAIZ, 'manual-capturas/pdf');
const PDF = resolve(RAIZ, 'docs/manual/MANUAL_GESTION_ESCOLAR.pdf');
const FUENTES = resolve(RAIZ, 'node_modules/@fontsource/atkinson-hyperlegible-next/files');
mkdirSync(resolve(SALIDA, 'img'), { recursive: true });
mkdirSync(resolve(RAIZ, 'docs/manual'), { recursive: true });

// Las capturas se reducen (ancho máx. 1400 px, JPEG 78) para que el PDF no pese de más.
const usadas = [...SECCIONES.map((s) => s[2]).join('').matchAll(/img\/([\w-]+)\.jpg/g)].map((m) => m[1]);
const faltan = usadas.filter((n) => !existsSync(resolve(ORIGEN, `${n}.jpg`)));
if (faltan.length) { console.error(`Faltan capturas: ${faltan.join(', ')}`); process.exit(1); }
const sinUsar = readdirSync(ORIGEN).map((f) => f.replace('.jpg', '')).filter((n) => !usadas.includes(n));
if (sinUsar.length) console.log(`Capturas no usadas en el manual: ${sinUsar.join(', ')}`);
execFileSync('python3', ['-I', '-c', `
import sys, os
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
for n in sys.argv[3:]:
    im = Image.open(os.path.join(src, n + '.jpg')).convert('RGB')
    if im.width > 1400: im = im.resize((1400, round(im.height * 1400 / im.width)), Image.LANCZOS)
    im.save(os.path.join(dst, n + '.jpg'), quality=78, optimize=True)
`, ORIGEN, resolve(SALIDA, 'img'), ...usadas]);
for (const f of ['atkinson-hyperlegible-next-latin-400-normal.woff2', 'atkinson-hyperlegible-next-latin-700-normal.woff2']) copyFileSync(resolve(FUENTES, f), resolve(SALIDA, f));

const hoy = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' });
const indice = SECCIONES.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('');
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Manual de uso · Gestión Escolar</title><style>
@font-face { font-family: 'Atkinson'; src: url('atkinson-hyperlegible-next-latin-400-normal.woff2'); font-weight: 400; }
@font-face { font-family: 'Atkinson'; src: url('atkinson-hyperlegible-next-latin-700-normal.woff2'); font-weight: 700; }
:root { --pizarron: #1f4d3a; --tiza: #f7f9f8; --lapiz: #f2b705; --lapiz-suave: #fff4cc; --texto: #1e2422; --suave: #56635e; --borde: #d5ddd9; --ok-suave: #e3f2e9; }
* { box-sizing: border-box; }
body { font-family: 'Atkinson', sans-serif; color: var(--texto); font-size: 10.5pt; line-height: 1.45; margin: 0; }
.portada { height: 255mm; display: flex; flex-direction: column; justify-content: center; padding: 0 10mm; background: var(--pizarron); color: #f4f8f5; break-after: page; }
.portada .marca { width: 34mm; height: 34mm; border-radius: 8mm; background: rgba(255,255,255,.12); display: grid; place-items: center; font-size: 22mm; margin-bottom: 10mm; }
.portada h1 { font-size: 34pt; margin: 0; letter-spacing: .02em; }
.portada .sub { font-size: 16pt; margin: 4mm 0 14mm; color: var(--lapiz); font-weight: 700; }
.portada p { font-size: 11pt; max-width: 150mm; }
.portada .franja { margin-top: 12mm; background: var(--lapiz); color: #3d2e00; padding: 4mm 6mm; border-radius: 3mm; font-weight: 700; }
h1.seccion { font-size: 20pt; color: var(--pizarron); border-bottom: 1.2mm solid var(--lapiz); padding-bottom: 2mm; margin: 0 0 5mm; break-before: page; }
h2 { font-size: 16pt; color: var(--pizarron); }
h3 { font-size: 12.5pt; color: var(--pizarron); margin: 6mm 0 2mm; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
ol.pasos li, ul li { margin: 1.2mm 0; }
.indice ol { columns: 1; font-size: 12pt; line-height: 1.9; }
.indice a { color: var(--texto); text-decoration: none; border-bottom: 1px dotted var(--suave); }
table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; font-size: 9.5pt; break-inside: auto; }
th { background: var(--pizarron); color: #f4f8f5; text-align: left; padding: 2mm 2.5mm; }
td { border-bottom: 1px solid var(--borde); padding: 1.8mm 2.5mm; vertical-align: top; }
tr { break-inside: avoid; }
.nota, .consejo { border-left: 1.5mm solid var(--lapiz); background: var(--lapiz-suave); padding: 3mm 4mm; border-radius: 0 2mm 2mm 0; break-inside: avoid; }
.consejo { border-color: var(--pizarron); background: var(--ok-suave); }
.fig { margin: 4mm auto 6mm; text-align: center; break-inside: avoid; }
.fig img { border: 1px solid var(--borde); border-radius: 2mm; display: block; margin: 0 auto; max-width: 100%; object-fit: contain; }
.fig--esc img { max-height: 225mm; }
.fig--med img { max-height: 115mm; }
.fig--tel img { max-height: 120mm; max-width: 62mm; }
.fig figcaption { font-size: 9pt; color: var(--suave); margin-top: 1.5mm; }
.par { display: flex; gap: 5mm; justify-content: center; align-items: flex-start; break-inside: avoid; }
.par .fig { flex: 1 1 0; margin: 4mm 0 6mm; }
.par .fig--med img { max-height: 135mm; }
</style></head><body>
<section class="portada">
  <div class="marca">🎓</div>
  <h1>Gestión Escolar</h1>
  <div class="sub">Manual de uso</div>
  <p>Todo lo que hace la aplicación, pantalla por pantalla: configuración de la escuela, catálogos, importaciones, horarios, modo docente y pase de lista, Prefectura, respaldos y trabajo con varias personas mediante el servidor escolar.</p>
  <p>Edición: ${hoy}.</p>
  <div class="franja">Todas las imágenes usan datos FICTICIOS (escuela de demostración DEMO-001). Ningún nombre corresponde a personas reales.</div>
</section>
<section class="indice"><h1 class="seccion" style="break-before:auto">Contenido</h1><ol>${indice}</ol></section>
${SECCIONES.map(([id, t, c]) => `<section id="${id}"><h1 class="seccion">${t}</h1>${c}</section>`).join('\n')}
</body></html>`;
const archivo = resolve(SALIDA, 'manual.html');
writeFileSync(archivo, html);

const nav = await chromium.launch();
const page = await nav.newPage();
await page.goto(pathToFileURL(archivo).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: PDF, format: 'A4', printBackground: true,
  margin: { top: '16mm', bottom: '16mm', left: '15mm', right: '15mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="width:100%;font-size:8px;color:#56635e;padding:0 15mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>Gestión Escolar · Manual de uso · datos ficticios</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>',
});
await nav.close();
console.log(`PDF: ${PDF}`);
