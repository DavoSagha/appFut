-- ============================================================
-- appFut 00027 - Una sola regla de pago: reparten los titulares
--
-- POR QUÉ: el sistema tenía DOS reglas de pago conviviendo, y la que se
-- veía dependía de qué acción hubieras hecho última.
--
--   Al anotarse (INSERT)      -> 00015_equipos.sql: pagan TODOS los
--                                anotados, costo_total / COUNT(*)
--   Al guardar equipos        -> 00017_equipos_batch.sql: pagan sólo los
--   Al elegir equipo propio      titulares, costo_total / titulares,
--   Al bajarse un titular        y la reserva queda en 0
--
-- Como 00017 corre después y sus tres funciones recalculan `pagos`, el
-- "todos pagan" de 00015 era un valor TRANSITORIO: sobrevivía sólo entre
-- que alguien se anotaba y el organizador tocaba los equipos. Después se
-- pisaba solo. La feature nunca llegó a verse de verdad.
--
-- El resto del sistema ya asume "solo titulares", en 5 lugares contra 1:
--   * 00017_equipos_batch.sql:474  guardar_equipos_partido
--   * 00017_equipos_batch.sql:601  cambiar_equipo_propio
--   * 00017_equipos_batch.sql:230  reasignar_suplentes_a_titulares
--   * src/lib/monto.ts             calcularMontoPorJugador(costo, titulares)
--   * src/app/p/[slug]/page.tsx    la vista del jugador sólo muestra monto
--                                  si tenés equipo
--
-- Esta migración alinea el único camino disidente (el INSERT) con esa
-- regla, restaurando la semántica de 00001/00009 que 00015 había pisado.
-- Nadie cambia de comportamiento salvo el instante previo a armar equipos,
-- que ahora también dice 0 en vez de mentir con un monto que se iba a pisar.
--
-- NO se elige por gusto: se elige la regla que ya estaba implementada en
-- todos lados. Si mañana se quiere "todos pagan", hay que cambiar las tres
-- funciones de 00017 Y el cliente, no una sola función suelta.
--
-- Lo que 00015_equipos.sql SÍ aporta y queda intacto: la columna
-- jugadores.equipo. Sus otras funciones (asignar_rol_nuevo_jugador,
-- proteger_columnas_jugador, roster_por_slug, reasignar_suplentes_a_titulares)
-- ya venían siendo redefinidas por 00017 y 00022, que corren después.
-- ============================================================

-- Divisor = titulares (Team1 + Team2). Misma fórmula que usan las tres
-- funciones de 00017, para que no vuelvan a divergir por redondeo.
CREATE OR REPLACE FUNCTION calcular_pago_esperado(p_partido_id UUID)
RETURNS NUMERIC(10,2)
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_costo_total NUMERIC(10,2);
  v_titulares INT;
BEGIN
  SELECT costo_total INTO v_costo_total
  FROM partidos WHERE id = p_partido_id;

  SELECT COUNT(*) INTO v_titulares
  FROM jugadores WHERE partido_id = p_partido_id AND rol = 'titular';

  IF v_titulares = 0 THEN
    RETURN 0;
  END IF;

  RETURN ROUND(v_costo_total / v_titulares, 2);
END;
$$ LANGUAGE plpgsql;

-- El alta crea el pago del nuevo y, si entró como titular, recalcula al
-- resto de los titulares porque cambió el divisor. Un suplente entra en 0
-- y no toca el reparto de nadie.
--
-- `completo` también se deriva de los titulares, no del total de anotados:
-- es lo mismo que hace guardar_equipos_partido (00017:490). Con el criterio
-- de 00015 un partido de cupo 2 con 2 suplentes en Reserva ya se marcaba
-- 'completo' sin que hubiera un solo equipo armado.
CREATE OR REPLACE FUNCTION crear_pago_nuevo_jugador()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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

  -- Un pago ya confirmado o pendiente de revisión no se recalcula: la plata
  -- comprometida queda congelada. Mismo criterio que 00017.
  IF NEW.rol = 'titular' THEN
    UPDATE pagos SET monto_esperado = v_monto
    WHERE jugador_id IN (
      SELECT id FROM jugadores
      WHERE partido_id = NEW.partido_id AND rol = 'titular'
    )
    AND estado IN ('sin_declarar', 'rechazado');
  END IF;

  SELECT cantidad_jugadores INTO v_cupo
  FROM partidos WHERE id = NEW.partido_id;

  SELECT COUNT(*) INTO v_titulares
  FROM jugadores WHERE partido_id = NEW.partido_id AND rol = 'titular';

  IF v_titulares >= v_cupo THEN
    UPDATE partidos SET estado = 'completo'
    WHERE id = NEW.partido_id AND estado = 'abierto';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
