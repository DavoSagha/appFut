-- ============================================================
-- appFut 00011 - Nombre único por partido + reclaim
--
-- 1) Cambia la UNIQUE de (partido_id, user_id) a (partido_id, nombre)
--    para evitar jugadores con el mismo nombre en un partido.
-- 2) Permite reclaim: si un jugador pierde su sesión anónima, puede
--    volver a entrar con el mismo nombre y reclaimar su identidad.
-- ============================================================

-- Desactivamos triggers que pueden interferir con la limpieza
ALTER TABLE jugadores DISABLE TRIGGER trigger_asignar_rol;
ALTER TABLE jugadores DISABLE TRIGGER trigger_reasignar_suplentes;

-- Eliminar duplicados por nombre (conservando el más antiguo)
WITH dups AS (
  SELECT id, partido_id, nombre,
    ROW_NUMBER() OVER (PARTITION BY partido_id, nombre ORDER BY id) AS rn
  FROM jugadores
)
DELETE FROM jugadores WHERE id IN (
  SELECT id FROM dups WHERE rn > 1
);

ALTER TABLE jugadores DROP CONSTRAINT IF EXISTS jugadores_partido_user_key;
ALTER TABLE jugadores ADD CONSTRAINT jugadores_partido_nombre_key UNIQUE (partido_id, nombre);

-- Reactivamos
ALTER TABLE jugadores ENABLE TRIGGER trigger_asignar_rol;
ALTER TABLE jugadores ENABLE TRIGGER trigger_reasignar_suplentes;
