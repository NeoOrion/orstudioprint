alter table public.projects
  add column submission_token_hash text not null;

alter table public.projects
  add constraint projects_submission_token_hash_check
  check (submission_token_hash ~ '^[0-9a-f]{64}$');
