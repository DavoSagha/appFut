-- ============================================================
-- appFut 00026 - verificar_confirmacion_pago unificada
--
-- POR QUÉ EXISTE ESTA MIGRACIÓN: dos ramas editaron la MISMA función
-- sin conocerse, y cada una borró la feature de la otra.
--
--   00020_pago_reversible.sql        -> revertir confirmado -> sin_declarar
--   00025_confirmar_sin_pendiente.sql -> confirmar desde cualquier estado
--
-- Las migraciones se aplican en orden de nombre de archivo y las dos hacen
-- CREATE OR REPLACE sobre verificar_confirmacion_pago(). O sea: la última
-- gana y la otra feature MUERE EN SILENCIO. No hay orden correcto entre
-- ellas — ninguna contiene a la otra. Hacía falta una tercera que las junte.
--
-- Esta es esa tercera, y es el ÚLTIMO escritor de la función. Si mañana
-- alguien la vuelve a tocar, que sea acá y no en una migración vieja.
--
-- (Cómo se llegó a esto: las dos ramas también numeraron migraciones
-- pisándose — dos 00015 y dos 00017. Supabase usa el número como PK de
-- supabase_migrations.schema_migrations, así que la cadena directamente no
-- aplicaba desde cero: `duplicate key value violates unique constraint
-- "schema_migrations_pkey"`. Se resolvió renumerando los dos archivos que
-- NO dependen de su posición: 00015_grants_service_role -> 00024 (son tres
-- GRANT sobre tablas que existen desde 00001) y 00017_confirmar_sin_pendiente
-- -> 00025. `00015_equipos.sql` se quedó donde estaba a propósito: redefine
-- asignar_rol_nuevo_jugador, y si corriera después de 00022 revertiría el
-- guard de partido vencido.)
--
-- LAS DOS REGLAS QUE CONVIVEN ACÁ:
--
--   1. Confirmar desde cualquier estado. En el fútbol amateur se paga en
--      efectivo y nadie declara nada: el organizador cobra y marca Pagado.
--      Exigir 'pendiente_confirmacion' lo dejaba atado de manos.
--      Único caso que se rechaza: confirmar algo YA confirmado, porque
--      re-escribiría confirmado_at y pisaría el monto congelado.
--
--   2. Revertir una confirmación hecha por error (confirmado -> sin_declarar),
--      limpiando el rastro (monto_pagado, confirmado_por, confirmado_at) y
--      SIN tocar comprobante_url, que sigue disponible para revisar de nuevo.
--
-- LO QUE NO SE AFLOJA: sólo el organizador del partido confirma, rechaza o
-- revierte. El chequeo de confirmado_por contra partidos.organizador_id sigue
-- intacto, y proteger_columnas_pago (00013) sigue impidiéndole al jugador
-- tocar montos o autoconfirmarse. Esto amplía CUÁNDO se puede confirmar,
-- nunca QUIÉN.
--
-- auth.uid() IS NULL = mantenimiento directo (migraciones, fixtures con
-- service_role): mismo criterio que el resto de los triggers de esta base.
-- ============================================================

CREATE OR REPLACE FUNCTION verificar_confirmacion_pago()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_organizador_id UUID;
BEGIN
  -- Regla 1: se confirma desde cualquier estado, menos desde 'confirmado'.
  IF NEW.estado = 'confirmado' AND OLD.estado = 'confirmado' THEN
    RAISE EXCEPTION 'El pago ya está confirmado';
  END IF;

  -- Regla 2: reversión explícita de una confirmación previa.
  -- Va ANTES del bloque de abajo porque 'sin_declarar' no entra ahí y
  -- necesita su propio chequeo de organizador: en la reversión
  -- confirmado_por se limpia, así que no sirve para identificar a nadie.
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

    NEW.monto_pagado   := NULL;
    NEW.confirmado_por := NULL;
    NEW.confirmado_at  := NULL;

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
