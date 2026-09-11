import { describe, expect, it } from "vitest";

import { buildCreateRequest } from "./api";
import type { IntakeFormValues } from "./types";
import {
  appendFiles,
  canStartCreate,
  extractAttribution,
  fileDescriptors,
  mapFormToProjectPayload,
  removeFileAt,
  MAX_FILE_SIZE_BYTES,
  validateExposureFactors,
  validateFiles,
} from "./validation";

function form(overrides: Partial<IntakeFormValues> = {}): IntakeFormValues {
  return {
    branch: "FDM",
    firstName: "Ada",
    email: "ada@example.com",
    city: "Curitiba",
    stateUf: "pr",
    cep: "",
    projectDescription: "Protótipo funcional",
    quantity: "2",
    finalSize: "100 mm",
    materialPreference: "",
    finishPreference: "",
    deadlineNote: "",
    comments: "",
    intendedUse: "Uso interno",
    exposureFactors: ["HEAT"],
    scaleOrHeight: "",
    detailNotes: "",
    fileDeliveryMode: "UPLOAD",
    externalFileUrl: "",
    ipDeclaration: true,
    privacyAcknowledgement: true,
    ...overrides,
  };
}

describe("file policy", () => {
  it("accepts exactly 50 MB decimal combined", () => {
    expect(validateFiles([
      { name: "one.stl", size: 30_000_000 },
      { name: "two.obj", size: 20_000_000 },
    ])).toEqual([]);
  });

  it("rejects 50,000,001 bytes combined", () => {
    expect(validateFiles([
      { name: "one.stl", size: 30_000_000 },
      { name: "two.obj", size: 20_000_001 },
    ])).toContain("Os arquivos excedem 50 MB no total. Use um link compartilhado.");
  });

  it("rejects prohibited extensions, more than five files, and oversized objects", () => {
    expect(validateFiles([{ name: "archive.zip", size: 10 }])[0]).toContain("não permitida");
    expect(validateFiles(
      Array.from({ length: 6 }, (_, index) => ({ name: `${index}.stl`, size: 1 })),
    )).toContain("Selecione no máximo 5 arquivos.");
    expect(validateFiles([{ name: "large.step", size: MAX_FILE_SIZE_BYTES + 1 }]))
      .toEqual(["Os arquivos excedem 50 MB no total. Use um link compartilhado."]);
  });
});

describe("exposure factors", () => {
  it("accepts the frozen allowlist", () => {
    expect(validateExposureFactors(["HEAT", "LOAD", "OUTDOOR", "IMPACT_FLEX"])).toEqual([]);
    expect(validateExposureFactors(["NONE"])).toEqual([]);
    expect(validateExposureFactors(["UNKNOWN"])).toEqual([]);
  });

  it("rejects invalid, duplicate, NONE-combined, and UNKNOWN-combined values", () => {
    expect(validateExposureFactors(["WATER"])).not.toEqual([]);
    expect(validateExposureFactors(["HEAT", "HEAT"])).not.toEqual([]);
    expect(validateExposureFactors(["NONE", "HEAT"])).not.toEqual([]);
    expect(validateExposureFactors(["UNKNOWN", "LOAD"])).not.toEqual([]);
  });
});

describe("payload mapping and attribution", () => {
  it("maps FDM without resin-only fields", () => {
    const payload = mapFormToProjectPayload(
      form(),
      { source: "search", campaign: "qa", message_variant: "a" },
      "11111111-1111-4111-8111-111111111111",
    );
    expect(payload).toMatchObject({
      branch: "FDM",
      state_uf: "PR",
      quantity: 2,
      intended_use: "Uso interno",
      exposure_factors: ["HEAT"],
      source: "search",
      campaign: "qa",
      message_variant: "a",
    });
    expect(payload).not.toHaveProperty("scale_or_height");
    expect(payload).not.toHaveProperty("detail_notes");
  });

  it("maps RESIN without FDM-only fields", () => {
    const payload = mapFormToProjectPayload(
      form({
        branch: "RESIN",
        intendedUse: "",
        exposureFactors: [],
        scaleOrHeight: "32 mm",
        detailNotes: "Preservar detalhes finos",
      }),
      {},
      "11111111-1111-4111-8111-111111111111",
    );
    expect(payload).toMatchObject({
      branch: "RESIN",
      scale_or_height: "32 mm",
      detail_notes: "Preservar detalhes finos",
    });
    expect(payload).not.toHaveProperty("intended_use");
    expect(payload).not.toHaveProperty("exposure_factors");
  });

  it("never includes files in a LINK create request", () => {
    const project = mapFormToProjectPayload(
      form({ branch: "RESIN", fileDeliveryMode: "LINK", externalFileUrl: "https://example.com/x" }),
      {},
      "11111111-1111-4111-8111-111111111111",
    );
    const request = buildCreateRequest(
      "turnstile",
      project,
      fileDescriptors([{ name: "ignored.stl", size: 10 }]),
    );
    expect(request.files).toEqual([]);
  });

  it("maps src, cmp and msg query parameters", () => {
    expect(extractAttribution("?src=instagram&cmp=launch&msg=b")).toEqual({
      source: "instagram",
      campaign: "launch",
      message_variant: "b",
    });
  });
});

describe("client create guard", () => {
  it("blocks double submit and a new create while pending", () => {
    expect(canStartCreate(false, false)).toBe(true);
    expect(canStartCreate(true, false)).toBe(false);
    expect(canStartCreate(false, true)).toBe(false);
  });

describe("additive file selection", () => {
  it("appends selections and removes an individual file", () => {
    const first = { name: "one.stl", size: 10 };
    const second = { name: "two.obj", size: 20 };
    expect(appendFiles([first], [second])).toEqual([first, second]);
    expect(removeFileAt([first, second], 0)).toEqual([second]);
  });
  it("keeps the combined size validation after additive selection", () => {
    const selected = appendFiles([{ name: "one.stl", size: 30_000_000 }], [{ name: "two.obj", size: 20_000_001 }]);
    expect(validateFiles(selected)).toEqual(["Os arquivos excedem 50 MB no total. Use um link compartilhado."]);
  });
});
});
