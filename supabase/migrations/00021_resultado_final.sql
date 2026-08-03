-- ============================================================
-- appFut 00021 - Resultado final del partido
-- ============================================================
-- Team1 X - Y Team2, cargado por el organizador después de jugado.
-- Editable (por si se cometió un error) y visible para todos los
-- jugadores, pero sólo el organizador puede escribirlo: la policy de
-- UPDATE de `partidos` ya restringe a organizador_id = auth.uid(), no
-- hace falta ninguna policy ni trigger nuevo para eso.

ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS resultado_team1 INT,
  ADD COLUMN IF NOT EXISTS resultado_team2 INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partidos_resultado_no_negativo'
  ) THEN
    ALTER TABLE public.partidos
      ADD CONSTRAINT partidos_resultado_no_negativo
      CHECK (
        (resultado_team1 IS NULL OR resultado_team1 >= 0)
        AND (resultado_team2 IS NULL OR resultado_team2 >= 0)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partidos_resultado_ambos_o_ninguno'
  ) THEN
    ALTER TABLE public.partidos
      ADD CONSTRAINT partidos_resultado_ambos_o_ninguno
      CHECK ((resultado_team1 IS NULL) = (resultado_team2 IS NULL));
  END IF;
END;
$$;

-- El tipo de retorno cambia (dos columnas más): CREATE OR REPLACE no
-- alcanza, hay que recrear la función (mismo patrón que roster_por_slug
-- en la 00017).
DROP FUNCTION IF EXISTS public.partido_por_slug(TEXT);
CREATE FUNCTION public.partido_por_slug(p_slug TEXT)
RETURNS TABLE (
  id UUID,
  fecha_hora TIMESTAMPTZ,
  cantidad_jugadores INT,
  estado partido_estado,
  resultado_team1 INT,
  resultado_team2 INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.fecha_hora, p.cantidad_jugadores, p.estado,
         p.resultado_team1, p.resultado_team2
  FROM partidos p
  WHERE p.link_slug = p_slug;
$$;

REVOKE ALL ON FUNCTION public.partido_por_slug(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partido_por_slug(TEXT) TO authenticated;
