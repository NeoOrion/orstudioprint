import type {
  AuthorizedIntakeResponse,
  CreateIntakeResponse,
  ExperimentEvent,
  FileDescriptor,
  ProjectPayload,
  PublicApiError,
  ResumeIntakeResponse,
} from "./types";

export class IntakeClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "IntakeClientError";
  }
}

function configuration(): { endpoint: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new IntakeClientError(
      "CLIENT_CONFIGURATION_ERROR",
      "O formulário ainda não está configurado para envio.",
    );
  }
  return {
    endpoint: `${url}/functions/v1/intake`,
    publishableKey,
  };
}

function isPublicApiError(value: unknown): value is PublicApiError {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "object" && error !== null && !Array.isArray(error) &&
    typeof (error as Record<string, unknown>).code === "string" &&
    typeof (error as Record<string, unknown>).message === "string";
}

async function postIntake<T>(payload: unknown): Promise<T> {
  const { endpoint, publishableKey } = configuration();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishableKey,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    throw new IntakeClientError("NETWORK_ERROR", "Não foi possível acessar o serviço de envio.");
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new IntakeClientError("INVALID_RESPONSE", "O serviço retornou uma resposta inválida.");
  }
  if (!response.ok || isPublicApiError(result)) {
    if (isPublicApiError(result)) {
      throw new IntakeClientError(result.error.code, result.error.message, result.error.details);
    }
    throw new IntakeClientError("REQUEST_FAILED", "Não foi possível concluir a solicitação.");
  }
  return result as T;
}

export function createIntake(
  turnstileToken: string,
  project: ProjectPayload,
  files: readonly FileDescriptor[],
): Promise<CreateIntakeResponse> {
  return postIntake<CreateIntakeResponse>(buildCreateRequest(turnstileToken, project, files));
}

export function buildCreateRequest(
  turnstileToken: string,
  project: ProjectPayload,
  files: readonly FileDescriptor[],
) {
  return {
    action: "create",
    turnstileToken,
    project,
    files: project.file_delivery_mode === "UPLOAD" ? files : [],
  } as const;
}

export function finalizeIntake(
  projectId: string,
  submissionToken: string,
): Promise<AuthorizedIntakeResponse> {
  return postIntake<AuthorizedIntakeResponse>({
    action: "finalize",
    projectId,
    submissionToken,
  });
}

export function resumeIntake(
  projectId: string,
  submissionToken: string,
): Promise<ResumeIntakeResponse> {
  return postIntake<ResumeIntakeResponse>({
    action: "resume",
    projectId,
    submissionToken,
  });
}

export function sendExperimentEvent(event: ExperimentEvent): Promise<unknown> {
  return postIntake({ action: "event", event });
}

export function sendExperimentEventBestEffort(event: ExperimentEvent): void {
  void sendExperimentEvent(event).catch(() => undefined);
}
