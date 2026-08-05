-- ============================================================
-- appFut 00022 - Un partido vencido se comporta como cerrado
--
-- "Ya se jugó" NO se guarda en ninguna columna: es fecha_hora <= now().
-- Persistirlo obligaría a un pg_cron que escriba `estado`, y entre el
-- instante en que pasa la hora y el instante en que corre el job la base
-- estaría mintiendo. Se deriva en cada lectura, igual que en el cliente
-- (src/lib/estado-partido.ts).
--
-- `partidos.estado` sigue guardando la INTENCIÓN (el organizador cerró,
-- los triggers marcaron completo). El vencimiento es la CONSECUENCIA.
--
-- Alcance deliberado: se extiende el guard donde YA se validaba 'cerrado'.
--   - asignar_rol_nuevo_jugador  (última versión: 00017)
--   - unirse_o_reclamar          (última versión: 00014)
-- Los PAGOS quedan intactos a propósito: en el fútbol amateur se paga
-- después de jugar, así que el vencimiento no puede trabar la cobranza.
-- ============================================================

-- Única fuente de verdad del bloqueo en SQL. STABLE (no IMMUTABLE): depende
-- de now(), así que sólo es constante dentro de una misma sentencia.
CREATE OR REPLACE FUNCTION public.partido_bloqueado(
  p_estado     partido_estado,
  p_fecha_hora TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_estado = 'cerrado' OR COALESCE(p_fecha_hora <= now(), FALSE);
$$;

REVOKE ALL ON FUNCTION public.partido_bloqueado(partido_estado, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partido_bloqueado(partido_estado, TIMESTAMPTZ) TO authenticated;


-- ------------------------------------------------------------
-- Alta de jugador. Idéntica a 00017 salvo que ahora también lee
-- fecha_hora y delega el bloqueo en partido_bloqueado().
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asignar_rol_nuevo_jugador()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_cupo INT;
  v_estado partido_estado;
  v_fecha_hora TIMESTAMPTZ;
  v_titulares INT;
  v_integrantes_equipo INT;
  v_max_por_equipo INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.partido_id::text));

  SELECT cantidad_jugadores, estado, fecha_hora
  INTO v_cupo, v_estado, v_fecha_hora
  FROM public.partidos
  WHERE id = NEW.partido_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'El partido no existe'; END IF;
  IF public.partido_bloqueado(v_estado, v_fecha_hora) THEN
    RAISE EXCEPTION 'El partido está cerrado';
  END IF;

  SELECT COALESCE(MAX(orden_ingreso), 0) + 1
  INTO NEW.orden_ingreso
  FROM public.jugadores
  WHERE partido_id = NEW.partido_id;

  IF NEW.equipo IS NULL THEN
    NEW.rol := 'suplente';
    RETURN NEW;
  END IF;

  IF NEW.equipo NOT IN ('team1', 'team2') THEN
    RAISE EXCEPTION 'Equipo inválido';
  END IF;

  v_max_por_equipo := CEIL(v_cupo / 2.0);
  SELECT COUNT(*)
  INTO v_integrantes_equipo
  FROM public.jugadores
  WHERE partido_id = NEW.partido_id AND equipo = NEW.equipo;

  IF v_integrantes_equipo >= v_max_por_equipo THEN
    RAISE EXCEPTION 'El equipo está completo';
  END IF;

  SELECT COUNT(*)
  INTO v_titulares
  FROM public.jugadores
  WHERE partido_id = NEW.partido_id AND rol = 'titular';

  IF v_titulares >= v_cupo THEN
    RAISE EXCEPTION 'El plantel supera el cupo del partido';
  END IF;

  NEW.rol := 'titular';
  RETURN NEW;
END;
$$;


-- ------------------------------------------------------------
-- Unirse por link. Idéntica a 00014 salvo que ahora también lee
-- fecha_hora y delega el bloqueo en partido_bloqueado().
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unirse_o_reclamar(p_slug TEXT, p_nombre TEXT)
RETURNS TABLE (jugador_id UUID, accion TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_partido_id UUID;
  v_estado partido_estado;
  v_fecha_hora TIMESTAMPTZ;
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

  SELECT id, estado, fecha_hora INTO v_partido_id, v_estado, v_fecha_hora
  FROM partidos WHERE link_slug = p_slug;

  IF v_partido_id IS NULL THEN RAISE EXCEPTION 'Partido no encontrado'; END IF;
  IF public.partido_bloqueado(v_estado, v_fecha_hora) THEN
    RAISE EXCEPTION 'Este partido ya está cerrado';
  END IF;

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
