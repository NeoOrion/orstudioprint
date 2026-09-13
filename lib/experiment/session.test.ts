import { describe, expect, it } from "vitest";

import type { IntakeFormValues } from "../intake/types";
import { mapFormToProjectPayload } from "../intake/validation";

import {
  buildInteractionEvent,
  buildSubmittedEvent,
  claimFormStarted,
  createExperimentMemory,
  EXPERIMENT_SESSION_KEY,
  getExperimentSession,
} from "./session";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION_ID = "22222222-2222-4222-8222-222222222222";

class FakeStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function validForm(): IntakeFormValues {
  return {
    branch: "FDM",
    firstName: "Ada",
    email: "ada@example.com",
    city: "Curitiba",
    stateUf: "PR",
    cep: "",
    projectDescription: "Peça funcional",
    quantity: "1",
    finalSize: "100 mm",
    materialPreference: "",
    finishPreference: "",
    deadlineNote: "",
    comments: "",
    intendedUse: "Uso interno",
    exposureFactors: [],
    scaleOrHeight: "",
    detailNotes: "",
    fileDeliveryMode: "LINK",
    externalFileUrl: "https://example.com/model",
    ipDeclaration: true,
    privacyAcknowledgement: true,
  };
}

describe("experiment first-touch session", () => {
  it("creates a UUID and captures src/cmp/msg on first use", () => {
    const storage = new FakeStorage();
    const session = getExperimentSession(
      storage,
      "?src=reddit&cmp=launch&msg=a",
      () => SESSION_ID,
      createExperimentMemory(),
    );

    expect(session).toEqual({
      session_id: SESSION_ID,
      source: "reddit",
      campaign: "launch",
      message_variant: "a",
    });
    expect(JSON.parse(storage.getItem(EXPERIMENT_SESSION_KEY) ?? "{}")).toEqual(session);
  });

  it("preserves first-touch through later URLs and navigation without params", () => {
    const storage = new FakeStorage();
    getExperimentSession(
      storage,
      "?src=reddit&cmp=test&msg=a",
      () => SESSION_ID,
      createExperimentMemory(),
    );

    const later = getExperimentSession(
      storage,
      "?src=facebook&cmp=other&msg=b",
      () => OTHER_SESSION_ID,
      createExperimentMemory(),
    );
    const withoutParams = getExperimentSession(
      storage,
      "",
      () => OTHER_SESSION_ID,
      createExperimentMemory(),
    );

    expect(later).toEqual({
      session_id: SESSION_ID,
      source: "reddit",
      campaign: "test",
      message_variant: "a",
    });
    expect(withoutParams).toEqual(later);
  });

  it("recovers malformed storage and caps attribution values at 200 characters", () => {
    const storage = new FakeStorage();
    storage.setItem(EXPERIMENT_SESSION_KEY, "not-json");
    const session = getExperimentSession(
      storage,
      `?src=${"x".repeat(250)}`,
      () => SESSION_ID,
      createExperimentMemory(),
    );

    expect(session.session_id).toBe(SESSION_ID);
    expect(session.source).toHaveLength(200);
  });

  it("uses an in-memory context when sessionStorage throws", () => {
    const failingStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    const memory = createExperimentMemory();

    expect(() => getExperimentSession(
      failingStorage,
      "?src=reddit",
      () => SESSION_ID,
      memory,
    )).not.toThrow();
    expect(getExperimentSession(
      failingStorage,
      "?src=other",
      () => OTHER_SESSION_ID,
      memory,
    )).toMatchObject({ session_id: SESSION_ID, source: "reddit" });
  });
});

describe("experiment event contract", () => {
  const session = {
    session_id: SESSION_ID,
    source: "reddit",
    campaign: "test",
    message_variant: "a",
  };

  it("maps branch routes and omits project_id from CTA/start events", () => {
    const fdm = buildInteractionEvent("quote_cta_clicked", session, "FDM");
    const resin = buildInteractionEvent("form_started", session, "RESIN");

    expect(fdm.route).toBe("/pecas");
    expect(resin.route).toBe("/resina");
    expect(fdm).not.toHaveProperty("project_id");
    expect(resin).not.toHaveProperty("project_id");
  });

  it("adds project_id only to form_submitted and never adds PII", () => {
    const events = [
      buildInteractionEvent("quote_cta_clicked", session, "FDM"),
      buildInteractionEvent("form_started", session, "FDM"),
      buildSubmittedEvent(session, "FDM", OTHER_SESSION_ID),
    ];
    const forbidden = [
      "first_name",
      "email",
      "city",
      "state_uf",
      "cep",
      "project_description",
      "quantity",
      "files",
      "external_file_url",
      "comments",
      "ip_declaration",
      "privacy_acknowledgement",
      "turnstileToken",
      "submissionToken",
    ];
    const approved = new Set([
      "event_name",
      "session_id",
      "branch",
      "route",
      "project_id",
      "source",
      "campaign",
      "message_variant",
    ]);

    expect(events[2]).toMatchObject({
      event_name: "form_submitted",
      project_id: OTHER_SESSION_ID,
    });
    for (const event of events) {
      expect(Object.keys(event).every((key) => approved.has(key))).toBe(true);
      for (const key of forbidden) expect(event).not.toHaveProperty(key);
    }
  });
});

describe("form-start deduplication", () => {
  it("claims once per route within the same session", () => {
    const storage = new FakeStorage();
    const firstPageMemory = createExperimentMemory();
    const nextPageMemory = createExperimentMemory();

    expect(claimFormStarted(storage, SESSION_ID, "/pecas", firstPageMemory)).toBe(true);
    expect(claimFormStarted(storage, SESSION_ID, "/pecas", nextPageMemory)).toBe(false);
    expect(claimFormStarted(storage, SESSION_ID, "/resina", nextPageMemory)).toBe(true);
    expect(claimFormStarted(storage, SESSION_ID, "/resina", nextPageMemory)).toBe(false);
  });
});

describe("public project attribution", () => {
  it("uses the stored first-touch session and attribution instead of the later URL", () => {
    const storage = new FakeStorage();
    const firstTouch = getExperimentSession(
      storage,
      "?src=reddit&cmp=test&msg=a",
      () => SESSION_ID,
      createExperimentMemory(),
    );
    const stored = getExperimentSession(
      storage,
      "?src=facebook&cmp=other&msg=b",
      () => OTHER_SESSION_ID,
      createExperimentMemory(),
    );
    const payload = mapFormToProjectPayload(validForm(), stored, stored.session_id);

    expect(stored).toEqual(firstTouch);
    expect(payload).toMatchObject({
      session_id: SESSION_ID,
      source: "reddit",
      campaign: "test",
      message_variant: "a",
    });
  });
});
