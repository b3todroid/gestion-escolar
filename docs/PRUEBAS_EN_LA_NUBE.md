# Pruebas en la nube GRATIS con GitHub Codespaces — Gestión Escolar (Fase 12)

**Para qué:** probar la app con teléfonos y tabletas REALES (Android, iPhone, Windows) desde internet, con HTTPS válido, **sin contratar nada** y manejándolo todo desde el navegador de una tableta. **Sólo datos FICTICIOS** (DEMO-001). No es producción.

## Cómo funciona
- GitHub Codespaces crea una máquina temporal en la nube (2 núcleos, 8 GB) con **tu** repositorio.
- Al abrirla, `deploy/scripts/codespaces.sh` hace todo solo:
  1. genera los secretos, que quedan **sólo** dentro del codespace y nunca en git;
  2. compila las imágenes;
  3. levanta la misma pila validada: Caddy, API, PostgreSQL con RLS y el buzón de prueba;
  4. carga DEMO-001.
- GitHub publica la app en `https://NOMBRE-8080.app.github.dev` con certificado **público**, así que la PWA se puede instalar en el teléfono.
- La base de datos y la API **no** quedan expuestas. El buzón de prueba (puerto 8025) queda **privado**: sólo lo abre quien tenga tu sesión de GitHub.

## Costo y límites (cuenta personal gratuita de GitHub)
- La cuota gratuita mensual alcanza para unas **60 horas al mes** con 2 núcleos, más 15 GB de almacenamiento. Si se acaba, GitHub detiene el codespace; **no cobra** si no registraste un método de pago y un límite de gasto.
- Se **apaga solo** tras 30 minutos sin uso y conserva los datos. Al volver a abrirlo, la app se levanta otra vez, con la **misma URL**.
- Al terminar las pruebas, **elimínalo** para liberar el espacio.

## Pasos desde la tableta Android (navegador Chrome)
1. Entra a **github.com** con tu cuenta y abre el repositorio **b3todroid/gestion-escolar**.
2. Toca el botón verde **«<> Code»** → pestaña **«Codespaces»** → **«Create codespace on main»**.
   - Si no ves el botón, activa en Chrome ⋮ → **«Sitio de escritorio»**.
3. Se abre un editor (VS Code en el navegador). **Espera 5–10 minutos** la primera vez: se construye todo. Las siguientes veces tarda menos de un minuto.
   - Para ver el avance: menú ☰ → **Terminal** → **New Terminal**, y escribe:
     ```bash
     tail -f deploy/registro/codespaces.log
     ```
   - Al final aparece un recuadro **«LISTO»** con la dirección de la app.
4. Haz **pública** la app: pestaña **«PUERTOS» / «PORTS»** (panel inferior) → mantén presionado **8080** → **Port Visibility** → **Public**.
   - El script intenta hacerlo solo; si la fila ya dice «Public», sáltate este paso.
   - **No** hagas público el 8025: es el buzón de prueba.
5. En esa misma pestaña, toca el ícono 🌐 de la fila **8080** para abrir la app. Esa dirección (`https://…-8080.app.github.dev`) es la que se usa en todos los equipos de prueba.
   - Si GitHub muestra un aviso la primera vez, toca **Continuar**.
6. **Para entrar:** en la app, «Cuenta» → escribe una cuenta de prueba (por ejemplo `docente.uno.piloto@ejemplo.test`) → **Enviar código**.
7. **Para leer el código:** en la pestaña «PUERTOS», abre el 🌐 de la fila **8025** (Buzón de prueba). Ábrelo desde la tableta, que tiene tu sesión de GitHub.
8. Escribe el código en la app → **«Usar en este dispositivo»**. Listo: ya ves DEMO-001.

Para cuentas en OTROS teléfonos: la persona escribe su cuenta de prueba; tú lees el código en el buzón (paso 7) y se lo dictas.

## Cuentas de prueba (ficticias)
| Rol | Cuenta |
|---|---|
| Administración (pide verificación en dos pasos) | `administrador.piloto@ejemplo.test` |
| Dirección (pide verificación en dos pasos) | `direccion.piloto@ejemplo.test` |
| Prefectura | `prefectura.piloto@ejemplo.test` |
| Docente | `docente.uno.piloto@ejemplo.test` |
| Docente | `docente.dos.piloto@ejemplo.test` |

## Qué probar en cada equipo físico
Sigue el protocolo de `docs/PRUEBAS_MULTIDISPOSITIVO.md`:
- instalar la app;
- entrar con una cuenta de prueba;
- pasar lista;
- usar el modo avión y volver a conectarse;
- revisar Prefectura.

Anota el modelo, el sistema, el navegador y el resultado de cada paso. **Sólo eso permite afirmar compatibilidad.**

## Comandos útiles (en la Terminal del codespace)
```bash
bash deploy/scripts/codespaces.sh
```
Vuelve a levantar todo y muestra la URL.
```bash
bash deploy/scripts/codespaces.sh --reiniciar
```
Borra la base de PRUEBA y vuelve a cargar DEMO-001.
```bash
RECONSTRUIR=1 bash deploy/scripts/codespaces.sh
```
Recompila después de traer cambios con `git pull`.

## Seguridad
- Sólo DEMO-001 (ficticia). **Nunca** cargar datos reales en un codespace.
- Los secretos se generan dentro del codespace y no salen de él: `deploy/secretos/` está excluido de git.
- Sólo se hace público el puerto 8080 (la app). La base y la API no tienen puertos, y el buzón es privado.
- Todas las personas llegan desde el reenvío de GitHub. Para los límites de intentos cuentan como una sola IP (30 códigos por minuto): basta para un grupo de prueba pequeño.

## Qué se comprobó antes de entregarlo (2026-11-04)
- Simulé el codespace en una **copia limpia** del repositorio (sin secretos ni archivos locales), con un HTTPS delante con el mismo nombre de host público:
  - el script terminó en 47 s (imágenes ya compiladas) y cargó DEMO-001;
  - salud 7/7 migraciones; cabeceras de seguridad presentes; buzón de desarrollo cerrado (404); solicitud sin `Origin` rechazada (403); el código llegó al buzón;
  - **9/9** pruebas de navegador (4 de dispositivos, incluida la instalabilidad de la PWA, y 5 multiusuario).
- No probado: un codespace REAL de GitHub. La primera ejecución allí es la prueba definitiva, y también el aviso de GitHub para puertos públicos, si aparece.
