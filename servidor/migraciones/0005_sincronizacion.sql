-- 0005 · Sincronización (Fase 8D) y decisión D14.

-- ---------- D14: el administrador de la escuela también modifica grupos y horarios ----------
UPDATE acceso.matriz SET escritura = 'escuela'
 WHERE rol = 'administrador' AND tabla IN ('grupos', 'materias', 'asignaciones', 'sesiones', 'actividades', 'excepciones', 'confirmaciones', 'bitacora');

CREATE OR REPLACE FUNCTION escolar.validar_confirmaciones() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE esc uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.escuela_id ELSE NEW.escuela_id END;
BEGIN
  IF current_user = 'gestion_app' AND NOT acceso.tiene_rol(esc, ARRAY['direccion', 'administrador']) THEN
    RAISE EXCEPTION 'Sólo Dirección o el administrador de la escuela confirman o reabren horarios.' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- ---------- Registro de cambios (feed de sincronización) ----------
-- Cada alta, cambio o baja de una fila escolar agrega una entrada con número de secuencia.
-- Los dispositivos piden «los cambios de mi escuela desde la secuencia N». Sólo guarda
-- identificadores (nunca datos personales); el contenido se lee después con RLS.
CREATE SCHEMA sincronizacion;

CREATE TABLE sincronizacion.cambios (
  seq bigserial PRIMARY KEY,
  escuela_id uuid NOT NULL,
  tabla text NOT NULL,
  registro_id uuid NOT NULL,
  eliminado boolean NOT NULL,
  usuario_id text,
  ocurrido_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cambios_escuela_seq ON sincronizacion.cambios (escuela_id, seq);

-- El candado por escuela (hasta el fin de la transacción) hace que, dentro de una escuela,
-- las secuencias se confirmen en orden: un dispositivo nunca «salta» un cambio que todavía
-- no se había confirmado cuando leyó.
CREATE FUNCTION sincronizacion.registrar_cambio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  fila jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  esc uuid := (fila ->> CASE WHEN TG_TABLE_NAME = 'escuelas' THEN 'id' ELSE 'escuela_id' END)::uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('sincronizacion:' || esc::text, 0));
  INSERT INTO sincronizacion.cambios (escuela_id, tabla, registro_id, eliminado, usuario_id)
  VALUES (esc, TG_TABLE_NAME, (fila ->> 'id')::uuid, TG_OP = 'DELETE', acceso.usuario_actual());
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'escolar' AND c.relkind = 'r' LOOP
    EXECUTE format('CREATE TRIGGER registrar_cambio AFTER INSERT OR UPDATE OR DELETE ON escolar.%I FOR EACH ROW EXECUTE FUNCTION sincronizacion.registrar_cambio()', t);
  END LOOP;
END $$;

-- La API (rol gestion_app) lee el registro sólo de la escuela de la ruta.
ALTER TABLE sincronizacion.cambios ENABLE ROW LEVEL SECURITY;
CREATE POLICY leer ON sincronizacion.cambios FOR SELECT TO gestion_app
  USING (acceso.escuela_permitida(escuela_id) AND acceso.tiene_rol(escuela_id, ARRAY['administrador','direccion','subdireccion','prefectura','docente','apoyo']));
GRANT USAGE ON SCHEMA sincronizacion TO gestion_app;
GRANT SELECT ON sincronizacion.cambios TO gestion_app;
