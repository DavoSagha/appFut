-- ============================================================
-- appFut 00015 - Grants explícitos para service_role
--
-- Descubierto levantando la base de cero: en esta versión de Supabase,
-- los privilegios por defecto del schema public NO le dan DML a
-- service_role. Una tabla recién creada le deja solo REFERENCES,
-- TRIGGER y TRUNCATE.
--
-- Nuestras migraciones nunca se lo otorgaron: 00003 y 00007 solo tocan
-- anon y authenticated. Resultado: en una base nueva, service_role se
-- come un "permission denied for table partidos".
--
-- Hoy la app no usa service_role (se sacó al migrar a anonymous
-- sign-ins), así que esto no afecta a producción. Pero deja el esquema
-- autocontenido en vez de depender de los defaults de la plataforma,
-- que ya probamos que cambian entre versiones.
--
-- No amplía su autoridad real: service_role tiene BYPASSRLS igual.
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partidos  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jugadores TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagos     TO service_role;
