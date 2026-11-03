-- 0004 · Permisos y aislamiento (Fase 8C).
-- Las peticiones de la API sobre datos escolares corren con el rol RESTRINGIDO
-- `gestion_app` (sin BYPASSRLS) y con el usuario en `app.usuario_id`:
--   BEGIN; SET LOCAL ROLE gestion_app; SELECT set_config('app.usuario_id', '<id>', true); …
-- Cada fila de cada tabla escolar se filtra con políticas RLS que consultan la
-- matriz de permisos (`acceso.matriz`) y las membresías ACTIVAS del usuario.
-- Requiere que el usuario dueño de la base pueda crear roles (CREATEROLE).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gestion_app') THEN
    CREATE ROLE gestion_app NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END $$;
GRANT gestion_app TO CURRENT_USER;

-- ---------- Matriz de permisos (datos, no código) ----------
-- alcance: 'escuela' = toda la escuela · 'grupos' = grupos donde imparte (y sus alumnos)
--          · 'propio' = registros de la propia ficha de personal · 'ninguno'
CREATE TABLE acceso.matriz (
  tabla text NOT NULL,
  rol text NOT NULL CHECK (rol IN ('administrador','direccion','subdireccion','prefectura','docente','apoyo')),
  lectura text NOT NULL CHECK (lectura IN ('escuela','grupos','propio','ninguno')),
  escritura text NOT NULL CHECK (escritura IN ('escuela','grupos','propio','ninguno')),
  PRIMARY KEY (tabla, rol)
);

-- Una fila por tabla: lectura y escritura para adm, dir, sub, pre, doc, apo.
-- e = escuela · g = grupos · p = propio · n = ninguno
WITH m(tabla, l, w) AS (VALUES
  ('escuelas',               'eeeeee', 'eennnn'),
  ('ciclos',                 'eeeeee', 'eennnn'),
  ('turnos',                 'eeeeee', 'eennnn'),
  ('jornadas',               'eeeeee', 'eennnn'),
  ('periodos',               'eeeeee', 'eennnn'),
  ('recesos',                'eeeeee', 'eennnn'),
  ('grados',                 'eeeeee', 'eennnn'),
  ('personal',               'eeeeee', 'eennnn'),
  ('grupos',                 'eeeege', 'neennn'),
  ('materias',               'eeeeee', 'neennn'),
  ('asignaciones',           'eeeege', 'neennn'),
  ('sesiones',               'eeeege', 'neennn'),
  ('actividades',            'eeeege', 'neennn'),
  ('excepciones',            'eeeepn', 'neennn'),
  ('confirmaciones',         'eeeege', 'nennnn'),
  ('bitacora',               'eeennn', 'neennn'),
  ('adscripciones',          'eeeepn', 'eeennn'),
  ('alumnos',                'eeeege', 'neennn'),
  ('inscripciones',          'eeeege', 'neennn'),
  ('movimientos',            'eeeege', 'neennn'),
  ('importaciones',          'eeennn', 'eeennn'),
  ('plantillas_importacion', 'eeennn', 'eeennn'),
  ('pases',                  'eeeegn', 'nnnnpn'),
  ('asistencias',            'eeeegn', 'nnnngn'),
  ('cambios_asistencia',     'eeeegn', 'nnnngn'),
  ('salidas',                'eeeege', 'nnnegn'),
  ('reportes',               'eeeege', 'nnnegn'),
  ('incidencias_personal',   'eeeepn', 'eeeenn'),
  ('coberturas',             'eeeepn', 'eeeenn'),
  ('banco_actividades',      'eeeeen', 'eeeeen'),
  ('bitacora_prefectura',    'eeeenn', 'eeeeen')
), roles(i, rol) AS (VALUES (1,'administrador'),(2,'direccion'),(3,'subdireccion'),(4,'prefectura'),(5,'docente'),(6,'apoyo')),
alc(c, alcance) AS (VALUES ('e','escuela'),('g','grupos'),('p','propio'),('n','ninguno'))
INSERT INTO acceso.matriz (tabla, rol, lectura, escritura)
SELECT m.tabla, roles.rol, al.alcance, aw.alcance
FROM m CROSS JOIN roles
JOIN alc al ON al.c = substr(m.l, roles.i, 1)
JOIN alc aw ON aw.c = substr(m.w, roles.i, 1);

