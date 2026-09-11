import { describe, expect, it } from "vitest";

import type { CreateIntakeResponse } from "./types";
import {
  LEGACY_PENDING_SESSION_KEY,
  PENDING_SESSION_KEY,
  PENDING_SESSION_TTL_MS,
  clearPendingSession,
  createPendingSession,
  matchPendingFiles,
  migrateLegacyPendingSession,
  parsePendingSession,
  readPendingSession,
  savePendingSession,
  serializePendingSession,
} from "./pending-session";

const response: CreateIntakeResponse = {
  project_id: "11111111-1111-4111-8111-111111111111",
  project_reference: "OP-00042",
  submission_token: "client-held-token",
  status: "UPLOAD_PENDING",
  upload_files: [{
    file_uuid: "22222222-2222-4222-8222-222222222222",
    original_name: "triangle.stl",
    declared_size_bytes: 128,
  }],
};

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("pending intake session", () => {
  it("serializes v2 without form PII or signed upload credentials", () => {
    const session = createPendingSession(response, [{ name: "triangle.stl", size: 128 }], 0);
    const raw = serializePendingSession(session);
    expect(parsePendingSession(raw)).toEqual(session);
    expect(Object.keys(session).sort()).toEqual([
      "expires_at", "files", "project_id", "project_reference", "submission_token", "version",
    ]);
    expect(raw).not.toContain("ada@example.com");
    expect(raw).not.toContain("Protótipo funcional");
    expect(raw).not.toContain("short-lived-upload-token");
  });

  it("keeps a valid session across storage instances until its fixed 24h expiry", () => {
    const createdAt = 1_000;
    const first = new MemoryStorage();
    const session = createPendingSession(response, [{ name: "triangle.stl", size: 128 }], createdAt);
    expect(savePendingSession(first, session)).toBe(true);
    const second = new MemoryStorage();
    second.setItem(PENDING_SESSION_KEY, first.getItem(PENDING_SESSION_KEY)!);
    expect(readPendingSession(second, createdAt + PENDING_SESSION_TTL_MS - 1)).toEqual(session);
  });

  it("clears expired or corrupt v2 records safely", () => {
    const storage = new MemoryStorage();
    const session = createPendingSession(response, [{ name: "triangle.stl", size: 128 }], 0);
    savePendingSession(storage, session);
    expect(readPendingSession(storage, PENDING_SESSION_TTL_MS)).toBeNull();
    expect(storage.getItem(PENDING_SESSION_KEY)).toBeNull();
    storage.setItem(PENDING_SESSION_KEY, "{bad json");
    expect(readPendingSession(storage, 0)).toBeNull();
    expect(storage.getItem(PENDING_SESSION_KEY)).toBeNull();
  });

  it("migrates a valid v1 session only when v2 is absent", () => {
    const local = new MemoryStorage();
    const legacy = new MemoryStorage();
    legacy.setItem(LEGACY_PENDING_SESSION_KEY, JSON.stringify({
      version: 1,
      project_id: response.project_id,
      project_reference: response.project_reference,
      submission_token: response.submission_token,
      files: response.upload_files,
    }));
    const migrated = migrateLegacyPendingSession(local, legacy, 10);
    expect(migrated?.version).toBe(2);
    expect(migrated?.expires_at).toBe(new Date(10 + PENDING_SESSION_TTL_MS).toISOString());
    expect(legacy.getItem(LEGACY_PENDING_SESSION_KEY)).toBeNull();
    expect(readPendingSession(local, 11)).toEqual(migrated);
  });

  it("clears persisted state on success or explicit discard", () => {
    const storage = new MemoryStorage();
    const session = createPendingSession(response, [{ name: "triangle.stl", size: 128 }]);
    savePendingSession(storage, session);
    expect(clearPendingSession(storage)).toBe(true);
    expect(storage.getItem(PENDING_SESSION_KEY)).toBeNull();
  });

  it("maps file UUID to a reselected file only when filename and size match", () => {
    const session = createPendingSession(response, [{ name: "triangle.stl", size: 128 }]);
    const selected = [{ name: "triangle.stl", size: 128, marker: "same-file" }];
    expect(matchPendingFiles(session.files, selected)?.get(session.files[0].file_uuid))
      .toBe(selected[0]);
    expect(matchPendingFiles(session.files, [{ name: "other.stl", size: 128 }])).toBeNull();
  });

  it("handles unavailable storage without throwing", () => {
    const failing = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    } as unknown as Storage;
    const session = createPendingSession(response, [{ name: "triangle.stl", size: 128 }]);
    expect(savePendingSession(failing, session)).toBe(false);
    expect(readPendingSession(failing)).toBeNull();
    expect(clearPendingSession(failing)).toBe(false);
  });
});
