-- 0007 · Escuela de DEMOSTRACIÓN para el piloto (Fase 10).
-- Marca explícita de una escuela con datos FICTICIOS: no lleva CCT (no se inventa una clave
-- oficial) y es lo único que las herramientas del piloto pueden quitar.
-- La marca no cambia después de crear la escuela: ni la API ni la sincronización pueden
-- convertir una escuela real en «de demostración» (y con ello volverla borrable).

ALTER TABLE escolar.escuelas ADD COLUMN demostracion boolean NOT NULL DEFAULT false;

ALTER TABLE escolar.escuelas ADD CONSTRAINT escuelas_demostracion_sin_cct CHECK (NOT demostracion OR cct IS NULL);

CREATE FUNCTION escolar.demostracion_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.demostracion IS DISTINCT FROM OLD.demostracion THEN
    RAISE EXCEPTION 'La marca de demostración de una escuela no se puede cambiar.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER escuelas_demostracion_inmutable BEFORE UPDATE OF demostracion ON escolar.escuelas
  FOR EACH ROW EXECUTE FUNCTION escolar.demostracion_inmutable();
