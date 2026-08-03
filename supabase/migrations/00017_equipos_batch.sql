-- ============================================================
-- appFut 00017 - Equipos persistidos + guardado batch atómico
-- ============================================================

-- La aplicación ya consumía `equipo`, pero la columna no estaba en el
-- historial de migraciones. No se infieren equipos ni se reescriben roles:
-- los datos legacy se preservan exactamente hasta una confirmación explícita.
ALTER TABLE public.jugadores ADD COLUMN IF NOT EXISTS equipo TEXT;

-- Versión monotónica del plantel para evitar lost updates entre pestañas.
ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS roster_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.partidos
  ALTER COLUMN roster_version SET DEFAULT 0;
UPDATE public.partidos SET roster_version = 0 WHERE roster_version IS NULL;
ALTER TABLE public.partidos
  ALTER COLUMN roster_version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.jugadores'::regclass
      AND conname = 'jugadores_equipo_check'
  ) THEN
    ALTER TABLE public.jugadores
      ADD CONSTRAINT jugadores_equipo_check
      CHECK (equipo IS NULL OR equipo IN ('team1', 'team2')) NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_jugadores_partido_equipo
  ON public.jugadores (partido_id, equipo);

-- Desde esta migración, una alta sin equipo entra a Reserva. No se actualizan
-- filas existentes: la compatibilidad legacy se conserva hasta que esa ficha
-- participe de un cambio explícito de equipo.
CREATE OR REPLACE FUNCTION public.asignar_rol_nuevo_jugador()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_cupo INT;
  v_estado partido_estado;
  v_titulares INT;
  v_integrantes_equipo INT;
  v_max_por_equipo INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.partido_id::text));

  SELECT cantidad_jugadores, estado
  INTO v_cupo, v_estado
  FROM public.partidos
  WHERE id = NEW.partido_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'El partido no existe'; END IF;
  IF v_estado = 'cerrado' THEN RAISE EXCEPTION 'El partido está cerrado'; END IF;

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

DROP TRIGGER IF EXISTS trigger_asignar_rol ON public.jugadores;
CREATE TRIGGER trigger_asignar_rol
BEFORE INSERT ON public.jugadores
FOR EACH ROW EXECUTE FUNCTION public.asignar_rol_nuevo_jugador();

-- No es un CHECK a propósito: un CHECK NOT VALID también bloquearía un UPDATE
-- de nombre/emoji sobre una fila legacy incoherente. Este trigger sólo valida
-- INSERTs nuevos o cambios reales de equipo/rol.
CREATE OR REPLACE FUNCTION public.validar_coherencia_equipo_rol()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.equipo IS NOT DISTINCT FROM OLD.equipo
     AND NEW.rol IS NOT DISTINCT FROM OLD.rol THEN
    RETURN NEW;
  END IF;

  IF (NEW.equipo IS NULL AND NEW.rol <> 'suplente')
     OR (NEW.equipo IS NOT NULL AND NEW.rol <> 'titular') THEN
    RAISE EXCEPTION 'Equipo y rol son incompatibles';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validar_equipo_rol ON public.jugadores;
CREATE TRIGGER trigger_validar_equipo_rol
BEFORE INSERT OR UPDATE OF equipo, rol ON public.jugadores
FOR EACH ROW EXECUTE FUNCTION public.validar_coherencia_equipo_rol();

-- Cada mutación real del plantel invalida los snapshots abiertos. Nombre/emoji
-- quedan afuera a propósito porque no cambian cupos ni distribución.
CREATE OR REPLACE FUNCTION public.incrementar_roster_version()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_partido_id UUID;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.equipo IS NOT DISTINCT FROM OLD.equipo
     AND NEW.rol IS NOT DISTINCT FROM OLD.rol THEN
    RETURN NEW;
  END IF;

  v_partido_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.partido_id
    ELSE NEW.partido_id
  END;

  UPDATE public.partidos
  SET roster_version = roster_version + 1
  WHERE id = v_partido_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- El prefijo z hace que, en DELETE, la promoción histórica corra primero. Así
