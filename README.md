# OrStudio Print

OrStudio Print is experimental infrastructure for validating a possible 3D
printing service in Brazil. Git is the implementation source of truth and
Supabase is the runtime. This phase intentionally contains no frontend.

## P2.3.6A architecture

- Supabase project ref: `oajqahzzfdjochasiltx`
- Region: `sa-east-1` (São Paulo, Brazil)
- Private Storage bucket: `quote-files`
- Database: `public.projects`, protected by RLS with no direct access for
  `anon` or `authenticated`
- Public Edge Function: `intake`, with the `create`, `finalize`, and `resume`
  actions

The function is public only in the sense that the future form will not require
Supabase Auth. Authentication and authorization are action-specific:

- `create`: server-side Cloudflare Turnstile validation
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
`step`, and `stp`. Each file and the combined project must be at most 50 MiB.
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

## Local commands

Requirements: Docker for the local Supabase stack, Supabase CLI 2.117.0 or a
compatible later release, and Deno 2.x.

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

P2.3.6A prepares code for review only. Applying remote migrations, deploying
the Edge Function, and merging the feature branch into `main` are explicitly
outside this task.
