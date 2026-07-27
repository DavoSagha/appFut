-- ============================================================
-- appFut 00009 - Fix trigger RLS con SECURITY DEFINER
--
-- Los triggers asignar_rol_nuevo_jugador() y
-- crear_pago_nuevo_jugador() hacen SELECT a partidos pero no
-- tenian SECURITY DEFINER. Con el RLS lockdown de 00007, los
-- usuarios anonimos no pueden leer partidos, y el trigger
-- falla con "El partido no existe".
-- ============================================================

CREATE OR REPLACE FUNCTION asignar_rol_nuevo_jugador()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cupo INT;
  v_estado partido_estado;
  v_titulares INT;
BEGIN
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

CREATE OR REPLACE FUNCTION crear_pago_nuevo_jugador()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
