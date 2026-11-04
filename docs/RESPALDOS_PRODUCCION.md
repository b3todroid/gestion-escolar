# Respaldos en producción — Gestión Escolar (Fase 11)

**Principio:** un respaldo no es confiable hasta que se **comprueba que se restaura**. Por eso la verificación forma parte del procedimiento, no es un paso opcional.

## 1. Qué se respalda
| Qué | Cómo | Dónde vive en producción |
|---|---|---|
| Base de datos completa: datos escolares, cuentas, membresías, auditoría, sincronización y migraciones | `deploy/scripts/respaldar.sh` (`pg_dump -Fc` en una sola transacción de lectura, más un manifiesto de conteos por tabla y huellas de migración) | Volumen `datos_pg` |
| Archivos adjuntos (banco de actividades, ≤ 1 MB cada uno) | Están **dentro de la base**: van en el mismo respaldo | — |
| Configuración necesaria para recuperar | `deploy/` está en el repositorio (versionado). El archivo `deploy/.env` (sin secretos) se copia junto con los respaldos | Servidor |
| Secretos (`deploy/secretos/`) | Copia **separada** de los datos, cifrada y bajo custodia (sin ellos se puede restaurar igual: se generan nuevos) | Servidor |
| Clave **privada** de age | **Nunca** en el servidor. Dos custodios y una copia sellada fuera de línea | Institución |
| Certificados de Caddy | No hace falta respaldarlos (se renuevan solos) | Volumen `caddy_datos` |
| Datos locales de cada dispositivo | Su respaldo cifrado propio (`#/respaldos`) y, en escuelas vinculadas, el servidor | Dispositivos |

## 2. Cifrado
- **age** con clave pública (X25519). El servidor **cifra pero no puede descifrar**: si alguien lo compromete, no puede leer los respaldos. La clave privada sólo se usa para verificar y restaurar.
- Cada archivo `.tar.age` tiene su `.sha256`. Además, age autentica cada bloque: un byte alterado impide descifrar (✓ probado).
- El respaldo sin cifrar sólo existe dentro de una carpeta temporal privada (700) durante el proceso, y se borra al terminar.

## 3. Frecuencia y retención (propuesta: requiere aprobación institucional)
| Tipo | Frecuencia | Retención | Ubicación |
|---|---|---|---|
| Diario (`respaldar.sh`) | Todos los días a las 03:10 (fuera de la jornada) | 35 días en el servidor (`RESPALDO_RETENER_DIAS`) | Servidor, más copia al NAS |
| Semanal | El del domingo se conserva | 12 semanas | NAS, más copia externa |
| Mensual | El del día 1 | 12 meses | Copia externa |
| De ciclo escolar | Al cerrar cada ciclo | Lo que fije la política de conservación (D7, con asesoría jurídica) | Copia externa, fuera de línea |
| Antes de cada actualización o restauración | Manual (forma parte del procedimiento) | Hasta la siguiente actualización correcta | Servidor y NAS |

**Regla 3-2-1:** 3 copias (servidor, NAS y externa), en 2 medios distintos, 1 fuera del sitio. Las copias del NAS y la externa deben ser **de sólo agregar o con versiones**, para que un servidor comprometido no pueda borrarlas.

## 4. Objetivos de recuperación (propuestos: requieren aprobación institucional)
| Objetivo | Propuesta | Con qué se logra | Nota |
|---|---|---|---|
| **RPO** (cuántos datos se pueden perder) | **24 horas** en el servidor | Respaldo diario | En la práctica es menor: los dispositivos conservan su cola sin enviar y sus datos locales, y vuelven a enviarlos tras una restauración (✓ DEP-07). Para bajar a ~15 minutos: archivado continuo de WAL (pgBackRest o WAL-G); no está implementado y debe evaluarse |
| **RTO** (cuánto tarda volver a operar) | **4 horas** | Servidor nuevo + `deploy/` + último respaldo verificado (procedimiento en `PLAN_RECUPERACION.md`) | Medido en preproducción: restaurar la base tarda segundos (2,2 s con DEMO-001); el resto es preparar el servidor y el DNS |

## 5. Verificación periódica (obligatoria)
- **Semanal (automática):**
  ```bash
  deploy/scripts/verificar-respaldo.sh RESPALDO.tar.age IDENTIDAD_AGE
  ```
  Se ejecuta en un equipo de la institución que tenga la clave privada (no en el servidor). Hace todo esto:
  1. Comprueba la suma SHA-256 y descifra.
  2. Restaura en un PostgreSQL **temporal y sin red** (`--network none`) que se borra al terminar.
  3. Compara las migraciones (nombre y huella) y **los conteos de todas las tablas** con el manifiesto tomado al respaldar.
  4. Sale con error si algo no coincide (para alertar).
- **Mensual (simulacro):** restaurar en preproducción (`restaurar.sh` hacia una base nueva) y abrir la app con una cuenta de prueba.
- Registrar cada verificación: fecha, archivo, resultado y quién la hizo.

## 6. Pruebas realizadas (preproducción local, datos ficticios DEMO-001)
| Prueba | Resultado |
|---|---|
| Respaldo cifrado de `gestion_piloto_preprod` (18 MB de base) | ✓ 1,9 MB cifrado, en 0,8 s; el texto no es legible en el archivo |
| Verificación en PostgreSQL temporal sin red | ✓ 7 migraciones y 38 tablas idénticas (39 915 registros), en 6,6 s; el contenedor temporal se borró |
| Archivo alterado (1 byte) | ✓ Rechazado: «La suma SHA-256 no coincide… RESPALDO NO VÁLIDO» |
| Identidad (clave privada) equivocada | ✓ Rechazado: «No se pudo descifrar…» |
| Restaurar sobre la base vigente | ✓ Se niega: «nunca se sobrescribe» |
| Restaurar en una base nueva | ✓ En 2,2 s; las 31 tablas escolares con conteos idénticos a la original |
| Dispositivo con cambios sin enviar mientras la base no está | ✓ Se envían al volver, sin duplicados (DEP-07) |

**No probado:** restauración completa en otro servidor físico o en la nube, copia automática al NAS, y archivado continuo de WAL.

## 7. Programación (ejemplo de cron en el servidor)
```cron
# m h dom mon dow  orden
10 3 * * *  /opt/gestion-escolar/deploy/scripts/respaldar.sh -p gestion-prod -e /opt/gestion-escolar/deploy/.env >> /var/log/gestion-respaldo.log 2>&1 || /opt/gestion-escolar/deploy/scripts/avisar.sh "Falló el respaldo"
40 3 * * *  rsync -a --ignore-existing /var/respaldos/gestion-escolar/ respaldo@nas-institucional:/respaldos/gestion-escolar/ || /opt/gestion-escolar/deploy/scripts/avisar.sh "Falló la copia al NAS"
```
`deploy/scripts/avisar.sh` escribe en el registro del sistema; el canal real (correo o mensajería, con `AVISO_ORDEN`) lo define la institución (**pendiente**). La copia al NAS debe usar una cuenta que **sólo pueda escribir** (`--ignore-existing`, sin borrar).
