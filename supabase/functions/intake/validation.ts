import { FilePolicyError, validateFileDescriptors } from "./file_policy.ts";
import type {
  AuthorizedProjectRequest,
  Branch,
  CreateRequest,
  EventInput,
  EventName,
  EventRequest,
  EventRoute,
  ExposureFactor,
  FileDeliveryMode,
  FileDescriptor,
  IntakeRequest,
  ProjectInput,
} from "./types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXPOSURE_FACTORS = new Set<ExposureFactor>([
  "HEAT",
  "LOAD",
  "OUTDOOR",
  "IMPACT_FLEX",
  "NONE",
  "UNKNOWN",
]);

const CREATE_KEYS = new Set(["action", "turnstileToken", "project", "files"]);
const AUTHORIZED_KEYS = new Set(["action", "projectId", "submissionToken"]);
const EVENT_REQUEST_KEYS = new Set(["action", "event"]);
const EVENT_KEYS = new Set([
  "event_name",
  "session_id",
  "branch",
  "route",
  "project_id",
  "source",
  "campaign",
  "message_variant",
]);
const EVENT_NAMES = new Set<EventName>([
  "quote_cta_clicked",
  "form_started",
  "form_submitted",
]);
const EVENT_ROUTES = new Set<EventRoute>(["/pecas", "/resina"]);
const PROJECT_KEYS = new Set([
  "branch",
  "first_name",
  "email",
  "city",
  "state_uf",
  "cep",
  "project_description",
  "quantity",
  "final_size",
  "material_preference",
  "finish_preference",
  "deadline_note",
  "comments",
  "intended_use",
  "exposure_factors",
  "scale_or_height",
  "detail_notes",
  "file_delivery_mode",
  "external_file_url",
  "ip_declaration",
  "privacy_acknowledgement",
  "source",
  "campaign",
  "message_variant",
  "session_id",
]);
const FILE_KEYS = new Set(["original_name", "declared_size_bytes"]);

