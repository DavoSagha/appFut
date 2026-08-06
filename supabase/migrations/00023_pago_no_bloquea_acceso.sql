-- ============================================================
-- appFut 00023 - El pago confirmado deja de ser un candado de acceso
--
-- SÍNTOMA: el organizador marca a Davo como Pagado. Davo cierra el
-- navegador, pierde la sesión anónima, vuelve, escribe "Davo" y el
-- sistema lo rechaza con "Ese jugador ya tiene el pago confirmado.
-- Pedile al organizador que te libere la ficha."
--
-- CAUSA: 00013 mezcló tres conceptos que son distintos.
--
--   jugador anotado  -> jugadores.id      ¿existe la ficha?
--   sesión / acceso  -> jugadores.user_id ¿quién es el dueño hoy?
--   estado de pago   -> pagos.estado      ¿debe plata?
--
-- `unirse_o_reclamar` usaba pagos.estado como si fuera una credencial
-- de autenticación. No lo es: es contabilidad. El resultado fue que el
-- único jugador que NO podía volver a entrar era, justamente, el que ya
-- había pagado.
--
-- CAMBIO: el reclamo por nombre ya no mira el estado del pago.
--
--   ficha sin dueño (la cargó el organizador)  -> reclamada_libre
--   ficha con dueño, pague o no                -> reclamada
--
-- QUÉ SOBREVIVE AL RECLAMO, Y POR QUÉ NO HAY QUE MIGRAR NADA:
-- el reclamo hace UPDATE de `user_id` sobre la MISMA fila; `jugadores.id`
-- nunca cambia. Y todo lo del jugador cuelga de ese id, no del usuario:
--   * pagos.jugador_id            -> el pago sigue en 'confirmado', con su
--                                    monto_pagado congelado y su confirmado_at
--   * {partido_id}/{jugador_id}/  -> ruta del comprobante en storage (00008),
--                                    y sus policies resuelven la propiedad
--                                    vía jugadores.user_id = auth.uid(), así
--                                    que el nuevo dueño hereda el acceso
--   * rol, equipo, orden_ingreso, emoji -> intactos, no se tocan
--
-- DOS PERSONAS NO PUEDEN OCUPAR LA MISMA FICHA A LA VEZ:
-- `user_id` es una sola columna y el traspaso corre bajo
-- pg_advisory_xact_lock(partido_id), igual que antes. El dueño anterior
-- queda desalojado (y registrado en user_id_anterior), nunca duplicado.
-- El índice único (partido_id, user_id) sigue garantizando una ficha por
-- usuario, y (partido_id, lower(nombre)) una ficha por nombre.
--
-- LO QUE ESTE CAMBIO SÍ HABILITA — a la vista, no escondido:
-- el reclamo por nombre nunca autenticó a nadie. Cualquiera con el link
-- puede escribir "Davo" y quedarse con la ficha de Davo. Eso YA era cierto
-- para toda ficha sin pago confirmado; 00023 extiende el mismo criterio a
-- las pagadas. La defensa sigue siendo la misma que para el resto: el link
-- es la credencial del grupo, y user_id_anterior + reclamado_at dejan el
-- rastro de auditoría. Si algún día hace falta más que eso, la respuesta es
-- un PIN por ficha, no volver a poner el pago de candado.
--
-- LO QUE NO CAMBIA: el pago sigue siendo intocable para el jugador.
-- proteger_columnas_pago (00013) y verificar_confirmacion_pago (00020) son
-- los que cuidan la plata, y quedan como están. Reclamar la ficha te
-- devuelve el acceso, no te deja mover el estado del pago.
-- ============================================================

-- Idéntica a 00022 salvo por el bloqueo de pago confirmado, que se retira
-- junto con la variable v_pago_estado, que ya no tiene lector.
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

  -- ¿Ya tengo ficha acá? Entonces no hay nada que reclamar.
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
    -- Acá vivía el bloqueo por pago confirmado. El estado del pago no se
    -- consulta más: no decide quién entra. Ver el encabezado.
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
