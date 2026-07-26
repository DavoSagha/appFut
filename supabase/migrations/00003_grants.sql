-- appFut - Otorgar permisos a los roles de Supabase

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partidos TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jugadores TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagos TO anon, authenticated;