export class ValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("INVALID_PAYLOAD", `${fieldName} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  fieldName: string,
): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new ValidationError(
      "UNEXPECTED_FIELD",
      `${fieldName} contains unsupported fields: ${unexpected.sort().join(", ")}.`,
    );
  }
}

function requiredString(value: unknown, fieldName: string, maxLength = 10_000): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new ValidationError("INVALID_FIELD", `${fieldName} is required and invalid.`);
  }
  return value.trim();
}

function optionalString(value: unknown, fieldName: string, maxLength = 10_000): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new ValidationError("INVALID_FIELD", `${fieldName} is invalid.`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function validateExternalUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ValidationError("INVALID_EXTERNAL_URL", "external_file_url must be a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ValidationError("INVALID_EXTERNAL_URL", "external_file_url must use http or https.");
  }
  const localHost = parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !localHost) {
    throw new ValidationError(
      "HTTPS_REQUIRED",
      "external_file_url must use https outside localhost.",
    );
  }
  return parsed.toString();
}

function parseFiles(value: unknown): FileDescriptor[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError("INVALID_FILES", "files must be an array.");
  }
  return value.map((item, index) => {
    const file = asRecord(item, `files[${index}]`);
    assertExactKeys(file, FILE_KEYS, `files[${index}]`);
    return {
      original_name: requiredString(file.original_name, `files[${index}].original_name`, 255),
      declared_size_bytes: file.declared_size_bytes as number,
    };
  });
}

function parseExposureFactors(value: unknown): ExposureFactor[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 20) {
    throw new ValidationError(
      "INVALID_FIELD",
      "exposure_factors must be an array of at most 20 strings.",
    );
  }
  const factors = value.map((item, index) => {
    const factor = requiredString(item, `exposure_factors[${index}]`, 200);
    if (!EXPOSURE_FACTORS.has(factor as ExposureFactor)) {
      throw new ValidationError(
        "INVALID_EXPOSURE_FACTOR",
        "exposure_factors contains an unsupported value.",
      );
    }
    return factor as ExposureFactor;
  });
  if (new Set(factors).size !== factors.length) {
    throw new ValidationError(
      "DUPLICATE_EXPOSURE_FACTOR",
      "exposure_factors must not contain duplicates.",
    );
  }
  if (factors.length > 1 && (factors.includes("NONE") || factors.includes("UNKNOWN"))) {
    throw new ValidationError(
      "EXCLUSIVE_EXPOSURE_FACTOR",
      "NONE and UNKNOWN cannot be combined with other exposure factors.",
    );
  }
  return factors;
}

function parseProject(value: unknown): ProjectInput {
  const project = asRecord(value, "project");
  assertExactKeys(project, PROJECT_KEYS, "project");

  if (project.branch !== "FDM" && project.branch !== "RESIN") {
    throw new ValidationError("INVALID_BRANCH", "branch must be FDM or RESIN.");
  }
  if (project.file_delivery_mode !== "UPLOAD" && project.file_delivery_mode !== "LINK") {
    throw new ValidationError(
      "INVALID_DELIVERY_MODE",
      "file_delivery_mode must be UPLOAD or LINK.",
    );
  }
  if (project.ip_declaration !== true || project.privacy_acknowledgement !== true) {
    throw new ValidationError("DECLARATIONS_REQUIRED", "Both declarations must be true.");
  }
  if (!Number.isSafeInteger(project.quantity) || (project.quantity as number) <= 0) {
    throw new ValidationError("INVALID_QUANTITY", "quantity must be a positive integer.");
  }

  const email = requiredString(project.email, "email", 320).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError("INVALID_EMAIL", "email is invalid.");
  }
  const stateUf = requiredString(project.state_uf, "state_uf", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(stateUf)) {
    throw new ValidationError("INVALID_STATE_UF", "state_uf must contain two letters.");
  }

  const intendedUse = optionalString(project.intended_use, "intended_use");
  if (project.branch === "FDM" && !intendedUse) {
    throw new ValidationError("FDM_INTENDED_USE_REQUIRED", "FDM projects require intended_use.");
  }

  const externalUrlValue = optionalString(project.external_file_url, "external_file_url", 2_048);
  if (project.file_delivery_mode === "LINK" && !externalUrlValue) {
    throw new ValidationError("LINK_URL_REQUIRED", "LINK delivery requires external_file_url.");
  }
  const externalUrl = externalUrlValue ? validateExternalUrl(externalUrlValue) : undefined;

  const sessionId = optionalString(project.session_id, "session_id", 36);
  if (sessionId && !UUID_PATTERN.test(sessionId)) {
    throw new ValidationError("INVALID_SESSION_ID", "session_id must be a UUID.");
  }

  return {
    branch: project.branch as Branch,
    first_name: requiredString(project.first_name, "first_name", 200),
    email,
    city: requiredString(project.city, "city", 200),
    state_uf: stateUf,
    project_description: requiredString(project.project_description, "project_description"),
    quantity: project.quantity as number,
    final_size: requiredString(project.final_size, "final_size", 200),
    file_delivery_mode: project.file_delivery_mode as FileDeliveryMode,
    ip_declaration: true,
    privacy_acknowledgement: true,
    cep: optionalString(project.cep, "cep", 20),
    material_preference: optionalString(project.material_preference, "material_preference", 200),
    finish_preference: optionalString(project.finish_preference, "finish_preference", 200),
    deadline_note: optionalString(project.deadline_note, "deadline_note", 1_000),
    comments: optionalString(project.comments, "comments"),
    intended_use: intendedUse,
    exposure_factors: parseExposureFactors(project.exposure_factors),
    scale_or_height: optionalString(project.scale_or_height, "scale_or_height", 200),
    detail_notes: optionalString(project.detail_notes, "detail_notes"),
    external_file_url: externalUrl,
    source: optionalString(project.source, "source", 200),
    campaign: optionalString(project.campaign, "campaign", 200),
    message_variant: optionalString(project.message_variant, "message_variant", 200),
    session_id: sessionId,
  };
}

function parseCreate(payload: Record<string, unknown>): CreateRequest {
  assertExactKeys(payload, CREATE_KEYS, "payload");
  const project = parseProject(payload.project);
  const files = parseFiles(payload.files);

  if (project.file_delivery_mode === "UPLOAD") {
    try {
      validateFileDescriptors(files);
    } catch (error) {
      if (error instanceof FilePolicyError) {
        throw new ValidationError(error.code, error.message);
      }
      throw error;
    }
  } else if (files.length > 0) {
    throw new ValidationError(
      "FILES_NOT_ALLOWED_FOR_LINK",
      "LINK delivery must not include upload files.",
    );
  }

  return {
    action: "create",
    turnstileToken: requiredString(payload.turnstileToken, "turnstileToken", 2_048),
    project,
    files,
  };
}

function parseAuthorized(payload: Record<string, unknown>): AuthorizedProjectRequest {
  assertExactKeys(payload, AUTHORIZED_KEYS, "payload");
  const projectId = requiredString(payload.projectId, "projectId", 36);
  if (!UUID_PATTERN.test(projectId)) {
    throw new ValidationError("INVALID_PROJECT_ID", "projectId must be a UUID.");
  }
  return {
    action: payload.action as "finalize" | "resume",
    projectId,
    submissionToken: requiredString(payload.submissionToken, "submissionToken", 4_096),
  };
}

function parseEventAttribution(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 200) {
    throw new ValidationError("INVALID_FIELD", `${fieldName} is invalid.`);
  }
  return value.trim() || undefined;
}

function parseEvent(payload: Record<string, unknown>): EventRequest {
  assertExactKeys(payload, EVENT_REQUEST_KEYS, "payload");
  const event = asRecord(payload.event, "event");
  assertExactKeys(event, EVENT_KEYS, "event");

  if (typeof event.event_name !== "string" || !EVENT_NAMES.has(event.event_name as EventName)) {
    throw new ValidationError("INVALID_EVENT_NAME", "event_name is unsupported.");
  }
  const eventName = event.event_name as EventName;

  const sessionId = requiredString(event.session_id, "session_id", 36);
  if (!UUID_PATTERN.test(sessionId)) {
    throw new ValidationError("INVALID_SESSION_ID", "session_id must be a UUID.");
  }

  if (event.branch !== "FDM" && event.branch !== "RESIN") {
    throw new ValidationError("INVALID_BRANCH", "branch must be FDM or RESIN.");
  }
  if (typeof event.route !== "string" || !EVENT_ROUTES.has(event.route as EventRoute)) {
    throw new ValidationError("INVALID_ROUTE", "route must be /pecas or /resina.");
  }
  if (
    (event.branch === "FDM" && event.route !== "/pecas") ||
    (event.branch === "RESIN" && event.route !== "/resina")
  ) {
    throw new ValidationError("BRANCH_ROUTE_MISMATCH", "branch and route do not match.");
  }

  let projectId: string | undefined;
  if (eventName === "form_submitted") {
    if (!Object.hasOwn(event, "project_id")) {
      throw new ValidationError(
        "PROJECT_ID_REQUIRED",
        "project_id is required for form_submitted.",
      );
    }
    projectId = requiredString(event.project_id, "project_id", 36);
    if (!UUID_PATTERN.test(projectId)) {
      throw new ValidationError("INVALID_PROJECT_ID", "project_id must be a UUID.");
    }
  } else if (Object.hasOwn(event, "project_id")) {
    throw new ValidationError(
      "PROJECT_ID_NOT_ALLOWED",
      "project_id is not allowed for this event.",
    );
  }

  const parsedEvent: EventInput = {
    event_name: eventName,
    session_id: sessionId,
    branch: event.branch as Branch,
    route: event.route as EventRoute,
    ...(projectId ? { project_id: projectId } : {}),
    source: parseEventAttribution(event.source, "source"),
    campaign: parseEventAttribution(event.campaign, "campaign"),
    message_variant: parseEventAttribution(event.message_variant, "message_variant"),
  };

  return { action: "event", event: parsedEvent };
}

export function parseIntakeRequest(value: unknown): IntakeRequest {
  const payload = asRecord(value, "payload");
  if (payload.action === "create") return parseCreate(payload);
  if (payload.action === "event") return parseEvent(payload);
  if (payload.action === "finalize" || payload.action === "resume") {
    return parseAuthorized(payload);
  }
  throw new ValidationError(
    "INVALID_ACTION",
    "action must be create, event, finalize, or resume.",
  );
}
