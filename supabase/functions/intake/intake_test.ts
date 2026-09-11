import {
  buildStorageManifest,
  MAX_FILE_SIZE_BYTES,
  MAX_PROJECT_SIZE_BYTES,
  normalizeExtension,
  validateFileDescriptors,
} from "./file_policy.ts";
import { corsHeaders, isOriginAllowed, parseAllowedOrigins } from "./cors.ts";
import { constantTimeHexEqual, generateSubmissionToken, hashSubmissionToken } from "./token.ts";
import { parseIntakeRequest, ValidationError } from "./validation.ts";

function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertThrowsCode(callback: () => unknown, expectedCode: string): void {
  try {
    callback();
  } catch (error) {
    assert(error instanceof Error && "code" in error, "Expected a coded error");
    assertEquals((error as Error & { code: string }).code, expectedCode);
    return;
  }
  throw new Error(`Expected error ${expectedCode}`);
}

function validProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    branch: "FDM",
    first_name: "Ada",
    email: "ada@example.com",
    city: "Curitiba",
    state_uf: "PR",
    project_description: "Functional prototype",
    quantity: 1,
    final_size: "100 mm",
    file_delivery_mode: "UPLOAD",
    intended_use: "Indoor prototype",
    ip_declaration: true,
    privacy_acknowledgement: true,
    ...overrides,
  };
}

function validCreate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "create",
    turnstileToken: "test-token",
    project: validProject(),
    files: [{ original_name: "model.STL", declared_size_bytes: 1_024 }],
    ...overrides,
  };
}

Deno.test("accepts every permitted extension", () => {
  for (const extension of ["stl", "3mf", "obj", "step", "stp"]) {
    validateFileDescriptors([{ original_name: `part.${extension}`, declared_size_bytes: 1 }]);
  }
});

Deno.test("rejects prohibited archive extensions", () => {
  for (const extension of ["zip", "rar"]) {
    assertThrowsCode(
      () =>
        validateFileDescriptors([{ original_name: `part.${extension}`, declared_size_bytes: 1 }]),
      "FILE_TYPE_NOT_ALLOWED",
    );
  }
});

Deno.test("rejects more than five files", () => {
  assertThrowsCode(
    () =>
      validateFileDescriptors(
        Array.from({ length: 6 }, (_, index) => ({
          original_name: `part-${index}.stl`,
          declared_size_bytes: 1,
        })),
      ),
    "INVALID_FILE_COUNT",
  );
});

Deno.test("accepts a combined project size of exactly 50 MB decimal", () => {
  validateFileDescriptors([
    { original_name: "one.stl", declared_size_bytes: 30_000_000 },
    { original_name: "two.obj", declared_size_bytes: 20_000_000 },
  ]);
  assertEquals(MAX_PROJECT_SIZE_BYTES, 50_000_000);
});

Deno.test("rejects a combined project size of 50,000,001 bytes", () => {
  assertThrowsCode(
    () =>
      validateFileDescriptors([
        { original_name: "one.stl", declared_size_bytes: 30_000_000 },
        { original_name: "two.obj", declared_size_bytes: 20_000_001 },
      ]),
    "PROJECT_FILES_TOO_LARGE",
  );
});

Deno.test("rejects an individual file above 50 MiB", () => {
  assertThrowsCode(
    () =>
      validateFileDescriptors([
        { original_name: "large.step", declared_size_bytes: MAX_FILE_SIZE_BYTES + 1 },
      ]),
    "FILE_TOO_LARGE",
  );
});

Deno.test("accepts the frozen exposure factor allowlist", () => {
  const parsed = parseIntakeRequest(validCreate({
    project: validProject({ exposure_factors: ["HEAT", "LOAD", "OUTDOOR", "IMPACT_FLEX"] }),
  }));
  assertEquals(parsed.action === "create" ? parsed.project.exposure_factors : undefined, [
    "HEAT",
    "LOAD",
    "OUTDOOR",
    "IMPACT_FLEX",
  ]);
});

Deno.test("rejects unsupported and duplicate exposure factors", () => {
  assertThrowsCode(
    () =>
      parseIntakeRequest(validCreate({
        project: validProject({ exposure_factors: ["WATER"] }),
      })),
    "INVALID_EXPOSURE_FACTOR",
  );
  assertThrowsCode(
    () =>
      parseIntakeRequest(validCreate({
        project: validProject({ exposure_factors: ["HEAT", "HEAT"] }),
      })),
    "DUPLICATE_EXPOSURE_FACTOR",
  );
});

