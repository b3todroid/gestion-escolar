// Contenido del MANUAL DE USO de Gestión Escolar (Fase 12). Todas las imágenes usan datos FICTICIOS.
// fig(nombre, pie, tipo): tipo 'esc' (pantalla ancha), 'tel' (teléfono), 'med' (media página).

export const fig = (n, pie, tipo = 'esc') => `<figure class="fig fig--${tipo}"><img src="img/${n}.jpg" alt=""><figcaption>${pie}</figcaption></figure>`;
export const par = (...figs) => `<div class="par">${figs.join('')}</div>`;
const nota = (t) => `<p class="nota"><b>Importante:</b> ${t}</p>`;
const consejo = (t) => `<p class="consejo"><b>Consejo:</b> ${t}</p>`;
const pasos = (xs) => `<ol class="pasos">${xs.map((x) => `<li>${x}</li>`).join('')}</ol>`;
const lista = (xs) => `<ul>${xs.map((x) => `<li>${x}</li>`).join('')}</ul>`;
const tabla = (cab, filas) => `<table><thead><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

export const SECCIONES = [
  ['intro', '1. Qué es Gestión Escolar', `
<p><b>Gestión Escolar</b> es una aplicación para organizar el trabajo diario de una escuela secundaria: datos del plantel, ciclo escolar, turnos y jornada, grupos, personal, materias, alumnos, horarios, pase de lista, salidas del aula, reportes de alumnos, Prefectura (incidencias del personal y coberturas), respaldos y, de forma opcional, el trabajo de varias personas con un servidor escolar.</p>
<h3>Cómo funciona</h3>
${lista([
  '<b>Es una aplicación web instalable (PWA).</b> Se abre en el navegador (Chrome, Edge o Safari) y se puede <b>instalar</b> como una app con ícono propio en Android, iPhone/iPad, Windows y macOS. No se descarga de una tienda.',
  '<b>Primero en el dispositivo («local-first»).</b> La información se guarda en el propio equipo y la app <b>funciona sin internet</b>. Nada sale del dispositivo, salvo que la escuela active el servidor escolar.',
  '<b>Servidor escolar (opcional).</b> Para trabajar varias personas a la vez, cada quien entra con una invitación y un código que llega a su correo. Los cambios se envían y se reciben automáticamente, también después de trabajar sin conexión.',
  '<b>Nunca decide por ti.</b> La app sugiere y avisa, pero no confirma faltas del personal, no asigna coberturas, no fusiona personas y no resuelve conflictos por su cuenta: siempre pide la decisión de una persona.',
])}
<h3>Para quién es</h3>
${tabla(['Persona', 'Lo que hace con la app'], [
  ['Dirección y Subdirección', 'Configuran la escuela, el ciclo, la jornada, los grupos, el personal, las materias y los alumnos; arman y confirman horarios; consultan asistencia y reportes; autorizan coberturas (con delegación).'],
  ['Docentes', 'Ven su día («Mi día»), su horario y sus grupos; pasan lista; registran salidas del aula y reportes breves de alumnos.'],
  ['Prefectura', 'Registra incidencias del personal, revisa qué grupos necesitan atención, propone coberturas y consulta reportes.'],
  ['Administración de la escuela', 'Invita a las personas, asigna roles, activa la verificación en dos pasos, confirma incidencias y autoriza coberturas, y hace la migración al servidor.'],
])}
${nota('todas las imágenes de este manual usan datos <b>ficticios</b>: la escuela de demostración «ESCUELA DEMO GESTIÓN ESCOLAR» (DEMO-001) y una escuela ficticia creada para el ejemplo. Ningún nombre corresponde a personas reales.')}
<h3>Elementos comunes de todas las pantallas</h3>
${lista([
  '<b>Barra superior</b> (verde): el nombre de la app (lleva al inicio), el indicador de <b>conexión</b> («En línea» / «Sin conexión») y, si hay servidor, el indicador de <b>sincronización</b> («✓ Sincronizado», «↻ N por enviar», «⚠ N por resolver»).',
  '<b>Migas de pan</b> (arriba del título): muestran dónde estás y permiten regresar (Inicio / Escuela / Ciclo…).',
  '<b>Avisos</b>: mensajes breves arriba de la pantalla que confirman lo que se guardó («Guardado en este dispositivo») o explican un problema. Se cierran con ✕.',
  '<b>Confirmaciones</b>: antes de borrar o cambiar algo importante aparece un cuadro que pide confirmar. Nada importante se borra con un solo toque.',
  '<b>Estados con texto y símbolo</b>, nunca sólo con color (por ejemplo «✓ GUARDADA», «✎ EN CAPTURA», «⚠ Conflicto»).',
  '<b>Campos con etiqueta visible</b>; se indica cuáles son «(obligatorio)» u «(opcional)». Si algo falta o está mal, el error aparece junto al campo y en un resumen.',
  '<b>Cambios sin guardar</b>: si sales de un formulario con cambios, la app pregunta si quieres salir sin guardar.',
  '<b>Escuela de DEMOSTRACIÓN</b>: si hay datos de demostración, una franja amarilla permanente lo indica en toda la app.',
])}`],

  ['instalar', '2. Abrir, instalar y primer uso', `
