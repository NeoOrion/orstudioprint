import type { CreateIntakeResponse, NamedSizedFile, UploadFileDescriptor } from "./types";

export const PENDING_SESSION_KEY = "orstudio_intake_pending_v1";

export interface PendingFile {
  file_uuid: string;
  original_name: string;
  declared_size_bytes: number;
}

export interface PendingIntakeSession {
  version: 1;
  project_id: string;
  project_reference: string;
  submission_token: string;
  files: PendingFile[];
}

function isPendingSession(value: unknown): value is PendingIntakeSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 &&
    typeof candidate.project_id === "string" &&
    typeof candidate.project_reference === "string" &&
    typeof candidate.submission_token === "string" &&
    Array.isArray(candidate.files) &&
    candidate.files.every((file) => {
      if (typeof file !== "object" || file === null || Array.isArray(file)) return false;
      const entry = file as Record<string, unknown>;
      return typeof entry.file_uuid === "string" &&
        typeof entry.original_name === "string" &&
        typeof entry.declared_size_bytes === "number";
    });
}

export function createPendingSession(
  response: CreateIntakeResponse,
  files: readonly NamedSizedFile[],
): PendingIntakeSession {
  const uploadFiles = response.upload_files ?? [];
  if (uploadFiles.length !== files.length) {
    throw new Error("MAPPING_MISMATCH");
  }
  uploadFiles.forEach((uploadFile, index) => {
    if (!isUploadFileDescriptor(uploadFile) ||
      uploadFile.original_name !== files[index].name ||
      uploadFile.declared_size_bytes !== files[index].size) {
      throw new Error("MAPPING_MISMATCH");
    }
  });
  return {
    version: 1,
    project_id: response.project_id,
    project_reference: response.project_reference,
    submission_token: response.submission_token,
    files: uploadFiles.map((uploadFile) => ({
      file_uuid: uploadFile.file_uuid,
      original_name: uploadFile.original_name,
      declared_size_bytes: uploadFile.declared_size_bytes,
    })),
  };
}

function isUploadFileDescriptor(value: unknown): value is UploadFileDescriptor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.file_uuid === "string" &&
    typeof candidate.original_name === "string" &&
    typeof candidate.declared_size_bytes === "number";
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

export function readPendingSession(storage: Storage): PendingIntakeSession | null {
  return parsePendingSession(storage.getItem(PENDING_SESSION_KEY));
}

export function savePendingSession(storage: Storage, session: PendingIntakeSession): void {
  storage.setItem(PENDING_SESSION_KEY, serializePendingSession(session));
}

export function clearPendingSession(storage: Storage): void {
  storage.removeItem(PENDING_SESSION_KEY);
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
