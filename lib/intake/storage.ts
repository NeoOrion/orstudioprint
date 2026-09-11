import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { UploadAuthorization } from "./types";

let browserClient: SupabaseClient | undefined;

function getBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("CLIENT_CONFIGURATION_ERROR");
  browserClient = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return browserClient;
}

export async function uploadAuthorizedFile(
  authorization: UploadAuthorization,
  file: File,
): Promise<void> {
  const { error } = await getBrowserClient()
    .storage
    .from("quote-files")
    .uploadToSignedUrl(authorization.storage_path, authorization.upload_token, file, {
      cacheControl: "3600",
      contentType: file.type || "application/octet-stream",
    });
  if (error) throw new Error("SIGNED_UPLOAD_FAILED");
}
