create table public.events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_name text not null,
  session_id uuid not null,
  branch text not null,
  route text not null,
  project_id uuid,
  source text,
  campaign text,
  message_variant text,
  constraint events_event_name_check check (
    event_name in ('quote_cta_clicked', 'form_started', 'form_submitted')
  ),
  constraint events_branch_check check (
    branch in ('FDM', 'RESIN')
  ),
  constraint events_route_check check (
    route in ('/pecas', '/resina')
  ),
  constraint events_branch_route_coherence_check check (
    (branch = 'FDM' and route = '/pecas')
    or (branch = 'RESIN' and route = '/resina')
  ),
  constraint events_project_id_fkey foreign key (project_id)
    references public.projects (id)
    on delete set null
);

alter table public.events enable row level security;

revoke all privileges on table public.events from anon, authenticated;
