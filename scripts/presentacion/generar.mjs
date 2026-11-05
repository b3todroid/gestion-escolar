// Presentación comercial breve (PDF 16:9): qué resuelve Gestión Escolar en una escuela.
// Regla: sólo afirmaciones VERDADERAS y COMPROBABLES (cada una indica la prueba o el documento que la respalda).
// Usa las capturas de manual-capturas/img (datos FICTICIOS). Generar antes las capturas del manual.
//   node scripts/presentacion/generar.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = resolve(import.meta.dirname, '../..');
const ORIGEN = resolve(RAIZ, 'manual-capturas/img');
const SALIDA = resolve(RAIZ, 'manual-capturas/presentacion');
const PDF = resolve(RAIZ, 'docs/presentacion/PRESENTACION_GESTION_ESCOLAR.pdf');
const FUENTES = resolve(RAIZ, 'node_modules/@fontsource/atkinson-hyperlegible-next/files');
mkdirSync(resolve(SALIDA, 'img'), { recursive: true });
mkdirSync(resolve(RAIZ, 'docs/presentacion'), { recursive: true });

const img = (n, clase = '') => `<img class="cap ${clase}" src="img/${n}.jpg" alt="">`;
const prueba = (t) => `<p class="prueba">✓ Comprobable: ${t}</p>`;
const problema = (t) => `<p class="problema"><span>Situación</span>${t}</p>`;
const puntos = (xs) => `<ul class="puntos">${xs.map((x) => `<li>${x}</li>`).join('')}</ul>`;
const lamina = (contenido, clase = '') => `<section class="lamina ${clase}">${contenido}<footer>Gestión Escolar · capturas con datos ficticios (escuela de demostración DEMO-001)</footer></section>`;
const conImagen = (etiqueta, titulo, sit, xs, prue, imagen) => lamina(`
<div class="dos">
  <div class="texto"><p class="etiqueta">${etiqueta}</p><h2>${titulo}</h2>${problema(sit)}${puntos(xs)}${prue}</div>
  <div class="imagen">${imagen}</div>
</div>`);