<h3>Abrir la app</h3>
<p>Se abre la dirección que entrega la escuela (siempre con <b>https://</b>). La primera vez se descarga la app; después abre aunque no haya internet.</p>
<h3>Instalar como app</h3>
${tabla(['Equipo', 'Navegador', 'Cómo instalar'], [
  ['Android (teléfono o tableta)', 'Chrome', 'Menú ⋮ → «Instalar app» (o «Agregar a la pantalla principal»).'],
  ['iPhone / iPad', 'Safari', 'Botón Compartir → «Agregar a inicio». Úsala siempre desde ese ícono: así los datos quedan mejor protegidos.'],
  ['Windows', 'Chrome o Edge', 'Ícono «Instalar» en la barra de direcciones, o menú → Aplicaciones → Instalar.'],
  ['macOS', 'Safari 17 o posterior / Chrome / Edge', 'Safari: Archivo → «Agregar al Dock». Chrome/Edge: igual que en Windows.'],
])}
<h3>Pantalla de bienvenida</h3>
<p>Si el equipo no tiene ninguna escuela, la app muestra la bienvenida con el botón <b>«Configurar mi escuela»</b> y el resumen de los cuatro pasos (datos del plantel, jornada, grados y grupos, revisión). También ofrece el <b>Modo docente</b> y la sección <b>Datos en este dispositivo</b>.</p>
${fig('a01-bienvenida', 'Bienvenida en un equipo sin escuelas.')}
<h3>Inicio con escuelas registradas</h3>
<p>Con escuelas, el inicio muestra <b>Tu escuela</b> (con «Continuar» y «+ Configurar otra escuela»), el <b>Modo docente</b> y <b>Datos en este dispositivo</b> (Respaldos, Aplicación y datos, Solicitar almacenamiento persistente). Si hay cambios sin respaldo, aparece un recordatorio con «Descargar respaldo». La pantalla <b>Escuelas</b> lista todas las escuelas del dispositivo.</p>
${par(fig('b05-inicio', 'Inicio con la escuela de demostración.', 'med'), fig('b06-escuelas', 'Pantalla Escuelas.', 'med'))}
<h3>Aplicación y datos</h3>
<p>La pantalla <b>Aplicación y datos</b> reúne:</p>
${lista([
  '<b>Estado</b>: conexión, si la app está lista para usarse sin conexión, versión de la app y de los datos, estado de la sincronización y de la cuenta del servidor, y el botón <b>«Buscar actualización»</b>.',
  '<b>Instalar en este dispositivo</b>: instrucciones según el equipo y el navegador.',
  '<b>Almacenamiento</b>: cuánto espacio se usa y cuánto hay disponible, y el botón <b>«Pedir almacenamiento persistente»</b>, que pide al navegador no borrar los datos de la app cuando falte espacio.',
])}
${fig('b29-aplicacion', 'Aplicación y datos.')}
${consejo('pide el almacenamiento persistente en cada equipo de trabajo y descarga respaldos con frecuencia. Si el navegador borra sus datos o el equipo se pierde, el respaldo es la única forma de recuperar la información que no se haya sincronizado con un servidor.')}
<h3>Actualizaciones</h3>
<p>Cuando hay una versión nueva, aparece el aviso «Hay una nueva versión». Cada persona decide cuándo actualizar. Si hay una lista sin guardar, la app pide confirmación antes de recargar; lo guardado y lo pendiente de enviar se conservan.</p>
<h3>Pantallas pequeñas</h3>
<p>La app se adapta a teléfonos (desde 320 px de ancho), tabletas y computadoras. Los botones miden al menos 44 px para tocarlos con facilidad.</p>
${fig('e05-telefono-chico', 'Inicio del modo docente en un teléfono de 320 px.', 'tel')}`],

  ['asistente', '3. Configurar una escuela nueva (asistente)', `
<p>El asistente crea en <b>un solo paso final</b> la escuela, el ciclo escolar, el turno, los periodos y recesos, y los grados y grupos. Puedes avanzar y regresar entre los 6 pasos; lo capturado se conserva como borrador en el equipo hasta que pulses <b>«Guardar escuela»</b>. Si la configuración queda sin terminar, el inicio ofrece retomarla o descartarla.</p>
${pasos([
  '<b>Escuela</b>: nombre oficial, nombre corto (opcional), <b>Clave de centro de trabajo (CCT)</b>, nivel educativo, entidad federativa y municipio o alcaldía; datos adicionales opcionales (zona, sector, domicilio, teléfono, correo, logotipo). La CCT debe empezar con la clave de la entidad; la app revisa el formato, no consulta si existe.',
  '<b>Ciclo escolar</b>: nombre (por ejemplo 2026-2027), inicio y fin de clases y si el ciclo está en curso (activo).',
  '<b>Turno y días</b>: nombre del turno (Matutino, Vespertino…), hora de entrada y de salida y días laborables.',
  '<b>Periodos y recesos</b>: minutos por módulo, módulos al día y recesos (después de qué módulo y cuántos minutos). La app genera la jornada y la muestra como gráfica. Con «Editar periodos uno por uno» se ajusta cada periodo; «Volver a generar automáticamente» deshace los cambios.',
  '<b>Grados y grupos</b>: del grado / al grado, grupos por grado y lugares por grupo; se ven los grupos que se crearán (1° A, 1° B…). «Personalizar grados y grupos» permite nombres y cantidades distintas por grado.',
  '<b>Revisar y guardar</b>: resumen de todo, con «Cambiar» en cada bloque. «Guardar escuela» crea todo de una vez.',
])}
${par(fig('a02-asistente-1-escuela', 'Paso 1 · Escuela.', 'med'), fig('a03-asistente-2-ciclo', 'Paso 2 · Ciclo escolar.', 'med'))}
${par(fig('a04-asistente-3-turno', 'Paso 3 · Turno y días.', 'med'), fig('a05-asistente-4-periodos', 'Paso 4 · Periodos y recesos, con la gráfica de la jornada.', 'med'))}
${par(fig('a06-asistente-5-grupos', 'Paso 5 · Grados y grupos.', 'med'), fig('a07-asistente-6-revisar', 'Paso 6 · Revisar y guardar.', 'med'))}
<p>Al guardar se abre el <b>panel principal</b> de la escuela.</p>
${fig('a08-panel-escuela-nueva', 'Panel de la escuela recién creada.')}
<h3>Registrar una escuela sin asistente</h3>
<p>«Registrar escuela» (desde «+ Configurar otra escuela») captura sólo los datos del plantel; el ciclo, los turnos y los grupos se agregan después desde el panel.</p>
${fig('a19-escuela-nueva', 'Registrar escuela.')}`],

  ['panel', '4. Panel de la escuela y datos del plantel', `
<p>El <b>panel principal</b> resume la escuela: CCT, ciclo escolar activo, turnos, grados, grupos y la jornada configurada. Tiene los botones <b>Editar datos escolares</b>, <b>Administrar periodos</b>, <b>Administrar grupos</b> y <b>Horarios</b>, y las secciones:</p>
${lista([
  '<b>Datos del plantel</b>, con «Eliminar escuela» (pide confirmación) y, sólo en la escuela de demostración, «Quitar escuela de demostración».',
  '<b>Catálogos escolares</b>: Personal, Docentes, Materias, Alumnos e Importar información, con conteos (personal activo, docentes, alumnos inscritos, alumnos sin grupo, materias activas) y alumnos por grado y por grupo.',
  '<b>Otros módulos</b>: importar horarios, respaldos, aplicación y datos, Prefectura, cuenta del servidor y sincronización. Lo que aún no existe aparece como «Próximamente», sin botón.',
  '<b>Personal</b> y <b>Ciclos escolares</b> (activar, cerrar, editar o eliminar un ciclo; agregar ciclo).',
])}
${fig('b07-panel-escuela', 'Panel principal (escuela de demostración).')}
<h3>Editar datos escolares</h3>
<p>Permite cambiar todos los datos del plantel capturados en el paso 1 del asistente, incluido el logotipo. «Guardar cambios» los conserva; «Cancelar» los descarta.</p>
${fig('b08-editar-escuela', 'Editar datos escolares.')}
${nota('la escuela de demostración no tiene CCT: la app nunca inventa una clave oficial. «Quitar escuela de demostración» borra sólo esa escuela (si no está vinculada con un servidor) y no toca ninguna otra.')}`],

  ['ciclo', '5. Ciclo escolar, turnos, periodos y grupos', `
<h3>Ciclo escolar</h3>
<p>La pantalla del ciclo muestra su estado (activo / cerrado) y accesos a <b>Turnos y jornadas</b>, <b>Materias</b>, <b>Horarios</b> y <b>Grados y grupos</b>. Desde aquí se agregan turnos y grupos, se editan, se desactivan o reactivan grupos y se eliminan grados.</p>
${fig('b10-ciclo', 'Ciclo escolar con sus turnos, materias, horarios y grupos.')}
<h3>Turnos y periodos</h3>
<p>Cada turno tiene su jornada: periodos de clase y recesos con hora de inicio y fin. La sección <b>Así se ve la jornada</b> la dibuja; <b>Periodos y recesos</b> permite editar, eliminar o agregar un periodo o receso. Turnos distintos pueden tener periodos distintos: la app compara siempre por <b>hora real</b>.</p>
${par(fig('b11-turno-matutino', 'Turno Matutino.', 'med'), fig('b12-turno-vespertino', 'Turno Vespertino.', 'med'))}
${nota('al cambiar un periodo, las actividades ligadas a ese periodo toman la nueva hora automáticamente, en la misma operación.')}
<h3>Administrar grupos</h3>
<p>Lista los grados y grupos con sus materias y horario. Cada grupo puede <b>editarse</b>, <b>desactivarse</b> (deja de recibir materias, clases, alumnos y actividades nuevas, pero conserva su historia), <b>reactivarse</b> o <b>eliminarse</b>. También se agregan grupos y grados.</p>
${fig('a20-administrar-grupos', 'Grados y grupos de un ciclo.')}`],

  ['catalogos', '6. Catálogos: personal, docentes, materias y alumnos', `
<h3>Personal</h3>
<p>Registra a todas las personas que trabajan en la escuela, una sola vez para todos los ciclos. Cada persona tiene nombre(s), apellidos, un <b>identificador interno</b> (opcional; es lo único que identifica a la persona, nunca el nombre) y una o varias <b>funciones</b>: Docente, Prefectura, Dirección, Subdirección académica, Subdirección de gestión, Orientación, Trabajo social, UDEEI, Secretaría, Asistencia escolar, Biblioteca u Otro. También se indican los turnos del ciclo y observaciones. Cada ficha se puede editar, dar de baja o eliminar; hay búsqueda y filtros por función y estado.</p>
${par(fig('a10-personal', 'Personal: alta de una persona.', 'med'), fig('b09-personal', 'Personal de la escuela de demostración.', 'med'))}
<h3>Docentes</h3>
<p>Son las personas con función Docente. Para cada ciclo se indica <b>qué materias y en qué turnos puede impartir</b> («Materias y turnos»). Esto no crea clases: sólo ayuda a sugerir y a revisar. Se ven las horas asignadas de cada docente.</p>
${fig('b14-docentes', 'Docentes del ciclo con materias y turnos que pueden impartir.')}
<h3>Materias y actividades</h3>
<p>Catálogo del ciclo: nombre, clave y <b>tipo</b> (materia, campo formativo, taller, tutoría, actividad especial o servicio escolar «SE»). Se agregan una por una, <b>varias a la vez</b> (una por renglón) o desde las <b>sugerencias para secundaria</b>. Se pueden editar, desactivar (no reciben asignaciones nuevas) o eliminar. Las horas de <b>servicio (SE)</b> no se asignan a grupos: se registran en el horario del docente.</p>
${par(fig('a09-materias', 'Materias de una escuela nueva.', 'med'), fig('b13-materias', 'Materias de la escuela de demostración.', 'med'))}
<h3>Alumnos</h3>
<p>Cada alumno es <b>una sola persona</b> en la escuela (identidad: nombre, apellidos, matrícula, CURP opcional) con una <b>inscripción por ciclo</b> (turno, grado, grupo, estado y número de lista). La pantalla muestra los inscritos por grado y grupo, permite <b>buscar</b> por nombre o matrícula y filtrar por grado, grupo y estado, e <b>inscribir</b> un alumno nuevo.</p>
${par(fig('b15-alumnos-ciclo', 'Alumnos del ciclo.', 'med'), fig('b16-alumnos-buscar', 'Búsqueda por matrícula.', 'med'))}
${fig('b17-alumnos-inscribir', 'Inscribir un alumno nuevo.')}
${nota('la app nunca identifica a una persona por su nombre. Si encuentra nombres iguales los marca como <b>«POSIBLE DUPLICADO»</b> para que alguien lo revise; nunca los fusiona sola. La misma matrícula o CURP no se puede repetir.')}
<h3>Ficha del alumno</h3>
<p>Muestra los <b>datos del alumno</b> (con «Editar datos»), la <b>inscripción</b> del ciclo con <b>«Cambiar de grupo»</b> (pide motivo; la persona es la misma y queda el movimiento en el historial), <b>Dar de baja</b> y <b>Eliminar</b>, el <b>historial de inscripción</b>, las <b>faltas y retardos</b> con fecha y materia, las <b>salidas del aula</b> (se pueden anular con confirmación) y los <b>reportes breves</b> (crear, eliminar).</p>
${par(fig('b27-ficha-alumno', 'Ficha del alumno.', 'med'), fig('b28-editar-alumno', 'Editar datos del alumno.', 'med'))}`],

  ['importar', '7. Importar información (Excel, CSV y PDF)', `
<p>«Importar información» carga muchos registros desde un archivo. Siempre son 4 pasos y <b>nada se guarda hasta confirmar</b>:</p>
${pasos([
  '<b>¿Qué vas a importar?</b> Alumnos, Docentes, Personal, Materias y actividades, Grupos u Horarios.',
  '<b>Elige el archivo</b>: Excel (.xlsx), CSV (.csv) o, para horarios, PDF. Si el libro tiene varias hojas, se elige la hoja. Hay plantillas de Excel para descargar.',
  '<b>Revisa las columnas</b>: la app reconoce los encabezados (también sinónimos) y propone a qué dato corresponde cada columna; se puede corregir a mano. Las columnas se reconocen por su nombre, no por su posición. La correspondencia se puede guardar como plantilla de reconocimiento.',
  '<b>Revisa y confirma</b>: «Analizar archivo» muestra cuántos registros son nuevos, cuáles ya existen, cuáles tienen errores o conflictos y los posibles duplicados. «Confirmar e importar (N)» guarda sólo lo correcto y lo que tú confirmaste.',
])}
${par(fig('a11-importar-inicio', 'Paso 1: tipo de información.', 'med'), fig('a12-importar-columnas', 'Paso 3: correspondencia de columnas.', 'med'))}
${par(fig('a13-importar-revision', 'Paso 4: revisión antes de guardar.', 'med'), fig('a14-importar-resultado', 'Resultado de la importación.', 'med'))}
<p>Al final se muestra el resultado (registros nuevos, actualizados y filas con error que no se guardaron) y la importación queda en <b>Importaciones anteriores</b>.</p>
<h3>Horarios desde PDF (digital o escaneado)</h3>
<p>Un horario en PDF se puede leer de dos formas: si el PDF tiene texto digital, se lee directamente; si es una imagen escaneada, la app usa <b>reconocimiento de texto (OCR) dentro del equipo</b> (no se envía a ningún servicio). La app identifica la <b>estructura</b> del documento (horario por grupo, por docente o lista), reconstruye la tabla y la muestra para revisarla y corregir celdas. Lo dudoso se marca como <b>incierto</b> y no se guarda hasta que alguien lo revise; una celda vacía nunca se interpreta como servicio (SE). Después pasa por la misma validación que un Excel.</p>
${par(fig('a15-pdf-estructura', 'PDF: estructura detectada y tabla reconstruida.', 'med'), fig('a16-pdf-tabla', 'PDF: tabla lista para continuar.', 'med'))}
${par(fig('a17-pdf-revision', 'PDF: revisión de las clases.', 'med'), fig('a18-pdf-resultado', 'PDF: clases importadas.', 'med'))}
<h3>Importar horarios desde Excel (una fila por clase)</h3>
<p>Pantalla de 3 pasos: <b>prepara el archivo</b> (con la plantilla de Excel: columnas Grado, Grupo, Turno, Día, Inicio, Fin, Materia y Docente), <b>elige el archivo</b> y <b>revisa antes de guardar</b>. Es «todo o nada»: si hay un error o un choque, no se guarda nada. No crea grupos, materias ni personas, no reemplaza clases existentes y no toca horarios confirmados.</p>
${par(fig('b18-importar-datos', 'Importar información (paso 1).', 'med'), fig('b19-importar-horarios', 'Importar horarios desde Excel.', 'med'))}`],

  ['horarios', '8. Horarios', `
<h3>Cómo se arma un horario</h3>
${pasos([
  'En <b>Administrar grupos</b> abre el grupo («Materias y horario de 1° A»).',
  'Asigna cada materia con su docente y horas por semana («Asignar materia»).',
  'En el horario, toca un periodo libre («Asignar Lunes 07:00») y elige la clase, u «Otra actividad».',
  'Revisa la semana y, cuando esté correcto, <b>«Confirmar horario»</b> (Dirección).',
])}
<p>Cada bloque del horario es de un tipo explícito: <b>CLASE</b>, <b>SERVICIO (SE)</b>, <b>RECESO</b>, <b>OTRA ACTIVIDAD</b> o <b>SIN ACTIVIDAD REGISTRADA</b>. Un periodo vacío nunca se considera servicio.</p>
${fig('a21-grupo-editable', 'Horario de un grupo sin confirmar: materias asignadas, horario semanal y edición por día.')}
${fig('b23-grupo-editar-dia', 'Editar por día: «Cambiar» una clase o «Asignar» un periodo libre.', 'med')}
<h3>Choques de horario</h3>
<p>Un docente no puede tener dos clases (o una clase y una actividad) que se traslapen en <b>hora real</b>, aunque sean de turnos con periodos distintos. Si se intenta, la app lo impide y explica el choque. Sólo con un <b>caso especial</b> autorizado se permite la simultaneidad.</p>
<h3>Horario confirmado</h3>
<p>Un horario confirmado ya no se edita por accidente: para cambiarlo hay que <b>«Reabrir para editar»</b> y escribir el motivo, que queda en la bitácora. El estado del horario (confirmado / sin confirmar / con conflicto) se calcula siempre de los datos.</p>
${fig('b22-grupo', 'Horario confirmado de un grupo (escuela de demostración).')}
<h3>Módulo Horarios</h3>
<p>Elige escuela y ciclo. Muestra la <b>selección</b> de horario por grupo o por docente, el <b>resumen</b> (clases, horas, grupos confirmados), los <b>conflictos pendientes</b>, las <b>horas por grupo</b> y <b>por docente</b>, con «Imprimir reporte». Esta revisión sólo informa: nunca corrige horarios por su cuenta.</p>
${par(fig('b20-horarios', 'Horarios: elegir escuela y ciclo.', 'med'), fig('b21-horarios-ciclo', 'Horarios del ciclo: resumen, conflictos y horas.', 'med'))}
<h3>Horario del docente</h3>
<p>La ficha del docente muestra el <b>resumen del horario</b> (grupos, materias, horas), su <b>semana</b> por día, las <b>horas de servicio (SE) y otras actividades</b> (registrar, editar, eliminar, confirmar) y los <b>casos especiales</b> («Autorizar caso especial» con motivo). Se puede imprimir.</p>
${par(fig('b24-personal-semana', 'Semana del docente.', 'med'), fig('b25-horario-docente', 'Horario del docente en el ciclo.', 'med'))}`],

  ['docente', '9. Modo docente y «Mi día»', `
<h3>Elegir el docente del dispositivo</h3>
<p>En <b>Modo docente</b> («¿Quién usa este dispositivo?») cada docente toca <b>«Soy yo»</b> junto a su nombre. Es sólo una preferencia del equipo para mostrar su día: <b>no es una contraseña ni un control de acceso</b>. Se puede cambiar en cualquier momento.</p>
${fig('c01-perfil', '¿Quién usa este dispositivo?')}
<h3>Mi día</h3>
<p>Al abrir la app, el docente ve <b>Mi día</b>: la fecha y la hora, la <b>actividad actual</b> (la clase en curso con «Pasar lista» y «Entrar al grupo», o receso, servicio, sin actividad registrada o fuera de jornada), la siguiente clase, la lista de <b>Hoy</b> con su estado, las <b>listas sin guardar</b> de hoy y <b>Mis grupos</b>. También avisa si las listas de este equipo no tienen respaldo reciente.</p>
${par(fig('c02-mi-dia-telefono', 'Mi día en el teléfono.', 'tel'), fig('c03-mi-dia-escritorio', 'Mi día en una computadora.', 'med'))}`],

  ['lista', '10. Pase de lista, salidas del aula y reportes', `
<h3>Pasar lista</h3>
${pasos([
  'Abre la clase desde «Mi día» («Pasar lista») o desde el grupo.',
  'Todos aparecen como <b>Presentes (P)</b>. Toca sólo las <b>Faltas (F)</b> y los <b>Retardos (R)</b>. Para un retardo se anota la hora de llegada.',
  'Usa «Buscar alumno» para encontrar a alguien rápido.',
  'Pulsa <b>«Guardar lista»</b>. Abajo se ven los totales de presentes, faltas y retardos.',
])}
<p>Abrir la lista <b>no guarda nada</b>: mientras no pulses «Guardar lista», la lista está <b>○ NO INICIADA</b> o <b>✎ EN CAPTURA</b> (lo marcado se conserva como borrador en el equipo). Al guardar queda <b>✓ GUARDADA</b>; si después se corrige, <b>↻ MODIFICADA</b>. Hay una sola lista por clase y fecha.</p>
${par(fig('c04-lista-nueva', 'Lista recién abierta (NO INICIADA).', 'tel'), fig('c05-lista-marcas', 'Falta y retardo marcados.', 'tel'), fig('c06-lista-guardada', 'Lista guardada.', 'tel'))}
<h3>Corregir una lista guardada</h3>
<p>Cambia la marca y pulsa «Guardar cambios»; la app pide confirmar. Cada corrección queda en el <b>Historial de correcciones</b> (quién, qué cambió y cuándo).</p>
${par(fig('c07-lista-confirmar-correccion', 'Confirmar la corrección.', 'tel'), fig('c10-lista-historial', 'Historial de correcciones.', 'tel'))}
<h3>Salidas del aula (baño) y regreso</h3>
<p>«Baño» registra la salida <b>en ese momento</b> (se guarda al instante, sin «Guardar lista»). El alumno aparece en «Fuera del aula» con la hora y los minutos transcurridos. «Regresó» registra el regreso. Un alumno sólo puede tener una salida abierta, y el regreso no puede ser antes de la salida.</p>
${nota('una <b>falta</b> y una <b>salida</b> en la misma clase son incompatibles. Si ocurre, la app no lo resuelve sola: pide registrar el regreso o anular la salida.')}
<h3>Reporte breve</h3>
<p>«Reporte» abre un cuadro para anotar un reporte breve del alumno (tipo: conducta, académico, reconocimiento u otro, y texto de hasta 280 caracteres). Queda en la ficha del alumno.</p>
${par(fig('c08-lista-salida', 'Alumno fuera del aula.', 'tel'), fig('c09-lista-reporte', 'Reporte breve.', 'tel'))}
${fig('c11-lista-escritorio', 'Pase de lista en una computadora.')}
<h3>Alumnos del grupo y asistencia del ciclo</h3>
<p>La pantalla del grupo muestra las clases del día para pasar lista, quién está <b>fuera del aula ahora</b>, la <b>asistencia del ciclo</b> de cada alumno (faltas, retardos, salidas, reportes) y los dados de baja. Cada nombre lleva a la ficha del alumno.</p>
${par(fig('c12-alumnos-grupo-faltas', 'Alumnos del grupo con su asistencia.', 'med'), fig('c13-alumno-reportes', 'Ficha con faltas, retardos y reportes.', 'med'))}`],

  ['prefectura', '11. Prefectura', `
<p>Prefectura atiende las ausencias del personal y los grupos que se quedan sin docente. La app <b>sugiere</b>, pero las decisiones (confirmar una falta, asignar una cobertura) siempre las toma y autoriza una persona. Lo que la app deduce se presenta como <b>«posible»</b>, nunca como un hecho.</p>
${fig('d01-prefectura-inicio', 'Prefectura: elegir escuela y ciclo.', 'med')}
<h3>Panel del día</h3>
<p>Para una fecha (con «◀ Día anterior», «Hoy», «Día siguiente ▶») y turno, muestra indicadores, <b>Grupos que requieren atención</b>, la <b>vista por periodo</b> (estado de cada grupo en cada periodo), las <b>incidencias del personal</b>, el <b>personal con horas de servicio (SE) confirmadas</b> y las <b>coberturas</b>. Se puede imprimir el día.</p>
${fig('d02-prefectura-dia', 'Panel del día de Prefectura.')}
<h3>Estado de cada clase</h3>
${tabla(['Estado', 'Significado'], [
  ['ATENDIDA (lista registrada)', 'El docente pasó lista: hubo clase.'],
  ['SIN INFORMACIÓN SUFICIENTE', 'No hay datos para saber qué pasó.'],
  ['POSIBLE GRUPO SIN DOCENTE', 'Hay una incidencia reportada (sin confirmar) del docente de esa clase.'],
  ['GRUPO SIN DOCENTE CONFIRMADO', 'La incidencia se confirmó.'],
  ['COBERTURA ASIGNADA / REALIZADA', 'Otra persona fue asignada (con autorización) o ya atendió al grupo.'],
])}
<h3>Incidencias del personal</h3>
${pasos([
  '«Registrar incidencia»: persona, tipo (Falta, Retardo, Permiso, Salida anticipada u Otra), a qué afecta (toda la jornada o periodos) y observaciones.',
  'Queda <b>REPORTADA (sin confirmar)</b>. Nunca se crean faltas automáticas.',
  'Quien tiene permiso la <b>Confirma</b> o la <b>Descarta</b> (con confirmación).',
])}
${par(fig('d03-prefectura-registrar-incidencia', 'Registrar incidencia.', 'med'), fig('d04-prefectura-incidencia-reportada', 'Incidencia reportada: «posible grupo sin docente».', 'med'))}
${fig('d05-prefectura-incidencia-confirmada', 'Incidencia confirmada: grupo sin docente confirmado.')}
<h3>Coberturas</h3>
<p>Desde un grupo que requiere atención, «Atender» abre la cobertura:</p>
${pasos([
  '<b>Personal sugerido</b>: la app lista quién está disponible a esa hora real y por qué (compatible, con SE, etc.). Sugerir no asigna.',
  '«Proponer personal»: marca a una o varias personas y «Registrar propuesta» (estado <b>Propuesta</b>).',
  '<b>Asignar cobertura (requiere autorización)</b>: persona asignada, <b>quién autorizó</b> (obligatorio), actividad del banco o descripción breve y observaciones. La app revisa que no haya choques de horario.',
  'Al terminar: «Registrar como realizada», «No se realizó» o «Cancelar cobertura».',
])}
${par(fig('d06-cobertura-candidatos', 'Personal sugerido para cubrir.', 'med'), fig('d07-cobertura-asignar', 'Asignar cobertura con autorización.', 'med'))}
${par(fig('d08-cobertura-realizada', 'Cobertura realizada con su historial.', 'med'), fig('d09-prefectura-dia-final', 'El panel del día refleja la cobertura.', 'med'))}
${nota('tener horas de servicio (SE) no significa estar autorizado para cubrir: la autorización siempre se registra aparte. Cada cambio queda en la bitácora de Prefectura.')}
<h3>Banco de actividades</h3>
<p>Actividades listas para usar en una cobertura, por materia y grado. Cualquiera puede <b>registrar</b> una (queda propuesta); Administración, Dirección o Subdirección la <b>validan</b> o la <b>retiran</b>. Sólo las validadas se ofrecen al asignar.</p>
${fig('d10-banco-actividades', 'Banco de actividades.')}
<h3>Reportes e historial</h3>
<p>«Generar reporte» por día, semana, mes o intervalo, con filtros de grupo, docente, tipo de incidencia, estado de cobertura y turno. Muestra indicadores (incidencias confirmadas, coberturas realizadas…), sólo con registros validados, y el detalle; se puede <b>imprimir o guardar como PDF</b> y descargar los datos. El <b>historial</b> muestra todos los cambios con fecha y responsable.</p>
${par(fig('d11-reportes-inicio', 'Reportes e historial.', 'med'), fig('d12-reportes-dia', 'Reporte del día con indicadores.', 'med'))}`],

  ['respaldos', '12. Respaldos y restauración', `
<p>Un <b>respaldo</b> es un archivo con toda la información de una escuela (o de todas). Es la forma de proteger los datos del equipo y de pasarlos a otro equipo.</p>
<h3>Descargar un respaldo</h3>
${pasos([
  'Abre <b>Respaldos</b>.',
  'Deja marcada <b>«Proteger con contraseña»</b> (recomendado: el archivo contiene datos personales) y escribe la contraseña dos veces. Al menos 10 caracteres. La app no guarda la contraseña: si se olvida, el respaldo no se puede abrir.',
  'Pulsa «Descargar respaldo» de la escuela (o «Descargar respaldo de todas las escuelas»).',
  'Guarda el archivo fuera del equipo (USB, nube institucional, NAS).',
])}
${fig('e01-respaldos-con-datos', 'Respaldos: descargar (con contraseña) y restaurar.')}
<h3>Restaurar un respaldo</h3>
${pasos([
  'En «2. Restaurar un respaldo» elige el archivo (y escribe su contraseña si está cifrado).',
  'La app revisa el archivo <b>antes</b> de tocar nada: formato, versión, integridad (huella) y conflictos con lo que ya hay, y muestra una tabla con lo que hay en el dispositivo y en el respaldo («Se agregará», «Se reemplazará»…).',
  'Pulsa «Restaurar» y confirma.',
  'Al terminar aparece el informe de restauración con lo que se agregó.',
])}
${par(fig('b01-respaldos-vacio', 'Respaldos en un equipo vacío.', 'med'), fig('b02-respaldos-revision', 'Revisión del archivo antes de restaurar.', 'med'))}
${par(fig('b03-respaldos-confirmar', 'Confirmar la restauración.', 'med'), fig('b04-respaldos-informe', 'Informe de restauración completa.', 'med'))}
${nota('un archivo alterado, de una versión incompatible o dañado se rechaza sin modificar nada. Si se reemplaza una escuela, antes se descarga automáticamente una copia de lo que había. No se mezclan dos escuelas distintas con la misma CCT. Si la restauración se interrumpe, no queda nada a medias.')}`],

  ['servidor', '13. Trabajo con varias personas (servidor escolar)', `
<p>Con el servidor escolar, varias personas trabajan sobre la misma escuela desde sus propios equipos. <b>No hay contraseñas ni registro abierto</b>: sólo entra quien fue invitado, con un <b>código de 6 dígitos</b> que llega a su correo. Los permisos los revisa el servidor en cada operación.</p>
<h3>Entrar</h3>
${pasos([
  'Abre <b>Cuenta</b> («Cuenta del servidor escolar»).',
  'Escribe el correo con el que te invitaron y pulsa «Enviar código».',
  'Escribe el código de 6 dígitos que llegó a tu correo y pulsa «Entrar». (El código vence en minutos; «Usar otro correo» permite corregir el correo.)',
  'En <b>Mis accesos</b>, pulsa «Usar en este dispositivo» para descargar la escuela con lo que tu rol permite ver.',
])}
${par(fig('s01-cuenta-entrar', 'Entrar con un código al correo.', 'med'), fig('s02-cuenta-codigo', 'Escribir el código recibido.', 'med'))}
${par(fig('s03-cuenta-usar-en-dispositivo', 'Mi cuenta: «Usar en este dispositivo».', 'med'), fig('s06-escuela-sincronizada', 'Escuela descargada y «✓ Sincronizado».', 'med'))}
<p>En las <b>pruebas</b>, los códigos llegan a un <b>buzón de prueba</b> que sólo ve la persona que coordina; en la escuela llegan al correo real.</p>
${par(fig('s04-buzon-prueba', 'Buzón de prueba (sólo en pruebas).', 'med'), fig('s05-buzon-correo-codigo', 'Correo con el código.', 'med'))}
<h3>Mi cuenta</h3>
<p>Muestra <b>Mi cuenta</b> (nombre, correo, «Cerrar sesión»), <b>Mis accesos</b> (escuelas y rol; «Administrar accesos» para la administración; «Ver sincronización»), <b>Verificación en dos pasos</b> y <b>Sesiones abiertas</b> (cerrar una o «Cerrar sesión en todos los dispositivos»). Una sesión dura varios días en ese equipo.</p>
${fig('s07-cuenta-docente', 'Cuenta de una docente.')}
<h3>Cerrar sesión</h3>
<p>Al cerrar sesión la app pregunta si el equipo es compartido: «Conservarlos (dispositivo personal)» o «Quitar los datos de este dispositivo». Cerrar la sesión en un equipo no afecta las sesiones de otras personas.</p>
${fig('s13-cerrar-sesion', '¿Este dispositivo es compartido?', 'med')}
<h3>Sincronización</h3>
<p>Lo que se guarda en el equipo se envía al servidor en segundos si hay conexión, y lo de los demás se recibe periódicamente. El indicador de la barra se calcula de la cola real: <b>nunca dice «Sincronizado» si hay algo pendiente</b>. La pantalla <b>Sincronización</b> muestra, por escuela, lo que falta enviar, el último envío y recepción, «Sincronizar ahora», «Abrir escuela» y «Quitar esta escuela del dispositivo».</p>
${fig('s08-sincronizacion-al-dia', 'Sincronización al día.')}
<h3>Trabajar sin conexión</h3>
<p>Sin internet se sigue trabajando igual: lo guardado queda en el equipo y el indicador muestra «↻ N por enviar» y «Sin conexión». Al volver la conexión, se envía solo y sin duplicados.</p>
${par(fig('s09-sin-conexion-por-enviar', 'Lista guardada sin conexión: «1 por enviar».', 'med'), fig('s10-sincronizacion-pendientes', 'Pendientes por enviar.', 'med'))}
<h3>Conflictos</h3>
<p>Si dos equipos cambiaron el mismo registro sin conexión, el segundo en enviar recibe un <b>Conflicto</b>: la app <b>no sobrescribe nada en silencio</b>. En «Requieren tu decisión» se ve qué cambió en cada lado; la persona elige <b>«Usar la versión del servidor»</b> o <b>«Volver a aplicar mi cambio»</b>, con confirmación.</p>
${par(fig('s11-sincronizacion-conflicto', 'Conflictos que requieren decisión.', 'med'), fig('s12-conflicto-confirmar', 'Confirmar la decisión.', 'med'))}
<h3>Verificación en dos pasos</h3>
<p>Administración y Dirección deben activarla; para los demás es opcional. Se usa una app de autenticación (Google Authenticator, Microsoft Authenticator u otra):</p>
${pasos([
  '«Activar verificación en dos pasos».',
  'Agrega la cuenta en la app de autenticación con la clave que se muestra.',
  'Guarda los <b>10 códigos de respaldo</b> en un lugar seguro (sirven si se pierde el teléfono).',
  'Escribe el código de 6 dígitos que muestra la app y pulsa «Confirmar y activar».',
])}
${par(fig('s14-cuenta-admin-sin-2fa', 'Administración: la verificación es obligatoria.', 'med'), fig('s15-activar-2fa', 'Activar la verificación en dos pasos.', 'med'))}
${fig('s16-cuenta-admin-2fa-activa', 'Verificación en dos pasos activa.', 'med')}
<h3>Accesos de la escuela (administración)</h3>
<p>«Administrar accesos» muestra las <b>personas con acceso</b> (rol, estado: activa o invitación pendiente con vencimiento), con «Reenviar invitación» y «Revocar acceso», y su <b>ficha y permisos</b>: vincular la cuenta con su ficha de personal (para que un docente vea sus grupos) y delegaciones. El formulario <b>Invitar a una persona</b> pide nombre, correo, rol y tipo de correo; un correo <b>personal</b> requiere el consentimiento de la persona. La invitación vence en 7 días. Abajo está la <b>actividad reciente</b> (auditoría, sin datos personales).</p>
${par(fig('s17-accesos-escuela', 'Accesos de la escuela.', 'med'), fig('s18-invitar-persona', 'Invitar a una persona.', 'med'))}
${fig('s19-accesos-con-invitacion', 'Invitación enviada (pendiente).', 'med')}
<h3>Migrar una escuela al servidor</h3>
<p>Pasa al servidor una escuela que hasta ahora vivía sólo en un equipo. Sólo la puede hacer la <b>administración con verificación en dos pasos</b>, en 9 pasos explícitos: 1) respaldo cifrado obligatorio, 2) validar los datos, 3) preparar (misma CCT), 4) ensayo en el servidor sin guardar nada (duplicados y reglas), 5) integridad (conteos y huella iguales), 6) autorización registrada (nombre y cargo, aviso de privacidad, CCT escrita), 7) migrar todo o nada, 8) validar releyendo lo guardado, 9) cambiar el dispositivo a la versión sincronizada. Se puede revertir si no hubo cambios posteriores.</p>
${fig('s20-migracion', 'Migrar una escuela al servidor (equipo sin escuelas locales).', 'med')}
${nota('nunca se migran datos reales sin autorización expresa de la escuela.')}
<h3>Pantallas del servidor sin servidor</h3>
<p>Si la app se usa sólo en el equipo, Cuenta, Sincronización y Migración lo indican («Servidor no disponible», ninguna escuela vinculada) y la app sigue funcionando completa en modo local.</p>
${par(fig('e02-cuenta-sin-servidor', 'Cuenta sin servidor.', 'med'), fig('e03-sincronizacion-local', 'Sincronización en modo local.', 'med'))}
${fig('e04-migracion-local', 'Migración: requiere entrar con la cuenta de administración.', 'med')}`],

  ['roles', '14. Roles y permisos', `
