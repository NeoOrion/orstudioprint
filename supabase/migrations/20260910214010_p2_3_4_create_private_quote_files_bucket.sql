insert into storage.buckets (
  id,
  name,
  public,
  type,
  file_size_limit,
  allowed_mime_types,
  versioning_status
)
values (
  'quote-files',
  'quote-files',
  false,
  'STANDARD',
  52428800,
  null,
  'DISABLED'
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  type = excluded.type,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  versioning_status = excluded.versioning_status;

-- Intentionally no policies on storage.objects. All bucket operations in P2.3.6
-- are performed by the server-side intake function.
