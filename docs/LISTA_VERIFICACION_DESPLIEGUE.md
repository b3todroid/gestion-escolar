# Lista de verificación para un despliegue institucional

> **Fase 11:** esta lista se amplió y se sustituye por `docs/CHECKLIST_PRODUCCION.md`. La configuración del despliegue está en `deploy/` y su guía en `docs/GUIA_PUBLICACION.md`.

**Nada de esta lista se ejecutó contra un servicio real:** no se publicó la aplicación, no se contrató nada y no se usaron datos reales. Cada punto necesita la autorización indicada. Marca: ☑ hecho y verificado en desarrollo · ☐ pendiente.

## A. Requisitos de la aplicación (verificados en desarrollo)
- ☑ Pruebas en verde: unitarias, funcionales, servidor, servidor con navegador, piloto local, piloto multiusuario (`docs/PILOTO_FASE_10.md` §4).
- ☑ Sin incidencias CRÍTICAS ni ALTAS abiertas (`docs/INCIDENCIAS_PILOTO.md`).
- ☑ Migraciones del servidor 0001–0007 con huella verificada; esquema local v13 con migración probada desde versiones anteriores.
- ☑ Compilación sin secretos (`cuenta-local.spec`); `npm audit --omit=dev` = 0.
- ☑ Respaldos cifrados que se restauran en otro dispositivo, también con escuelas grandes.
- ☑ Escuela de demostración (DEMO-001) separada de los datos reales y con limpieza segura.

## B. Infraestructura (requiere autorización y contratación)
- ☐ Hospedaje del servidor en México (D11) con PostgreSQL 14 o posterior administrado y respaldos automáticos (diarios, con prueba de restauración).
- ☐ Dominio propio y **HTTPS** (certificado válido). El servidor se niega a arrancar en producción sin HTTPS.
- ☐ **SMTP** institucional para los códigos de acceso (en producción no existe el buzón de desarrollo).
- ☐ Proxy inverso que entregue la IP real del cliente (los límites de intentos dependen de ella).
- ☐ Variables de entorno de producción (`servidor/configuracion.ejemplo.env`): secreto de Better Auth generado en el servidor y nunca en el repositorio; `MODO=produccion`.
- ☐ Monitoreo y alertas: disponibilidad, errores 5xx, espacio en disco y duración de las transacciones.
- ☐ Revisar las notas de seguridad de Better Auth 1.7.15 o posterior y actualizar si procede (S6).
- ☐ Registro de Google Workspace o Microsoft 365, si se usará acceso institucional (SSO).

## C. Datos y legal (requiere autorización)
- ☐ Aviso de privacidad publicado por la escuela; revisión jurídica (datos de menores; D2).
- ☐ Designación del responsable que autoriza la migración (queda registrado en la base).
- ☐ Ensayo de migración con una copia del respaldo real en un servidor de prueba **aislado** (nunca en producción) y verificación de conteos y huella.
- ☐ Migración real con autorización registrada; respaldo cifrado previo, guardado fuera del dispositivo.
- ☐ Plan de reversión revisado (`docs/MIGRACION.md`, `docs/RECUPERACION.md`).

## D. Dispositivos (requiere a la escuela)
- ☐ Prueba en los **teléfonos Android reales** de la escuela, incluidos los de gama baja (aquí sólo hubo emulación).
- ☐ Prueba en **iPhone** con Safari (aquí no fue posible: sin dispositivo ni WebKit).
- ☐ Tabletas reales.
- ☐ Bloqueo de pantalla obligatorio; almacenamiento persistente concedido (`#/aplicacion`).
- ☐ Decisión sobre dispositivos compartidos: personales, o base local separada por persona (S4) antes de compartirlos.
- ☐ Instalación como app (PWA) en cada dispositivo y prueba sin conexión.

## E. Operación del piloto
- ☐ Escuela piloto y periodo elegidos (D10).
- ☐ Cuentas invitadas por rol; Administración y Dirección con segundo factor activado.
- ☐ Capacitación breve por perfil (docentes, Prefectura, Dirección).
- ☐ Revisión diaria de `#/sincronizacion` (conflictos y rechazos) durante las primeras dos semanas.
- ☐ Respaldo semanal verificado (descargar y restaurar en un navegador de prueba).
- ☐ Criterios de éxito y de suspensión acordados (`docs/PLAN_PILOTO.md` §3).
- ☐ La escuela de demostración NO se carga en el servidor de producción (sólo en `gestion_piloto*`; la herramienta lo impide).
