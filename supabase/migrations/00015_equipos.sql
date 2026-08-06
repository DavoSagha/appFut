-- ============================================================
-- appFut 00015 - Equipos dentro del partido
--
-- Agrega columna equipo a jugadores. Todos pagan igual.
-- El jugador elige a qué equipo unirse (team1 / team2) o
-- queda en reserva (NULL).
-- ============================================================

ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS equipo TEXT CHECK (equipo IN ('team1', 'team2'));

-- Backfill: titulares existentes van a team1 por defecto
UPDATE jugadores SET equipo = 'team1' WHERE rol = 'titular' AND equipo IS NULL;

-- ------------------------------------------------------------
-- calcular_pago_esperado: todos pagan, no solo titulares
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION calcular_pago_esperado(p_partido_id UUID)
RETURNS NUMERIC(10,2) SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_costo_total NUMERIC(10,2);
  v_total INT;
BEGIN
  SELECT costo_total INTO v_costo_total FROM partidos WHERE id = p_partido_id;
  SELECT COUNT(*) INTO v_total FROM jugadores WHERE partido_id = p_partido_id;
  IF v_total = 0 THEN
    RETURN 0;
  END IF;
  RETURN ROUND(v_costo_total / v_total, 2);
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- asignar_rol_nuevo_jugador: todos entran como suplente + reserva
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION asignar_rol_nuevo_jugador()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado partido_estado;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.partido_id::text));

  SELECT estado INTO v_estado FROM partidos WHERE id = NEW.partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El partido no existe';
  END IF;

  IF v_estado = 'cerrado' THEN
    RAISE EXCEPTION 'El partido esta cerrado';
  END IF;

  SELECT COALESCE(MAX(orden_ingreso), 0) + 1 INTO NEW.orden_ingreso
  FROM jugadores WHERE partido_id = NEW.partido_id;

  NEW.rol := 'suplente';
  NEW.equipo := NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- crear_pago_nuevo_jugador: todos pagan, recalcula a todos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION crear_pago_nuevo_jugador()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cupo INT;
  v_total INT;
  v_monto NUMERIC(10, 2);
BEGIN
  v_monto := calcular_pago_esperado(NEW.partido_id);

  INSERT INTO pagos (jugador_id, monto_esperado) VALUES (NEW.id, v_monto);

  UPDATE pagos SET monto_esperado = v_monto
  WHERE jugador_id IN (
    SELECT id FROM jugadores
    WHERE partido_id = NEW.partido_id
  )
  AND estado IN ('sin_declarar', 'rechazado');

  SELECT cantidad_jugadores INTO v_cupo FROM partidos WHERE id = NEW.partido_id;
  SELECT COUNT(*) INTO v_total
  FROM jugadores WHERE partido_id = NEW.partido_id;

  IF v_total >= v_cupo THEN
    UPDATE partidos SET estado = 'completo'
    WHERE id = NEW.partido_id AND estado = 'abierto';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- reasignar_suplentes_a_titulares: solo recalcula, no promueve
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reasignar_suplentes_a_titulares()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partido_id UUID;
  v_cupo INT;
  v_total INT;
  v_nuevo_monto NUMERIC(10, 2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_partido_id := OLD.partido_id;

    PERFORM pg_advisory_xact_lock(hashtext(v_partido_id::text));

    SELECT cantidad_jugadores INTO v_cupo FROM partidos WHERE id = v_partido_id;

    v_nuevo_monto := calcular_pago_esperado(v_partido_id);

    UPDATE pagos SET monto_esperado = v_nuevo_monto
    WHERE jugador_id IN (
      SELECT id FROM jugadores
      WHERE partido_id = v_partido_id
    )
    AND estado IN ('sin_declarar', 'rechazado');

    SELECT COUNT(*) INTO v_total
    FROM jugadores WHERE partido_id = v_partido_id;

    IF v_total < v_cupo THEN
      UPDATE partidos SET estado = 'abierto'
      WHERE id = v_partido_id AND estado = 'completo';
    END IF;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- proteger_columnas_jugador: permite cambiar equipo + rol juntos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION proteger_columnas_jugador()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF COALESCE(current_setting('appfut.reclamo', true), 'off') = 'on' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF public.es_organizador_de(NEW.partido_id) THEN RETURN NEW; END IF;

  -- Cambiar equipo está permitido (y con él puede cambiar rol suplente↔titular)
  IF NEW.equipo IS DISTINCT FROM OLD.equipo THEN RETURN NEW; END IF;

  IF NEW.partido_id IS DISTINCT FROM OLD.partido_id
     OR NEW.user_id  IS DISTINCT FROM OLD.user_id
     OR NEW.rol      IS DISTINCT FROM OLD.rol
     OR NEW.orden_ingreso IS DISTINCT FROM OLD.orden_ingreso THEN
    RAISE EXCEPTION 'Solo podés cambiar tu equipo, nombre o emoji';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- roster_por_slug: incluir equipo
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.roster_por_slug(TEXT);
CREATE FUNCTION public.roster_por_slug(p_slug TEXT)
RETURNS TABLE (
  id UUID,
  nombre TEXT,
  rol jugador_rol,
  equipo TEXT,
  emoji_o_color TEXT,
  pago_estado pago_estado,
  es_mio BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT j.id, j.nombre, j.rol, j.equipo, j.emoji_o_color, pg.estado, (j.user_id = auth.uid())
  FROM jugadores j
  JOIN partidos p ON p.id = j.partido_id
  LEFT JOIN pagos pg ON pg.jugador_id = j.id
  WHERE p.link_slug = p_slug
  ORDER BY j.orden_ingreso;
$$;

REVOKE ALL ON FUNCTION public.roster_por_slug(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roster_por_slug(TEXT) TO authenticated;
