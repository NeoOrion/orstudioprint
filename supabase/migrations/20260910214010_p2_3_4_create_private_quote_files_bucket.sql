insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'quote-files',
  'quote-files',
  false,
  52428800,
  null
);

-- No storage.objects policies are created:
-- the bucket stays closed to public/anon/authenticated access.
-- P2.3.6 will use server-side signed upload URLs
-- from a controlled Edge Function.
