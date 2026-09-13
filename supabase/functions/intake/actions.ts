import type { AdminClient } from "./runtime.ts";
import { HttpError } from "./responses.ts";
import { buildStorageManifest, buildStoragePath } from "./file_policy.ts";
import { constantTimeHexEqual, generateSubmissionToken, hashSubmissionToken } from "./token.ts";
import type {
  AuthorizedProjectRequest,
  CreateRequest,
  EventRequest,
  StorageManifestEntry,
  UploadAuthorization,
} from "./types.ts";

const BUCKET = "quote-files";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ProjectRow {
  id: string;
  project_number: number | string;
  status: string;
  file_delivery_mode: string;
  storage_manifest: unknown;
  file_delete_after: string;
  submission_token_hash: string;
}

interface StorageInspection {
  manifest: StorageManifestEntry[];
  missing: string[];
  sizeMismatches: Array<{
    file_uuid: string;
    declared_size_bytes: number;
    observed_size_bytes: number;
  }>;
}

function humanReference(projectNumber: number | string): string {
  return `OP-${String(projectNumber).padStart(5, "0")}`;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function parseManifest(value: unknown): StorageManifestEntry[] {
  if (!Array.isArray(value)) {
    throw new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable.");
  }
  const parsed: StorageManifestEntry[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable.");
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.file_uuid !== "string" ||
      typeof row.original_name !== "string" ||
      typeof row.extension !== "string" ||
      typeof row.declared_size_bytes !== "number" ||
      typeof row.storage_path !== "string"
    ) {
      throw new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable.");
    }
    parsed.push({
      file_uuid: row.file_uuid,
      original_name: row.original_name,
      extension: row.extension,
      declared_size_bytes: row.declared_size_bytes,
      storage_path: row.storage_path,
      upload_status: row.upload_status === "UPLOADED" || row.upload_status === "SIZE_MISMATCH"
        ? row.upload_status
        : "PENDING",
      ...(typeof row.observed_size_bytes === "number"
        ? { observed_size_bytes: row.observed_size_bytes }
        : {}),
    });
  }
  return parsed;
}