-- esa promoción y la baja quedan reflejadas como dos mutaciones reales.
DROP TRIGGER IF EXISTS trigger_z_roster_version_alta_baja ON public.jugadores;
CREATE TRIGGER trigger_z_roster_version_alta_baja
AFTER INSERT OR DELETE ON public.jugadores
FOR EACH ROW EXECUTE FUNCTION public.incrementar_roster_version();

DROP TRIGGER IF EXISTS trigger_z_roster_version_equipo ON public.jugadores;
CREATE TRIGGER trigger_z_roster_version_equipo
AFTER UPDATE OF equipo, rol ON public.jugadores
FOR EACH ROW
WHEN (
  OLD.equipo IS DISTINCT FROM NEW.equipo
  OR OLD.rol IS DISTINCT FROM NEW.rol
)
EXECUTE FUNCTION public.incrementar_roster_version();

-- La promoción histórica debe escribir las dos columnas juntas. Si se borra
-- un titular legacy sin equipo no hay equipo liberado y no se promociona.
CREATE OR REPLACE FUNCTION public.reasignar_suplentes_a_titulares()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_cupo INT;
  v_titulares INT;
  v_nuevo_monto NUMERIC(10, 2);
  v_reserva_id UUID;
BEGIN
  IF TG_OP <> 'DELETE' OR OLD.rol <> 'titular' THEN RETURN OLD; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(OLD.partido_id::text));

  SELECT cantidad_jugadores
  INTO v_cupo
  FROM public.partidos
  WHERE id = OLD.partido_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN OLD; END IF;

  IF OLD.equipo IS NOT NULL THEN
    SELECT id
    INTO v_reserva_id
    FROM public.jugadores
    WHERE partido_id = OLD.partido_id
      AND equipo IS NULL
      AND rol = 'suplente'
    ORDER BY orden_ingreso, created_at, id
    LIMIT 1;

    IF v_reserva_id IS NOT NULL THEN
      UPDATE public.jugadores
      SET equipo = OLD.equipo, rol = 'titular'
      WHERE id = v_reserva_id;
    END IF;
  END IF;

  SELECT COUNT(*)
  INTO v_titulares
  FROM public.jugadores
  WHERE partido_id = OLD.partido_id AND rol = 'titular';

  v_nuevo_monto := CASE
    WHEN v_titulares = 0 THEN 0
    ELSE public.calcular_pago_esperado(OLD.partido_id)
  END;

  UPDATE public.pagos pg
  SET monto_esperado = CASE
    WHEN j.rol = 'titular' THEN v_nuevo_monto
    ELSE 0
  END
  FROM public.jugadores j
  WHERE pg.jugador_id = j.id
    AND j.partido_id = OLD.partido_id
    AND pg.estado IN ('sin_declarar', 'rechazado')
    AND pg.monto_esperado IS DISTINCT FROM CASE
      WHEN j.rol = 'titular' THEN v_nuevo_monto
      ELSE 0
    END;

  UPDATE public.partidos
  SET estado = CASE
    WHEN v_titulares = v_cupo THEN 'completo'::partido_estado
    ELSE 'abierto'::partido_estado
  END
  WHERE id = OLD.partido_id AND estado <> 'cerrado';

  RETURN OLD;
END;
$$;

