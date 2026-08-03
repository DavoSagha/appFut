-- ============================================================
-- appFut 00018 - Resumen público sin nombres para la pantalla de unirse
-- ============================================================
-- La pantalla previa a unirse (`/unirse/[slug]`) compartía
-- obtenerVistaPartido con la vista del jugador ya unido, y esa función
-- trae el roster completo (nombres, equipo, pago) vía roster_por_slug.
-- Cualquiera con el link -o que adivine un código- veía quién ya estaba
-- anotado en Team1/Team2/Reserva antes de decidir unirse. Esta función
-- sólo expone lo necesario para decidir: cuántos hay anotados y si quien
-- pregunta ya tiene ficha propia, sin ningún nombre ajeno.

CREATE OR REPLACE FUNCTION public.resumen_publico_por_slug(p_slug TEXT)
RETURNS TABLE (
  anotados INT,
  ya_estoy BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::INT,
         EXISTS (
           SELECT 1
           FROM public.jugadores j2
           JOIN public.partidos p2 ON p2.id = j2.partido_id
           WHERE p2.link_slug = p_slug AND j2.user_id = auth.uid()
         )
  FROM public.jugadores j
  JOIN public.partidos p ON p.id = j.partido_id
  WHERE p.link_slug = p_slug;
$$;

-- Igual que partido_por_slug/roster_por_slug: sólo `authenticated` (el
-- anónimo ya tiene sesión real gracias a asegurarSesion() en el cliente).
-- `anon` sin sesión sigue sin poder ni probar códigos.
REVOKE ALL ON FUNCTION public.resumen_publico_por_slug(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumen_publico_por_slug(TEXT) TO authenticated;
