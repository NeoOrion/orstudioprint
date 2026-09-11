import type { CreateIntakeResponse, NamedSizedFile, UploadFileDescriptor } from "./types";

export const PENDING_SESSION_KEY = "orstudio_intake_pending_v2";
export const LEGACY_PENDING_SESSION_KEY = "orstudio_intake_pending_v1";
export const PENDING_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;

export interface PendingFile {
  file_uuid: string;
  original_name: string;
  declared_size_bytes: number;
}

export interface PendingIntakeSession {
  version: 2;
  project_id: string;
  project_reference: string;
  submission_token: string;
  files: PendingFile[];
  expires_at: string;
}

interface LegacyPendingIntakeSession {
  version: 1;
  project_id: string;
  project_reference: string;
  submission_token: string;
  files: PendingFile[];
}

function isPendingFile(value: unknown): value is PendingFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.file_uuid === "string" &&
    typeof entry.original_name === "string" &&
    typeof entry.declared_size_bytes === "number";
}

function isLegacyPendingSession(value: unknown): value is LegacyPendingIntakeSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 &&
    typeof candidate.project_id === "string" &&
    typeof candidate.project_reference === "string" &&
    typeof candidate.submission_token === "string" &&
    Array.isArray(candidate.files) &&
    candidate.files.every(isPendingFile);
}

function isPendingSession(value: unknown): value is PendingIntakeSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 2 &&
    typeof candidate.project_id === "string" &&
    typeof candidate.project_reference === "string" &&
    typeof candidate.submission_token === "string" &&
    typeof candidate.expires_at === "string" &&
    Array.isArray(candidate.files) &&
    candidate.files.every(isPendingFile);
}

function isUploadFileDescriptor(value: unknown): value is UploadFileDescriptor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.file_uuid === "string" &&
    typeof candidate.original_name === "string" &&
    typeof candidate.declared_size_bytes === "number";
}

export function createPendingSession(
  response: CreateIntakeResponse,
  files: readonly NamedSizedFile[],
  now = Date.now(),
): PendingIntakeSession {
  const uploadFiles = response.upload_files ?? [];
  if (uploadFiles.length !== files.length) throw new Error("MAPPING_MISMATCH");
  uploadFiles.forEach((uploadFile, index) => {
    if (!isUploadFileDescriptor(uploadFile) ||
      uploadFile.original_name !== files[index].name ||
      uploadFile.declared_size_bytes !== files[index].size) {
      throw new Error("MAPPING_MISMATCH");
    }
  });
  return {
    version: 2,
    project_id: response.project_id,
    project_reference: response.project_reference,
    submission_token: response.submission_token,
    files: uploadFiles.map((uploadFile) => ({
      file_uuid: uploadFile.file_uuid,
      original_name: uploadFile.original_name,
      declared_size_bytes: uploadFile.declared_size_bytes,
    })),
    expires_at: new Date(now + PENDING_SESSION_TTL_MS).toISOString(),
  };
}

export function serializePendingSession(session: PendingIntakeSession): string {
  return JSON.stringify(session);
}

export function parsePendingSession(raw: string | null): PendingIntakeSession | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPendingSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function expiresAt(session: PendingIntakeSession): number {
  return Date.parse(session.expires_at);
}

export function readPendingSession(storage: Storage, now = Date.now()): PendingIntakeSession | null {
  try {
    const session = parsePendingSession(storage.getItem(PENDING_SESSION_KEY));
    if (!session || !Number.isFinite(expiresAt(session)) || expiresAt(session) <= now) {
      storage.removeItem(PENDING_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function savePendingSession(storage: Storage, session: PendingIntakeSession): boolean {
  try {
    storage.setItem(PENDING_SESSION_KEY, serializePendingSession(session));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingSession(storage: Storage): boolean {
  try {
    storage.removeItem(PENDING_SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}

export function migrateLegacyPendingSession(
  localStorage: Storage,
  sessionStorage: Storage,
  now = Date.now(),
): PendingIntakeSession | null {
  const current = readPendingSession(localStorage, now);
  if (current) return current;
  try {
    const raw = sessionStorage.getItem(LEGACY_PENDING_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isLegacyPendingSession(parsed)) {
      sessionStorage.removeItem(LEGACY_PENDING_SESSION_KEY);
      return null;
    }
    const migrated: PendingIntakeSession = {
      ...parsed,
      version: 2,
      expires_at: new Date(now + PENDING_SESSION_TTL_MS).toISOString(),
    };
    if (!savePendingSession(localStorage, migrated)) return null;
    sessionStorage.removeItem(LEGACY_PENDING_SESSION_KEY);
    return migrated;
  } catch {
    return null;
  }
}

export function matchPendingFiles<T extends NamedSizedFile>(
  expected: readonly PendingFile[],
  selected: readonly T[],
): Map<string, T> | null {
  if (expected.length !== selected.length) return null;
  const unused = selected.map((file) => ({ file, used: false }));
  const result = new Map<string, T>();
  for (const expectedFile of expected) {
    const match = unused.find(({ file, used }) =>
      !used &&
      file.name === expectedFile.original_name &&
      file.size === expectedFile.declared_size_bytes
    );
    if (!match) return null;
    match.used = true;
    result.set(expectedFile.file_uuid, match.file);
  }
  return result;
}
