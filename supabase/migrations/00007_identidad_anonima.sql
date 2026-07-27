-- ============================================================
-- appFut 00007 - Identidad real para los jugadores
--
-- Reemplaza el device_id (texto que el cliente elegía) por un
-- usuario anónimo de Supabase: un JWT firmado, con auth.uid() real.
--
-- Consecuencias:
--   * Desaparece la service_role de la app. El .env vuelve a 2 variables.
--   * Desaparece la cookie firmada a mano. La firma la hace Supabase.
--   * RLS vuelve a enforcar de verdad, no de adorno.
--
-- REQUIERE: Authentication > Sign In / Providers > Anonymous = ON
-- ============================================================

-- ------------------------------------------------------------
-- 1. jugadores.device_id  ->  jugadores.user_id
-- ------------------------------------------------------------
ALTER TABLE jugadores DROP CONSTRAINT IF EXISTS jugadores_partido_id_device_id_key;

ALTER TABLE jugadores
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Las filas viejas se ataban a un device_id que ya no significa nada.
DELETE FROM jugadores WHERE user_id IS NULL;

ALTER TABLE jugadores ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE jugadores DROP COLUMN IF EXISTS device_id;

ALTER TABLE jugadores
  ADD CONSTRAINT jugadores_partido_user_key UNIQUE (partido_id, user_id);

DROP INDEX IF EXISTS idx_jugadores_device;
CREATE INDEX IF NOT EXISTS idx_jugadores_user ON jugadores(user_id);

