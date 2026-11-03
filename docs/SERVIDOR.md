# Servidor escolar — Fase 8B (backend y autenticación)

**Estado:** implementado y probado **sólo en un entorno local** con datos ficticios. No se crearon recursos en la nube, no se contrató ningún servicio, no se publicó nada y no se migraron datos. La aplicación **sigue usando sólo los datos locales**: iniciar sesión no envía ni sincroniza datos escolares (la interfaz lo dice).

## Qué incluye
| Parte | Dónde | Notas |
|---|---|---|
| Configuración validada (Zod) | `servidor/src/config.ts` | Sólo variables de entorno; secretos sin valor por omisión; producción bloqueada hasta configurar SMTP en el despliegue |
| Migraciones versionadas | `servidor/migraciones/*.sql`, `servidor/src/migrar.ts` | Una vez cada una, en orden, en transacción; huella SHA-256; se detiene si un archivo aplicado cambia o desaparece; candado para evitar ejecuciones simultáneas |
| Autenticación | `servidor/src/auth.ts` (Better Auth 1.7.11) | Código de 6 dígitos al correo (institucional o personal con consentimiento) y cuenta institucional (Google Workspace / Microsoft 365, OIDC). **Sin contraseñas** y sin registro abierto |
| Verificación en dos pasos | TOTP + 10 códigos de respaldo | Obligatoria para Administrador, Dirección y Subdirección; complemento propio para exigirla también con código al correo y cuenta institucional |
| API propia | `servidor/src/api.ts`, `servidor/src/http.ts` | Perfil, sesiones, miembros, invitaciones, revocación, restablecer verificación, auditoría |
| Operador (D8) | `servidor/src/cli.ts`, `servidor/src/operador.ts` | `migrar`, `alta-escuela`, `restablecer-segundo-factor`. No existen en la web |
| Cliente | `src/remoto/servidorEscolar.ts`, `src/services/cuenta.ts`, `src/pages/cuenta.ts` | Pantallas `#/cuenta` y `#/cuenta/escuela/ID` |

## Decisión técnica: Better Auth en lugar de Supabase Auth
El diseño 8A proponía Supabase Auth (GoTrue) autohospedado o Keycloak/Zitadel. En este entorno no fue posible obtener la imagen de Supabase Auth (Docker Hub devolvió 429 y otros registros estaban bloqueados), y compilarla desde su código no fue autorizado. Se eligió **Better Auth** (biblioteca de código abierto, licencia MIT, sin servicios externos, se instala con npm y corre dentro del propio servidor):
- Cubre lo decidido: código por correo, OIDC/Google/Microsoft, TOTP, sesiones en PostgreSQL, límites de intentos.
- Se autohospeda en la región elegida (D1: México), sin dependencia de un proveedor.
- Riesgo: biblioteca joven con publicaciones frecuentes. Mitigación: versión fija (1.7.11, de hace más de dos semanas), superficie mínima (lista de rutas permitidas), pruebas propias de cada garantía de seguridad. Antes de producción se revisarán las notas de seguridad de versiones posteriores.
- Si en el despliegue se prefiere Supabase Auth o Keycloak, el esquema de membresías y la API no dependen de la biblioteca.

## Medidas de seguridad (verificadas por pruebas)
- **Sin contraseñas caseras ni simuladas**: no hay contraseñas. Los códigos de correo se guardan con hash, caducan a los 5 minutos y se invalidan tras 3 intentos fallidos.
- **Sólo personas invitadas**: un correo sin invitación recibe la misma respuesta que uno invitado (no se revela si existe), no recibe código y no se crea cuenta. Lo mismo con cuentas institucionales.
- **Permisos en el servidor en cada petición**: sesión → segundo factor → membresía activa → rol. «Sin permiso» responde igual exista o no la escuela.
- **Aislamiento entre escuelas**: un administrador no ve, invita ni revoca en otra escuela; revocar en una escuela no afecta el acceso a otra.
- **Revocación inmediata**: las sesiones se consultan en la base en cada petición (sin caché). Revocar el último acceso de una persona borra sus sesiones al instante.
- **Sesión sólo en cookie HttpOnly** (`SameSite=Lax`, `Secure` en producción). El servidor **elimina el token** de cualquier respuesta JSON y no expone `get-session` ni `list-sessions` (devolverían el token).
- **CSRF**: toda petición POST debe traer el `Origin` de la aplicación; cuerpo JSON ≤ 64 KB.
- **Límites de intentos** por dirección y minuto (códigos e intentos de verificación).
- **Superficie mínima**: registro, contraseñas, cambio de correo, borrado de cuenta y demás rutas de la biblioteca responden 404.
- **Segundo factor pendiente**: mientras no se escribe el código TOTP no se puede operar, desactivarlo ni cerrar otras sesiones. Los roles amplios no pueden desactivarlo.
- **Auditoría de sólo agregar** (la base rechaza `UPDATE`, `DELETE` y `TRUNCATE`), con hora del servidor y sin correos, nombres ni códigos.
- **Sin secretos en el cliente**: la aplicación no importa código del servidor; una prueba revisa el código fuente y otra la compilación.
- **Service Worker**: no responde `/api/*` (lista de exclusión), así que no guarda nada del servidor.
- **Errores**: se registran sin datos personales.

