-- ============================================================
-- appFut 00012 - RPC para reclamar un jugador al perder sesión
--
-- Un RPC SECURITY DEFINER permite a un usuario anónimo reclamar
-- su nombre actualizando el user_id de su ficha. Valida que el
-- jugador pertenezca al partido identificado por el slug, que es
-- la credencial de invitación (secreta), previniendo abusos.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reclamar_jugador(p_jugador_id UUID, p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE jugadores j
  SET user_id = auth.uid()
  FROM partidos p
  WHERE j.id = p_jugador_id
    AND j.partido_id = p.id
    AND p.link_slug = p_slug;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.reclamar_jugador(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reclamar_jugador(UUID, TEXT) TO authenticated;
