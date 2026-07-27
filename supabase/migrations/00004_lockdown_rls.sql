-- ============================================================
-- appFut 00004 - Cierre de RLS
-- Revierte 00002_fix_rls.sql (policies USING(true)) y
-- 00003_grants.sql (GRANT ALL a anon).
--
-- Modelo de acceso nuevo:
--   anon           -> SIN acceso directo a las tablas.
--                     Los jugadores operan via Server Actions.
--   authenticated  -> el organizador SOLO LEE sus propias filas.
--                     Toda escritura pasa por Server Actions.
--   service_role   -> lo usan las Server Actions, que verifican la
--                     cookie firmada del dispositivo antes de escribir.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Revocar los grants amplios de 00003
-- ------------------------------------------------------------
REVOKE ALL ON public.partidos  FROM anon, authenticated;
REVOKE ALL ON public.jugadores FROM anon, authenticated;
REVOKE ALL ON public.pagos     FROM anon, authenticated;

-- El dashboard del organizador lee con su propio JWT. Nada mas.
GRANT SELECT ON public.partidos  TO authenticated;
GRANT SELECT ON public.jugadores TO authenticated;
GRANT SELECT ON public.pagos     TO authenticated;

-- ------------------------------------------------------------
-- 2. Borrar TODAS las policies de anon (las de 00001 y las de 00002)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Cualquiera puede ver partido por link"                         ON partidos;
DROP POLICY IF EXISTS "Cualquiera puede ver jugadores de un partido"                  ON jugadores;
DROP POLICY IF EXISTS "Cualquiera puede insertarse como jugador"                      ON jugadores;
DROP POLICY IF EXISTS "Jugador puede actualizar su propio registro"                   ON jugadores;
DROP POLICY IF EXISTS "Jugador puede actualizar su propio registro (mismo device_id)" ON jugadores;
DROP POLICY IF EXISTS "Cada jugador ve su propio pago"                                ON pagos;
DROP POLICY IF EXISTS "Jugador puede insertar su pago"                                ON pagos;
DROP POLICY IF EXISTS "Jugador puede actualizar su propio pago"                       ON pagos;
DROP POLICY IF EXISTS "Jugador puede actualizar su propio pago (subir comprobante)"   ON pagos;

-- ------------------------------------------------------------
-- 3. Borrar las policies de ESCRITURA del organizador.
--    Ahora escribe por Server Action, no directo desde el browser.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Organizador puede insertar partidos"                ON partidos;
DROP POLICY IF EXISTS "Organizador puede actualizar su partido"            ON partidos;
DROP POLICY IF EXISTS "Organizador puede gestionar jugadores de su partido" ON jugadores;
DROP POLICY IF EXISTS "Organizador confirma o rechaza pagos"               ON pagos;

-- ------------------------------------------------------------
-- 4. Policies de SOLO LECTURA, scoped al organizador
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Organizador puede ver sus propios partidos" ON partidos;
DROP POLICY IF EXISTS "Organizador lee sus partidos"               ON partidos;
CREATE POLICY "Organizador lee sus partidos"
  ON partidos FOR SELECT TO authenticated
  USING (organizador_id = auth.uid());

DROP POLICY IF EXISTS "Organizador lee jugadores de sus partidos" ON jugadores;
CREATE POLICY "Organizador lee jugadores de sus partidos"
  ON jugadores FOR SELECT TO authenticated
  USING (partido_id IN (SELECT id FROM partidos WHERE organizador_id = auth.uid()));

DROP POLICY IF EXISTS "Organizador ve todos los pagos de su partido" ON pagos;
DROP POLICY IF EXISTS "Organizador lee pagos de sus partidos"        ON pagos;
CREATE POLICY "Organizador lee pagos de sus partidos"
  ON pagos FOR SELECT TO authenticated
  USING (jugador_id IN (
    SELECT j.id FROM jugadores j
    JOIN partidos p ON p.id = j.partido_id
    WHERE p.organizador_id = auth.uid()
  ));

-- ------------------------------------------------------------
-- 5. RLS activo. service_role tiene BYPASSRLS por diseño.
-- ------------------------------------------------------------
ALTER TABLE partidos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE jugadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos     ENABLE ROW LEVEL SECURITY;
