-- 0002 · Espejo del modelo escolar de la aplicación (esquema local v10).
-- Una tabla por cada tabla del respaldo (validators/respaldo.ts), con los MISMOS
-- identificadores (UUID) y campos en snake_case. En la Fase 8B estas tablas quedan
-- VACÍAS: no se migra información. Sirven de base para permisos (8C) y sincronización (8D).
-- Las restricciones únicas reproducen las de IndexedDB; las reglas de negocio entre
-- tablas se validarán en el servidor en 8C.

CREATE SCHEMA escolar;

CREATE DOMAIN escolar.hora AS text CHECK (VALUE ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
CREATE DOMAIN escolar.dia AS smallint CHECK (VALUE BETWEEN 1 AND 7);
CREATE DOMAIN escolar.version AS integer CHECK (VALUE >= 1);

CREATE TABLE escolar.escuelas (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  nombre varchar(150) NOT NULL,
  cct varchar(20),
  nivel text NOT NULL CHECK (nivel IN ('inicial','preescolar','primaria','secundaria','media_superior','otro')),
  localidad varchar(120),
  nombre_corto varchar(60),
  entidad varchar(2),
  zona_escolar varchar(20),
  sector varchar(20),
  domicilio varchar(200),
  telefono varchar(10),
  correo varchar(120),
  logotipo text CHECK (logotipo IS NULL OR (length(logotipo) <= 400000 AND logotipo ~ '^data:image/(png|jpeg|webp);base64,'))
);
-- Escuelas distintas nunca comparten CCT (no se mezclan).
CREATE UNIQUE INDEX escuelas_cct_unica ON escolar.escuelas (upper(cct)) WHERE cct IS NOT NULL;

CREATE TABLE escolar.ciclos (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  nombre varchar(40) NOT NULL,
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  estado text NOT NULL CHECK (estado IN ('planeacion','activo','cerrado')),
  CHECK (fecha_fin >= fecha_inicio)
);
CREATE INDEX ciclos_escuela ON escolar.ciclos (escuela_id);

CREATE TABLE escolar.turnos (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  nombre varchar(40) NOT NULL
);
CREATE INDEX turnos_ciclo ON escolar.turnos (ciclo_escolar_id);

CREATE TABLE escolar.jornadas (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  turno_id uuid NOT NULL UNIQUE REFERENCES escolar.turnos(id),
  hora_inicio escolar.hora NOT NULL,
  hora_fin escolar.hora NOT NULL,
  dias smallint[] NOT NULL CHECK (cardinality(dias) <= 7 AND dias <@ ARRAY[1,2,3,4,5,6,7]::smallint[])
);

CREATE TABLE escolar.periodos (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  jornada_id uuid NOT NULL REFERENCES escolar.jornadas(id),
  nombre varchar(40) NOT NULL,
  hora_inicio escolar.hora NOT NULL,
  hora_fin escolar.hora NOT NULL
);
CREATE INDEX periodos_jornada ON escolar.periodos (jornada_id);

CREATE TABLE escolar.recesos (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  jornada_id uuid NOT NULL REFERENCES escolar.jornadas(id),
  nombre varchar(40) NOT NULL,
  hora_inicio escolar.hora NOT NULL,
  hora_fin escolar.hora NOT NULL
);
CREATE INDEX recesos_jornada ON escolar.recesos (jornada_id);

CREATE TABLE escolar.grados (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  numero smallint NOT NULL CHECK (numero BETWEEN 1 AND 99),
  nombre varchar(40) NOT NULL
);
CREATE INDEX grados_ciclo ON escolar.grados (ciclo_escolar_id);

CREATE TABLE escolar.grupos (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  grado_id uuid NOT NULL REFERENCES escolar.grados(id),
  turno_id uuid NOT NULL REFERENCES escolar.turnos(id),
  nombre varchar(20) NOT NULL,
  capacidad smallint CHECK (capacidad BETWEEN 1 AND 80),
  activo boolean NOT NULL
);
CREATE INDEX grupos_ciclo ON escolar.grupos (ciclo_escolar_id);

CREATE TABLE escolar.personal (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  nombre varchar(60) NOT NULL,
  primer_apellido varchar(60) NOT NULL,
  segundo_apellido varchar(60),
  numero_empleado varchar(20),
  funciones text[] NOT NULL CHECK (cardinality(funciones) <= 15 AND funciones <@ ARRAY['docente','prefectura','direccion','subdireccion_academica','subdireccion_gestion','orientacion','trabajo_social','udei','secretaria','asistencia_escolar','biblioteca','otro','directivo','administrativo','apoyo']),
  activo boolean NOT NULL,
  observaciones varchar(300)
);
CREATE INDEX personal_escuela ON escolar.personal (escuela_id);

CREATE TABLE escolar.materias (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  nombre varchar(80) NOT NULL,
  abreviatura varchar(12),
  tipo text NOT NULL CHECK (tipo IN ('materia','campo_formativo','taller','tutoria','actividad_especial','servicio')),
  activo boolean NOT NULL
);
CREATE INDEX materias_ciclo ON escolar.materias (ciclo_escolar_id);

CREATE TABLE escolar.asignaciones (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  grupo_id uuid NOT NULL REFERENCES escolar.grupos(id),
  materia_id uuid NOT NULL REFERENCES escolar.materias(id),
  personal_id uuid REFERENCES escolar.personal(id),
  horas_semana smallint NOT NULL CHECK (horas_semana BETWEEN 1 AND 40)
);
CREATE INDEX asignaciones_grupo ON escolar.asignaciones (grupo_id);
CREATE INDEX asignaciones_personal ON escolar.asignaciones (personal_id);

CREATE TABLE escolar.sesiones (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  asignacion_id uuid NOT NULL REFERENCES escolar.asignaciones(id),
  grupo_id uuid NOT NULL REFERENCES escolar.grupos(id),
  personal_id uuid REFERENCES escolar.personal(id),
  dia escolar.dia NOT NULL,
  periodo_id uuid NOT NULL REFERENCES escolar.periodos(id),
  origen text CHECK (origen IN ('manual','importacion'))
);
CREATE INDEX sesiones_grupo ON escolar.sesiones (grupo_id);
CREATE INDEX sesiones_personal ON escolar.sesiones (personal_id);

CREATE TABLE escolar.actividades (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  tipo text NOT NULL CHECK (tipo IN ('servicio','otra')),
  personal_id uuid REFERENCES escolar.personal(id),
  grupo_id uuid REFERENCES escolar.grupos(id),
  periodo_id uuid REFERENCES escolar.periodos(id),
  dia escolar.dia NOT NULL,
  hora_inicio escolar.hora NOT NULL,
  hora_fin escolar.hora NOT NULL,
  descripcion varchar(120) NOT NULL,
  confirmada boolean NOT NULL,
  confirmada_en timestamptz,
  origen text CHECK (origen IN ('manual','importacion'))
);
CREATE INDEX actividades_personal ON escolar.actividades (personal_id);

CREATE TABLE escolar.excepciones (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  personal_id uuid NOT NULL REFERENCES escolar.personal(id),
  dia escolar.dia NOT NULL,
  hora_inicio escolar.hora NOT NULL,
  hora_fin escolar.hora NOT NULL,
  motivo varchar(200) NOT NULL
);

CREATE TABLE escolar.confirmaciones (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  grupo_id uuid NOT NULL UNIQUE REFERENCES escolar.grupos(id)
);

CREATE TABLE escolar.bitacora (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  entidad text NOT NULL CHECK (entidad IN ('horario_grupo','actividad')),
  entidad_id uuid NOT NULL,
  accion text NOT NULL CHECK (accion IN ('confirmar','reabrir','importar')),
  motivo varchar(200),
  detalle varchar(300)
);

CREATE TABLE escolar.alumnos (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  nombre varchar(60) NOT NULL,
  primer_apellido varchar(60) NOT NULL,
  segundo_apellido varchar(60),
  matricula varchar(30),
  curp varchar(18),
  observaciones varchar(300)
);
CREATE INDEX alumnos_escuela ON escolar.alumnos (escuela_id);
-- Matrícula y CURP identifican a la persona dentro de la escuela (el nombre nunca).
CREATE UNIQUE INDEX alumnos_matricula_unica ON escolar.alumnos (escuela_id, upper(matricula)) WHERE matricula IS NOT NULL;
CREATE UNIQUE INDEX alumnos_curp_unica ON escolar.alumnos (escuela_id, upper(curp)) WHERE curp IS NOT NULL;

CREATE TABLE escolar.inscripciones (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  alumno_id uuid NOT NULL REFERENCES escolar.alumnos(id),
  turno_id uuid REFERENCES escolar.turnos(id),
  grado_id uuid REFERENCES escolar.grados(id),
  grupo_id uuid REFERENCES escolar.grupos(id),
  estado text NOT NULL CHECK (estado IN ('inscrito','baja')),
  numero_lista smallint CHECK (numero_lista BETWEEN 1 AND 200),
  UNIQUE (alumno_id, ciclo_escolar_id)
);
CREATE INDEX inscripciones_grupo ON escolar.inscripciones (grupo_id);

CREATE TABLE escolar.movimientos (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  alumno_id uuid NOT NULL REFERENCES escolar.alumnos(id),
  inscripcion_id uuid NOT NULL REFERENCES escolar.inscripciones(id),
  tipo text NOT NULL CHECK (tipo IN ('alta','cambio_grupo','baja','reactivacion','migracion')),
  grupo_anterior_id uuid REFERENCES escolar.grupos(id),
  grupo_nuevo_id uuid REFERENCES escolar.grupos(id),
  motivo varchar(300)
);

CREATE TABLE escolar.adscripciones (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  personal_id uuid NOT NULL REFERENCES escolar.personal(id),
  turno_ids uuid[] NOT NULL CHECK (cardinality(turno_ids) <= 20),
  materia_ids uuid[] NOT NULL CHECK (cardinality(materia_ids) <= 200),
  UNIQUE (personal_id, ciclo_escolar_id)
);

CREATE TABLE escolar.importaciones (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  tipo text NOT NULL CHECK (tipo IN ('alumnos','docentes','personal','materias','grupos','horarios')),
  archivo varchar(200) NOT NULL,
  hoja varchar(100),
  huella char(64) CHECK (huella ~ '^[0-9a-f]{64}$'),
  resultado jsonb NOT NULL
);

CREATE TABLE escolar.pases (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  grupo_id uuid NOT NULL REFERENCES escolar.grupos(id),
  sesion_id uuid NOT NULL REFERENCES escolar.sesiones(id),
  asignacion_id uuid NOT NULL REFERENCES escolar.asignaciones(id),
  personal_id uuid REFERENCES escolar.personal(id),
  fecha date NOT NULL,
  hora_inicio escolar.hora NOT NULL,
  hora_fin escolar.hora NOT NULL,
  guardado_en timestamptz NOT NULL,
  correcciones integer NOT NULL CHECK (correcciones >= 0),
  UNIQUE (sesion_id, fecha)
);

CREATE TABLE escolar.asistencias (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  pase_id uuid NOT NULL REFERENCES escolar.pases(id),
  grupo_id uuid NOT NULL REFERENCES escolar.grupos(id),
  alumno_id uuid NOT NULL REFERENCES escolar.alumnos(id),
  fecha date NOT NULL,
  marca char(1) NOT NULL CHECK (marca IN ('P','F','R')),
  hora_llegada escolar.hora
);
CREATE INDEX asistencias_pase ON escolar.asistencias (pase_id);
CREATE INDEX asistencias_alumno ON escolar.asistencias (alumno_id, fecha);

CREATE TABLE escolar.salidas (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  grupo_id uuid NOT NULL REFERENCES escolar.grupos(id),
  alumno_id uuid NOT NULL REFERENCES escolar.alumnos(id),
  sesion_id uuid NOT NULL REFERENCES escolar.sesiones(id),
  fecha date NOT NULL,
  salida escolar.hora NOT NULL,
  regreso escolar.hora,
  personal_id uuid REFERENCES escolar.personal(id),
  periodo_id uuid REFERENCES escolar.periodos(id),
  CHECK (regreso IS NULL OR regreso >= salida)
);

CREATE TABLE escolar.reportes (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  grupo_id uuid NOT NULL REFERENCES escolar.grupos(id),
  alumno_id uuid NOT NULL REFERENCES escolar.alumnos(id),
  personal_id uuid REFERENCES escolar.personal(id),
  sesion_id uuid REFERENCES escolar.sesiones(id),
  fecha date NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('conducta','academico','reconocimiento','otro')),
  texto varchar(280) NOT NULL,
  hora escolar.hora,
  estado text NOT NULL CHECK (estado IN ('abierta','atendida'))
);

