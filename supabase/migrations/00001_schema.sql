-- ============================================================
-- appFut - Esquema de base de datos Supabase
-- ============================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE partido_estado AS ENUM ('abierto', 'completo', 'cerrado');
CREATE TYPE jugador_rol AS ENUM ('titular', 'suplente');
CREATE TYPE pago_estado AS ENUM ('sin_declarar', 'pendiente_confirmacion', 'confirmado', 'rechazado');

-- ============================================================
-- TABLA: partidos
-- ============================================================
CREATE TABLE partidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizador_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha_hora TIMESTAMPTZ NOT NULL,
  cantidad_jugadores INT NOT NULL CHECK (cantidad_jugadores > 1),
  costo_total NUMERIC(10, 2) NOT NULL CHECK (costo_total >= 0),
  estado partido_estado NOT NULL DEFAULT 'abierto',
  link_slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_partidos_organizador ON partidos(organizador_id);
CREATE INDEX idx_partidos_link_slug ON partidos(link_slug);
CREATE INDEX idx_partidos_estado ON partidos(estado);

-- ============================================================
-- TABLA: jugadores
-- ============================================================
CREATE TABLE jugadores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partido_id UUID NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  device_id TEXT NOT NULL,
  rol jugador_rol NOT NULL DEFAULT 'suplente',
  emoji_o_color TEXT,
  orden_ingreso INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un device_id solo puede registrar una vez por partido
  UNIQUE(partido_id, device_id)
);

CREATE INDEX idx_jugadores_partido ON jugadores(partido_id);
CREATE INDEX idx_jugadores_device ON jugadores(partido_id, device_id);
CREATE INDEX idx_jugadores_orden ON jugadores(partido_id, orden_ingreso);

-- ============================================================
-- TABLA: pagos
-- ============================================================
CREATE TABLE pagos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jugador_id UUID NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  monto_esperado NUMERIC(10, 2) NOT NULL CHECK (monto_esperado >= 0),
  comprobante_url TEXT,
  estado pago_estado NOT NULL DEFAULT 'sin_declarar',
  confirmado_por UUID REFERENCES auth.users(id),
  confirmado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un jugador solo puede tener un pago por partido
  UNIQUE(jugador_id)
);

CREATE INDEX idx_pagos_jugador ON pagos(jugador_id);
CREATE INDEX idx_pagos_estado ON pagos(estado);

-- ============================================================
-- FUNCIÓN: calcular monto esperado por jugador
-- ============================================================
CREATE OR REPLACE FUNCTION calcular_pago_esperado(p_partido_id UUID)
RETURNS NUMERIC(10,2) AS $$
DECLARE
  v_costo_total NUMERIC(10,2);
  v_titulares INT;
BEGIN
  SELECT costo_total INTO v_costo_total FROM partidos WHERE id = p_partido_id;
  SELECT COUNT(*) INTO v_titulares FROM jugadores WHERE partido_id = p_partido_id AND rol = 'titular';
  IF v_titulares = 0 THEN
    RETURN 0;
  END IF;
  RETURN ROUND(v_costo_total / v_titulares, 2);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCIÓN: reordenar roles cuando un titular se da de baja
-- ============================================================
CREATE OR REPLACE FUNCTION reasignar_suplentes_a_titulares()
RETURNS TRIGGER AS $$
DECLARE
  v_partido_id UUID;
  v_cupo INT;
  v_titulares_count INT;
  v_costo_total NUMERIC(10,2);
  v_nuevo_monto NUMERIC(10,2);
  r RECORD;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.rol = 'titular' THEN
    v_partido_id := OLD.partido_id;

    -- Obtener el cupo del partido
    SELECT cantidad_jugadores, costo_total INTO v_cupo, v_costo_total
    FROM partidos WHERE id = v_partido_id;

    -- Contar titulares actuales
    SELECT COUNT(*) INTO v_titulares_count
    FROM jugadores WHERE partido_id = v_partido_id AND rol = 'titular';

    -- Si hay menos titulares que el cupo, promover suplentes
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

    -- Recalcular monto esperado para todos los pagos del partido
    v_nuevo_monto := calcular_pago_esperado(v_partido_id);
    IF v_nuevo_monto > 0 THEN
      UPDATE pagos
      SET monto_esperado = v_nuevo_monto
      WHERE jugador_id IN (SELECT id FROM jugadores WHERE partido_id = v_partido_id AND rol = 'titular');
    END IF;

    -- Si después de asignar aún no se completa el cupo, volver a abierto
    SELECT COUNT(*) INTO v_titulares_count
    FROM jugadores WHERE partido_id = v_partido_id AND rol = 'titular';

    IF v_titulares_count < v_cupo AND EXISTS (
      SELECT 1 FROM partidos WHERE id = v_partido_id AND estado = 'completo'
    ) THEN
      UPDATE partidos SET estado = 'abierto' WHERE id = v_partido_id;
    END IF;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_reasignar_suplentes
