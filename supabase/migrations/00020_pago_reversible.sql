-- ============================================================
-- appFut 00020 - Pago confirmado reversible (Pagado -> Sin pagar)
-- ============================================================
-- Antes, la única transición fuera de 'pendiente_confirmacion' era hacia
-- 'confirmado': no había vuelta atrás si el organizador confirmaba por
-- error. Esto agrega esa reversión explícita, sólo para el organizador,
-- limpiando el rastro de la confirmación anterior (monto pagado, quién y
-- cuándo confirmó). No toca comprobante_url: si el jugador ya había subido
-- comprobante, sigue disponible para revisar de nuevo.

CREATE OR REPLACE FUNCTION verificar_confirmacion_pago()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_organizador_id UUID;
BEGIN
  IF NEW.estado = 'confirmado' AND OLD.estado <> 'pendiente_confirmacion' THEN
    RAISE EXCEPTION 'Solo se puede confirmar un pago en estado pendiente_confirmacion';
  END IF;

  -- Reversión explícita de una confirmación previa. proteger_columnas_pago
  -- ya le impide esto a un jugador sobre su propio pago (no puede tocar
  -- monto_pagado/confirmado_por ni poner un estado distinto de
  -- pendiente_confirmacion); acá se repite el chequeo de organizador por
  -- las dudas, para no depender de un solo trigger. auth.uid() IS NULL es
  -- mantenimiento directo (migraciones, fixtures con service_role): mismo
  -- criterio que el resto de los triggers de esta base.
  IF NEW.estado = 'sin_declarar' AND OLD.estado = 'confirmado' THEN
    IF auth.uid() IS NOT NULL THEN
      SELECT p.organizador_id INTO v_organizador_id
      FROM partidos p
      JOIN jugadores j ON j.partido_id = p.id
      WHERE j.id = NEW.jugador_id;

      IF v_organizador_id IS NULL OR auth.uid() IS DISTINCT FROM v_organizador_id THEN
        RAISE EXCEPTION 'Solo el organizador puede revertir un pago confirmado';
      END IF;
    END IF;

    NEW.monto_pagado := NULL;
    NEW.confirmado_por := NULL;
    NEW.confirmado_at := NULL;

    RETURN NEW;
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