-- El tipo de retorno de una función no se puede cambiar con CREATE OR REPLACE.
-- DROP/CREATE hace converger instalaciones donde `equipo` se agregó a mano.
DROP FUNCTION IF EXISTS public.roster_por_slug(TEXT);
CREATE FUNCTION public.roster_por_slug(p_slug TEXT)
RETURNS TABLE (
  id UUID,
  nombre TEXT,
  rol jugador_rol,
  equipo TEXT,
  emoji_o_color TEXT,
  pago_estado pago_estado,
  es_mio BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT j.id,
         j.nombre,
         j.rol,
         j.equipo,
         j.emoji_o_color,
         pg.estado,
         (j.user_id = auth.uid())
  FROM public.jugadores j
  JOIN public.partidos p ON p.id = j.partido_id
  LEFT JOIN public.pagos pg ON pg.jugador_id = j.id
  WHERE p.link_slug = p_slug
  ORDER BY j.orden_ingreso;
$$;

REVOKE ALL ON FUNCTION public.roster_por_slug(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_por_slug(TEXT) TO authenticated, service_role;

-- Tanto el batch del organizador como el cambio propio escriben equipo+rol de
-- forma atómica. El flag sólo lo activa la RPC validada de cambio propio.
CREATE OR REPLACE FUNCTION public.proteger_columnas_jugador()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF COALESCE(current_setting('appfut.reclamo', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('appfut.cambio_equipo', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.es_organizador_de(NEW.partido_id) THEN RETURN NEW; END IF;

  IF NEW.partido_id IS DISTINCT FROM OLD.partido_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.rol IS DISTINCT FROM OLD.rol
     OR NEW.equipo IS DISTINCT FROM OLD.equipo
     OR NEW.orden_ingreso IS DISTINCT FROM OLD.orden_ingreso THEN
    RAISE EXCEPTION 'Solo podés cambiar tu nombre o tu emoji';
  END IF;

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.guardar_equipos_partido(UUID, JSONB);
CREATE OR REPLACE FUNCTION public.guardar_equipos_partido(
  p_partido_id UUID,
  p_cambios JSONB,
  p_expected_version BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cupo INT;
  v_costo_total NUMERIC(10, 2);
  v_cantidad_cambios INT;
  v_ids_validos INT;
  v_team1 INT;
  v_team2 INT;
  v_titulares INT;
  v_max_por_equipo INT;
  v_nuevo_monto NUMERIC(10, 2);
  v_roster_version BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesión expirada';
  END IF;
  IF jsonb_typeof(p_cambios) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Los cambios de equipos son inválidos';
  END IF;

  IF p_expected_version IS NULL OR p_expected_version < 0 THEN
    RAISE EXCEPTION 'La versión del plantel es inválida';
  END IF;

  v_cantidad_cambios := jsonb_array_length(p_cambios);
  IF v_cantidad_cambios > 500 THEN
    RAISE EXCEPTION 'Demasiados cambios de equipos';
  END IF;

  -- Se valida texto ANTES de cualquier cast: los UUID inválidos siempre
  -- producen un mensaje controlado, nunca el error interno de PostgreSQL.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_cambios) AS item(valor)
    WHERE jsonb_typeof(valor) IS DISTINCT FROM 'object'
       OR NOT (valor ? 'jugador_id')
       OR COALESCE(valor->>'jugador_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT (valor ? 'equipo')
       OR NOT (
         valor->'equipo' = 'null'::jsonb
         OR (
           jsonb_typeof(valor->'equipo') = 'string'
           AND valor->>'equipo' IN ('team1', 'team2')
         )
       )
  ) THEN
    RAISE EXCEPTION 'Los cambios de equipos son inválidos';
  END IF;

  -- UUID es case-insensitive. El DISTINCT ocurre sobre UUID canónico, no text.
  IF (
    SELECT COUNT(DISTINCT (valor->>'jugador_id')::UUID)
    FROM jsonb_array_elements(p_cambios) AS item(valor)
  ) <> v_cantidad_cambios THEN
    RAISE EXCEPTION 'Hay jugadores repetidos en los cambios';
  END IF;

  -- Mismo advisory lock que altas/bajas, más lock de partido. Una baja ya en
  -- curso puede hacer esperar o abortar esta RPC; la Server Action devuelve el
  -- error y la UI conserva el draft para reintentar, sin estado parcial.
  PERFORM pg_advisory_xact_lock(hashtext(p_partido_id::text));

  SELECT cantidad_jugadores, costo_total, roster_version
  INTO v_cupo, v_costo_total, v_roster_version
  FROM public.partidos
  WHERE id = p_partido_id AND organizador_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No tenés permiso sobre este partido';
  END IF;
  IF v_roster_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'ROSTER_STALE';
  END IF;

  WITH cambios AS (
    SELECT (valor->>'jugador_id')::UUID AS jugador_id
    FROM jsonb_array_elements(p_cambios) AS item(valor)
  )
  SELECT COUNT(*)
  INTO v_ids_validos
  FROM public.jugadores j
  JOIN cambios c ON c.jugador_id = j.id
  WHERE j.partido_id = p_partido_id;

  IF v_ids_validos <> v_cantidad_cambios THEN
    RAISE EXCEPTION 'Uno o más jugadores ya no pertenecen al partido';
  END IF;

  -- Los jugadores legacy sin equipo conservan su rol hasta ser incluidos en un
  -- batch. Así migrar la columna no altera pagos, cupos ni estado existentes.
  WITH cambios AS (
    SELECT (valor->>'jugador_id')::UUID AS jugador_id,
           valor->>'equipo' AS equipo
    FROM jsonb_array_elements(p_cambios) AS item(valor)
  ), estado_final AS (
    SELECT CASE WHEN c.jugador_id IS NOT NULL THEN c.equipo ELSE j.equipo END AS equipo,
           CASE
             WHEN c.jugador_id IS NULL THEN j.rol
             WHEN c.equipo IS NULL THEN 'suplente'::jugador_rol
             ELSE 'titular'::jugador_rol
           END AS rol
    FROM public.jugadores j
    LEFT JOIN cambios c ON c.jugador_id = j.id
    WHERE j.partido_id = p_partido_id
  )
  SELECT COUNT(*) FILTER (WHERE equipo = 'team1'),
         COUNT(*) FILTER (WHERE equipo = 'team2'),
         COUNT(*) FILTER (WHERE rol = 'titular')
  INTO v_team1, v_team2, v_titulares
  FROM estado_final;

  v_max_por_equipo := CEIL(v_cupo / 2.0);
  IF v_team1 > v_max_por_equipo THEN
    RAISE EXCEPTION 'El equipo 1 está completo';
  END IF;
  IF v_team2 > v_max_por_equipo THEN
    RAISE EXCEPTION 'El equipo 2 está completo';
  END IF;
  IF v_titulares > v_cupo THEN
    RAISE EXCEPTION 'El plantel supera el cupo del partido';
  END IF;

  WITH cambios AS (
    SELECT (valor->>'jugador_id')::UUID AS jugador_id,
           valor->>'equipo' AS equipo
    FROM jsonb_array_elements(p_cambios) AS item(valor)
  )
  UPDATE public.jugadores j
  SET equipo = c.equipo,
      rol = CASE
        WHEN c.equipo IS NULL THEN 'suplente'::jugador_rol
        ELSE 'titular'::jugador_rol
      END
  FROM cambios c
  WHERE j.id = c.jugador_id
    AND j.partido_id = p_partido_id
    AND (j.equipo, j.rol) IS DISTINCT FROM (
      c.equipo,
      CASE
        WHEN c.equipo IS NULL THEN 'suplente'::jugador_rol
        ELSE 'titular'::jugador_rol
      END
    );

  v_nuevo_monto := CASE
    WHEN v_titulares = 0 THEN 0
    ELSE ROUND(v_costo_total / v_titulares, 2)
  END;

  UPDATE public.pagos pg
  SET monto_esperado = CASE
    WHEN j.rol = 'titular' THEN v_nuevo_monto
    ELSE 0
  END
  FROM public.jugadores j
  WHERE pg.jugador_id = j.id
    AND j.partido_id = p_partido_id
    AND pg.estado IN ('sin_declarar', 'rechazado')
    AND pg.monto_esperado IS DISTINCT FROM CASE
      WHEN j.rol = 'titular' THEN v_nuevo_monto
      ELSE 0
    END;

  UPDATE public.partidos
  SET estado = CASE
    WHEN v_titulares = v_cupo THEN 'completo'::partido_estado
    ELSE 'abierto'::partido_estado
  END
  WHERE id = p_partido_id AND estado <> 'cerrado';

  SELECT roster_version
  INTO v_roster_version
  FROM public.partidos
  WHERE id = p_partido_id;

  RETURN v_roster_version;
END;
$$;

REVOKE ALL ON FUNCTION public.guardar_equipos_partido(UUID, JSONB, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_equipos_partido(UUID, JSONB, BIGINT)
  TO authenticated, service_role;

-- Mantiene funcional el cambio de equipo del propio jugador sin aflojar la
-- protección de columnas ni repetir el COUNT -> UPDATE vulnerable a carreras.
CREATE OR REPLACE FUNCTION public.cambiar_equipo_propio(
  p_slug TEXT,
  p_equipo TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_partido_id UUID;
  v_jugador_id UUID;
  v_cupo INT;
  v_costo_total NUMERIC(10, 2);
  v_team_destino INT;
  v_titulares INT;
  v_max_por_equipo INT;
  v_nuevo_monto NUMERIC(10, 2);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No estás anotado en este partido';
  END IF;
  IF p_equipo IS NOT NULL AND p_equipo NOT IN ('team1', 'team2') THEN
    RAISE EXCEPTION 'Equipo inválido';
  END IF;

  SELECT id INTO v_partido_id
  FROM public.partidos
  WHERE link_slug = p_slug;

  IF v_partido_id IS NULL THEN
    RAISE EXCEPTION 'Partido no encontrado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_partido_id::text));

  SELECT cantidad_jugadores, costo_total
  INTO v_cupo, v_costo_total
  FROM public.partidos
  WHERE id = v_partido_id
  FOR UPDATE;

  SELECT id INTO v_jugador_id
  FROM public.jugadores
  WHERE partido_id = v_partido_id AND user_id = v_uid
  FOR UPDATE;

  IF v_jugador_id IS NULL THEN
    RAISE EXCEPTION 'No estás anotado en este partido';
  END IF;

  IF p_equipo IS NOT NULL THEN
    SELECT COUNT(*) INTO v_team_destino
    FROM public.jugadores
    WHERE partido_id = v_partido_id
      AND equipo = p_equipo
      AND id <> v_jugador_id;

    v_max_por_equipo := CEIL(v_cupo / 2.0);
    IF v_team_destino >= v_max_por_equipo THEN
      RAISE EXCEPTION 'El equipo % está completo',
        CASE WHEN p_equipo = 'team1' THEN '1' ELSE '2' END;
    END IF;
  END IF;

  SELECT COUNT(*) + CASE WHEN p_equipo IS NULL THEN 0 ELSE 1 END
  INTO v_titulares
  FROM public.jugadores
  WHERE partido_id = v_partido_id
    AND rol = 'titular'
    AND id <> v_jugador_id;

  IF v_titulares > v_cupo THEN
    RAISE EXCEPTION 'El plantel supera el cupo del partido';
  END IF;

  PERFORM set_config('appfut.cambio_equipo', 'on', true);
  UPDATE public.jugadores
  SET equipo = p_equipo,
      rol = CASE
        WHEN p_equipo IS NULL THEN 'suplente'::jugador_rol
        ELSE 'titular'::jugador_rol
      END
  WHERE id = v_jugador_id;

  v_nuevo_monto := CASE
    WHEN v_titulares = 0 THEN 0
    ELSE ROUND(v_costo_total / v_titulares, 2)
  END;

  UPDATE public.pagos pg
  SET monto_esperado = CASE
    WHEN j.rol = 'titular' THEN v_nuevo_monto
    ELSE 0
  END
  FROM public.jugadores j
  WHERE pg.jugador_id = j.id
    AND j.partido_id = v_partido_id
    AND pg.estado IN ('sin_declarar', 'rechazado')
    AND pg.monto_esperado IS DISTINCT FROM CASE
      WHEN j.rol = 'titular' THEN v_nuevo_monto
      ELSE 0
    END;

  UPDATE public.partidos
  SET estado = CASE
    WHEN v_titulares = v_cupo THEN 'completo'::partido_estado
    ELSE 'abierto'::partido_estado
  END
  WHERE id = v_partido_id AND estado <> 'cerrado';
END;
$$;

REVOKE ALL ON FUNCTION public.cambiar_equipo_propio(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_equipo_propio(TEXT, TEXT)
  TO authenticated, service_role;