AFTER DELETE ON jugadores
FOR EACH ROW EXECUTE FUNCTION reasignar_suplentes_a_titulares();

-- ============================================================
-- FUNCIÓN: al insertar nuevo jugador, asignar rol y crear pago
-- ============================================================
CREATE OR REPLACE FUNCTION manejar_nuevo_jugador()
RETURNS TRIGGER AS $$
DECLARE
  v_cupo INT;
  v_titulares_count INT;
  v_partido_estado partido_estado;
  v_monto NUMERIC(10,2);
  v_partido_id UUID;
  v_jugador_id UUID;
  v_orden_max INT;
BEGIN
  v_partido_id := NEW.partido_id;
  v_jugador_id := NEW.id;

  SELECT cantidad_jugadores, estado INTO v_cupo, v_partido_estado
  FROM partidos WHERE id = v_partido_id;

  SELECT COALESCE(MAX(orden_ingreso), 0) + 1 INTO v_orden_max
  FROM jugadores WHERE partido_id = v_partido_id;
  NEW.orden_ingreso := v_orden_max;

  SELECT COUNT(*) INTO v_titulares_count
  FROM jugadores WHERE partido_id = v_partido_id AND rol = 'titular';

  IF v_titulares_count < v_cupo THEN
    NEW.rol := 'titular';
  ELSE
    NEW.rol := 'suplente';
  END IF;

  IF v_titulares_count + 1 >= v_cupo AND v_partido_estado = 'abierto' THEN
    UPDATE partidos SET estado = 'completo' WHERE id = v_partido_id;
  END IF;

  IF NEW.rol = 'titular' THEN
    v_monto := calcular_pago_esperado(v_partido_id);
    INSERT INTO pagos (jugador_id, monto_esperado)
    VALUES (v_jugador_id, v_monto);
  ELSE
    INSERT INTO pagos (jugador_id, monto_esperado)
    VALUES (v_jugador_id, 0);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_manejar_nuevo_jugador
BEFORE INSERT ON jugadores
FOR EACH ROW EXECUTE FUNCTION manejar_nuevo_jugador();

-- ============================================================
-- FUNCIÓN: al actualizar el costo_total, recalcular montos
-- ============================================================
CREATE OR REPLACE FUNCTION recalcular_pagos_por_costo()
RETURNS TRIGGER AS $$
DECLARE
  v_nuevo_monto NUMERIC(10,2);
  v_partido_id UUID;
BEGIN
  v_partido_id := NEW.id;
  IF NEW.costo_total IS DISTINCT FROM OLD.costo_total THEN
    v_nuevo_monto := calcular_pago_esperado(v_partido_id);
    IF v_nuevo_monto > 0 THEN
      UPDATE pagos
      SET monto_esperado = v_nuevo_monto
      WHERE jugador_id IN (SELECT id FROM jugadores WHERE partido_id = v_partido_id AND rol = 'titular')
        AND estado = 'sin_declarar';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_recalcular_pagos
AFTER UPDATE OF costo_total ON partidos
FOR EACH ROW EXECUTE FUNCTION recalcular_pagos_por_costo();

-- ============================================================
-- FUNCIÓN: verificar que solo el organizador confirme pagos
-- ============================================================
CREATE OR REPLACE FUNCTION verificar_confirmacion_pago()
RETURNS TRIGGER AS $$
DECLARE
  v_organizador_id UUID;
  v_jugador_id UUID;
  v_nuevo_estado TEXT;
  v_viejo_estado TEXT;