const LAMINAS = [
  lamina(`
<div class="portada">
  <div class="logo">🎓</div>
  <h1>Gestión Escolar</h1>
  <p class="lema">Horarios, asistencia y Prefectura de la secundaria en una sola aplicación, en cualquier dispositivo, también sin internet.</p>
  <p class="aviso-portada">Todo lo que se afirma aquí se puede comprobar: cada lámina indica la prueba o la medición que lo respalda.</p>
</div>`, 'lamina--portada'),

  lamina(`
<p class="etiqueta">Resumen</p><h2>Lo que la app resuelve en la escuela</h2>
<div class="rejilla">
  <div><b>1 · Arranque del ciclo</b><span>Escuela, turnos, jornada y grupos en un asistente de 6 pasos.</span></div>
  <div><b>2 · Horarios sin choques</b><span>Impide asignar a un docente dos clases a la misma hora real.</span></div>
  <div><b>3 · Asistencia digital</b><span>Sólo se marcan faltas y retardos; correcciones con historial.</span></div>
  <div><b>4 · Prefectura ordenada</b><span>Grupos sin docente visibles y coberturas con autorización registrada.</span></div>
  <div><b>5 · Sin internet y en equipo</b><span>Trabaja sin conexión y sincroniza sin perder ni duplicar.</span></div>
  <div><b>6 · Datos protegidos</b><span>Permisos por rol, respaldos cifrados y nada se envía a terceros.</span></div>
</div>`),

  conImagen('1 · Arranque del ciclo', 'La escuela lista en un solo recorrido',
    'Al iniciar el ciclo, los datos del plantel, la jornada, los grupos, el personal y los alumnos se capturan en distintos archivos.',
    [
      'Asistente de <b>6 pasos</b> que crea escuela, ciclo, turno, periodos, recesos, grados y grupos en <b>una sola operación</b>.',
      'La jornada se <b>genera sola</b> a partir de la duración del módulo y los recesos, y se ve en una gráfica.',
      '<b>Importación masiva</b> de alumnos, personal, materias y grupos desde Excel o CSV: revisa todo antes de guardar y no guarda filas con error.',
    ],
    prueba('prueba funcional «flujo integral»: configuración → importación → horario → lista → reporte.'),
    img('a05-asistente-4-periodos')),

  conImagen('2 · Horarios', 'Horarios sin choques, también entre turnos',
    'Un docente queda asignado a dos grupos a la misma hora, sobre todo cuando los turnos tienen periodos de distinta duración.',
    [
      'La app <b>impide</b> que un docente tenga dos clases que se traslapen en <b>hora real</b>, aunque estén en turnos distintos.',
      'Un horario <b>confirmado</b> no se cambia por accidente: reabrirlo exige un motivo, que queda en la bitácora.',
      'Reporte de <b>conflictos pendientes</b> y de horas por grupo y por docente.',
      'Importa horarios desde <b>Excel o PDF</b>, incluso escaneado: el reconocimiento de texto se hace <b>en el propio equipo</b>.',
    ],
    prueba('pruebas de conflictos por hora real y de importación de horarios (Excel y PDF).'),
    img('b22-grupo')),

  conImagen('3 · Asistencia', 'Pase de lista que sólo pide lo necesario',
    'Las listas en papel se pierden, se capturan dos veces y no registran quién salió del aula ni a qué hora.',
    [
      'Todos aparecen <b>presentes</b>: el docente sólo marca <b>faltas y retardos</b> (con hora de llegada).',
      '<b>Una lista por clase y fecha.</b> Cada corrección queda en un historial: qué cambió y cuándo.',
      '<b>Salidas al baño</b> con hora de salida y de regreso; una falta y una salida en la misma clase no pueden coexistir.',
      '<b>Reportes breves</b> por alumno y asistencia del ciclo al momento.',
    ],
    prueba('recorrido del docente PIL-DOC-01: actividad actual → lista → corrección → salida → reporte → historial.'),
    img('c05-lista-marcas', 'cap--tel')),

  conImagen('4 · Prefectura', 'Ningún grupo sin docente pasa desapercibido',
    'Una ausencia del personal se conoce tarde, no se sabe qué grupos quedaron sin docente y las coberturas no quedan registradas.',
    [
      'Al registrar una incidencia, los grupos afectados aparecen como <b>«POSIBLE GRUPO SIN DOCENTE»</b>: la app <b>no inventa faltas</b> y alguien con permiso la confirma.',
      '<b>Sugiere</b> al personal disponible a esa hora real, incluidas las horas de servicio (SE).',
      'Para asignar una cobertura hay que indicar <b>quién la autorizó</b>; todo queda en la bitácora.',
      'Reportes por día, semana o mes, calculados <b>sólo con registros validados</b>.',
    ],
    prueba('recorrido de Prefectura PIL-PRE-01: ausencia → grupo afectado → propuesta → autorización → cobertura realizada → reporte.'),
    img('d04-prefectura-incidencia-reportada')),

  conImagen('5 · Sin internet y en equipo', 'Si falla la red, el trabajo continúa',
    'La red de la escuela falla o no llega a todas las aulas, y la información queda en una sola computadora.',
    [
      'La app <b>abre y funciona sin conexión</b>; lo guardado queda en el dispositivo.',
      'Al volver la red, <b>envía sola</b> lo pendiente, <b>sin duplicados</b>.',
      'El indicador <b>nunca dice «Sincronizado»</b> si queda algo pendiente.',
      'Si dos equipos cambiaron lo mismo, <b>no se sobrescribe en silencio</b>: una persona decide.',
    ],
    prueba('pruebas multiusuario MUP-03 (sin red) y MUP-04 (conflicto) con navegadores independientes; DEP-06 y DEP-07 (actualización y caída de la base).'),
    img('s11-sincronizacion-conflicto')),

  conImagen('6 · Permisos', 'Cada persona ve sólo lo que le corresponde',
    'Se comparten archivos o una misma computadora, y todos ven y pueden cambiar todo.',
    [
      'Acceso sólo por <b>invitación</b>, con un <b>código al correo</b>: sin contraseñas que se olviden o se presten.',
      '<b>Verificación en dos pasos obligatoria</b> para la Administración y la Dirección.',
      'Cada <b>docente ve sólo sus grupos</b>; la CURP, sólo la Dirección y la Subdirección.',
      'El <b>servidor revisa los permisos</b> en cada operación: ocultar un botón nunca es el permiso.',
    ],
    prueba('batería de aislamiento con 2 escuelas × 6 roles × 30 tablas; prueba MUP-05 (cada docente, sólo sus grupos).'),
    img('s17-accesos-escuela')),

  conImagen('7 · Datos protegidos', 'La información de la escuela no se pierde ni se filtra',
    'Los datos viven en un equipo que puede fallar o perderse, o terminan en servicios externos sin control.',
    [
      '<b>Respaldos cifrados</b> con contraseña (AES-GCM); la app nunca guarda la contraseña.',
      'Antes de restaurar se <b>verifica la integridad</b>: un archivo alterado se rechaza y nada queda a medias.',
      'Los datos escolares <b>no se envían a servicios externos</b>.',
      'Servidor con <b>HTTPS (TLS 1.2 y 1.3)</b>; base de datos sin acceso desde internet; auditoría sin datos personales.',
    ],
    prueba('respaldo del servidor restaurado y verificado (40 571 registros, 38 tablas idénticas); revisión de seguridad con 0 fallas.'),
    img('e01-respaldos-con-datos')),

  lamina(`
<p class="etiqueta">8 · Cualquier dispositivo</p><h2>Una sola app para teléfono, tableta y computadora</h2>
<div class="dos dos--equipos">
  <div class="texto">${puntos([
    'Se <b>instala desde el navegador</b>, sin tienda de aplicaciones: Android, iPhone/iPad, Windows y Mac.',
    'Se adapta a pantallas desde <b>320 px</b>; los botones miden al menos <b>44 px</b> para tocarlos con facilidad.',
    'El docente abre la app y ve <b>su clase actual</b>, con acceso directo a pasar lista.',
  ])}
  <p class="honesto"><b>Con honestidad:</b> se probó en <b>emulación</b> de Chromium (Android, tableta y escritorio). Las pruebas en <b>equipos físicos</b> y en <b>iPhone/Safari</b> están pendientes.</p>
  ${prueba('4 perfiles de dispositivo instalables, sin desbordes y con uso sin conexión (pruebas DIS).')}</div>
  <div class="imagen imagen--par">${img('c02-mi-dia-telefono', 'cap--tel')}${img('c03-mi-dia-escritorio', 'cap--med')}</div>
</div>`),

  lamina(`
<p class="etiqueta">Evidencia</p><h2>Números verificables</h2>
<div class="cifras">
  <div><b>191</b><span>pruebas unitarias aprobadas</span></div>
  <div><b>59</b><span>pruebas funcionales en el navegador</span></div>
  <div><b>129</b><span>pruebas del servidor (permisos, sincronización, seguridad)</span></div>
  <div><b>38</b><span>pruebas contra el entorno completo en contenedores (21 de despliegue y 17 del flujo completo)</span></div>
  <div><b>0</b><span>vulnerabilidades conocidas en las dependencias de producción</span></div>
  <div><b>0,36 s</b><span>primera carga de la app; 0,17 s las siguientes*</span></div>
  <div><b>50</b><span>consultas simultáneas atendidas sin errores*</span></div>
  <div><b>≈ 5 s</b><span>de guardar una lista en el teléfono a verla en el servidor*</span></div>
</div>
<p class="nota-pie">* Medido el 4 de noviembre de 2026 en un equipo local con datos ficticios. No representa redes móviles reales. Detalle en docs/FASE_12_PREPRODUCCION.md.</p>`),

  lamina(`
<p class="etiqueta">Transparencia</p><h2>Lo que hoy no hace y en qué etapa está</h2>
<div class="dos dos--iguales">
  <div class="caja"><h3>No incluye</h3>${puntos([
    'Calificaciones ni boletas.',
    'Cobros ni pagos.',
    'Avisos a madres y padres de familia.',
    'Reportes de asistencia por periodo (próximamente; hoy: asistencia del ciclo por grupo).',
  ])}</div>
  <div class="caja"><h3>Estado actual</h3>${puntos([
    '<b>Lista para demostración</b> y para un <b>piloto controlado</b> con datos ficticios.',
    'Sin servidor institucional publicado: requiere autorizar proveedor, dominio y correo.',
    'Pendiente: probar en equipos físicos e iPhone, y el aviso de privacidad de la escuela.',
    'No se han usado datos reales de ninguna escuela.',
  ])}</div>
</div>`),

  lamina(`
<div class="cierre">
  <p class="etiqueta">Siguiente paso</p>
  <h2>Pruébela con la escuela de demostración</h2>
  <ol class="pasos-cierre">
    <li><b>Demostración</b><span>Recorrido con la escuela DEMO-001: horarios, lista, Prefectura y respaldos.</span></li>
    <li><b>Piloto controlado</b><span>Unos docentes y Prefectura en sus propios equipos, con datos ficticios.</span></li>
    <li><b>Decisión</b><span>Con los resultados del piloto, se define servidor, correo y aviso de privacidad.</span></li>
  </ol>
  <p class="lema-cierre">Gestión Escolar · menos captura repetida, horarios sin choques y control del día escolar.</p>
</div>`, 'lamina--portada'),
];

