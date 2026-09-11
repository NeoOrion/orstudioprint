import type { FileDescriptor, StorageManifestEntry } from "./types.ts";

export const MAX_FILE_COUNT = 5;
// Technical per-object backstop aligned with the Storage bucket (50 MiB).
export const MAX_FILE_SIZE_BYTES = 52_428_800;
// Frozen combined business limit (50 MB decimal).
export const MAX_PROJECT_SIZE_BYTES = 50_000_000;
export const ALLOWED_EXTENSIONS = new Set(["stl", "3mf", "obj", "step", "stp"]);

export class FilePolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FilePolicyError";
  }
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) <= 0x1f);
}

export function normalizeExtension(originalName: string): string {
  const trimmed = originalName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    throw new FilePolicyError("FILE_EXTENSION_REQUIRED", "Each file must have an extension.");
  }
  return trimmed.slice(lastDot + 1).toLowerCase();
}

export function validateFileDescriptors(files: FileDescriptor[]): void {
  if (files.length < 1 || files.length > MAX_FILE_COUNT) {
    throw new FilePolicyError(
      "INVALID_FILE_COUNT",
      `UPLOAD requires between 1 and ${MAX_FILE_COUNT} files.`,
    );
  }

  let combinedSize = 0;
  for (const file of files) {
    if (!Number.isSafeInteger(file.declared_size_bytes) || file.declared_size_bytes <= 0) {
      throw new FilePolicyError("INVALID_FILE_SIZE", "Each file size must be a positive integer.");
    }
    if (file.declared_size_bytes > MAX_FILE_SIZE_BYTES) {
      throw new FilePolicyError("FILE_TOO_LARGE", "A file exceeds the 50 MiB limit.");
    }
    if (
      !file.original_name.trim() || file.original_name.length > 255 ||
      hasControlCharacters(file.original_name)
    ) {
      throw new FilePolicyError("INVALID_FILE_NAME", "Each file needs a valid original name.");
    }

    const extension = normalizeExtension(file.original_name);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new FilePolicyError("FILE_TYPE_NOT_ALLOWED", "A file extension is not allowed.");
    }
    combinedSize += file.declared_size_bytes;
  }

  if (combinedSize > MAX_PROJECT_SIZE_BYTES) {
    throw new FilePolicyError("PROJECT_FILES_TOO_LARGE", "Combined file size exceeds 50 MB.");
  }
}

export function buildStoragePath(
  projectId: string,
  fileUuid: string,
  extension: string,
): string {
  const normalized = extension.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(normalized)) {
    throw new FilePolicyError("FILE_TYPE_NOT_ALLOWED", "A file extension is not allowed.");
  }
  return `projects/${projectId}/${fileUuid}.${normalized}`;
}

export function buildStorageManifest(
  projectId: string,
  files: FileDescriptor[],
  randomUuid: () => string = () => crypto.randomUUID(),
): StorageManifestEntry[] {
  validateFileDescriptors(files);
  return files.map((file) => {
    const extension = normalizeExtension(file.original_name);
    const fileUuid = randomUuid();
    return {
      file_uuid: fileUuid,
      original_name: file.original_name.trim(),
      extension,
      declared_size_bytes: file.declared_size_bytes,
      storage_path: buildStoragePath(projectId, fileUuid, extension),
      upload_status: "PENDING",
    };
  });
}
