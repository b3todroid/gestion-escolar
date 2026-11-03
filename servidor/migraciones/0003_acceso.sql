-- 0003 · Acceso: membresías (persona + escuela + rol) y auditoría de sólo agregar.
-- Una persona puede tener varias membresías (varios roles o varias escuelas).
-- Nadie entra a una escuela sin una membresía explícita.

CREATE SCHEMA acceso;

CREATE TABLE acceso.membresias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id text NOT NULL REFERENCES "user"(id),
  escuela_id uuid NOT NULL REFERENCES escolar.escuelas(id),
  rol text NOT NULL CHECK (rol IN ('administrador','direccion','subdireccion','prefectura','docente','apoyo')),
  estado text NOT NULL DEFAULT 'invitada' CHECK (estado IN ('invitada','activa','revocada')),
  -- Vínculo opcional con la ficha de personal de la escuela (se usará en 8C).
  personal_id uuid REFERENCES escolar.personal(id),
  -- Permisos delegados por el administrador de la escuela (decisión D5), p. ej.
  -- 'confirmar_incidencias', 'autorizar_coberturas'. Se aplicarán en 8C.
  permisos_delegados text[] NOT NULL DEFAULT '{}' CHECK (permisos_delegados <@ ARRAY['confirmar_incidencias','autorizar_coberturas']),
  -- Tipo de correo con el que entra (D4/D12). El personal correo requiere consentimiento registrado.
  tipo_correo text NOT NULL CHECK (tipo_correo IN ('institucional','personal')),
  consentimiento_correo_en timestamptz,
  invitada_por text REFERENCES "user"(id),
  invitada_en timestamptz NOT NULL DEFAULT now(),
  expira_en timestamptz NOT NULL,
  aceptada_en timestamptz,
  revocada_por text REFERENCES "user"(id),
  revocada_en timestamptz,
  motivo_revocacion varchar(300),
  actualizada_en timestamptz NOT NULL DEFAULT now(),
  CHECK (tipo_correo = 'institucional' OR consentimiento_correo_en IS NOT NULL),
  CHECK (estado <> 'revocada' OR (revocada_en IS NOT NULL AND motivo_revocacion IS NOT NULL))
);
-- Un mismo rol vigente por persona y escuela (las revocadas se conservan como historial).
CREATE UNIQUE INDEX membresias_rol_vigente ON acceso.membresias (usuario_id, escuela_id, rol) WHERE estado <> 'revocada';
CREATE INDEX membresias_usuario ON acceso.membresias (usuario_id);
CREATE INDEX membresias_escuela ON acceso.membresias (escuela_id);

-- Auditoría: quién hizo qué y cuándo (hora del SERVIDOR). Sin correos, nombres ni códigos.
CREATE TABLE acceso.auditoria (
  id bigserial PRIMARY KEY,
  ocurrido_en timestamptz NOT NULL DEFAULT now(),
  usuario_id text,
  escuela_id uuid,
  accion varchar(60) NOT NULL,
  entidad varchar(60),
  entidad_id text,
  detalle jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX auditoria_escuela ON acceso.auditoria (escuela_id, ocurrido_en DESC);
CREATE INDEX auditoria_usuario ON acceso.auditoria (usuario_id, ocurrido_en DESC);

CREATE FUNCTION acceso.auditoria_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría es de sólo agregar: no se modifica ni se borra.';
END $$;
CREATE TRIGGER auditoria_sin_cambios BEFORE UPDATE OR DELETE ON acceso.auditoria
  FOR EACH ROW EXECUTE FUNCTION acceso.auditoria_inmutable();
CREATE TRIGGER auditoria_sin_vaciado BEFORE TRUNCATE ON acceso.auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION acceso.auditoria_inmutable();
