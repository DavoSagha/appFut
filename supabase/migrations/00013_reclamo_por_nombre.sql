-- ============================================================
-- appFut 00013 - Reclamo de ficha por nombre + cierre de agujeros
--
-- REQUISITO DE PRODUCTO: si un jugador pierde su sesión anónima,
-- tiene que poder volver a entrar escribiendo el mismo nombre y
-- seguir con lo suyo (subir el comprobante, etc).
--
-- Reglas del reclamo:
--   * ficha sin dueño (la cargó el organizador)  -> libre
--   * ficha con dueño y pago SIN confirmar       -> se reclama
--   * ficha con dueño y pago CONFIRMADO          -> bloqueado
--
-- Además revierte el bypass de 00010, que desactivaba por completo
-- las dos protecciones de columnas.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Retirar reclamar_jugador() de 00012.
--    Reasignaba el user_id de CUALQUIER ficha con solo pasar su id y
--    el slug. Pero el slug lo tienen todos los invitados del grupo: no
--    distingue entre ellos, que es justo lo que hay que distinguir.
--    Cualquiera del grupo se llevaba la ficha de cualquiera, incluso
--    con el pago ya confirmado. Lo reemplaza unirse_o_reclamar().
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reclamar_jugador(UUID, TEXT);

-- ------------------------------------------------------------
-- 1. La ficha puede no tener dueño todavía
-- ------------------------------------------------------------
ALTER TABLE jugadores ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS user_id_anterior UUID;
ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS reclamado_at TIMESTAMPTZ;

COMMENT ON COLUMN jugadores.user_id IS
  'NULL = ficha cargada por el organizador, todavía sin dueño.';
COMMENT ON COLUMN jugadores.user_id_anterior IS
  'Rastro de auditoría: a quién le pertenecía antes del último reclamo.';

-- ------------------------------------------------------------
-- 2. Constraints. Los dos conviven, no se reemplazan.
--    (00011 cambió uno POR el otro y perdió la garantía de que
--     un mismo usuario no se anote N veces en el mismo partido.)
-- ------------------------------------------------------------
ALTER TABLE jugadores DROP CONSTRAINT IF EXISTS jugadores_partido_nombre_key;
ALTER TABLE jugadores DROP CONSTRAINT IF EXISTS jugadores_partido_user_key;

-- Un usuario, una ficha por partido. Las fichas sin dueño no cuentan.
CREATE UNIQUE INDEX IF NOT EXISTS jugadores_partido_user_uidx
  ON jugadores (partido_id, user_id) WHERE user_id IS NOT NULL;

-- Un nombre por partido, sin importar mayúsculas: si el reclamo se
-- resuelve por nombre, "martin" y "Martín" no pueden ser dos fichas.
CREATE UNIQUE INDEX IF NOT EXISTS jugadores_partido_nombre_uidx
  ON jugadores (partido_id, lower(nombre));

-- ------------------------------------------------------------
-- 2b. El organizador puede cargar fichas SIN dueño.
--     La policy de 00007 exigía user_id = auth.uid(), y como
--     `NULL = auth.uid()` no es TRUE, RLS bloqueaba esos inserts.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "anotarse a si mismo" ON jugadores;
CREATE POLICY "anotarse a si mismo"
  ON jugadores FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR (user_id IS NULL AND public.es_organizador_de(partido_id))
  );

-- ------------------------------------------------------------
-- 3. Revertir el bypass de 00010.
--
--    `IF current_user <> session_user THEN RETURN NEW` era SIEMPRE
--    verdadero: PostgREST entra como `authenticator` y hace SET ROLE,
--    y dentro de una función SECURITY DEFINER current_user es el dueño
--    de la función. Nunca coinciden -> la protección no corría nunca.
--
--    Lo que en realidad había que distinguir es "UPDATE directo del
--    usuario" de "UPDATE disparado por otro trigger" (la promoción de
--    suplentes). Para eso está pg_trigger_depth().
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION proteger_columnas_jugador()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Cascada interna (ej: reasignar_suplentes_a_titulares promoviendo).
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  -- Reclamo autorizado por unirse_o_reclamar().
  IF COALESCE(current_setting('appfut.reclamo', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF public.es_organizador_de(NEW.partido_id) THEN RETURN NEW; END IF;

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
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_partido_id UUID;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  SELECT partido_id INTO v_partido_id FROM jugadores WHERE id = NEW.jugador_id;

  IF public.es_organizador_de(v_partido_id) THEN RETURN NEW; END IF;

  IF NEW.monto_esperado  IS DISTINCT FROM OLD.monto_esperado
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

-- ------------------------------------------------------------
-- 4. verificar_confirmacion_pago necesita SECURITY DEFINER.
--    Sin él, su SELECT sobre partidos pasa por RLS: para un jugador
--    devuelve 0 filas, v_organizador_id queda NULL, y como
--    `NULL IS DISTINCT FROM NULL` es false, la validación no dispara.
--    Resultado: el jugador se autoconfirmaba el pago.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 5. Unirse o reclamar, atómico y con las reglas adentro.
--
--    Va por SECURITY DEFINER a propósito: el que reclama todavía NO
--    es jugador del partido, así que RLS no lo deja ni leer la ficha
--    que quiere reclamar. En vez de aflojar la policy (que es cómo
--    nos comimos el desastre de 00002), la excepción vive acá, acotada
--    y con las reglas escritas.
-- ------------------------------------------------------------
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
    SELECT estado INTO v_pago_estado FROM pagos WHERE jugador_id = v_ficha_id;

    -- Plata ya cerrada: no se toca sin el organizador.
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
