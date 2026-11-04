# Plan de prueba piloto controlada

> **Fase 10:** el piloto se ejecutó en condiciones SIMULADAS con la escuela ficticia DEMO-001. Resultado y dictamen: `docs/PILOTO_FASE_10.md`. Lista de verificación para el despliegue: `docs/LISTA_VERIFICACION_DESPLIEGUE.md`.

**Estado:** preparado con datos FICTICIOS. El piloto con datos reales **no** puede empezar hasta cumplir los requisitos del apartado 2, y cada uno necesita autorización.

## 1. Entornos de prueba disponibles hoy (datos ficticios)
### A. Sólo dispositivo (sin servidor) — uso diario de un docente o una escuela
- **Windows:** doble clic en `iniciar.cmd`.
- **Cualquier equipo con Node 22.12 o posterior:**
  ```bash
  npm install
  ```
  ```bash
  npm run dev
  ```
  Abre http://localhost:5173.
- **Versión con funcionamiento sin conexión:**
  ```bash
  npm run build
  ```
  ```bash
  npm run preview
  ```
  Abre http://localhost:4173.
- **Recorrido sugerido:**
  1. Configura la escuela con el asistente.
  2. En «Importar información», carga `tests/fixtures/alumnos-sinonimos.xlsx` y `tests/fixtures/personal.csv`.
  3. Registra materias y asigna el horario.
  4. Elige el docente del dispositivo (`#/perfil`) y entra a «Mi día»: pasa lista con retardos, registra una salida al baño y el regreso.
  5. Consulta «Asistencia del ciclo» del grupo.
  6. Abre Prefectura: incidencia → propuesta → autorización → cobertura → reporte.
- **Perfiles en este modo:** el «docente de este dispositivo» **no es una cuenta ni un permiso seguro**. Cualquiera con el dispositivo puede cambiarlo, y la interfaz lo dice.

### B. Con servidor escolar local — cuentas y permisos reales (Administrador, Dirección, Prefectura, Docente)
Requiere PostgreSQL 14 o posterior y un usuario con `CREATEDB` y `CREATEROLE`.

1. Crea una base **vacía** sólo para la demostración y configura `servidor/.env` (ver `servidor/configuracion.ejemplo.env`):
   ```bash
   createdb gestion_demo
   ```
2. Carga la escuela de demostración y sus cuentas:
   ```bash
   DATABASE_URL=postgres://USUARIO:CLAVE@localhost:5432/gestion_demo npm run servidor:demo
   ```
   Crea «Escuela Secundaria Ficticia (DEMOSTRACIÓN)» (CCT 32ZZZ0001D) con datos completos y estas cuentas:

   | Rol | Correo (ficticio) | Nota |
   |---|---|---|
   | Administrador | administrador.demo@ejemplo.test | Activa la verificación en dos pasos al entrar |
   | Dirección | direccion.demo@ejemplo.test | Activa la verificación en dos pasos al entrar |
   | Prefectura | prefectura.demo@ejemplo.test | Vinculada a la ficha «Prefecto Ficticio» |
   | Docente | docente.demo@ejemplo.test | Vinculada a «Docente Uno Ficticio» (grupo A) |
3. Arranca el servidor apuntando a esa base:
   ```bash
   DATABASE_URL=postgres://USUARIO:CLAVE@localhost:5432/gestion_demo npm run servidor
   ```
4. En otra terminal, arranca la aplicación:
   ```bash
   npm run dev
   ```
5. En `#/cuenta`, entra con cada correo. El código **no sale por correo**: se lee en http://localhost:5173/api/desarrollo/buzon?correo=CORREO, sólo desde ese equipo.
6. Cada perfil hace «Usar en este dispositivo», trabaja sin conexión (modo avión) y sincroniza. Conviene usar un navegador o perfil de navegador distinto por cada persona.
7. Para probar una migración, el administrador usa `#/migracion` con una escuela local **ficticia** de la misma CCT, dada de alta vacía en el servidor con `npm run servidor:cli -- alta-escuela …`.