export async function verifyTurnstile(
  token: string,
  secret: string | undefined,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  if (!secret) throw new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable.");

  const body = new URLSearchParams({
    secret,
    response: token,
    idempotency_key: crypto.randomUUID(),
  });

  let response: Response;
  try {
    response = await fetchImplementation(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("Turnstile request failed", error instanceof Error ? error.name : "unknown");
    throw new HttpError(503, "TURNSTILE_UNAVAILABLE", "Verification service is unavailable.");
  }

  if (!response.ok) {
    console.error("Turnstile returned an HTTP error", response.status);
    throw new HttpError(503, "TURNSTILE_UNAVAILABLE", "Verification service is unavailable.");
  }

  const result = await response.json() as { success?: boolean };
  if (result.success !== true) {
    throw new HttpError(422, "TURNSTILE_FAILED", "Human verification failed.");
  }
}

export async function handleEvent(
  request: EventRequest,
  admin: AdminClient,
): Promise<{ body: unknown; status: number }> {
  const event = request.event;
  const insertValue = {
    event_name: event.event_name,
    session_id: event.session_id,
    branch: event.branch,
    route: event.route,
    ...(event.project_id ? { project_id: event.project_id } : {}),
    ...(event.source ? { source: event.source } : {}),
    ...(event.campaign ? { campaign: event.campaign } : {}),
    ...(event.message_variant ? { message_variant: event.message_variant } : {}),
  };
  const { error } = await admin.from("events").insert(insertValue);
  if (error) {
    console.error("Event insert failed", {
      code: error.code,
      event_name: request.event.event_name,
    });
    throw new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable.");
  }
  return { body: { accepted: true }, status: 201 };
}

async function createUploadAuthorizations(
  admin: AdminClient,
  manifest: StorageManifestEntry[],
): Promise<{ authorizations: UploadAuthorization[]; failedFileUuids: string[] }> {
  type AuthorizationResult =
    | { ok: true; authorization: UploadAuthorization }
    | { ok: false; fileUuid: string };

  const results: AuthorizationResult[] = await Promise.all(manifest.map(async (file) => {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(file.storage_path, { upsert: false });

    if (error || !data?.signedUrl || !data?.token) {
      console.error("Signed upload creation failed", { file_uuid: file.file_uuid });
      return { ok: false, fileUuid: file.file_uuid } as const;
    }
    return {
      ok: true,
      authorization: {
        file_uuid: file.file_uuid,
        storage_path: file.storage_path,
        signed_url: data.signedUrl,
        upload_token: data.token,
      } satisfies UploadAuthorization,
    };
  }));

  return {
    authorizations: results.flatMap((result) => result.ok ? [result.authorization] : []),
    failedFileUuids: results.flatMap((result) => result.ok ? [] : [result.fileUuid]),
  };
}

export async function handleCreate(
  request: CreateRequest,
  admin: AdminClient,
  getEnv: (name: string) => string | undefined,
): Promise<{ body: unknown; status: number }> {
  await verifyTurnstile(request.turnstileToken, getEnv("TURNSTILE_SECRET_KEY"));

  const projectId = crypto.randomUUID();
  const submissionToken = generateSubmissionToken();
  const submissionTokenHash = await hashSubmissionToken(submissionToken);
  const manifest = request.project.file_delivery_mode === "UPLOAD"
    ? buildStorageManifest(projectId, request.files)
    : [];
  const initialStatus = request.project.file_delivery_mode === "LINK"
    ? "SUBMITTED"
    : "UPLOAD_PENDING";

  const insertValue = compactRecord({
    id: projectId,
    ...request.project,
    exposure_factors: request.project.exposure_factors ?? [],
    storage_manifest: manifest,
    status: initialStatus,
    submission_token_hash: submissionTokenHash,
  });

  const { data, error } = await admin
    .from("projects")
    .insert(insertValue)
    .select("id, project_number, status")
    .single();

  if (error || !data) {
    console.error("Project insert failed", { code: error?.code });
    throw new HttpError(503, "CREATE_FAILED", "The project could not be created.");
  }

  const baseResponse = {
    project_id: data.id,
    project_reference: humanReference(data.project_number),
    submission_token: submissionToken,
    status: data.status,
  };

  if (manifest.length === 0) {
    return { body: baseResponse, status: 201 };
  }

  const uploadResult = await createUploadAuthorizations(admin, manifest);
  return {
    body: {
      ...baseResponse,
      upload_files: manifest.map(({ file_uuid, original_name, declared_size_bytes }) => ({
        file_uuid,
        original_name,
        declared_size_bytes,
      })),
      uploads: uploadResult.authorizations,
      upload_authorization_incomplete: uploadResult.failedFileUuids.length > 0,
      ...(uploadResult.failedFileUuids.length > 0
        ? { authorization_missing_file_uuids: uploadResult.failedFileUuids }
        : {}),
    },
    status: 201,
  };
}

async function loadAuthorizedProject(
  request: AuthorizedProjectRequest,
  admin: AdminClient,
): Promise<ProjectRow> {
  const { data, error } = await admin
    .from("projects")
    .select(
      "id, project_number, status, file_delivery_mode, storage_manifest, file_delete_after, submission_token_hash",
    )
    .eq("id", request.projectId)
    .maybeSingle();

  if (error) {
    console.error("Project authorization lookup failed", { code: error.code });
    throw new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable.");
  }
  if (!data) {
    throw new HttpError(401, "INVALID_PROJECT_CREDENTIALS", "Invalid project credentials.");
  }

  const receivedHash = await hashSubmissionToken(request.submissionToken);
  if (!constantTimeHexEqual(receivedHash, data.submission_token_hash)) {
    throw new HttpError(401, "INVALID_PROJECT_CREDENTIALS", "Invalid project credentials.");
  }
  return data as ProjectRow;
}

function assertWithinRetention(project: ProjectRow): void {
  const retentionEndsAt = Date.parse(project.file_delete_after);
  if (!Number.isFinite(retentionEndsAt)) {
    throw new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable.");
  }
  if (retentionEndsAt <= Date.now()) {
    throw new HttpError(410, "RETENTION_EXPIRED", "The project upload period has expired.");
  }
}

async function inspectStorage(
  project: ProjectRow,
  admin: AdminClient,
): Promise<StorageInspection> {
  const manifest = parseManifest(project.storage_manifest);
  const folder = `projects/${project.id}`;
  const { data, error } = await admin.storage.from(BUCKET).list(folder, {
    limit: 100,
    offset: 0,
    sortBy: { column: "name", order: "asc" },
  });
  if (error || !data) {
    console.error("Storage inspection failed", { project_id: project.id });
    throw new HttpError(503, "STORAGE_UNAVAILABLE", "File storage is unavailable.");
  }

  const storedByName = new Map(
    data.filter((item) => item.id !== null).map((item) => [item.name, item]),
  );
  const missing: string[] = [];
  const sizeMismatches: StorageInspection["sizeMismatches"] = [];
  const updatedManifest = manifest.map((file) => {
    const expectedName = file.storage_path.slice(folder.length + 1);
    const stored = storedByName.get(expectedName);
    if (!stored) {
      missing.push(file.file_uuid);
      const pending = { ...file, upload_status: "PENDING" as const };
      delete pending.observed_size_bytes;
      return pending;
    }

    const rawSize = stored.metadata?.size;
    const observedSize = typeof rawSize === "number" ? rawSize : Number(rawSize);
    if (Number.isFinite(observedSize) && observedSize !== file.declared_size_bytes) {
      sizeMismatches.push({
        file_uuid: file.file_uuid,
        declared_size_bytes: file.declared_size_bytes,
        observed_size_bytes: observedSize,
      });
      return {
        ...file,
        upload_status: "SIZE_MISMATCH" as const,
        observed_size_bytes: observedSize,
      };
    }
    return {
      ...file,
      upload_status: "UPLOADED" as const,
      ...(Number.isFinite(observedSize) ? { observed_size_bytes: observedSize } : {}),
    };
  });

  return { manifest: updatedManifest, missing, sizeMismatches };
}

async function deleteSizeMismatches(
  project: ProjectRow,
  inspection: StorageInspection,
  admin: AdminClient,
): Promise<void> {
  const mismatchedFileUuids = new Set(
    inspection.sizeMismatches.map((mismatch) => mismatch.file_uuid),
  );
  const deletionEntries = inspection.manifest.filter((file) =>
    mismatchedFileUuids.has(file.file_uuid)
  );

  if (deletionEntries.length !== mismatchedFileUuids.size) {
    throw new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable.");
  }
  for (const file of deletionEntries) {
    if (!UUID_PATTERN.test(file.file_uuid)) {
      throw new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable.");
    }
    let canonicalPath: string;
    try {
      canonicalPath = buildStoragePath(project.id, file.file_uuid, file.extension);
    } catch {
      throw new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable.");
    }
    if (file.storage_path !== canonicalPath) {
      console.error("Refused non-canonical manifest deletion", {
        project_id: project.id,
        file_uuid: file.file_uuid,
      });
      throw new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable.");
    }
  }

  const fileUuids = deletionEntries.map((file) => file.file_uuid);
  const paths = deletionEntries.map((file) => file.storage_path);
  const { error } = await admin.storage.from(BUCKET).remove(paths);
  if (error) {
    console.error("Mismatched object deletion failed", {
      project_id: project.id,
      file_uuids: fileUuids,
    });
    throw new HttpError(
      409,
      "SIZE_MISMATCH_DELETE_FAILED",
      "Incorrect files could not be prepared for another upload.",
      { file_uuids: fileUuids, recoverable: true },
    );
  }
}

async function saveManifest(
  project: ProjectRow,
  manifest: StorageManifestEntry[],
  admin: AdminClient,
): Promise<void> {
  const { error } = await admin
    .from("projects")
    .update({ storage_manifest: manifest })
    .eq("id", project.id)
    .eq("status", "UPLOAD_PENDING");
  if (error) {
    console.error("Manifest update failed", { code: error.code, project_id: project.id });
    throw new HttpError(503, "SERVICE_UNAVAILABLE", "Intake service is unavailable.");
  }
}

function closedProjectResponse(project: ProjectRow): { body: unknown; status: number } {
  return {
    body: {
      project_id: project.id,
      project_reference: humanReference(project.project_number),
      status: project.status,
      already_finalized: true,
    },
    status: 200,
  };
}

export async function handleFinalize(
  request: AuthorizedProjectRequest,
  admin: AdminClient,
): Promise<{ body: unknown; status: number }> {
  const project = await loadAuthorizedProject(request, admin);
  if (project.status !== "UPLOAD_PENDING") return closedProjectResponse(project);
  if (project.file_delivery_mode !== "UPLOAD") {
    throw new HttpError(409, "INVALID_PROJECT_STATE", "The project is not awaiting uploads.");
  }
  assertWithinRetention(project);

  const inspection = await inspectStorage(project, admin);
  await saveManifest(project, inspection.manifest, admin);
  if (inspection.missing.length > 0 || inspection.sizeMismatches.length > 0) {
    throw new HttpError(409, "UPLOAD_INCOMPLETE", "Expected files are incomplete.", {
      missing_file_uuids: inspection.missing,
      size_mismatches: inspection.sizeMismatches,
      recoverable: true,
    });
  }

  const { data, error } = await admin
    .from("projects")
    .update({ storage_manifest: inspection.manifest, status: "SUBMITTED" })
    .eq("id", project.id)
    .eq("status", "UPLOAD_PENDING")
    .select("status")
    .maybeSingle();
  if (error) {
    console.error("Project finalization failed", { code: error.code, project_id: project.id });
    throw new HttpError(503, "FINALIZE_FAILED", "The project could not be finalized.");
  }
  if (!data) {
    const refreshed = await loadAuthorizedProject(request, admin);
    if (refreshed.status !== "UPLOAD_PENDING") return closedProjectResponse(refreshed);
    throw new HttpError(409, "PROJECT_STATE_CHANGED", "The project state changed. Try again.");
  }

  return {
    body: {
      project_id: project.id,
      project_reference: humanReference(project.project_number),
      status: "SUBMITTED",
    },
    status: 200,
  };
}

export async function handleResume(
  request: AuthorizedProjectRequest,
  admin: AdminClient,
): Promise<{ body: unknown; status: number }> {
  const project = await loadAuthorizedProject(request, admin);
  if (project.status !== "UPLOAD_PENDING") return closedProjectResponse(project);
  if (project.file_delivery_mode !== "UPLOAD") {
    throw new HttpError(409, "INVALID_PROJECT_STATE", "The project is not awaiting uploads.");
  }
  assertWithinRetention(project);

  let inspection = await inspectStorage(project, admin);
  await saveManifest(project, inspection.manifest, admin);
  const recoveredSizeMismatchFileUuids = inspection.sizeMismatches.map((mismatch) =>
    mismatch.file_uuid
  );
  if (recoveredSizeMismatchFileUuids.length > 0) {
    await deleteSizeMismatches(project, inspection, admin);
    inspection = await inspectStorage(project, admin);
    const stillPresent = recoveredSizeMismatchFileUuids.filter((fileUuid) =>
      !inspection.missing.includes(fileUuid)
    );
    if (stillPresent.length > 0) {
      console.error("Mismatched object deletion could not be confirmed", {
        project_id: project.id,
        file_uuids: stillPresent,
      });
      throw new HttpError(
        409,
        "SIZE_MISMATCH_DELETE_FAILED",
        "Incorrect files could not be prepared for another upload.",
        { file_uuids: stillPresent, recoverable: true },
      );
    }
    await saveManifest(project, inspection.manifest, admin);
  }
  const missingEntries = inspection.manifest.filter((file) =>
    inspection.missing.includes(file.file_uuid)
  );
  const uploadResult = await createUploadAuthorizations(admin, missingEntries);

  return {
    body: {
      project_id: project.id,
      project_reference: humanReference(project.project_number),
      status: project.status,
      missing_file_uuids: inspection.missing,
      size_mismatches: inspection.sizeMismatches,
      recovered_size_mismatch_file_uuids: recoveredSizeMismatchFileUuids,
      uploads: uploadResult.authorizations,
      upload_authorization_incomplete: uploadResult.failedFileUuids.length > 0,
      ...(uploadResult.failedFileUuids.length > 0
        ? { authorization_missing_file_uuids: uploadResult.failedFileUuids }
        : {}),
    },
    status: 200,
  };
}