-- ---------- Funciones de permiso (SECURITY DEFINER: leen membresías sin exponerlas) ----------
CREATE FUNCTION acceso.usuario_actual() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.usuario_id', true), '')
$$;

-- La transacción de la API queda ATADA a la escuela de la ruta (app.escuela_id): aunque la
-- persona tenga acceso a otras escuelas, en esta petición sólo existe ésta.
CREATE FUNCTION acceso.escuela_permitida(p_escuela uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_escuela IS NOT NULL AND (nullif(current_setting('app.escuela_id', true), '') IS NULL
    OR p_escuela::text = current_setting('app.escuela_id', true))
$$;

-- Grupos donde la ficha de personal vinculada a la membresía DOCENTE imparte clase.
CREATE FUNCTION acceso.mis_grupos(p_escuela uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT g), '{}') FROM (
    SELECT a.grupo_id AS g FROM escolar.asignaciones a JOIN acceso.membresias m
      ON m.personal_id = a.personal_id AND m.escuela_id = a.escuela_id
     WHERE m.usuario_id = acceso.usuario_actual() AND m.escuela_id = p_escuela AND m.estado = 'activa' AND m.rol = 'docente'
    UNION
    SELECT s.grupo_id FROM escolar.sesiones s JOIN acceso.membresias m
      ON m.personal_id = s.personal_id AND m.escuela_id = s.escuela_id
     WHERE m.usuario_id = acceso.usuario_actual() AND m.escuela_id = p_escuela AND m.estado = 'activa' AND m.rol = 'docente'
  ) x
$$;

