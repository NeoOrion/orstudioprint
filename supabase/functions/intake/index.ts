import { handleCreate, handleFinalize, handleResume } from "./actions.ts";
import { corsHeaders, isOriginAllowed, parseAllowedOrigins } from "./cors.ts";
import { HttpError, jsonResponse, publicErrorResponse } from "./responses.ts";
import { ConfigurationError, createAdminClient } from "./runtime.ts";
import { parseIntakeRequest, ValidationError } from "./validation.ts";

const getEnv = (name: string): string | undefined => Deno.env.get(name);

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("Origin");
  let allowedOrigins: Set<string>;
  try {
    allowedOrigins = parseAllowedOrigins(getEnv("ALLOWED_ORIGINS"));
  } catch {
    console.error("ALLOWED_ORIGINS contains an invalid origin");
    return jsonResponse(
      { error: { code: "SERVICE_UNAVAILABLE", message: "Intake service is unavailable." } },
      503,
      new Headers({ "Cache-Control": "no-store" }),
    );
  }
  const headers = corsHeaders(origin, allowedOrigins);

  if (!isOriginAllowed(origin, allowedOrigins)) {
    return publicErrorResponse(
      new HttpError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed."),
      headers,
    );
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") {
    headers.set("Allow", "POST, OPTIONS");
    return publicErrorResponse(
      new HttpError(405, "METHOD_NOT_ALLOWED", "Only POST is allowed."),
      headers,
    );
  }

  try {
    let rawPayload: unknown;
    try {
      rawPayload = await request.json();
    } catch {
      throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
    }

    const intakeRequest = parseIntakeRequest(rawPayload);
    const admin = createAdminClient(getEnv);
    const result = intakeRequest.action === "create"
      ? await handleCreate(intakeRequest, admin, getEnv)
      : intakeRequest.action === "finalize"
      ? await handleFinalize(intakeRequest, admin)
      : await handleResume(intakeRequest, admin);
    return jsonResponse(result.body, result.status, headers);
  } catch (error) {
    if (error instanceof ValidationError) {
      return publicErrorResponse(new HttpError(400, error.code, error.message), headers);
    }
    if (error instanceof HttpError) return publicErrorResponse(error, headers);
    if (error instanceof ConfigurationError) {
      console.error("Intake configuration error", error.message);
      return publicErrorResponse(
        new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable."),
        headers,
      );
    }
    console.error("Unhandled intake error", error instanceof Error ? error.name : "unknown");
    return publicErrorResponse(
      new HttpError(500, "INTERNAL_ERROR", "An unexpected error occurred."),
      headers,
    );
  }
});
