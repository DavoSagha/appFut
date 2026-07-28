-- ============================================================
-- appFut 00016 - El organizador puede borrar un partido ya jugado
--
-- Hasta acá NO existía policy de DELETE sobre partidos ni el grant
-- correspondiente: borrar un partido era imposible.
--
-- Regla: solo el organizador, y solo DESPUÉS de la fecha y hora del
-- partido. Antes de que se juegue no se borra: hay gente anotada y
-- pagos en curso.
--
-- Los residuos en la base ya estaban resueltos por las FK:
--   partidos -> jugadores -> pagos, todas ON DELETE CASCADE.
-- Lo que NO cascadea son los archivos de Storage. Eso lo limpia la
-- Server Action eliminarPartido() ANTES de borrar la fila, porque la
-- policy de storage se apoya en que el partido todavía exista.
-- ============================================================

GRANT DELETE ON public.partidos TO authenticated;

DROP POLICY IF EXISTS "organizador borra su partido ya jugado" ON partidos;
CREATE POLICY "organizador borra su partido ya jugado"
  ON partidos FOR DELETE TO authenticated
  USING (
    organizador_id = auth.uid()
    AND fecha_hora < now()
  );