## Recuperación del acceso
- No hay contraseñas que recuperar: basta pedir otro código al correo.
- Si alguien perdió su app de autenticación, puede usar un **código de respaldo** (cada uno sirve una vez).
- Sin códigos de respaldo, el **administrador de la escuela** restablece la verificación, tras confirmar su identidad en persona. Se registra el motivo y se cierran sus sesiones. No puede restablecer la suya ni la de alguien con acceso a otras escuelas: eso lo hace el **operador** con `restablecer-segundo-factor`.
- La escuela nunca queda sin administración: nadie puede revocar su propio acceso ni al último administrador activo.

## Correo personal (D4/D12)
Al invitar se indica si el correo es institucional o personal. El personal **exige** marcar que la persona dio su consentimiento; se guarda la fecha. Sólo el administrador de la escuela ve los correos.

## Uso local (desarrollo, datos ficticios)
Requisitos: PostgreSQL 14 o posterior local y Node 22.12 o posterior.
1. Crear un usuario y una base sólo para desarrollo (ejemplo con `psql` como superusuario):
   ```sql
   CREATE ROLE gestion_dev LOGIN CREATEDB PASSWORD 'una-clave-local';
   CREATE DATABASE gestion_dev OWNER gestion_dev;
   ```
2. Copiar `servidor/configuracion.ejemplo.env` como `servidor/.env` (excluido de git) y completar `DATABASE_URL` y `BETTER_AUTH_SECRET`.
3. Dar de alta una escuela ficticia y su administrador:
   ```bash
   npm run servidor:cli -- alta-escuela --nombre "Escuela Ficticia" --cct 32ZZZ0001A --nivel secundaria --entidad 32 --municipio "Municipio Ejemplo" --admin-correo admin@ejemplo.test --admin-nombre "Persona Ficticia" --tipo-correo institucional
   ```
4. `npm run servidor` (aplica las migraciones pendientes y escucha en 127.0.0.1:8787) y, en otra terminal, `npm run dev`. Vite reenvía `/api` al servidor (mismo origen).
5. En `#/cuenta`, el código no sale por correo: se consulta en `http://localhost:5173/api/desarrollo/buzon?correo=…`. El buzón sólo existe fuera de producción y sólo responde a peticiones del propio equipo.

Sin el servidor en marcha, `#/cuenta` indica «Modo local» y todo lo demás funciona igual (D9). `iniciar.cmd` no cambia.

## Pruebas
- `PRUEBAS_POSTGRES_URL=postgres://gestion_dev:…@localhost:5432/postgres npm run test:servidor`: 35 pruebas. Cada archivo crea una base **nueva** y la borra al terminar.
- `PRUEBAS_POSTGRES_URL=… npm run test:e2e:servidor`: 2 pruebas con navegador contra el servidor real.
- `npm run test:e2e` incluye además el modo local sin servidor y la revisión de la compilación sin secretos.
- El inicio con cuenta institucional se prueba con un proveedor OIDC **simulado local** (`oauth2-mock-server`, sólo en `MODO=pruebas`). Google y Microsoft reales requieren registrar la aplicación en el despliegue.

## Pendiente (requiere autorización)
- **Despliegue** en la nube elegida (D11): servidor, PostgreSQL gestionado, HTTPS, proxy inverso con IP de cliente confiable, respaldos y monitoreo.
- **Envío por SMTP**: el servidor se niega a arrancar en producción sin él.
- **Registro de Google y Microsoft** con las cuentas del administrador (D8).
- **8C**: políticas RLS, matriz de permisos completa, delegación (D5) y validación de reglas de negocio en el servidor. Para eso hace falta compartir `domain/` con el servidor, empaquetándolo con Vite.
- **8D**: sincronización. **8E**: migración de datos reales, sólo con autorización.
- **Aviso de privacidad por escuela** (D2) y retención de 1 ciclo (D7).