CREATE FUNCTION acceso.permite(p_escuela uuid, p_tabla text, p_accion text, p_grupos uuid[], p_personas uuid[], p_alumno uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r record;
  alcance text;
  grupos uuid[];
BEGIN
  IF acceso.usuario_actual() IS NULL OR NOT acceso.escuela_permitida(p_escuela) THEN RETURN false; END IF;
  FOR r IN SELECT m.rol, m.personal_id FROM acceso.membresias m
            WHERE m.usuario_id = acceso.usuario_actual() AND m.escuela_id = p_escuela AND m.estado = 'activa' LOOP
    SELECT CASE WHEN p_accion = 'leer' THEN x.lectura ELSE x.escritura END INTO alcance
      FROM acceso.matriz x WHERE x.tabla = p_tabla AND x.rol = r.rol;
    IF alcance = 'escuela' THEN RETURN true; END IF;
    IF alcance IN ('grupos', 'propio') AND r.personal_id IS NOT NULL AND r.personal_id = ANY (p_personas) THEN RETURN true; END IF;
    IF alcance = 'grupos' THEN
      grupos := acceso.mis_grupos(p_escuela);
      IF p_grupos && grupos THEN RETURN true; END IF;
      IF p_alumno IS NOT NULL AND EXISTS (SELECT 1 FROM escolar.inscripciones i
          WHERE i.alumno_id = p_alumno AND i.escuela_id = p_escuela AND i.grupo_id = ANY (grupos)) THEN RETURN true; END IF;
    END IF;
  END LOOP;
  RETURN false;
END $$;

-- Permisos de confirmar/autorizar (decisión D5): el administrador siempre; Dirección y
-- Subdirección sólo si el administrador se los delegó.
CREATE FUNCTION acceso.puede(p_escuela uuid, p_permiso text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM acceso.membresias m
    WHERE m.usuario_id = acceso.usuario_actual() AND m.escuela_id = p_escuela AND m.estado = 'activa' AND acceso.escuela_permitida(p_escuela)
      AND (m.rol = 'administrador' OR (m.rol IN ('direccion','subdireccion') AND p_permiso = ANY (m.permisos_delegados))))
$$;

CREATE FUNCTION acceso.tiene_rol(p_escuela uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM acceso.membresias m
    WHERE m.usuario_id = acceso.usuario_actual() AND m.escuela_id = p_escuela AND m.estado = 'activa' AND m.rol = ANY (p_roles)
      AND acceso.escuela_permitida(p_escuela))
$$;

-- ---------- Políticas RLS ----------
-- Para cada tabla: qué columnas identifican grupo, personas y alumno de la fila.
CREATE TEMP TABLE politicas(tabla text, escuela text, grupos text, personas text, alumno text) ON COMMIT DROP;
INSERT INTO politicas VALUES
  ('escuelas', 'id', NULL, NULL, NULL),
  ('ciclos', 'escuela_id', NULL, NULL, NULL),
  ('turnos', 'escuela_id', NULL, NULL, NULL),
  ('jornadas', 'escuela_id', NULL, NULL, NULL),
  ('periodos', 'escuela_id', NULL, NULL, NULL),
  ('recesos', 'escuela_id', NULL, NULL, NULL),
  ('grados', 'escuela_id', NULL, NULL, NULL),
  ('personal', 'escuela_id', NULL, 'id', NULL),
  ('grupos', 'escuela_id', 'id', NULL, NULL),
  ('materias', 'escuela_id', NULL, NULL, NULL),
  ('asignaciones', 'escuela_id', 'grupo_id', 'personal_id', NULL),
  ('sesiones', 'escuela_id', 'grupo_id', 'personal_id', NULL),
  ('actividades', 'escuela_id', 'grupo_id', 'personal_id', NULL),
  ('excepciones', 'escuela_id', NULL, 'personal_id', NULL),
  ('confirmaciones', 'escuela_id', 'grupo_id', NULL, NULL),
  ('bitacora', 'escuela_id', NULL, NULL, NULL),
  ('adscripciones', 'escuela_id', NULL, 'personal_id', NULL),
  ('alumnos', 'escuela_id', NULL, NULL, 'id'),
  ('inscripciones', 'escuela_id', 'grupo_id', NULL, 'alumno_id'),
  ('movimientos', 'escuela_id', 'grupo_anterior_id, grupo_nuevo_id', NULL, 'alumno_id'),
  ('importaciones', 'escuela_id', NULL, NULL, NULL),
  ('plantillas_importacion', 'escuela_id', NULL, NULL, NULL),
  ('pases', 'escuela_id', 'grupo_id', 'personal_id', NULL),
  ('asistencias', 'escuela_id', 'grupo_id', NULL, NULL),
  ('cambios_asistencia', 'escuela_id', 'grupo_id', 'personal_id', NULL),
  ('salidas', 'escuela_id', 'grupo_id', 'personal_id', NULL),
  ('reportes', 'escuela_id', 'grupo_id', 'personal_id', NULL),
  ('incidencias_personal', 'escuela_id', NULL, 'personal_id', NULL),
  ('coberturas', 'escuela_id', NULL, 'asignado_id, docente_ausente_id', NULL),
  ('banco_actividades', 'escuela_id', NULL, NULL, NULL),
  ('bitacora_prefectura', 'escuela_id', NULL, 'personal_id', NULL);

DO $$
DECLARE p record; expr_leer text; expr_escribir text; args text;
BEGIN
  FOR p IN SELECT * FROM politicas LOOP
    args := format('%s, %L, %%L, ARRAY[%s]::uuid[], ARRAY[%s]::uuid[], %s',
      p.escuela, p.tabla, coalesce(p.grupos, ''), coalesce(p.personas, ''), coalesce(p.alumno, 'NULL::uuid'));
    expr_leer := format('acceso.permite(' || args || ')', 'leer');
    expr_escribir := format('acceso.permite(' || args || ')', 'escribir');
    EXECUTE format('ALTER TABLE escolar.%I ENABLE ROW LEVEL SECURITY', p.tabla);
    EXECUTE format('CREATE POLICY leer ON escolar.%I FOR SELECT TO gestion_app USING (%s)', p.tabla, expr_leer);
    EXECUTE format('CREATE POLICY insertar ON escolar.%I FOR INSERT TO gestion_app WITH CHECK (%s)', p.tabla, expr_escribir);
    EXECUTE format('CREATE POLICY modificar ON escolar.%I FOR UPDATE TO gestion_app USING (%s) WITH CHECK (%s)', p.tabla, expr_escribir, expr_escribir);
    EXECUTE format('CREATE POLICY borrar ON escolar.%I FOR DELETE TO gestion_app USING (%s)', p.tabla, expr_escribir);
  END LOOP;
END $$;

-- Toda tabla del esquema escolar debe tener RLS (si se agrega una tabla sin política, falla aquí).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'escolar' AND c.relkind = 'r' AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'Hay tablas escolares sin seguridad por fila.';
  END IF;
END $$;

GRANT USAGE ON SCHEMA escolar TO gestion_app;
GRANT USAGE ON SCHEMA acceso TO gestion_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA escolar TO gestion_app;
REVOKE ALL ON FUNCTION acceso.mis_grupos(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION acceso.permite(uuid, text, text, uuid[], uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION acceso.puede(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION acceso.tiene_rol(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acceso.usuario_actual(), acceso.escuela_permitida(uuid), acceso.mis_grupos(uuid), acceso.permite(uuid, text, text, uuid[], uuid[], uuid),
  acceso.puede(uuid, text), acceso.tiene_rol(uuid, text[]) TO gestion_app;

-- ---------- Llaves foráneas verificadas al CONFIRMAR la transacción ----------
-- Los servicios de la aplicación (escritos para IndexedDB) pueden insertar el detalle antes
-- que el encabezado dentro de la misma operación; la integridad se exige igual al final.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT con.conname, cl.relname FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = cl.relnamespace WHERE n.nspname = 'escolar' AND con.contype = 'f' LOOP
    EXECUTE format('ALTER TABLE escolar.%I ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED', r.relname, r.conname);
  END LOOP;
END $$;

-- ---------- Integridad: una fila nunca apunta a datos de otra escuela ----------
-- (Las llaves foráneas no ven las políticas RLS: sin esto se podría «colgar» un registro
-- propio de un grupo, alumno o persona de otra escuela.)
CREATE FUNCTION escolar.verificar_misma_escuela() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  i int; col text; destino text; valor jsonb; ids uuid[]; ajenas int;
  fila jsonb := to_jsonb(NEW);
BEGIN
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    col := split_part(TG_ARGV[i], ':', 1);
    destino := split_part(TG_ARGV[i], ':', 2);
    valor := fila -> col;
    IF valor IS NULL OR valor = 'null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(valor) = 'array' THEN
      ids := ARRAY(SELECT jsonb_array_elements_text(valor)::uuid);
    ELSE
      ids := ARRAY[(valor #>> '{}')::uuid];
    END IF;
    EXECUTE format('SELECT count(*) FROM escolar.%I WHERE id = ANY ($1) AND escuela_id <> $2', destino) INTO ajenas USING ids, NEW.escuela_id;
    IF ajenas > 0 THEN
      RAISE EXCEPTION 'Referencia a datos de otra escuela (%.%).', TG_TABLE_NAME, col USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TEMP TABLE referencias(tabla text, refs text[]) ON COMMIT DROP;
INSERT INTO referencias VALUES
  ('ciclos', '{}'),
  ('turnos', '{ciclo_escolar_id:ciclos}'),
  ('jornadas', '{ciclo_escolar_id:ciclos,turno_id:turnos}'),
  ('periodos', '{ciclo_escolar_id:ciclos,jornada_id:jornadas}'),
  ('recesos', '{ciclo_escolar_id:ciclos,jornada_id:jornadas}'),
  ('grados', '{ciclo_escolar_id:ciclos}'),
  ('grupos', '{ciclo_escolar_id:ciclos,grado_id:grados,turno_id:turnos}'),
  ('materias', '{ciclo_escolar_id:ciclos}'),
  ('asignaciones', '{ciclo_escolar_id:ciclos,grupo_id:grupos,materia_id:materias,personal_id:personal}'),
  ('sesiones', '{ciclo_escolar_id:ciclos,asignacion_id:asignaciones,grupo_id:grupos,personal_id:personal,periodo_id:periodos}'),
  ('actividades', '{ciclo_escolar_id:ciclos,personal_id:personal,grupo_id:grupos,periodo_id:periodos}'),
  ('excepciones', '{ciclo_escolar_id:ciclos,personal_id:personal}'),
  ('confirmaciones', '{ciclo_escolar_id:ciclos,grupo_id:grupos}'),
  ('bitacora', '{ciclo_escolar_id:ciclos}'),
  ('adscripciones', '{ciclo_escolar_id:ciclos,personal_id:personal,turno_ids:turnos,materia_ids:materias}'),
  ('inscripciones', '{ciclo_escolar_id:ciclos,alumno_id:alumnos,turno_id:turnos,grado_id:grados,grupo_id:grupos}'),
  ('movimientos', '{ciclo_escolar_id:ciclos,alumno_id:alumnos,inscripcion_id:inscripciones,grupo_anterior_id:grupos,grupo_nuevo_id:grupos}'),
  ('importaciones', '{ciclo_escolar_id:ciclos}'),
  ('pases', '{ciclo_escolar_id:ciclos,grupo_id:grupos,sesion_id:sesiones,asignacion_id:asignaciones,personal_id:personal}'),
  ('asistencias', '{ciclo_escolar_id:ciclos,pase_id:pases,grupo_id:grupos,alumno_id:alumnos}'),
  ('cambios_asistencia', '{ciclo_escolar_id:ciclos,pase_id:pases,grupo_id:grupos,alumno_id:alumnos,personal_id:personal}'),
  ('salidas', '{ciclo_escolar_id:ciclos,grupo_id:grupos,alumno_id:alumnos,sesion_id:sesiones,personal_id:personal,periodo_id:periodos}'),
  ('reportes', '{ciclo_escolar_id:ciclos,grupo_id:grupos,alumno_id:alumnos,personal_id:personal,sesion_id:sesiones}'),
  ('incidencias_personal', '{ciclo_escolar_id:ciclos,personal_id:personal,periodo_ids:periodos,registrada_por:personal,validada_por:personal}'),
  ('coberturas', '{ciclo_escolar_id:ciclos,sesion_id:sesiones,grupo_id:grupos,periodo_id:periodos,docente_ausente_id:personal,incidencia_id:incidencias_personal,propuesto_ids:personal,asignado_id:personal,actividad_id:banco_actividades}'),
  ('banco_actividades', '{ciclo_escolar_id:ciclos,materia_id:materias,grado_id:grados}'),
  ('bitacora_prefectura', '{ciclo_escolar_id:ciclos,personal_id:personal}');

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM referencias WHERE cardinality(refs) > 0 LOOP
    EXECUTE format('CREATE TRIGGER misma_escuela BEFORE INSERT OR UPDATE ON escolar.%I FOR EACH ROW EXECUTE FUNCTION escolar.verificar_misma_escuela(%s)',
      r.tabla, (SELECT string_agg(quote_literal(x), ', ') FROM unnest(r.refs) x));
  END LOOP;
END $$;

-- ---------- Ciclo cerrado: sólo lectura (también en el servidor) ----------
CREATE FUNCTION escolar.ciclo_no_cerrado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ciclo uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.ciclo_escolar_id ELSE NEW.ciclo_escolar_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM escolar.ciclos c WHERE c.id = ciclo AND c.estado = 'cerrado')
     OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM escolar.ciclos c WHERE c.id = OLD.ciclo_escolar_id AND c.estado = 'cerrado')) THEN
    RAISE EXCEPTION 'El ciclo escolar está cerrado: sus datos son de sólo lectura.' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema = 'escolar' AND column_name = 'ciclo_escolar_id' LOOP
    EXECUTE format('CREATE TRIGGER ciclo_abierto BEFORE INSERT OR UPDATE OR DELETE ON escolar.%I FOR EACH ROW EXECUTE FUNCTION escolar.ciclo_no_cerrado()', t);
  END LOOP;
END $$;

-- ---------- Confirmar, autorizar y validar (sólo para la API: rol gestion_app) ----------
CREATE FUNCTION escolar.validar_confirmaciones() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE esc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.escuela_id ELSE NEW.escuela_id END;
BEGIN
  IF current_user = 'gestion_app' AND NOT acceso.tiene_rol(esc, ARRAY['direccion']) THEN
    RAISE EXCEPTION 'Sólo Dirección confirma o reabre horarios.' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER confirmar_horario BEFORE INSERT OR DELETE ON escolar.confirmaciones FOR EACH ROW EXECUTE FUNCTION escolar.validar_confirmaciones();

CREATE FUNCTION escolar.validar_incidencias() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'gestion_app' AND NEW.estado <> 'reportada'
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM NEW.estado OR OLD.validada_por IS DISTINCT FROM NEW.validada_por)
     AND NOT acceso.puede(NEW.escuela_id, 'confirmar_incidencias') THEN
    RAISE EXCEPTION 'Sólo el administrador de la escuela (o a quien delegó) confirma o descarta incidencias.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER confirmar_incidencia BEFORE INSERT OR UPDATE ON escolar.incidencias_personal FOR EACH ROW EXECUTE FUNCTION escolar.validar_incidencias();

CREATE FUNCTION escolar.validar_coberturas() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'gestion_app' AND NEW.estado = 'asignada'
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM NEW.estado OR OLD.asignado_id IS DISTINCT FROM NEW.asignado_id)
     AND NOT acceso.puede(NEW.escuela_id, 'autorizar_coberturas') THEN
    RAISE EXCEPTION 'Sólo el administrador de la escuela (o a quien delegó) autoriza coberturas.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER autorizar_cobertura BEFORE INSERT OR UPDATE ON escolar.coberturas FOR EACH ROW EXECUTE FUNCTION escolar.validar_coberturas();

CREATE FUNCTION escolar.validar_banco() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE esc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.escuela_id ELSE NEW.escuela_id END;
BEGIN
  IF current_user <> 'gestion_app' THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  IF acceso.tiene_rol(esc, ARRAY['administrador','direccion','subdireccion']) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- Prefectura y docentes sólo PROPONEN: no validan ni retiran actividades.
  IF TG_OP = 'DELETE' OR NEW.estado <> 'propuesta' OR (TG_OP = 'UPDATE' AND OLD.estado <> 'propuesta') THEN
    RAISE EXCEPTION 'Sólo Administración, Dirección o Subdirección validan o retiran actividades.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NOT acceso.tiene_rol(esc, ARRAY['prefectura']) THEN
    RAISE EXCEPTION 'Un docente sólo propone actividades nuevas.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validar_actividad BEFORE INSERT OR UPDATE OR DELETE ON escolar.banco_actividades FOR EACH ROW EXECUTE FUNCTION escolar.validar_banco();

-- Historiales: desde la API sólo se agregan.
CREATE FUNCTION escolar.solo_agregar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'gestion_app' THEN
    RAISE EXCEPTION 'Los historiales sólo se agregan; no se modifican ni se borran.' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER solo_agregar BEFORE UPDATE OR DELETE ON escolar.bitacora FOR EACH ROW EXECUTE FUNCTION escolar.solo_agregar();
CREATE TRIGGER solo_agregar BEFORE UPDATE OR DELETE ON escolar.bitacora_prefectura FOR EACH ROW EXECUTE FUNCTION escolar.solo_agregar();
CREATE TRIGGER solo_agregar BEFORE UPDATE OR DELETE ON escolar.cambios_asistencia FOR EACH ROW EXECUTE FUNCTION escolar.solo_agregar();
CREATE TRIGGER solo_agregar BEFORE UPDATE OR DELETE ON escolar.movimientos FOR EACH ROW EXECUTE FUNCTION escolar.solo_agregar();

-- ---------- Operaciones aplicadas (idempotencia de comandos) ----------
CREATE TABLE acceso.operaciones (
  op_id uuid PRIMARY KEY,
  usuario_id text NOT NULL REFERENCES "user"(id),
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  tipo varchar(60) NOT NULL,
  resultado jsonb NOT NULL,
  aplicada_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operaciones_usuario ON acceso.operaciones (usuario_id, aplicada_en DESC);
