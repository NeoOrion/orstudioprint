import { handleEvent, handleFinalize, handleResume } from "./actions.ts";
import { buildStoragePath } from "./file_policy.ts";
import { HttpError } from "./responses.ts";
import type { AdminClient } from "./runtime.ts";
import { hashSubmissionToken } from "./token.ts";
import type { AuthorizedProjectRequest, EventRequest, StorageManifestEntry } from "./types.ts";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ONE_ID = "22222222-2222-4222-8222-222222222222";
const FILE_TWO_ID = "33333333-3333-4333-8333-333333333333";
const SUBMISSION_TOKEN = "client-held-submission-token";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  assert(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof HttpError, "Expected HttpError");
    assertEquals(error.status, status);
    assertEquals(error.code, code);
    return error;
  }
  throw new Error(`Expected ${status}/${code}`);
}

interface FakeProject extends Record<string, unknown> {
  id: string;
  project_number: number;
  status: string;
  file_delivery_mode: string;
  storage_manifest: StorageManifestEntry[];
  file_delete_after: string;
  submission_token_hash: string;
}

interface FakeState {
  project: FakeProject;
  objects: Map<string, number>;
  signed: Array<{ path: string; upsert: boolean }>;
  removed: string[][];
  deleteFails: boolean;
  listCalls: number;
}

interface FakeQueryResult {
  data: Record<string, unknown> | null;
  error: { code: string } | null;
}

class FakeProjectQuery {
  private operation: "select" | "update" = "select";
  private updates: Record<string, unknown> = {};
  private filters = new Map<string, unknown>();
  private returnsData = false;

  constructor(private readonly state: FakeState) {}

  select(_columns: string): this {
    this.returnsData = true;
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.operation = "update";
    this.updates = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.set(column, value);
    return this;
  }

  maybeSingle(): Promise<FakeQueryResult> {
    return Promise.resolve(this.execute());
  }

