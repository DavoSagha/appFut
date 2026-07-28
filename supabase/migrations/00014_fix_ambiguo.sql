-- ============================================================
-- appFut 00014 - Fix columna ambigua en unirse_o_reclamar
--
-- La funcion retorna TABLE(jugador_id UUID, accion TEXT).
-- Dentro del cuerpo hace:
--   SELECT estado FROM pagos WHERE jugador_id = v_ficha_id;
-- PostgreSQL ve "jugador_id" ambiguo entre el output param
-- y la columna pagos.jugador_id. Se califica con la tabla.
-- ============================================================

CREATE OR REPLACE FUNCTION public.unirse_o_reclamar(p_slug TEXT, p_nombre TEXT)
RETURNS TABLE (jugador_id UUID, accion TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_partido_id UUID;
  v_estado partido_estado;
  v_nombre TEXT;
  v_ficha_id UUID;
  v_ficha_dueno UUID;
  v_pago_estado pago_estado;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No hay sesión iniciada. Recargá la página.';
  END IF;

  v_nombre := btrim(regexp_replace(p_nombre, '\s+', ' ', 'g'));
  IF length(v_nombre) < 2  THEN RAISE EXCEPTION 'Escribí tu nombre'; END IF;
  IF length(v_nombre) > 50 THEN RAISE EXCEPTION 'El nombre es demasiado largo'; END IF;

  SELECT id, estado INTO v_partido_id, v_estado
  FROM partidos WHERE link_slug = p_slug;

  IF v_partido_id IS NULL THEN RAISE EXCEPTION 'Partido no encontrado'; END IF;
  IF v_estado = 'cerrado' THEN RAISE EXCEPTION 'Este partido ya está cerrado'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_partido_id::text));

  SELECT id INTO v_ficha_id
  FROM jugadores WHERE partido_id = v_partido_id AND user_id = v_uid;

  IF v_ficha_id IS NOT NULL THEN
    RETURN QUERY SELECT v_ficha_id, 'ya_estabas'::TEXT;
    RETURN;
  END IF;

  SELECT j.id, j.user_id INTO v_ficha_id, v_ficha_dueno
  FROM jugadores j
  WHERE j.partido_id = v_partido_id AND lower(j.nombre) = lower(v_nombre);

  IF v_ficha_id IS NOT NULL THEN
    SELECT estado INTO v_pago_estado FROM pagos WHERE pagos.jugador_id = v_ficha_id;

    IF v_ficha_dueno IS NOT NULL AND v_pago_estado = 'confirmado' THEN
      RAISE EXCEPTION 'Ese jugador ya tiene el pago confirmado. Pedile al organizador que te libere la ficha.';
    END IF;

    PERFORM set_config('appfut.reclamo', 'on', true);

    UPDATE jugadores
    SET user_id          = v_uid,
        user_id_anterior = v_ficha_dueno,
        reclamado_at     = CASE WHEN v_ficha_dueno IS NULL THEN reclamado_at ELSE now() END
    WHERE id = v_ficha_id;

    PERFORM set_config('appfut.reclamo', 'off', true);

    RETURN QUERY SELECT v_ficha_id,
      CASE WHEN v_ficha_dueno IS NULL THEN 'reclamada_libre' ELSE 'reclamada' END::TEXT;
    RETURN;
  END IF;

  INSERT INTO jugadores (partido_id, nombre, user_id)
  VALUES (v_partido_id, v_nombre, v_uid)
  RETURNING id INTO v_ficha_id;

  RETURN QUERY SELECT v_ficha_id, 'creada'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.unirse_o_reclamar(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unirse_o_reclamar(TEXT, TEXT) TO authenticated;
