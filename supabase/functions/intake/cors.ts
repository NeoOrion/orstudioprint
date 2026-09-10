const BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

export function parseAllowedOrigins(rawValue: string | undefined): Set<string> {
  if (!rawValue) return new Set();
  return new Set(
    rawValue.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => new URL(origin).origin),
  );
}

export function isOriginAllowed(origin: string | null, allowedOrigins: Set<string>): boolean {
  if (origin === null) return true;
  try {
    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function corsHeaders(origin: string | null, allowedOrigins: Set<string>): Headers {
  const headers = new Headers(BASE_HEADERS);
  if (origin !== null && isOriginAllowed(origin, allowedOrigins)) {
    headers.set("Access-Control-Allow-Origin", new URL(origin).origin);
  }
  return headers;
}
