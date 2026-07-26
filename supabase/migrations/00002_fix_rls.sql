-- appFut - Corregir RLS (por si la migración original falló)

ALTER TABLE partidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE jugadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;

-- partidos
DROP POLICY IF EXISTS "Organizador puede insertar partidos" ON partidos;
CREATE POLICY "Organizador puede insertar partidos"
  ON partidos FOR INSERT TO authenticated
  WITH CHECK (organizador_id = auth.uid());

DROP POLICY IF EXISTS "Organizador puede ver sus propios partidos" ON partidos;
CREATE POLICY "Organizador puede ver sus propios partidos"
  ON partidos FOR SELECT TO authenticated
  USING (organizador_id = auth.uid());

DROP POLICY IF EXISTS "Cualquiera puede ver partido por link" ON partidos;
CREATE POLICY "Cualquiera puede ver partido por link"
  ON partidos FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "Organizador puede actualizar su partido" ON partidos;
CREATE POLICY "Organizador puede actualizar su partido"
  ON partidos FOR UPDATE TO authenticated
  USING (organizador_id = auth.uid())
  WITH CHECK (organizador_id = auth.uid());

-- jugadores
DROP POLICY IF EXISTS "Cualquiera puede ver jugadores de un partido" ON jugadores;
CREATE POLICY "Cualquiera puede ver jugadores de un partido"
  ON jugadores FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "Cualquiera puede insertarse como jugador" ON jugadores;
CREATE POLICY "Cualquiera puede insertarse como jugador"
  ON jugadores FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Jugador puede actualizar su propio registro" ON jugadores;
CREATE POLICY "Jugador puede actualizar su propio registro"
  ON jugadores FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Organizador puede gestionar jugadores de su partido" ON jugadores;
CREATE POLICY "Organizador puede gestionar jugadores de su partido"
  ON jugadores FOR UPDATE TO authenticated
  USING (partido_id IN (SELECT id FROM partidos WHERE organizador_id = auth.uid()));

-- pagos
DROP POLICY IF EXISTS "Cada jugador ve su propio pago" ON pagos;
CREATE POLICY "Cada jugador ve su propio pago"
  ON pagos FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "Jugador puede insertar su pago" ON pagos;
CREATE POLICY "Jugador puede insertar su pago"
  ON pagos FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Jugador puede actualizar su propio pago" ON pagos;
CREATE POLICY "Jugador puede actualizar su propio pago"
  ON pagos FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Organizador ve todos los pagos de su partido" ON pagos;
CREATE POLICY "Organizador ve todos los pagos de su partido"
  ON pagos FOR SELECT TO authenticated
  USING (jugador_id IN (
    SELECT j.id FROM jugadores j
    JOIN partidos p ON p.id = j.partido_id
    WHERE p.organizador_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Organizador confirma o rechaza pagos" ON pagos;
CREATE POLICY "Organizador confirma o rechaza pagos"
  ON pagos FOR UPDATE TO authenticated
  USING (jugador_id IN (
    SELECT j.id FROM jugadores j
    JOIN partidos p ON p.id = j.partido_id
    WHERE p.organizador_id = auth.uid()
  ))
  WITH CHECK (jugador_id IN (
    SELECT j.id FROM jugadores j
    JOIN partidos p ON p.id = j.partido_id
    WHERE p.organizador_id = auth.uid()
  ));
