-- ============================================================
-- appFut 00017 - El organizador puede confirmar pagos sin
--               que el jugador los haya declarado
--
-- Antes: solo se podía confirmar un pago en estado
-- 'pendiente_confirmacion'. Si el jugador pagó en efectivo y
-- se le olvidó declararlo, el organizador quedaba atado de
-- manos. Ahora puede confirmar desde cualquier estado.
--
-- La seguridad real no cambia: el chequeo de confirmado_por
-- contra el organizador del partido sigue acá abajo.
-- ============================================================

CREATE OR REPLACE FUNCTION verificar_confirmacion_pago()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_organizador_id UUID;
BEGIN
  IF NEW.estado = 'confirmado' AND OLD.estado = 'confirmado' THEN
    RAISE EXCEPTION 'El pago ya está confirmado';
  END IF;

  IF NEW.estado IN ('confirmado', 'rechazado') THEN
    SELECT p.organizador_id INTO v_organizador_id
    FROM partidos p
    JOIN jugadores j ON j.partido_id = p.id
    WHERE j.id = NEW.jugador_id;

    IF v_organizador_id IS NULL
       OR NEW.confirmado_por IS DISTINCT FROM v_organizador_id THEN
      RAISE EXCEPTION 'Solo el organizador puede confirmar o rechazar pagos';
    END IF;

    NEW.confirmado_at := now();
  END IF;

  IF NEW.estado = 'confirmado' THEN
    NEW.monto_pagado := COALESCE(NEW.monto_pagado, NEW.monto_esperado);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