<p>Con el servidor escolar, cada persona tiene un <b>rol</b> por escuela. El servidor aplica los permisos en cada lectura y escritura; ocultar un botón nunca es el permiso.</p>
${tabla(['Rol', 'Qué ve', 'Qué puede hacer'], [
  ['Administrador de la escuela', 'Toda la escuela', 'Invitar, revocar, roles, delegaciones y verificación en dos pasos; confirmar o descartar incidencias; autorizar coberturas; migrar al servidor.'],
  ['Dirección', 'Toda la escuela (incluye CURP y observaciones)', 'Configurar escuela, grupos, horarios y personal; inscribir alumnos; confirmar y reabrir horarios; validar actividades; con delegación, confirmar incidencias y autorizar coberturas.'],
  ['Subdirección', 'Toda la escuela (incluye CURP y observaciones)', 'Grupos, horarios, materias y alumnos; validar actividades; con delegación, confirmar incidencias y autorizar coberturas.'],
  ['Prefectura', 'Toda la escuela (con matrícula, sin CURP)', 'Registrar incidencias y proponer coberturas; salidas del aula y reportes; banco de actividades (proponer).'],
  ['Docente', 'Sólo los grupos donde da clase y sus alumnos', 'Pasar lista de <b>sus</b> clases; salidas del aula y reportes; proponer actividades al banco.'],
  ['Personal de apoyo', 'Alumnos, inscripciones, salidas y reportes', 'Consulta.'],
])}
<p>Datos sensibles: la <b>CURP</b> y las <b>observaciones</b> del alumno sólo las ven Dirección y Subdirección; la <b>matrícula</b>, además, Prefectura; el número de empleado y las observaciones del personal, Administración, Dirección y Subdirección.</p>`],

  ['seguridad', '15. Seguridad y privacidad', lista([
  'Los datos se guardan en el equipo y no se envían a servicios externos. El reconocimiento de texto de los PDF se hace dentro del equipo.',
  'Con el servidor, la conexión es siempre cifrada (HTTPS) y cada persona sólo recibe lo que su rol permite.',
  'Sin contraseñas: entrada con código al correo y, para administración y dirección, verificación en dos pasos.',
  'La auditoría registra accesos y cambios sin guardar correos, nombres ni códigos.',
  'Los respaldos se pueden (y deben) cifrar con contraseña. La app nunca guarda contraseñas.',
  'En equipos compartidos, al cerrar sesión elige «Quitar los datos de este dispositivo».',
  'Para pruebas se usa la escuela de DEMOSTRACIÓN con datos ficticios; nunca se capturan datos reales en un entorno de prueba.',
])],

  ['problemas', '16. Preguntas frecuentes y solución de problemas', tabla(['Situación', 'Qué hacer'], [
  ['No llega el código al correo', 'Revisa el correo escrito y la carpeta de spam; espera un minuto y pide otro. Si dice «Demasiados intentos», espera un minuto.'],
  ['El indicador dice «↻ por enviar»', 'Hay cambios guardados en el equipo que aún no llegan al servidor. Se envían solos al volver la conexión. No borres los datos del navegador.'],
  ['El indicador dice «⚠ por resolver»', 'Entra a Sincronización y decide cada conflicto.'],
  ['No puedo guardar un retardo', 'La hora de llegada no puede ser antes del inicio de la clase.'],
  ['No puedo marcar falta a un alumno', 'Tiene una salida del aula en esa clase: registra su regreso o anula la salida.'],
  ['No me deja asignar una clase', 'Hay un choque de horario del docente (hora real), el grupo está desactivado o el horario está confirmado (hay que reabrirlo con motivo).'],
  ['La importación no guardó todo', 'Sólo se guarda lo correcto y confirmado. Revisa las filas con error, corrige el archivo e importa de nuevo.'],
  ['Cambié de equipo', 'Con servidor: entra con tu correo y «Usar en este dispositivo». Sin servidor: restaura el último respaldo.'],
  ['Quiero empezar las pruebas de cero', 'Quita la escuela de demostración (panel → «Quitar escuela de demostración») o restaura un respaldo.'],
  ['Hay una versión nueva', 'Acepta el aviso cuando no tengas una lista a medias; lo guardado se conserva.'],
])],

  ['glosario', '17. Glosario', tabla(['Término', 'Significado'], [
  ['CCT', 'Clave de centro de trabajo de la escuela.'],
  ['Ciclo escolar', 'Periodo de un año escolar; cada ciclo tiene sus grupos, materias, inscripciones y horarios.'],
  ['Turno / jornada', 'Horario de trabajo (Matutino, Vespertino) con sus periodos y recesos.'],
  ['Periodo (módulo)', 'Bloque de tiempo de una clase.'],
  ['SE (servicio escolar)', 'Horas del docente que no son clase frente a grupo.'],
  ['Inscripción', 'Relación del alumno con un ciclo: turno, grado, grupo, estado y número de lista.'],
  ['Pase de lista', 'Registro de asistencia de una clase en una fecha (una sola por clase y fecha).'],
  ['Incidencia', 'Falta, retardo, permiso u otra situación del personal; primero se reporta y luego se confirma o descarta.'],
  ['Cobertura', 'Atención de un grupo sin docente por otra persona, con autorización.'],
  ['Sincronizar', 'Enviar al servidor lo guardado en el equipo y recibir lo de los demás.'],
  ['Conflicto', 'Dos cambios distintos al mismo registro; lo decide una persona.'],
  ['Respaldo', 'Archivo con los datos de una o todas las escuelas, opcionalmente cifrado.'],
  ['PWA', 'Aplicación web que se instala y funciona sin conexión.'],
])],

  ['pantallas', 'Anexo. Todas las pantallas de la app', tabla(['Pantalla', 'Para qué sirve', 'Sección'], [
  ['Inicio / Bienvenida', 'Punto de partida; Mi día si hay docente elegido', '2, 9'],
  ['Escuelas', 'Lista de escuelas del equipo', '2'],
  ['Asistente', 'Configurar una escuela nueva en 6 pasos', '3'],
  ['Registrar escuela', 'Alta de escuela sin asistente', '3'],
  ['Panel de la escuela', 'Resumen y accesos de la escuela', '4'],
  ['Editar datos escolares', 'Datos del plantel', '4'],
  ['Personal de la escuela', 'Altas, cambios y bajas del personal', '6'],
  ['Semana del docente / Horario del docente', 'Horario, SE y casos especiales', '8'],
  ['Ciclo escolar', 'Turnos, materias, horarios, grados y grupos', '5'],
  ['Turno', 'Periodos y recesos de la jornada', '5'],
  ['Materias', 'Catálogo de materias y actividades', '6'],
  ['Docentes', 'Materias y turnos que puede impartir cada docente', '6'],
  ['Alumnos (ciclo)', 'Búsqueda e inscripción', '6'],
  ['Importar información', 'Excel, CSV y PDF', '7'],
  ['Importar horarios', 'Horarios desde Excel (una fila por clase)', '7'],
  ['Horarios / Horarios del ciclo', 'Resumen, conflictos y reportes', '8'],
  ['Grupo', 'Materias asignadas y horario semanal', '8'],
  ['Alumnos del grupo', 'Clases del día y asistencia del ciclo', '10'],
  ['Ficha y edición del alumno', 'Datos, inscripción, faltas, salidas y reportes', '6, 10'],
  ['Modo docente', 'Elegir quién usa el equipo', '9'],
  ['Pase de lista', 'Asistencia, salidas y reportes de una clase', '10'],
  ['Prefectura (inicio, día, cobertura, actividades, reportes)', 'Incidencias, coberturas y reportes', '11'],
  ['Respaldos', 'Descargar y restaurar', '12'],
  ['Aplicación y datos', 'Instalación, estado y almacenamiento', '2'],
  ['Cuenta / Accesos de la escuela', 'Entrar, verificación, sesiones, invitaciones', '13'],
  ['Sincronización', 'Pendientes y conflictos', '13'],
  ['Migración', 'Pasar una escuela al servidor', '13'],
])],
];