-- ------------------------------------------------------------
-- 2. Helpers SECURITY DEFINER
--    Evitan la recursión infinita de una policy sobre jugadores
--    que necesita consultar jugadores.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.es_jugador_de(p_partido_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM jugadores
    WHERE partido_id = p_partido_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.es_organizador_de(p_partido_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM partidos
    WHERE id = p_partido_id AND organizador_id = auth.uid()
  );
$$;

-- ------------------------------------------------------------
-- 3. Lectura pública por SLUG.
--    El slug es la credencial de invitación: sin slug no hay nada.
--    Así nadie enumera la tabla partidos como pasaba antes.
--    Ojo: NO devuelven costo_total ni organizador_id.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partido_por_slug(p_slug TEXT)
RETURNS TABLE (
  id UUID,
  fecha_hora TIMESTAMPTZ,
  cantidad_jugadores INT,
  estado partido_estado
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.fecha_hora, p.cantidad_jugadores, p.estado
  FROM partidos p
  WHERE p.link_slug = p_slug;
$$;

CREATE OR REPLACE FUNCTION public.roster_por_slug(p_slug TEXT)
RETURNS TABLE (
  id UUID,
  nombre TEXT,
  rol jugador_rol,
  emoji_o_color TEXT,
  pago_estado pago_estado,
  es_mio BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT j.id, j.nombre, j.rol, j.emoji_o_color, pg.estado, (j.user_id = auth.uid())
  FROM jugadores j
  JOIN partidos p ON p.id = j.partido_id
  LEFT JOIN pagos pg ON pg.jugador_id = j.id
  WHERE p.link_slug = p_slug
  ORDER BY j.orden_ingreso;
$$;

REVOKE ALL ON FUNCTION public.partido_por_slug(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roster_por_slug(TEXT)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partido_por_slug(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roster_por_slug(TEXT)  TO authenticated;

-- ------------------------------------------------------------
-- 4. Grants: anon sigue sin nada. Los jugadores anónimos entran
--    como 'authenticated' (con is_anonymous = true en el JWT).
-- ------------------------------------------------------------
REVOKE ALL ON public.partidos  FROM anon, authenticated;
REVOKE ALL ON public.jugadores FROM anon, authenticated;
REVOKE ALL ON public.pagos     FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE         ON public.partidos  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jugadores TO authenticated;
GRANT SELECT, UPDATE                 ON public.pagos     TO authenticated;

-- ------------------------------------------------------------
-- 5. Policies
-- ------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('partidos','jugadores','pagos')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- --- partidos: solo el organizador. Los jugadores usan las funciones. ---
CREATE POLICY "organizador lee sus partidos"
  ON partidos FOR SELECT TO authenticated
  USING (organizador_id = auth.uid());

CREATE POLICY "organizador crea partidos"
  ON partidos FOR INSERT TO authenticated
  WITH CHECK (
    organizador_id = auth.uid()
    AND COALESCE(auth.jwt() ->> 'is_anonymous', 'false') = 'false'
  );

CREATE POLICY "organizador actualiza su partido"
  ON partidos FOR UPDATE TO authenticated
  USING (organizador_id = auth.uid())
  WITH CHECK (organizador_id = auth.uid());

-- --- jugadores ---
CREATE POLICY "ver jugadores del partido propio"
  ON jugadores FOR SELECT TO authenticated
  USING (public.es_jugador_de(partido_id) OR public.es_organizador_de(partido_id));

CREATE POLICY "anotarse a si mismo"
  ON jugadores FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "editar su propia ficha"
  ON jugadores FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.es_organizador_de(partido_id))
  WITH CHECK (user_id = auth.uid() OR public.es_organizador_de(partido_id));

CREATE POLICY "borrarse o que lo borre el organizador"
  ON jugadores FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.es_organizador_de(partido_id));

-- --- pagos ---
CREATE POLICY "ver el pago propio o los del partido que organizo"
  ON pagos FOR SELECT TO authenticated
  USING (
    jugador_id IN (SELECT id FROM jugadores WHERE user_id = auth.uid())
    OR jugador_id IN (
      SELECT j.id FROM jugadores j
      WHERE public.es_organizador_de(j.partido_id)
    )
  );

CREATE POLICY "actualizar el pago propio o los del partido que organizo"
  ON pagos FOR UPDATE TO authenticated
  USING (
    jugador_id IN (SELECT id FROM jugadores WHERE user_id = auth.uid())
    OR jugador_id IN (
      SELECT j.id FROM jugadores j
      WHERE public.es_organizador_de(j.partido_id)
    )
  )
  WITH CHECK (
    jugador_id IN (SELECT id FROM jugadores WHERE user_id = auth.uid())
    OR jugador_id IN (
      SELECT j.id FROM jugadores j
      WHERE public.es_organizador_de(j.partido_id)
    )
  );

ALTER TABLE partidos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE jugadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos     ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 6. RLS no filtra COLUMNAS. Sin esto, un jugador con permiso de
--    UPDATE sobre su propia fila se asciende a titular solo, o se
--    pone monto_esperado = 0. Los triggers cierran ese hueco.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION proteger_columnas_jugador()
RETURNS TRIGGER AS $$
BEGIN
  IF public.es_organizador_de(NEW.partido_id) THEN
    RETURN NEW; -- el organizador sí puede mover roles
  END IF;

  IF NEW.partido_id IS DISTINCT FROM OLD.partido_id
     OR NEW.user_id  IS DISTINCT FROM OLD.user_id
     OR NEW.rol      IS DISTINCT FROM OLD.rol
     OR NEW.orden_ingreso IS DISTINCT FROM OLD.orden_ingreso THEN
    RAISE EXCEPTION 'Solo podés cambiar tu nombre o tu emoji';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_proteger_jugador ON jugadores;
CREATE TRIGGER trigger_proteger_jugador
BEFORE UPDATE ON jugadores
FOR EACH ROW EXECUTE FUNCTION proteger_columnas_jugador();

CREATE OR REPLACE FUNCTION proteger_columnas_pago()
RETURNS TRIGGER AS $$
DECLARE
  v_partido_id UUID;
BEGIN
  SELECT partido_id INTO v_partido_id FROM jugadores WHERE id = NEW.jugador_id;

  IF public.es_organizador_de(v_partido_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.monto_esperado IS DISTINCT FROM OLD.monto_esperado
     OR NEW.monto_pagado IS DISTINCT FROM OLD.monto_pagado
     OR NEW.jugador_id   IS DISTINCT FROM OLD.jugador_id
     OR NEW.confirmado_por IS DISTINCT FROM OLD.confirmado_por THEN
    RAISE EXCEPTION 'No podés modificar el monto ni la confirmación de tu pago';
  END IF;

  -- Un jugador solo puede declarar que pagó. Confirmar es del organizador.
  IF NEW.estado IS DISTINCT FROM OLD.estado
     AND NEW.estado <> 'pendiente_confirmacion' THEN
    RAISE EXCEPTION 'Solo podés marcar tu pago como pendiente de confirmación';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_proteger_pago ON pagos;
CREATE TRIGGER trigger_proteger_pago
BEFORE UPDATE ON pagos
FOR EACH ROW EXECUTE FUNCTION proteger_columnas_pago();