CREATE TABLE escolar.cambios_asistencia (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  pase_id uuid NOT NULL REFERENCES escolar.pases(id),
  grupo_id uuid NOT NULL REFERENCES escolar.grupos(id),
  alumno_id uuid NOT NULL REFERENCES escolar.alumnos(id),
  marca_anterior char(1) NOT NULL CHECK (marca_anterior IN ('P','F','R')),
  marca_nueva char(1) NOT NULL CHECK (marca_nueva IN ('P','F','R')),
  llegada_anterior escolar.hora,
  llegada_nueva escolar.hora,
  personal_id uuid REFERENCES escolar.personal(id)
);

CREATE TABLE escolar.plantillas_importacion (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  nombre varchar(80) NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('alumnos','docentes','personal','materias','grupos','horarios')),
  estructura text NOT NULL CHECK (estructura IN ('automatica','lista','sabana_grupo','sabana_docente')),
  columnas jsonb NOT NULL,
  umbral_confianza real NOT NULL CHECK (umbral_confianza BETWEEN 0 AND 1)
);

CREATE TABLE escolar.incidencias_personal (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  personal_id uuid NOT NULL REFERENCES escolar.personal(id),
  fecha date NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('falta','retardo','permiso','salida_anticipada','otra')),
  tipo_otro varchar(60),
  alcance text NOT NULL CHECK (alcance IN ('jornada','periodos')),
  periodo_ids uuid[] NOT NULL CHECK (cardinality(periodo_ids) <= 30),
  observaciones varchar(300),
  estado text NOT NULL CHECK (estado IN ('reportada','confirmada','descartada')),
  registrada_por uuid REFERENCES escolar.personal(id),
  validada_por uuid REFERENCES escolar.personal(id),
  validada_en timestamptz,
  motivo_validacion varchar(300)
);
CREATE INDEX incidencias_personal_fecha ON escolar.incidencias_personal (ciclo_escolar_id, fecha);

