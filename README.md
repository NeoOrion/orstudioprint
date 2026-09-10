# OrStudio Print

OrStudio Print is an experimental foundation for validating a possible 3D
printing service in Brazil.

This repository is the implementation source of truth. Supabase is the runtime,
but no remote deployment is part of the repository bootstrap.

## Initial structure

- `supabase/config.toml`: local Supabase project configuration.
- `supabase/migrations/`: versioned database history.
- `supabase/functions/intake/`: future public intake Edge Function.

Secrets must never be committed. Copy `.env.example` to a Git-ignored local
environment file when local runtime configuration is required.

