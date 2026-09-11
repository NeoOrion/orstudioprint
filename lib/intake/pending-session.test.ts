import { describe, expect, it } from "vitest";

import type { CreateIntakeResponse } from "./types";
import {
  createPendingSession,
  matchPendingFiles,
  parsePendingSession,
  serializePendingSession,
} from "./pending-session";

const response: CreateIntakeResponse = {
  project_id: "11111111-1111-4111-8111-111111111111",
  project_reference: "OP-00042",
  submission_token: "client-held-token",
  status: "UPLOAD_PENDING",
  uploads: [
    {
      file_uuid: "22222222-2222-4222-8222-222222222222",
      storage_path: "projects/111/222.stl",
      signed_url: "https://storage.example/upload",
      upload_token: "short-lived-upload-token",
    },
  ],
};

describe("pending intake session", () => {
  it("serializes only credentials and the non-content file mapping", () => {
    const session = createPendingSession(response, [{ name: "triangle.stl", size: 128 }]);
    const raw = serializePendingSession(session);
    expect(parsePendingSession(raw)).toEqual(session);
    expect(Object.keys(session).sort()).toEqual([
      "files",
      "project_id",
      "project_reference",
      "submission_token",
      "version",
    ]);
    expect(raw).not.toContain("ada@example.com");
    expect(raw).not.toContain("Protótipo funcional");
    expect(raw).not.toContain("short-lived-upload-token");
    expect(raw).not.toContain("storage.example");
  });

  it("maps file UUID to a reselected file only when filename and size match", () => {
    const session = createPendingSession(response, [{ name: "triangle.stl", size: 128 }]);
    const selected = [{ name: "triangle.stl", size: 128, marker: "same-file" }];
    expect(matchPendingFiles(session.files, selected)?.get(session.files[0].file_uuid))
      .toBe(selected[0]);
    expect(matchPendingFiles(session.files, [{ name: "other.stl", size: 128 }])).toBeNull();
    expect(matchPendingFiles(session.files, [{ name: "triangle.stl", size: 129 }])).toBeNull();
  });
});
