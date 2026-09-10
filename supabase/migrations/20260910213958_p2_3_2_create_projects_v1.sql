create sequence public.projects_project_number_seq;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  project_number bigint not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  branch text not null check (branch in ('FDM','RESIN')),
  status text not null default 'UPLOAD_PENDING'
    check (status in (
      'UPLOAD_PENDING',
      'SUBMITTED',
      'VALIDATING',
      'VALID',
      'INVALID',
      'QUOTED',
      'WANT_TO_CLOSE',
      'REJECTED',
      'NO_RESPONSE'
    )),
  first_name text not null,
  email text not null,
  city text not null,
  state_uf text not null,
  cep text,
  project_description text not null,
  quantity integer not null check (quantity > 0),
  final_size text not null,
  material_preference text,
  finish_preference text,
  deadline_note text,
  comments text,
  intended_use text,
  exposure_factors text[] not null default '{}'::text[],
  scale_or_height text,
  detail_notes text,
  file_delivery_mode text not null
    check (file_delivery_mode in ('UPLOAD','LINK')),
  external_file_url text,
  storage_manifest jsonb not null default '[]'::jsonb
    check (jsonb_typeof(storage_manifest) = 'array'),
  file_delete_after timestamptz not null
    default (now() + interval '30 days'),
  file_deleted_at timestamptz,
  ip_declaration boolean not null
    check (ip_declaration = true),
  ip_declaration_at timestamptz not null default now(),
  privacy_acknowledgement boolean not null
    check (privacy_acknowledgement = true),
  privacy_acknowledgement_at timestamptz not null default now(),
  source text,
  campaign text,
  message_variant text,
  session_id uuid,
  intake_version text not null default 'v1.0',
  constraint projects_fdm_requires_intended_use
    check (
      branch <> 'FDM'
      or length(btrim(coalesce(intended_use,''))) > 0
    ),
  constraint projects_link_requires_url
    check (
      file_delivery_mode <> 'LINK'
      or length(btrim(coalesce(external_file_url,''))) > 0
    )
);

alter sequence public.projects_project_number_seq
  owned by public.projects.project_number;

create or replace function public.assign_project_number()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.project_number is null then
    new.project_number :=
      nextval('public.projects_project_number_seq');
  end if;
  return new;
end;
$$;

create trigger projects_assign_project_number
before insert on public.projects
for each row execute function public.assign_project_number();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

revoke all on table public.projects from anon, authenticated;
revoke all on sequence public.projects_project_number_seq
  from anon, authenticated;
revoke execute on function public.assign_project_number()
  from public, anon, authenticated;
revoke execute on function public.set_updated_at()
  from public, anon, authenticated;
