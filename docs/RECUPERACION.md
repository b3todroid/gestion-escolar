# Recuperación de datos, respaldos y funcionamiento sin conexión

## 1. Riesgos del almacenamiento local (revisados antes de la Fase 5)
Todos los datos escolares viven **sólo** en IndexedDB del navegador del dispositivo. No hay servidor ni copia en la nube.

| Riesgo | Efecto | Mitigación en la aplicación |
|---|---|---|
| El usuario borra «datos de sitios» / historial completo | Se pierde todo | Respaldos descargables; recordatorio si hay cambios sin respaldar (> 7 días) |
| El navegador desaloja almacenamiento por falta de espacio | Puede borrar todo el sitio | Solicitar **almacenamiento persistente** (`navigator.storage.persist()`); mostrar uso y cuota |
| Safari / iOS: datos de sitios no usados en ~7 días pueden borrarse si la app **no** está instalada en la pantalla de inicio | Pérdida de datos | Recomendar instalar en iPhone/iPad; respaldos frecuentes |
| Navegación privada / incógnito | Los datos desaparecen al cerrar | Advertencia en la pantalla «Aplicación y datos» |
| Dispositivo perdido o compartido | Exposición de datos personales | Respaldos **cifrados con contraseña**; el docente del dispositivo **no** es autenticación |
| Cierre o corte a mitad de una importación o restauración | Datos a medias | Todas las escrituras relacionadas van en **una transacción** de IndexedDB: se guarda todo o nada |
| Actualización de la aplicación | Cambio de esquema | Migraciones `version(n+1)` con `upgrade()` que conservan datos; el Service Worker sólo reemplaza recursos estáticos, nunca IndexedDB |
| Respaldo dañado o manipulado | Restauración incorrecta | Validación Zod por registro, referencias internas, huella SHA-256 (sin cifrar) o etiqueta AES-GCM (cifrado) |
| Respaldo de una versión más nueva | Datos que la app no entiende | Se rechaza: hay que actualizar la aplicación antes |

Esta fase **no modifica el esquema** de la base de datos (sigue en la versión 8): sólo agrega el formato cifrado del archivo de respaldo y verificaciones. No se borra ni transforma ningún registro existente.

## 2. Respaldar
1. Abrir **Respaldos** (`#/respaldos`).
2. Elegir la escuela (o todas). Por omisión el archivo se **protege con contraseña** (mínimo 10 caracteres, se escribe dos veces). La contraseña no se guarda en ningún lugar: si se olvida, el respaldo no se puede abrir.
3. Se descarga `respaldo-gestion-escolar-<CCT>-<fecha>.json` (o `.cifrado.json`). Guardarlo fuera del dispositivo (USB, nube personal).

Contenido del archivo (sin cifrar o dentro del cifrado): formato y versión de formato, **versión del esquema**, **fecha de exportación**, **escuelas**, **ciclos escolares**, **conteo de registros por tabla**, huella SHA-256 y todos los registros con sus relaciones (ids). Se exporta por escuela completa para conservar la integridad referencial.

Cifrado: **AES-GCM de 256 bits** (cifrado autenticado) con clave derivada de la contraseña mediante **PBKDF2-SHA-256 con 600 000 iteraciones** y sal aleatoria de 16 bytes; vector de inicialización aleatorio de 12 bytes. Todo con Web Crypto (`crypto.subtle`), sin bibliotecas externas. Requiere HTTPS o `localhost`.

## 3. Restaurar
1. Seleccionar el archivo. 2. Si está cifrado, escribir la contraseña. 3. Se valida formato y **versión** (un esquema más nuevo se rechaza). 4. Se verifica **integridad** (huella o etiqueta de autenticación; cada registro con Zod; referencias internas). 5. **Resumen**: por escuela, ciclos y conteos «en este dispositivo / en el respaldo». 6. **Conflictos**: escuela distinta con la misma CCT (bloqueado), identificadores que pertenecen a otra escuela (bloqueado), datos del dispositivo **modificados después** de la fecha del respaldo (advertencia con el número de registros que se perderían). 7. **Confirmación explícita**. 8. Restauración **transaccional** (todo o nada); si se reemplaza, antes se descarga automáticamente una copia de los datos actuales. 9. **Informe final** con los registros restaurados por tabla.

Nunca se eliminan registros para «resolver» un conflicto: o se bloquea, o la persona decide reemplazar con advertencia y copia previa.

## 4. Archivos corruptos y versiones incompatibles
- JSON ilegible, formato desconocido, campos faltantes → «no es un respaldo válido». Nada se modifica.
- Huella distinta (sin cifrar) o etiqueta AES-GCM inválida (cifrado) → «el archivo fue modificado o está dañado» / «contraseña incorrecta o archivo dañado» (AES-GCM no distingue ambas causas a propósito).
- Esquema mayor al de la aplicación → «actualiza la aplicación antes de restaurarlo».
- Esquemas anteriores → se convierten igual que las migraciones (p. ej. alumnos anteriores a v6 → inscripciones).

## 5. Interrupciones durante importaciones
Importar catálogos u horarios, restaurar y guardar una lista son operaciones de **una sola transacción**. Si la pestaña se cierra, el dispositivo se apaga o ocurre un error a mitad, IndexedDB descarta la transacción completa: no queda nada a medias. Tras una interrupción basta con volver a analizar el archivo; la importación avisa si el mismo archivo ya se importó (huella).

## 6. Funcionamiento sin conexión: cómo probarlo
1. Abrir la aplicación con conexión una vez (en `npm run preview` o en la versión publicada; el servidor de desarrollo `npm run dev` **no** registra el Service Worker).
2. Esperar el aviso «La aplicación ya puede usarse sin conexión» (o ver «Lista para usarse sin conexión» en **Aplicación y datos**).
3. Desconectar la red (modo avión, o en Chrome: DevTools → Network → Offline).
4. Recargar: la aplicación abre y el indicador muestra «Sin conexión · los datos se guardan en este dispositivo».
5. Consultar escuelas, grupos, docentes, alumnos y horarios; pasar lista con retardos; registrar salida y regreso; registrar una incidencia. Todo se guarda en IndexedDB.
6. Cerrar y volver a abrir (aún sin red): los datos siguen ahí.

No hay sincronización: no se muestra ningún indicador de «sincronizado».

## 7. Instalación
- **Android (Chrome, Edge, Samsung Internet)** y **computadoras (Chrome, Edge)**: botón «Instalar aplicación» en **Aplicación y datos** cuando el navegador lo ofrece, o desde el menú del navegador.
- **iPhone / iPad (Safari)**: Compartir → «Agregar a pantalla de inicio». Safari no ofrece un botón de instalación programable.
- **Firefox de escritorio** no instala PWA; la aplicación funciona igual en el navegador.
Los navegadores no ofrecen las mismas funciones de instalación; la aplicación no lo promete.