BEGIN
  v_nuevo_estado := NEW.estado;
  v_viejo_estado := OLD.estado;
  v_jugador_id := NEW.jugador_id;

  IF v_nuevo_estado = 'confirmado' AND v_viejo_estado != 'pendiente_confirmacion' THEN
    RAISE EXCEPTION 'Solo se puede confirmar un pago en estado pendiente_confirmacion';
  END IF;

  SELECT p.organizador_id INTO v_organizador_id
  FROM partidos p
  JOIN jugadores j ON j.partido_id = p.id
  WHERE j.id = v_jugador_id;

  IF NEW.confirmado_por IS DISTINCT FROM v_organizador_id THEN
    RAISE EXCEPTION 'Solo el organizador puede confirmar pagos';
  END IF;

  IF v_nuevo_estado = 'confirmado' OR v_nuevo_estado = 'rechazado' THEN
    NEW.confirmado_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_verificar_confirmacion
BEFORE UPDATE OF estado ON pagos
FOR EACH ROW
EXECUTE FUNCTION verificar_confirmacion_pago();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE partidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE jugadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;

-- Políticas para partidos
CREATE POLICY "Organizador puede insertar partidos"
  ON partidos FOR INSERT
  TO authenticated
  WITH CHECK (organizador_id = auth.uid());

CREATE POLICY "Organizador puede ver sus propios partidos"
  ON partidos FOR SELECT
  TO authenticated
  USING (organizador_id = auth.uid());

CREATE POLICY "Cualquiera puede ver partido por link"
  ON partidos FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Organizador puede actualizar su partido"
  ON partidos FOR UPDATE
  TO authenticated
  USING (organizador_id = auth.uid())
  WITH CHECK (organizador_id = auth.uid());

-- Políticas para jugadores
CREATE POLICY "Cualquiera puede ver jugadores de un partido"
  ON jugadores FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Cualquiera puede insertarse como jugador"
  ON jugadores FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Jugador puede actualizar su propio registro (mismo device_id)"
  ON jugadores FOR UPDATE
  TO anon
  USING (device_id = current_setting('app.device_id', true)::TEXT)
  WITH CHECK (device_id = current_setting('app.device_id', true)::TEXT);

CREATE POLICY "Organizador puede gestionar jugadores de su partido"
  ON jugadores FOR UPDATE
  TO authenticated
  USING (
    partido_id IN (SELECT id FROM partidos WHERE organizador_id = auth.uid())
  );

-- Políticas para pagos
CREATE POLICY "Cada jugador ve su propio pago"
  ON pagos FOR SELECT
  TO anon
  USING (
    jugador_id IN (
      SELECT id FROM jugadores
      WHERE device_id = current_setting('app.device_id', true)::TEXT
    )
  );

CREATE POLICY "Jugador puede insertar su pago"
  ON pagos FOR INSERT
  TO anon
  WITH CHECK (
    jugador_id IN (
      SELECT id FROM jugadores
      WHERE device_id = current_setting('app.device_id', true)::TEXT
    )
  );

CREATE POLICY "Jugador puede actualizar su propio pago (subir comprobante)"
  ON pagos FOR UPDATE
  TO anon
  USING (
    jugador_id IN (
      SELECT id FROM jugadores
      WHERE device_id = current_setting('app.device_id', true)::TEXT
    )
  )
  WITH CHECK (
    jugador_id IN (
      SELECT id FROM jugadores
      WHERE device_id = current_setting('app.device_id', true)::TEXT
    )
  );

CREATE POLICY "Organizador ve todos los pagos de su partido"
  ON pagos FOR SELECT
  TO authenticated
  USING (
    jugador_id IN (
      SELECT j.id FROM jugadores j
      JOIN partidos p ON p.id = j.partido_id
      WHERE p.organizador_id = auth.uid()
    )
  );

CREATE POLICY "Organizador confirma o rechaza pagos"
  ON pagos FOR UPDATE
  TO authenticated
  USING (
    jugador_id IN (
      SELECT j.id FROM jugadores j
      JOIN partidos p ON p.id = j.partido_id
      WHERE p.organizador_id = auth.uid()
    )
  )
  WITH CHECK (
    jugador_id IN (
      SELECT j.id FROM jugadores j
      JOIN partidos p ON p.id = j.partido_id
      WHERE p.organizador_id = auth.uid()
    )
  );