const usadas = [...LAMINAS.join('').matchAll(/img\/([\w-]+)\.jpg/g)].map((m) => m[1]);
const faltan = usadas.filter((n) => !existsSync(resolve(ORIGEN, `${n}.jpg`)));
if (faltan.length) { console.error(`Faltan capturas (genera las del manual): ${faltan.join(', ')}`); process.exit(1); }
execFileSync('python3', ['-I', '-c', `
import sys, os
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
for n in sys.argv[3:]:
    im = Image.open(os.path.join(src, n + '.jpg')).convert('RGB')
    if im.height > im.width * 1.25: im = im.crop((0, 0, im.width, int(im.width * 1.25)))
    if im.width > 1400: im = im.resize((1400, round(im.height * 1400 / im.width)), Image.LANCZOS)
    im.save(os.path.join(dst, n + '.jpg'), quality=80, optimize=True)
`, ORIGEN, resolve(SALIDA, 'img'), ...usadas]);
for (const f of ['atkinson-hyperlegible-next-latin-400-normal.woff2', 'atkinson-hyperlegible-next-latin-700-normal.woff2']) copyFileSync(resolve(FUENTES, f), resolve(SALIDA, f));

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Gestión Escolar · Presentación</title><style>
@font-face { font-family: 'Atkinson'; src: url('atkinson-hyperlegible-next-latin-400-normal.woff2'); font-weight: 400; }
@font-face { font-family: 'Atkinson'; src: url('atkinson-hyperlegible-next-latin-700-normal.woff2'); font-weight: 700; }
@page { size: 338.67mm 190.5mm; margin: 0; }
:root { --pizarron: #1f4d3a; --pizarron-2: #2a6450; --tiza: #f7f9f8; --lapiz: #f2b705; --lapiz-suave: #fff4cc; --texto: #1e2422; --suave: #56635e; --borde: #d5ddd9; --ok: #1f6b45; --ok-suave: #e3f2e9; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Atkinson', sans-serif; color: var(--texto); }
.lamina { width: 338.67mm; height: 190.5mm; padding: 14mm 18mm 14mm; background: var(--tiza); position: relative; overflow: hidden; break-after: page; }
.lamina footer { position: absolute; left: 18mm; bottom: 6mm; font-size: 8pt; color: var(--suave); }
.lamina--portada { background: var(--pizarron); color: #f4f8f5; }
.lamina--portada footer { color: #bcd2c6; }
.etiqueta { margin: 0 0 2mm; font-size: 11pt; font-weight: 700; color: var(--ok); text-transform: uppercase; letter-spacing: .06em; }
h2 { margin: 0 0 6mm; font-size: 26pt; line-height: 1.12; color: var(--pizarron); }
.lamina--portada h2, .lamina--portada .etiqueta { color: var(--lapiz); }
.portada { height: 100%; display: flex; flex-direction: column; justify-content: center; }
.logo { width: 26mm; height: 26mm; border-radius: 6mm; background: rgba(255,255,255,.12); display: grid; place-items: center; font-size: 16mm; margin-bottom: 8mm; }
.portada h1 { font-size: 48pt; margin: 0; }
.lema { font-size: 20pt; max-width: 230mm; color: var(--lapiz); font-weight: 700; line-height: 1.25; margin: 6mm 0 10mm; }
.aviso-portada { font-size: 12pt; max-width: 200mm; border-left: 1.5mm solid var(--lapiz); padding-left: 5mm; }
.dos { display: grid; grid-template-columns: 1.05fr 1fr; gap: 12mm; height: 150mm; align-items: center; }
.dos--iguales { grid-template-columns: 1fr 1fr; align-items: stretch; height: auto; }
.texto h2 { font-size: 23pt; }
.problema { background: #fff; border: 1px solid var(--borde); border-radius: 3mm; padding: 3mm 4mm; font-size: 10.5pt; color: var(--suave); margin: 0 0 4mm; }
.problema span { display: block; font-weight: 700; color: #b3261e; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 1mm; }
.puntos { margin: 0; padding-left: 5mm; font-size: 12pt; line-height: 1.35; }
.puntos li { margin: 0 0 2.6mm; }
.puntos li::marker { color: var(--lapiz); }
.prueba { margin: 4mm 0 0; font-size: 9.5pt; color: var(--ok); background: var(--ok-suave); border-radius: 2mm; padding: 2mm 3mm; }
.imagen { display: flex; justify-content: center; align-items: center; height: 150mm; }
.cap { max-width: 100%; max-height: 150mm; border-radius: 3mm; border: 1px solid var(--borde); box-shadow: 0 2mm 6mm rgba(0,0,0,.12); background: #fff; }
.cap--tel { max-height: 150mm; max-width: 72mm; }
.imagen--par { gap: 6mm; }
.imagen--par .cap--tel { max-width: 52mm; max-height: 120mm; }
.imagen--par .cap--med { max-width: 95mm; max-height: 120mm; }
.honesto { font-size: 10.5pt; background: var(--lapiz-suave); border-left: 1.5mm solid var(--lapiz); padding: 3mm 4mm; border-radius: 0 2mm 2mm 0; }
.rejilla { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; margin-top: 4mm; }
.rejilla div { background: #fff; border: 1px solid var(--borde); border-top: 2mm solid var(--lapiz); border-radius: 3mm; padding: 6mm; min-height: 50mm; }
.rejilla b { display: block; font-size: 15pt; color: var(--pizarron); margin-bottom: 3mm; }
.rejilla span { font-size: 12pt; color: var(--texto); }
.cifras { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5mm; }
.cifras div { background: #fff; border: 1px solid var(--borde); border-radius: 3mm; padding: 5mm; min-height: 46mm; }
.cifras b { display: block; font-size: 30pt; color: var(--pizarron); line-height: 1; margin-bottom: 3mm; }
.cifras span { font-size: 10.5pt; color: var(--suave); }
.nota-pie { font-size: 9pt; color: var(--suave); margin-top: 5mm; }
.caja { background: #fff; border: 1px solid var(--borde); border-radius: 3mm; padding: 6mm 7mm; }
.caja h3 { margin: 0 0 4mm; font-size: 15pt; color: var(--pizarron); }
.cierre { height: 100%; display: flex; flex-direction: column; justify-content: center; }
.pasos-cierre { list-style: none; padding: 0; margin: 4mm 0 10mm; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; counter-reset: p; }
.pasos-cierre li { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.2); border-radius: 3mm; padding: 6mm; counter-increment: p; }
.pasos-cierre li::before { content: counter(p); display: grid; place-items: center; width: 10mm; height: 10mm; border-radius: 50%; background: var(--lapiz); color: #3d2e00; font-weight: 700; margin-bottom: 3mm; }
.pasos-cierre b { display: block; font-size: 15pt; margin-bottom: 2mm; }
.pasos-cierre span { font-size: 11.5pt; color: #d9e6df; }
.lema-cierre { font-size: 13pt; color: var(--lapiz); font-weight: 700; }
</style></head><body>${LAMINAS.join('\n')}</body></html>`;
const archivo = resolve(SALIDA, 'presentacion.html');
writeFileSync(archivo, html);
const nav = await chromium.launch();
const page = await nav.newPage();
await page.goto(pathToFileURL(archivo).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: PDF, width: '338.67mm', height: '190.5mm', printBackground: true, preferCSSPageSize: true });
await nav.close();
console.log(`PDF: ${PDF} (${LAMINAS.length} láminas)`);
