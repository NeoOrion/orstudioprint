create sequence public.projects_project_number_seq
  as bigint
  start with 1
  increment by 1
  no minvalue
  no maxvalue
  cache 1;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  project_number bigint not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  branch text not null,
  status text not null default 'UPLOAD_PENDING',

  first_name text not null,
  email text not null,
  city text not null,
  state_uf text not null,
  cep text,

  project_description text not null,
  quantity integer not null,
  final_size text not null,

  material_preference text,
  finish_preference text,
  deadline_note text,
  comments text,

  intended_use text,
  exposure_factors text[] not null default '{}'::text[],

  scale_or_height text,
  detail_notes text,

  file_delivery_mode text not null,
  external_file_url text,
  storage_manifest jsonb not null default '[]'::jsonb,

  file_delete_after timestamptz not null default now() + interval '30 days',
  file_deleted_at timestamptz,

  ip_declaration boolean not null,
  ip_declaration_at timestamptz not null default now(),

  privacy_acknowledgement boolean not null,
  privacy_acknowledgement_at timestamptz not null default now(),

  source text,
  campaign text,
  message_variant text,
  session_id uuid,

  intake_version text not null default 'v1.0',

  constraint projects_branch_check
    check (branch in ('FDM', 'RESIN')),
  constraint projects_status_check
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
  constraint projects_quantity_check
    check (quantity > 0),
  constraint projects_file_delivery_mode_check
    check (file_delivery_mode in ('UPLOAD', 'LINK')),
  constraint projects_fdm_intended_use_check
    check (branch <> 'FDM' or nullif(btrim(intended_use), '') is not null),
  constraint projects_link_url_check
    check (
      file_delivery_mode <> 'LINK'
      or nullif(btrim(external_file_url), '') is not null
    ),
  constraint projects_ip_declaration_check
    check (ip_declaration is true),
  constraint projects_privacy_acknowledgement_check
    check (privacy_acknowledgement is true),
  constraint projects_storage_manifest_array_check
    check (jsonb_typeof(storage_manifest) = 'array')
);

alter sequence public.projects_project_number_seq
  owned by public.projects.project_number;

create function public.assign_project_number()
returns trigger
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
begin
  if new.project_number is null then
    new.project_number := nextval('public.projects_project_number_seq');
  end if;
  return new;
end;
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_assign_project_number
before insert on public.projects
for each row execute function public.assign_project_number();

create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

revoke all on table public.projects from public, anon, authenticated;
revoke all on sequence public.projects_project_number_seq from public, anon, authenticated;
revoke all on function public.assign_project_number() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

grant select, insert, update, delete on table public.projects to service_role;
grant usage, select, update on sequence public.projects_project_number_seq to service_role;
grant execute on function public.assign_project_number() to service_role;
grant execute on function public.set_updated_at() to service_role;
