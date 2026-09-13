alter table public.projects
  add column quote_price_brl numeric(12,2),
  add column quote_sent_at timestamptz,
  add column macroconversion_at timestamptz,
  add constraint projects_quote_price_brl_positive
    check (
      quote_price_brl is null
      or quote_price_brl > 0
    ),
  add constraint projects_macroconversion_requires_quote
    check (
      macroconversion_at is null
      or (
        quote_price_brl is not null
        and quote_sent_at is not null
        and macroconversion_at >= quote_sent_at
      )
    );

comment on column public.projects.quote_price_brl is
  'Total BRL presented in the active macroconversion CTA, including estimated freight when applicable.';

comment on column public.projects.quote_sent_at is
  'Timestamp of the currently active price simulation.';

comment on column public.projects.macroconversion_at is
  'Timestamp of manually verified explicit QUERO FECHAR response.';