### C. Entorno del piloto de la Fase 10 (DEMO-001, datos FICTICIOS)
- **Sólo dispositivo:**
  ```bash
  npm run piloto -- datos --escala 1
  ```
  ```bash
  npm run piloto:app
  ```
  Abre http://localhost:4180 (origen propio: su almacenamiento está separado del de desarrollo) y carga `piloto/salida/DEMO-001.json` con «Restaurar». Para terminar, «Quitar escuela de demostración» en el panel de la escuela: sólo existe y sólo actúa en escuelas de demostración.
- **Con servidor:**
  ```bash
  DATABASE_URL=postgres://USUARIO:CLAVE@localhost:5432/gestion_piloto npm run piloto -- servidor iniciar
  ```
  Crea la base si falta, carga DEMO-001 con la huella verificada e invita a Administración, Dirección, Prefectura y dos docentes (`*.piloto@ejemplo.test`). Para borrarla:
  ```bash
  DATABASE_URL=postgres://USUARIO:CLAVE@localhost:5432/gestion_piloto npm run piloto -- servidor limpiar
  ```
  La herramienta se niega con cualquier base que no se llame `gestion_piloto*`, o que tenga una escuela que no sea de demostración.

## 2. Requisitos pendientes para un piloto con datos reales
| # | Requisito | Responsable | Estado |
|---|---|---|---|
| 1 | Elegir la escuela piloto y el periodo dentro del ciclo (D10) | Administrador | Pendiente |
| 2 | Aviso de privacidad publicado por la escuela y revisión jurídica (datos de menores; D2) | Escuela / área jurídica | Pendiente |
| 3 | Desplegar el servidor en la nube elegida en México (D11): HTTPS, SMTP, respaldos del servidor, monitoreo, proxy con IP real | Operador (D8) | Pendiente (requiere autorización y contratación) |
| 4 | Registro de Google Workspace o Microsoft 365, si se usará SSO | Operador | Pendiente |
| 5 | Base local separada por persona en dispositivos compartidos (riesgo S4) | Desarrollo | Propuesto |
| 6 | Medir el servidor con volumen (RLS por fila) | Desarrollo | Pendiente |
| 7 | Ensayo de migración con una copia del respaldo real en un servidor de prueba aislado | Administrador + desarrollo | Pendiente (requiere autorización) |
| 8 | Capacitación breve: docentes (Mi día, lista, salidas), Prefectura (panel del día, coberturas), Dirección (confirmaciones, delegación) | Escuela | Pendiente |
| 9 | Dispositivos con bloqueo de pantalla y almacenamiento persistente concedido | Escuela | Pendiente |
| 10 | Probar en los teléfonos y tabletas reales de la escuela (gama baja), con red intermitente, antes de la semana 1. Referencia: tiempos medidos en `docs/AUDITORIA_FASE_9.md` §5 | Desarrollo + escuela | Pendiente |
| 11 | Respaldo de prueba de una escuela completa y restauración en otro dispositivo (verifica tamaño y tiempo reales) | Administrador | Pendiente |

## 3. Desarrollo del piloto (propuesta)
1. **Semana 0:** respaldo cifrado, ensayo de migración, migración con autorización y alta de cuentas.
2. **Semanas 1–2:** pase de lista diario en grupos seleccionados y Prefectura en un turno. Revisión diaria de `#/sincronizacion` (conflictos).
3. **Semana 3:** todos los grupos del turno. Revisión de reportes contra los registros en papel.
4. **Criterios de éxito:**
   - Cero pérdidas de datos.
   - Cero accesos indebidos.
   - Conflictos resueltos explícitamente.
   - Tiempo de pase de lista ≤ 1 minuto por grupo.
   - Respaldo semanal verificado.
5. **Criterios de suspensión:** cualquier pérdida o exposición de datos, o un conflicto que no se pueda resolver. Si se suspende, se revierte la migración o se vuelve al respaldo (`docs/MIGRACION.md`, `docs/RECUPERACION.md`).
