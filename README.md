# OrStudio Print

OrStudio Print is experimental infrastructure for validating a possible 3D
printing service in Brazil. Git is the implementation source of truth and
Supabase is the backend runtime. The current P2.8 baseline combines a static
public Next.js frontend with a technical intake and analytics backend.

## Current Supabase backend

- Supabase project ref: `oajqahzzfdjochasiltx`
- Region: `sa-east-1` (São Paulo, Brazil)
- Private Storage bucket: `quote-files`
- Database tables: `public.projects` and `public.events`
- Public Edge Function: `intake`, ACTIVE v5, with the `create`, `event`,
  `finalize`, and `resume` actions

The function is public only in the sense that the public form does not require
Supabase Auth. Authentication and authorization are action-specific:

- `create`: server-side Cloudflare Turnstile validation
- `event`: allowlisted diagnostic events without customer PII
- `finalize` and `resume`: `projectId` plus a high-entropy `submissionToken`

The raw submission token is returned only once by `create`. Only its SHA-256
hash is stored. The Edge Function uses a privileged Supabase key exclusively on
the server. Browser code must never receive that key.

## Intake contract

All requests use `POST` with JSON. Browser origins must be listed explicitly in
`ALLOWED_ORIGINS`; `*` is not supported. `OPTIONS` is handled for CORS.

`create` accepts this shape:

```json
{
  "action": "create",
  "turnstileToken": "token-from-widget",
  "project": {
    "branch": "FDM",
    "first_name": "Example",
    "email": "person@example.com",
    "city": "Curitiba",
    "state_uf": "PR",
    "project_description": "Functional prototype",
    "quantity": 1,
    "final_size": "100 mm",
    "intended_use": "Indoor prototype",
    "file_delivery_mode": "UPLOAD",
    "ip_declaration": true,
    "privacy_acknowledgement": true
  },
  "files": [
    {
      "original_name": "model.stl",
      "declared_size_bytes": 12345
    }
  ]
}
```

Allowed project fields are limited to those represented by the database
contract. Phone, CPF, full address, payment information, customer budget, and
unknown fields are rejected. `FDM` requires `intended_use`. `LINK` requires a
valid HTTP(S) `external_file_url`, with plain HTTP accepted only for localhost.

`UPLOAD` requires 1–5 files. Accepted extensions are `stl`, `3mf`, `obj`,
`step`, and `stp`. The combined business limit is 50 MB decimal
(`50_000_000` bytes). The private bucket retains its per-object technical
backstop of 50 MiB (`52_428_800` bytes).
ZIP and RAR are rejected. Generated object paths have the form
`projects/<project_id>/<file_uuid>.<ext>` and contain no customer name, email,
or original filename. Signed upload authorizations are temporary and never use
upsert.

`finalize` and `resume` accept:

```json
{
  "action": "finalize",
  "projectId": "00000000-0000-4000-8000-000000000000",
  "submissionToken": "raw-token-returned-by-create"
}
```

Use `"action": "resume"` with the same credentials to obtain fresh upload
authorizations for missing files. When an expected object has the wrong size,
`resume` deletes only that manifest-registered path server-side, confirms its
absence, resets the entry to `PENDING`, and signs the same path again without
upsert. The frontend receives no delete capability. Both actions return
operational IDs and status only, never project PII. `finalize` verifies every
expected object in Storage and compares sizes when Storage reports them. It
changes the project to `SUBMITTED` only after the upload is complete. Closed
projects are handled idempotently, and pending projects cannot be resumed after
retention expires.

FDM exposure factors are restricted at the public write boundary to `HEAT`,
`LOAD`, `OUTDOOR`, `IMPACT_FLEX`, `NONE`, and `UNKNOWN`. Duplicate
values are rejected. `NONE` and `UNKNOWN` are each exclusive and cannot be
combined with any other factor.

## Static frontend

The repository root is a Next.js App Router application with TypeScript, React,
plain CSS, and `output: "export"`. It has no Route Handlers, Server Actions,
SSR dependency, or production Node.js runtime. The public acquisition routes
are `/`, `/pecas`, and `/resina`. `/intake` is a technical/QA harness, not a
public acquisition route.

