-- 0006 · Migración de datos locales al servidor (Fase 8E).
-- Cada migración de una escuela queda registrada con su autorización, conteos y huella, y con
-- la lista de registros que agregó para poder REVERTIRLA completa mientras nadie haya hecho
-- cambios después.

-- La precisión de `real` alteraba valores como 0.6 al ida-y-vuelta (la huella no coincidía).
ALTER TABLE escolar.plantillas_importacion ALTER COLUMN umbral_confianza TYPE double precision;

CREATE TABLE acceso.migraciones (
  id uuid PRIMARY KEY,
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  origen_escuela_id uuid NOT NULL,          -- identificador de la escuela en el dispositivo de origen
  usuario_id text NOT NULL REFERENCES "user"(id),
  autorizado_por varchar(120) NOT NULL,     -- nombre de quien autoriza (responsable del tratamiento, D2)
  cargo varchar(120) NOT NULL,
  aviso_privacidad boolean NOT NULL CHECK (aviso_privacidad),
  conteos jsonb NOT NULL,
  huella char(64) NOT NULL,
  escuela_previa jsonb NOT NULL,            -- datos de la escuela en el servidor antes de migrar (para revertir)
  seq_final bigint NOT NULL,                -- última secuencia de cambios al terminar la migración
  estado text NOT NULL DEFAULT 'aplicada' CHECK (estado IN ('aplicada', 'revertida')),
  aplicada_en timestamptz NOT NULL DEFAULT now(),
  revertida_en timestamptz,
  revertida_por text REFERENCES "user"(id),
  motivo_reversion varchar(300),
  CHECK (estado = 'aplicada' OR (revertida_en IS NOT NULL AND motivo_reversion IS NOT NULL))
);
-- Una sola migración vigente por escuela.
CREATE UNIQUE INDEX migraciones_vigente ON acceso.migraciones (escuela_id) WHERE estado = 'aplicada';

CREATE TABLE acceso.migracion_registros (
  migracion_id uuid NOT NULL REFERENCES acceso.migraciones(id),
  tabla text NOT NULL,
  registro_id uuid NOT NULL,
  PRIMARY KEY (migracion_id, tabla, registro_id)
);

-- Al MIGRAR o REVERTIR (transacción del servidor con el rol dueño y app.migracion = 'si') se cargan
-- también ciclos ya cerrados (historial). La API (rol gestion_app) nunca tiene esta excepción.
-- Se ejecuta con los permisos de quien llama (SECURITY INVOKER) para distinguir a la API:
-- gestion_app lee los ciclos con sus políticas (todos los roles los ven).
CREATE OR REPLACE FUNCTION escolar.ciclo_no_cerrado() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ciclo uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.ciclo_escolar_id ELSE NEW.ciclo_escolar_id END;
BEGIN
  IF current_user <> 'gestion_app' AND current_setting('app.migracion', true) = 'si' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF EXISTS (SELECT 1 FROM escolar.ciclos c WHERE c.id = ciclo AND c.estado = 'cerrado')
     OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM escolar.ciclos c WHERE c.id = OLD.ciclo_escolar_id AND c.estado = 'cerrado')) THEN
    RAISE EXCEPTION 'El ciclo escolar está cerrado: sus datos son de sólo lectura.' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
