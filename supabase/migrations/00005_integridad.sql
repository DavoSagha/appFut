-- ============================================================
-- appFut 00005 - Integridad de datos
--
-- Arregla:
--   * El primer titular quedaba con monto_esperado = 0 (el trigger
--     BEFORE INSERT contaba titulares antes de insertar la fila).
--   * Los montos de los titulares ya existentes nunca se recalculaban
--     al entrar gente nueva: cada uno tenia un divisor distinto.
--   * Race condition del cupo con joins simultaneos.
--   * Los recalculos pisaban pagos ya confirmados.
--   * INSERT INTO pagos desde un BEFORE INSERT (FK que anda de casualidad).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Separar lo esperado de lo efectivamente pagado
-- ------------------------------------------------------------
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS monto_pagado NUMERIC(10, 2);

COMMENT ON COLUMN pagos.monto_pagado IS
  'Monto congelado al confirmar. Ningun recalculo lo toca. La recaudacion se suma de aca.';

UPDATE pagos
SET monto_pagado = monto_esperado
WHERE estado = 'confirmado' AND monto_pagado IS NULL;

-- ------------------------------------------------------------
-- 2. Reemplazar manejar_nuevo_jugador por dos triggers separados
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_manejar_nuevo_jugador ON jugadores;
DROP FUNCTION IF EXISTS manejar_nuevo_jugador();

-- 2a. BEFORE INSERT: asigna rol y orden bajo lock. No toca otras tablas.
CREATE OR REPLACE FUNCTION asignar_rol_nuevo_jugador()
RETURNS TRIGGER AS $$
DECLARE
  v_cupo INT;
  v_estado partido_estado;
  v_titulares INT;
BEGIN
  -- Serializa los ingresos concurrentes del MISMO partido.
  -- Sin esto, diez personas tocando el link a la vez entran todas de titular.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.partido_id::text));

  SELECT cantidad_jugadores, estado INTO v_cupo, v_estado
  FROM partidos WHERE id = NEW.partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El partido no existe';
  END IF;

  IF v_estado = 'cerrado' THEN
    RAISE EXCEPTION 'El partido esta cerrado';
  END IF;

  SELECT COALESCE(MAX(orden_ingreso), 0) + 1 INTO NEW.orden_ingreso
  FROM jugadores WHERE partido_id = NEW.partido_id;

  SELECT COUNT(*) INTO v_titulares
  FROM jugadores WHERE partido_id = NEW.partido_id AND rol = 'titular';

  IF v_titulares < v_cupo THEN
    NEW.rol := 'titular';
  ELSE
    NEW.rol := 'suplente';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_asignar_rol
BEFORE INSERT ON jugadores
FOR EACH ROW EXECUTE FUNCTION asignar_rol_nuevo_jugador();

-- 2b. AFTER INSERT: crea el pago y recalcula. La fila YA existe -> la FK
--     es real y calcular_pago_esperado cuenta bien.
CREATE OR REPLACE FUNCTION crear_pago_nuevo_jugador()
RETURNS TRIGGER AS $$
DECLARE
  v_cupo INT;
  v_titulares INT;
  v_monto NUMERIC(10, 2);
BEGIN
  IF NEW.rol = 'titular' THEN
    v_monto := calcular_pago_esperado(NEW.partido_id);
  ELSE
    v_monto := 0;
  END IF;

  INSERT INTO pagos (jugador_id, monto_esperado) VALUES (NEW.id, v_monto);

  -- Entro un titular nuevo => cambio el divisor => todos los titulares
  -- que todavia no pagaron pasan a deber menos.
  IF NEW.rol = 'titular' THEN
    UPDATE pagos SET monto_esperado = v_monto
    WHERE jugador_id IN (
      SELECT id FROM jugadores
      WHERE partido_id = NEW.partido_id AND rol = 'titular'
    )
    AND estado IN ('sin_declarar', 'rechazado');
  END IF;

  SELECT cantidad_jugadores INTO v_cupo FROM partidos WHERE id = NEW.partido_id;
  SELECT COUNT(*) INTO v_titulares
  FROM jugadores WHERE partido_id = NEW.partido_id AND rol = 'titular';

  IF v_titulares >= v_cupo THEN
    UPDATE partidos SET estado = 'completo'
    WHERE id = NEW.partido_id AND estado = 'abierto';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_crear_pago
AFTER INSERT ON jugadores
FOR EACH ROW EXECUTE FUNCTION crear_pago_nuevo_jugador();

-- ------------------------------------------------------------
-- 3. Al dar de baja un titular: promover suplentes SIN pisar
--    los pagos ya confirmados.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reasignar_suplentes_a_titulares()
RETURNS TRIGGER AS $$
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
      -- Un pago ya confirmado NO se recalcula nunca.
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

-- ------------------------------------------------------------
-- 4. Cambio de costo: tampoco pisa confirmados
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalcular_pagos_por_costo()
RETURNS TRIGGER AS $$
DECLARE
  v_nuevo_monto NUMERIC(10, 2);
BEGIN
  IF NEW.costo_total IS DISTINCT FROM OLD.costo_total THEN
    v_nuevo_monto := calcular_pago_esperado(NEW.id);
    IF v_nuevo_monto > 0 THEN
      UPDATE pagos SET monto_esperado = v_nuevo_monto
      WHERE jugador_id IN (
        SELECT id FROM jugadores WHERE partido_id = NEW.id AND rol = 'titular'
      )
      AND estado IN ('sin_declarar', 'rechazado');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 5. Confirmar un pago congela el monto pagado
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION verificar_confirmacion_pago()
RETURNS TRIGGER AS $$
DECLARE
  v_organizador_id UUID;
BEGIN
  IF NEW.estado = 'confirmado' AND OLD.estado <> 'pendiente_confirmacion' THEN
    RAISE EXCEPTION 'Solo se puede confirmar un pago en estado pendiente_confirmacion';
  END IF;

  IF NEW.estado IN ('confirmado', 'rechazado') THEN
    SELECT p.organizador_id INTO v_organizador_id
    FROM partidos p
    JOIN jugadores j ON j.partido_id = p.id
    WHERE j.id = NEW.jugador_id;

    IF NEW.confirmado_por IS DISTINCT FROM v_organizador_id THEN
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
