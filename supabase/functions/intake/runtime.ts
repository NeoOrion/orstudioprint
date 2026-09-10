import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

export type AdminClient = SupabaseClient<Database>;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function secretFromJson(rawValue: string | undefined): string | undefined {
  if (!rawValue) return undefined;
  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    const defaultValue = parsed.default;
    return typeof defaultValue === "string" && defaultValue ? defaultValue : undefined;
  } catch {
    throw new ConfigurationError("SUPABASE_SECRET_KEYS must be valid JSON.");
  }
}

export function resolveAdminKey(getEnv: (name: string) => string | undefined): string {
  const currentDefault = secretFromJson(getEnv("SUPABASE_SECRET_KEYS"));
  const explicitlyConfigured = getEnv("SUPABASE_SECRET_KEY");
  const key = currentDefault || explicitlyConfigured;
  if (!key) {
    throw new ConfigurationError("A server-side Supabase secret key is required.");
  }
  return key;
}

export function createAdminClient(getEnv: (name: string) => string | undefined): AdminClient {
  const url = getEnv("SUPABASE_URL");
  if (!url) throw new ConfigurationError("SUPABASE_URL is required.");
  return createClient(url, resolveAdminKey(getEnv), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
