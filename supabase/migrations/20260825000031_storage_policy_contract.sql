-- BTPM OSS baseline: direct storage access remains fail-closed for private buckets.
-- Protected access to these buckets must flow through approved backend paths.

DROP POLICY IF EXISTS btpm_private_buckets_deny_select ON storage.objects;
CREATE POLICY btpm_private_buckets_deny_select
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id <> ALL (ARRAY['btpm-attachments'::text, 'btpm-exports'::text, 'btpm-imports-temp'::text]));

DROP POLICY IF EXISTS btpm_private_buckets_deny_insert ON storage.objects;
CREATE POLICY btpm_private_buckets_deny_insert
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id <> ALL (ARRAY['btpm-attachments'::text, 'btpm-exports'::text, 'btpm-imports-temp'::text]));

DROP POLICY IF EXISTS btpm_private_buckets_deny_update ON storage.objects;
CREATE POLICY btpm_private_buckets_deny_update
ON storage.objects
FOR UPDATE
TO anon, authenticated
USING (bucket_id <> ALL (ARRAY['btpm-attachments'::text, 'btpm-exports'::text, 'btpm-imports-temp'::text]))
WITH CHECK (bucket_id <> ALL (ARRAY['btpm-attachments'::text, 'btpm-exports'::text, 'btpm-imports-temp'::text]));

DROP POLICY IF EXISTS btpm_private_buckets_deny_delete ON storage.objects;
CREATE POLICY btpm_private_buckets_deny_delete
ON storage.objects
FOR DELETE
TO anon, authenticated
USING (bucket_id <> ALL (ARRAY['btpm-attachments'::text, 'btpm-exports'::text, 'btpm-imports-temp'::text]));