The browser calls the public `intake` Edge Function with typed
`create`, `event`, `finalize`, and `resume` requests. Upload mode follows:

```text
create -> signed upload -> finalize
```

Only `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` initialize the browser client, and
that client is used exclusively for `uploadToSignedUrl` on `quote-files`.
It does not perform normal table or Storage CRUD. The privileged key remains
server-only inside the Edge Function. The frontend also requires
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` at build time.

After `create`, recoverable upload state is stored for up to 24 hours in
`localStorage` under `orstudio_intake_pending_v2`. It contains operational
project identifiers, the submission token, expiry, and the mapping
`file_uuid <-> original_name <-> size`. It does not store form PII fields such
as name, email, city, or project description, nor file content, signed upload
URLs, or short-lived upload tokens. Original filenames are part of the recovery
mapping and must be treated as potentially identifying. After reload, the user
reselects only missing files before `resume` issues fresh authorizations.
Discarding a local session never deletes remote data.

Minimal first-touch analytics records only `quote_cta_clicked`, `form_started`,
and `form_submitted`. Quoting and macroconversion remain manual. During this
validation phase there are no payments, orders, or production reservations.

Turnstile uses Cloudflare's explicit SPA rendering and resets after every
attempted `create` request because tokens are single-use. For local testing,
use the official always-pass sitekey `1x00000000000000000000AA`; never place
the Turnstile secret in a `NEXT_PUBLIC_` variable.

The checked-in STL fixture at `tests/fixtures/tiny-triangle.stl` is an
original, minimal ASCII triangle for upload QA.

## Local commands

Requirements: Docker for the local Supabase stack, Supabase CLI 2.117.0 or a
compatible later release, and Deno 2.x.

Install the pinned frontend dependencies, copy `.env.example` to the ignored
`.env.local`, and provide:

- `NEXT_PUBLIC_SUPABASE_URL=https://oajqahzzfdjochasiltx.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<browser publishable key>`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA`

```powershell
npm ci
npm run dev
```

Open `/`, `/pecas`, or `/resina` for the public flow. Use `/intake` only as the
technical/QA harness. The production build is fully static and is emitted to
`out/` by `npm run build`.

Frontend verification:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
```

```powershell
npx --yes supabase@2.117.0 start
npx --yes supabase@2.117.0 migration list --local
npx --yes supabase@2.117.0 functions serve intake --env-file supabase/functions/.env
```

Run the pure TypeScript checks from the function directory:

```powershell
cd supabase/functions/intake
deno task check
deno task test
```

The function expects:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEYS`, using the runtime JSON form with a `default` key, or
  a separately configured server-only `SUPABASE_SECRET_KEY`
- `TURNSTILE_SECRET_KEY`
- `ALLOWED_ORIGINS`, as a comma-separated allowlist

Copy `.env.example` to a Git-ignored environment file and replace every
placeholder locally. Cloudflare's official testing keys may be used for local
Turnstile tests. Never commit secrets, access tokens, private keys, or database
passwords.

## Deployment status

Production is deployed on Cloudflare Pages Free at
[https://orstudioprint.pages.dev](https://orstudioprint.pages.dev) from the
production branch `main`. It uses the static Next.js export with build command
`npx next build` and output directory `out`.

Cloudflare Pages/frontend requires only these public build variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`

Never place any of the following in Pages or frontend configuration:

- `SUPABASE_SECRET_KEY`
- `SUPABASE_SECRET_KEYS`
- `TURNSTILE_SECRET_KEY`
- database passwords
- service-role or other secret keys

Advanced server-side `create` idempotency is not a pending P4 requirement; it
was deliberately deferred to avoid overengineering the validation experiment.
Advanced retention automation also remains deferred, with manual operation
retained for the small experiment.

Before P4, the active production provider set must be checked for any applicable
international data transfers, and the published privacy disclosure must reflect
the actual configuration.

This README is a technical handoff. Future production configuration changes,
including Turnstile changes, require a separate authorized step.
