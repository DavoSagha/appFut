-- ============================================================
-- appFut 00019 - No crear partidos en el pasado ni con <2hs de aviso
-- ============================================================
-- La validación ya existe en el formulario y en crearPartido(), pero las
-- dos son client/server de la MISMA app: quien llame a la RPC/REST directo
-- (o manipule el fetch) se la salta igual. Esto la hace inevitable.
--
-- No es un CHECK: un CHECK con now() se re-evalúa en CUALQUIER UPDATE de la
-- fila, y partidos.estado se actualiza todo el tiempo (cerrar/reabrir, el
-- batch de equipos) mucho después de jugado, cuando fecha_hora ya quedó en
-- el pasado a propósito. Un trigger scoped a fecha_hora no tiene ese problema.
CREATE OR REPLACE FUNCTION public.validar_fecha_partido()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Mismo criterio que proteger_columnas_jugador: mantenimiento directo en
  -- la base (migraciones, fixtures de test con service_role) no tiene JWT,
  -- así que auth.uid() es NULL. Sólo se exige a los inserts reales de la app.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF NEW.fecha_hora < now() + INTERVAL '2 hours' THEN
    RAISE EXCEPTION 'El partido debe crearse con al menos 2 horas de anticipación';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validar_fecha_partido_insert ON public.partidos;
CREATE TRIGGER trigger_validar_fecha_partido_insert
BEFORE INSERT ON public.partidos
FOR EACH ROW EXECUTE FUNCTION public.validar_fecha_partido();

-- Hoy no existe una acción para editar fecha_hora, pero si algún día se
-- agrega, ya queda cubierta: sólo corre cuando esa columna cambia de verdad.
DROP TRIGGER IF EXISTS trigger_validar_fecha_partido_update ON public.partidos;
CREATE TRIGGER trigger_validar_fecha_partido_update
BEFORE UPDATE OF fecha_hora ON public.partidos
FOR EACH ROW
WHEN (NEW.fecha_hora IS DISTINCT FROM OLD.fecha_hora)
EXECUTE FUNCTION public.validar_fecha_partido();
