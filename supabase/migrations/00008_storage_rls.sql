-- ============================================================
-- appFut 00008 - Storage con RLS real
--
-- Reemplaza el enfoque de 00006 (bucket cerrado, todo via service_role)
-- por policies sobre storage.objects atadas a auth.uid().
--
-- Ruta: {partido_id}/{jugador_id}/comprobante.{ext}
--   foldername(name)[1] = partido_id
--   foldername(name)[2] = jugador_id
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comprobantes',
  'comprobantes',
  false,
  5242880, -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
SET public             = false,
    file_size_limit    = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Limpiar cualquier policy previa sobre este bucket.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (COALESCE(qual, '') LIKE '%comprobantes%'
        OR COALESCE(with_check, '') LIKE '%comprobantes%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- El jugador sube y pisa SOLO su propio comprobante.
CREATE POLICY "jugador sube su comprobante"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'comprobantes'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.jugadores WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "jugador reemplaza su comprobante"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'comprobantes'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.jugadores WHERE user_id = auth.uid()
    )
  );

-- Lo ve quien lo subió, y el organizador del partido.
CREATE POLICY "ver comprobante propio o del partido que organizo"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'comprobantes'
    AND (
      (storage.foldername(name))[2] IN (
        SELECT id::text FROM public.jugadores WHERE user_id = auth.uid()
      )
      OR (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.partidos WHERE organizador_id = auth.uid()
      )
    )
  );

-- Borra el organizador al rechazar, o el jugador al reemplazar.
CREATE POLICY "borrar comprobante propio o del partido que organizo"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'comprobantes'
    AND (
      (storage.foldername(name))[2] IN (
        SELECT id::text FROM public.jugadores WHERE user_id = auth.uid()
      )
      OR (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.partidos WHERE organizador_id = auth.uid()
      )
    )
  );