  then<TResult1 = FakeQueryResult, TResult2 = never>(
    onfulfilled?: ((value: FakeQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private matches(): boolean {
    for (const [column, value] of this.filters) {
      if (this.state.project[column] !== value) return false;
    }
    return true;
  }

  private execute(): FakeQueryResult {
    if (!this.matches()) return { data: null, error: null };
    if (this.operation === "select") {
      return { data: this.state.project, error: null };
    }
    Object.assign(this.state.project, this.updates);
    return {
      data: this.returnsData ? { status: this.state.project.status } : null,
      error: null,
    };
  }
}

function createFakeAdmin(state: FakeState): AdminClient {
  const admin = {
    from: (_table: string) => new FakeProjectQuery(state),
    storage: {
      from: (bucket: string) => {
        if (bucket !== "quote-files") throw new Error(`Unexpected bucket ${bucket}`);
        return {
          list: (folder: string) => {
            state.listCalls += 1;
            const prefix = `${folder}/`;
            const data = Array.from(state.objects.entries())
              .filter(([path]) => path.startsWith(prefix))
              .map(([path, size]) => ({
                id: path,
                name: path.slice(prefix.length),
                metadata: { size },
              }));
            return Promise.resolve({ data, error: null });
          },
          createSignedUploadUrl: (path: string, options: { upsert?: boolean }) => {
            state.signed.push({ path, upsert: options.upsert === true });
            return Promise.resolve({
              data: {
                signedUrl: `https://storage.test/upload/${encodeURIComponent(path)}`,
                token: `signed-token-${state.signed.length}`,
              },
              error: null,
            });
          },
          remove: (paths: string[]) => {
            state.removed.push([...paths]);
            if (state.deleteFails) {
              return Promise.resolve({ data: null, error: { message: "delete failed" } });
            }
            for (const path of paths) state.objects.delete(path);
            return Promise.resolve({ data: paths.map((name) => ({ name })), error: null });
          },
        };
      },
    },
  };
  return admin as unknown as AdminClient;
}

function manifest(): StorageManifestEntry[] {
  return [
    {
      file_uuid: FILE_ONE_ID,
      original_name: "one.stl",
      extension: "stl",
      declared_size_bytes: 100,
      storage_path: buildStoragePath(PROJECT_ID, FILE_ONE_ID, "stl"),
      upload_status: "PENDING",
    },
    {
      file_uuid: FILE_TWO_ID,
      original_name: "two.obj",
      extension: "obj",
      declared_size_bytes: 200,
      storage_path: buildStoragePath(PROJECT_ID, FILE_TWO_ID, "obj"),
      upload_status: "PENDING",
    },
  ];
}

async function context(
  options: {
    status?: string;
    retentionExpired?: boolean;
    objects?: Array<[string, number]>;
    deleteFails?: boolean;
  } = {},
): Promise<{ state: FakeState; admin: AdminClient; request: AuthorizedProjectRequest }> {
  const state: FakeState = {
    project: {
      id: PROJECT_ID,
      project_number: 42,
      status: options.status ?? "UPLOAD_PENDING",
      file_delivery_mode: "UPLOAD",
      storage_manifest: manifest(),
      file_delete_after: options.retentionExpired
        ? "2020-01-01T00:00:00.000Z"
        : "2099-01-01T00:00:00.000Z",
      submission_token_hash: await hashSubmissionToken(SUBMISSION_TOKEN),
    },
    objects: new Map(options.objects ?? []),
    signed: [],
    removed: [],
    deleteFails: options.deleteFails ?? false,
    listCalls: 0,
  };
  return {
    state,
    admin: createFakeAdmin(state),
    request: { action: "finalize", projectId: PROJECT_ID, submissionToken: SUBMISSION_TOKEN },
  };
}

function eventRequest(overrides: Partial<EventRequest["event"]> = {}): EventRequest {
  return {
    action: "event",
    event: {
      event_name: "form_started",
      session_id: SESSION_ID,
      branch: "FDM",
      route: "/pecas",
      ...overrides,
    },
  };
}

function eventAdmin(
  inserted: Record<string, unknown>[],
  error: { code: string } | null = null,
): AdminClient {
  return {
    from: (table: string) => {
      assertEquals(table, "events");
      return {
        insert: (value: Record<string, unknown>) => {
          inserted.push(value);
          return Promise.resolve({ data: null, error });
        },
      };
    },
  } as unknown as AdminClient;
}

Deno.test("handleEvent inserts only approved fields", async () => {
  const inserted: Record<string, unknown>[] = [];
  await handleEvent(
    eventRequest({
      event_name: "form_submitted",
      project_id: PROJECT_ID,
      source: "landing",
      campaign: "p4",
      message_variant: "a",
    }),
    eventAdmin(inserted),
  );
  assertEquals(inserted, [{
    event_name: "form_submitted",
    session_id: SESSION_ID,
    branch: "FDM",
    route: "/pecas",
    project_id: PROJECT_ID,
    source: "landing",
    campaign: "p4",
    message_variant: "a",
  }]);
});

Deno.test("handleEvent returns the minimal success response without Turnstile", async () => {
  const inserted: Record<string, unknown>[] = [];
  const result = await handleEvent(eventRequest(), eventAdmin(inserted));
  assertEquals(result, { body: { accepted: true }, status: 201 });
});

Deno.test("handleEvent maps database failures to a generic service error", async () => {
  const inserted: Record<string, unknown>[] = [];
  await expectHttpError(
    handleEvent(eventRequest(), eventAdmin(inserted, { code: "DATABASE_ERROR" })),
    503,
    "SERVICE_UNAVAILABLE",
  );
});

Deno.test("A invalid submission token returns 401", async () => {
  const test = await context();
  await expectHttpError(
    handleFinalize({ ...test.request, submissionToken: "wrong-token" }, test.admin),
    401,
    "INVALID_PROJECT_CREDENTIALS",
  );
});

Deno.test("B/C finalize submits complete uploads and repeated finalize is idempotent", async () => {
  const files = manifest();
  const test = await context({
    objects: [[files[0].storage_path, 100], [files[1].storage_path, 200]],
  });
  const first = await handleFinalize(test.request, test.admin);
  assertEquals(asRecord(first.body).status, "SUBMITTED");
  assertEquals(test.state.project.status, "SUBMITTED");
  const listsAfterFirst = test.state.listCalls;

  const second = await handleFinalize(test.request, test.admin);
  assertEquals(asRecord(second.body).already_finalized, true);
  assertEquals(test.state.project.status, "SUBMITTED");
  assertEquals(test.state.listCalls, listsAfterFirst);
});

Deno.test("D finalize reports missing upload as recoverable", async () => {
  const files = manifest();
  const test = await context({ objects: [[files[0].storage_path, 100]] });
  const error = await expectHttpError(
    handleFinalize(test.request, test.admin),
    409,
    "UPLOAD_INCOMPLETE",
  );
  const details = asRecord(error.details);
  assertEquals(details.recoverable, true);
  assertEquals(details.missing_file_uuids, [FILE_TWO_ID]);
  assertEquals(test.state.project.status, "UPLOAD_PENDING");
});

Deno.test("E resume signs only the missing object", async () => {
  const files = manifest();
  const test = await context({ objects: [[files[0].storage_path, 100]] });
  const result = await handleResume({ ...test.request, action: "resume" }, test.admin);
  assertEquals(asRecord(result.body).missing_file_uuids, [FILE_TWO_ID]);
  assertEquals(test.state.signed, [{ path: files[1].storage_path, upsert: false }]);
  assertEquals(test.state.removed, []);
});

Deno.test("F finalize reports SIZE_MISMATCH as incomplete", async () => {
  const files = manifest();
  const test = await context({
    objects: [[files[0].storage_path, 101], [files[1].storage_path, 200]],
  });
  const error = await expectHttpError(
    handleFinalize(test.request, test.admin),
    409,
    "UPLOAD_INCOMPLETE",
  );
  const mismatches = asRecord(error.details).size_mismatches as unknown[];
  assertEquals(asRecord(mismatches[0]).file_uuid, FILE_ONE_ID);
});

Deno.test("G resume deletes only expected mismatch and signs the same path", async () => {
  const files = manifest();
  const unrelatedPath = `projects/${PROJECT_ID}/unregistered.stl`;
  const test = await context({
    objects: [
      [files[0].storage_path, 101],
      [files[1].storage_path, 200],
      [unrelatedPath, 999],
    ],
  });
  const result = await handleResume({ ...test.request, action: "resume" }, test.admin);

  assertEquals(test.state.removed, [[files[0].storage_path]]);
  assert(test.state.objects.has(unrelatedPath), "Unregistered object must not be deleted");
  assertEquals(test.state.signed, [{ path: files[0].storage_path, upsert: false }]);
  assertEquals(asRecord(result.body).recovered_size_mismatch_file_uuids, [FILE_ONE_ID]);
  const storedManifest = test.state.project.storage_manifest;
  assertEquals(storedManifest[0].upload_status, "PENDING");
  assert(!("observed_size_bytes" in storedManifest[0]));
});

Deno.test("H mismatch delete failure emits no unusable authorization", async () => {
  const files = manifest();
  const test = await context({
    objects: [[files[0].storage_path, 101], [files[1].storage_path, 200]],
    deleteFails: true,
  });
  const error = await expectHttpError(
    handleResume({ ...test.request, action: "resume" }, test.admin),
    409,
    "SIZE_MISMATCH_DELETE_FAILED",
  );
  assertEquals(asRecord(error.details).recoverable, true);
  assertEquals(test.state.signed, []);
  assertEquals(test.state.removed, [[files[0].storage_path]]);
  assert(test.state.objects.has(files[0].storage_path));
});

Deno.test("I expired retention rejects resume", async () => {
  const test = await context({ retentionExpired: true });
  await expectHttpError(
    handleResume({ ...test.request, action: "resume" }, test.admin),
    410,
    "RETENTION_EXPIRED",
  );
  assertEquals(test.state.listCalls, 0);
  assertEquals(test.state.signed, []);
});

Deno.test("J closed project actions are idempotent and never reopen", async () => {
  const test = await context({ status: "VALID" });
  const finalized = await handleFinalize(test.request, test.admin);
  const resumed = await handleResume({ ...test.request, action: "resume" }, test.admin);
  assertEquals(asRecord(finalized.body).already_finalized, true);
  assertEquals(asRecord(resumed.body).already_finalized, true);
  assertEquals(test.state.project.status, "VALID");
  assertEquals(test.state.listCalls, 0);
  assertEquals(test.state.signed, []);
  assertEquals(test.state.removed, []);
});