CREATE TABLE escolar.coberturas (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  sesion_id uuid NOT NULL REFERENCES escolar.sesiones(id),
  fecha date NOT NULL,
  grupo_id uuid NOT NULL REFERENCES escolar.grupos(id),
  periodo_id uuid NOT NULL REFERENCES escolar.periodos(id),
  docente_ausente_id uuid REFERENCES escolar.personal(id),
  incidencia_id uuid REFERENCES escolar.incidencias_personal(id),
  propuesto_ids uuid[] NOT NULL CHECK (cardinality(propuesto_ids) <= 20),
  asignado_id uuid REFERENCES escolar.personal(id),
  actividad_id uuid,
  actividad_texto varchar(300),
  autorizado_por varchar(120),
  autorizado_en timestamptz,
  estado text NOT NULL CHECK (estado IN ('sin_docente','propuesta','asignada','realizada','no_realizada','cancelada')),
  observaciones varchar(300),
  UNIQUE (sesion_id, fecha)
);

CREATE TABLE escolar.banco_actividades (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  materia_id uuid REFERENCES escolar.materias(id),
  grado_id uuid REFERENCES escolar.grados(id),
  titulo varchar(120) NOT NULL,
  descripcion varchar(1000) NOT NULL,
  archivo jsonb,
  fecha date NOT NULL,
  responsable varchar(120),
  estado text NOT NULL CHECK (estado IN ('propuesta','validada','retirada'))
);
ALTER TABLE escolar.coberturas ADD FOREIGN KEY (actividad_id) REFERENCES escolar.banco_actividades(id);

CREATE TABLE escolar.bitacora_prefectura (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL, actualizado_en timestamptz NOT NULL, version escolar.version NOT NULL,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  ciclo_escolar_id uuid NOT NULL REFERENCES escolar.ciclos(id),
  entidad text NOT NULL CHECK (entidad IN ('incidencia','cobertura','actividad')),
  entidad_id uuid NOT NULL,
  accion varchar(40) NOT NULL,
  detalle varchar(300),
  personal_id uuid REFERENCES escolar.personal(id),
  orden bigint NOT NULL CHECK (orden >= 0)
);