Deno.test("NONE and UNKNOWN exposure factors are exclusive", () => {
  for (const factors of [["NONE", "HEAT"], ["UNKNOWN", "LOAD"], ["NONE", "UNKNOWN"]]) {
    assertThrowsCode(
      () =>
        parseIntakeRequest(validCreate({ project: validProject({ exposure_factors: factors }) })),
      "EXCLUSIVE_EXPOSURE_FACTOR",
    );
  }
});

Deno.test("requires intended_use for FDM", () => {
  assertThrowsCode(
    () => parseIntakeRequest(validCreate({ project: validProject({ intended_use: undefined }) })),
    "FDM_INTENDED_USE_REQUIRED",
  );
});

Deno.test("requires external_file_url for LINK", () => {
  assertThrowsCode(
    () =>
      parseIntakeRequest(validCreate({
        project: validProject({
          branch: "RESIN",
          file_delivery_mode: "LINK",
          intended_use: undefined,
        }),
        files: [],
      })),
    "LINK_URL_REQUIRED",
  );
});

Deno.test("requires both declarations to be true", () => {
  assertThrowsCode(
    () =>
      parseIntakeRequest(validCreate({
        project: validProject({ privacy_acknowledgement: false }),
      })),
    "DECLARATIONS_REQUIRED",
  );
});

Deno.test("generates and hashes submission tokens", async () => {
  const token = generateSubmissionToken();
  const hash = await hashSubmissionToken(token);
  assert(/^[0-9a-f]{64}$/.test(token));
  assert(/^[0-9a-f]{64}$/.test(hash));
  assert(constantTimeHexEqual(hash, await hashSubmissionToken(token)));
  const differentHash = `${hash[0] === "0" ? "1" : "0"}${hash.slice(1)}`;
  assert(!constantTimeHexEqual(hash, differentHash));
});

Deno.test("storage paths never include the original filename", () => {
  const manifest = buildStorageManifest(
    "11111111-1111-4111-8111-111111111111",
    [{ original_name: "Israel-private-model.STL", declared_size_bytes: 100 }],
    () => "22222222-2222-4222-8222-222222222222",
  );
  assertEquals(
    manifest[0].storage_path,
    "projects/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.stl",
  );
  assert(!manifest[0].storage_path.includes("Israel"));
});

Deno.test("normalizes file extensions", () => {
  assertEquals(normalizeExtension("part.3MF"), "3mf");
  assertEquals(normalizeExtension("part.Final.StEp"), "step");
});

Deno.test("rejects invalid actions and unexpected payload fields", () => {
  assertThrowsCode(() => parseIntakeRequest({ action: "delete" }), "INVALID_ACTION");
  assertThrowsCode(
    () => parseIntakeRequest({ ...validCreate(), phone: "+55 41 99999-9999" }),
    "UNEXPECTED_FIELD",
  );
  assertThrowsCode(
    () => parseIntakeRequest(validCreate({ project: validProject({ cpf: "00000000000" }) })),
    "UNEXPECTED_FIELD",
  );
});

Deno.test("accepts a basic valid create payload", () => {
  const parsed = parseIntakeRequest(validCreate());
  assertEquals(parsed.action, "create");
  if (parsed.action === "create") {
    assertEquals(parsed.project.state_uf, "PR");
    assertEquals(parsed.files[0].original_name, "model.STL");
  }
});

Deno.test("validation errors remain public and coded", () => {
  try {
    parseIntakeRequest({ action: "resume", projectId: "not-a-uuid", submissionToken: "x" });
  } catch (error) {
    assert(error instanceof ValidationError);
    assertEquals(error.code, "INVALID_PROJECT_ID");
    return;
  }
  throw new Error("Expected ValidationError");
});

Deno.test("accepts finalize and resume credential payloads", () => {
  for (const action of ["finalize", "resume"] as const) {
    const parsed = parseIntakeRequest({
      action,
      projectId: "11111111-1111-4111-8111-111111111111",
      submissionToken: "client-held-secret",
    });
    assertEquals(parsed.action, action);
  }
});

Deno.test("CORS allows only configured origins and never emits a wildcard", () => {
  const allowed = parseAllowedOrigins("http://localhost:3000,https://print.example.com");
  assert(isOriginAllowed("https://print.example.com", allowed));
  assert(!isOriginAllowed("https://attacker.example", allowed));
  assertEquals(
    corsHeaders("https://print.example.com", allowed).get("Access-Control-Allow-Origin"),
    "https://print.example.com",
  );
  assertEquals(
    corsHeaders("https://attacker.example", allowed).get("Access-Control-Allow-Origin"),
    null,
  );
});
