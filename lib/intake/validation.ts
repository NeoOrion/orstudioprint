import type {
  Attribution,
  ExposureFactor,
  FileDescriptor,
  IntakeFormValues,
  NamedSizedFile,
  ProjectPayload,
} from "./types";

export const MAX_FILE_COUNT = 5;
export const MAX_FILE_SIZE_BYTES = 52_428_800;
export const MAX_PROJECT_SIZE_BYTES = 50_000_000;
export const ALLOWED_EXTENSIONS = new Set(["stl", "3mf", "obj", "step", "stp"]);
export const EXPOSURE_FACTORS = new Set<ExposureFactor>([
  "HEAT",
  "LOAD",
  "OUTDOOR",
  "IMPACT_FLEX",
  "NONE",
  "UNKNOWN",
]);

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function extensionOf(name: string): string {
  const index = name.trim().lastIndexOf(".");
  return index > 0 ? name.trim().slice(index + 1).toLowerCase() : "";
}

export function validateFiles(files: readonly NamedSizedFile[]): string[] {
  const errors: string[] = [];
  if (files.length < 1) errors.push("Selecione pelo menos um arquivo.");
  if (files.length > MAX_FILE_COUNT) errors.push("Selecione no máximo 5 arquivos.");
  let combinedSize = 0;
  const combinedTooLarge = files.reduce((total, file) => total + file.size, 0) > MAX_PROJECT_SIZE_BYTES;
  for (const file of files) {
    if (!ALLOWED_EXTENSIONS.has(extensionOf(file.name))) {
      errors.push(`O arquivo "${file.name}" usa uma extensão não permitida.`);
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      errors.push(`O arquivo "${file.name}" está vazio ou possui tamanho inválido.`);
    } else if (file.size > MAX_FILE_SIZE_BYTES && !combinedTooLarge) {
      errors.push(`O arquivo "${file.name}" excede o limite técnico por arquivo.`);
    }
    combinedSize += file.size;
  }
  if (combinedSize > MAX_PROJECT_SIZE_BYTES) {
    errors.push("Os arquivos excedem 50 MB no total. Use um link compartilhado.");
  }
  return errors;
}

export function appendFiles<T extends NamedSizedFile>(current: readonly T[], added: readonly T[]): T[] {
  return [...current, ...added];
}

export function removeFileAt<T>(files: readonly T[], index: number): T[] {
  return files.filter((_, currentIndex) => currentIndex !== index);
}

export function formatFileSize(bytes: number): string {
  return `${(bytes / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

export function validateExposureFactors(factors: readonly string[]): string[] {
  if (new Set(factors).size !== factors.length) {
    return ["Os fatores de exposição não podem ser repetidos."];
  }
  if (factors.some((factor) => !EXPOSURE_FACTORS.has(factor as ExposureFactor))) {
    return ["Existe um fator de exposição inválido."];
  }
  if (factors.length > 1 && (factors.includes("NONE") || factors.includes("UNKNOWN"))) {
    return ["“Nenhum destes” e “Não sei” devem ser selecionados isoladamente."];
  }
  return [];
}

export function toggleExposureFactor(
  current: readonly ExposureFactor[],
  factor: ExposureFactor,
): ExposureFactor[] {
  if (current.includes(factor)) return current.filter((item) => item !== factor);
  if (factor === "NONE" || factor === "UNKNOWN") return [factor];
  return [...current.filter((item) => item !== "NONE" && item !== "UNKNOWN"), factor];
}

export function validateExternalUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    return parsed.protocol === "https:" || (parsed.protocol === "http:" && isLocalhost);
  } catch {
    return false;
  }
}

export function validateForm(
  values: IntakeFormValues,
  files: readonly NamedSizedFile[],
): string[] {
  const errors: string[] = [];
  if (!values.firstName.trim()) errors.push("Informe seu nome.");
  if (!/^\S+@\S+\.\S+$/.test(values.email.trim())) errors.push("Informe um e-mail válido.");
  if (!values.city.trim()) errors.push("Informe sua cidade.");
  if (!/^[A-Za-z]{2}$/.test(values.stateUf.trim())) errors.push("Informe a UF com duas letras.");
  if (!values.projectDescription.trim()) errors.push("Descreva o projeto.");
  if (!Number.isSafeInteger(Number(values.quantity)) || Number(values.quantity) <= 0) {
    errors.push("Informe uma quantidade válida.");
  }
  if (!values.finalSize.trim()) errors.push("Informe o tamanho final ou escala.");
  if (!values.ipDeclaration || !values.privacyAcknowledgement) {
    errors.push("Confirme as duas declarações obrigatórias.");
  }
  if (values.branch === "FDM" && !values.intendedUse.trim()) {
    errors.push("Informe o uso pretendido para o projeto FDM.");
  }
  errors.push(...validateExposureFactors(values.exposureFactors));
  if (values.fileDeliveryMode === "UPLOAD") {
    errors.push(...validateFiles(files));
  } else if (!validateExternalUrl(values.externalFileUrl.trim())) {
    errors.push("Informe um link HTTPS válido e acessível.");
  }
  return errors;
}

export function fileDescriptors(files: readonly NamedSizedFile[]): FileDescriptor[] {
  return files.map((file) => ({
    original_name: file.name,
    declared_size_bytes: file.size,
  }));
}

export function mapFormToProjectPayload(
  values: IntakeFormValues,
  attribution: Attribution,
  sessionId: string,
): ProjectPayload {
  const payload: ProjectPayload = {
    branch: values.branch,
    first_name: values.firstName.trim(),
    email: values.email.trim().toLowerCase(),
    city: values.city.trim(),
    state_uf: values.stateUf.trim().toUpperCase(),
    project_description: values.projectDescription.trim(),
    quantity: Number(values.quantity),
    final_size: values.finalSize.trim(),
    file_delivery_mode: values.fileDeliveryMode,
    ip_declaration: true,
    privacy_acknowledgement: true,
    session_id: sessionId,
  };

  const optionalFields = {
    cep: optional(values.cep),
    material_preference: optional(values.materialPreference),
    finish_preference: optional(values.finishPreference),
    deadline_note: optional(values.deadlineNote),
    comments: optional(values.comments),
    source: attribution.source,
    campaign: attribution.campaign,
    message_variant: attribution.message_variant,
  };
  Object.assign(
    payload,
    Object.fromEntries(Object.entries(optionalFields).filter(([, value]) => value !== undefined)),
  );

  if (values.branch === "FDM") {
    payload.intended_use = values.intendedUse.trim();
    if (values.exposureFactors.length > 0) payload.exposure_factors = [...values.exposureFactors];
  } else {
    const scaleOrHeight = optional(values.scaleOrHeight);
    const detailNotes = optional(values.detailNotes);
    if (scaleOrHeight) payload.scale_or_height = scaleOrHeight;
    if (detailNotes) payload.detail_notes = detailNotes;
  }
  if (values.fileDeliveryMode === "LINK") {
    payload.external_file_url = values.externalFileUrl.trim();
  }
  return payload;
}

function queryValue(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value ? value.slice(0, 200) : undefined;
}

export function extractAttribution(search: string): Attribution {
  const params = new URLSearchParams(search);
  return {
    source: queryValue(params, "src"),
    campaign: queryValue(params, "cmp"),
    message_variant: queryValue(params, "msg"),
  };
}

export function canStartCreate(requestActive: boolean, hasPendingSession: boolean): boolean {
  return !requestActive && !hasPendingSession;
}
