-- ============================================================
-- appFut 00010 - Fix trigger RLS con SECURITY DEFINER
--
-- Varios triggers no tenian SECURITY DEFINER y fallaban al ser
-- invocados por funciones del sistema o desde el SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION proteger_columnas_jugador()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user <> session_user THEN
    RETURN NEW;
  END IF;

  IF public.es_organizador_de(NEW.partido_id) THEN
    RETURN NEW;
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

CREATE OR REPLACE FUNCTION proteger_columnas_pago()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partido_id UUID;
BEGIN
  IF current_user <> session_user THEN
    RETURN NEW;
  END IF;

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

  IF NEW.estado IS DISTINCT FROM OLD.estado
     AND NEW.estado <> 'pendiente_confirmacion' THEN
    RAISE EXCEPTION 'Solo podés marcar tu pago como pendiente de confirmación';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reasignar_suplentes_a_titulares()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partido_id UUID;
  v_cupo INT;
  v_titulares_count INT;
  v_nuevo_monto NUMERIC(10, 2);
  r RECORD;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.rol = 'titular' THEN
    v_partido_id := OLD.partido_id;

    PERFORM pg_advisory_xact_lock(hashtext(v_partido_id::text));

    SELECT cantidad_jugadores INTO v_cupo FROM partidos WHERE id = v_partido_id;

    SELECT COUNT(*) INTO v_titulares_count
    FROM jugadores WHERE partido_id = v_partido_id AND rol = 'titular';

    IF v_titulares_count < v_cupo THEN
      FOR r IN
        SELECT id FROM jugadores
        WHERE partido_id = v_partido_id AND rol = 'suplente'
        ORDER BY orden_ingreso ASC
        LIMIT (v_cupo - v_titulares_count)
      LOOP
        UPDATE jugadores SET rol = 'titular' WHERE id = r.id;
      END LOOP;
    END IF;

    v_nuevo_monto := calcular_pago_esperado(v_partido_id);
    IF v_nuevo_monto > 0 THEN
      UPDATE pagos SET monto_esperado = v_nuevo_monto
      WHERE jugador_id IN (
        SELECT id FROM jugadores
        WHERE partido_id = v_partido_id AND rol = 'titular'
      )
      AND estado IN ('sin_declarar', 'rechazado');
    END IF;

    SELECT COUNT(*) INTO v_titulares_count
    FROM jugadores WHERE partido_id = v_partido_id AND rol = 'titular';

    IF v_titulares_count < v_cupo THEN
      UPDATE partidos SET estado = 'abierto'
      WHERE id = v_partido_id AND estado = 'completo';
    END IF;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
