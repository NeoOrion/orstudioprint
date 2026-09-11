export type Branch = "FDM" | "RESIN";
export type FileDeliveryMode = "UPLOAD" | "LINK";
export type ExposureFactor =
  | "HEAT"
  | "LOAD"
  | "OUTDOOR"
  | "IMPACT_FLEX"
  | "NONE"
  | "UNKNOWN";

export interface Attribution {
  source?: string;
  campaign?: string;
  message_variant?: string;
}

export interface IntakeFormValues {
  branch: Branch;
  firstName: string;
  email: string;
  city: string;
  stateUf: string;
  cep: string;
  projectDescription: string;
  quantity: string;
  finalSize: string;
  materialPreference: string;
  finishPreference: string;
  deadlineNote: string;
  comments: string;
  intendedUse: string;
  exposureFactors: ExposureFactor[];
  scaleOrHeight: string;
  detailNotes: string;
  fileDeliveryMode: FileDeliveryMode;
  externalFileUrl: string;
  ipDeclaration: boolean;
  privacyAcknowledgement: boolean;
}

export interface ProjectPayload {
  branch: Branch;
  first_name: string;
  email: string;
  city: string;
  state_uf: string;
  project_description: string;
  quantity: number;
  final_size: string;
  file_delivery_mode: FileDeliveryMode;
  ip_declaration: true;
  privacy_acknowledgement: true;
  cep?: string;
  material_preference?: string;
  finish_preference?: string;
  deadline_note?: string;
  comments?: string;
  intended_use?: string;
  exposure_factors?: ExposureFactor[];
  scale_or_height?: string;
  detail_notes?: string;
  external_file_url?: string;
  source?: string;
  campaign?: string;
  message_variant?: string;
  session_id: string;
}

export interface FileDescriptor {
  original_name: string;
  declared_size_bytes: number;
}

export interface UploadFileDescriptor {
  file_uuid: string;
  original_name: string;
  declared_size_bytes: number;
}

export interface UploadAuthorization {
  file_uuid: string;
  storage_path: string;
  signed_url: string;
  upload_token: string;
}

export interface CreateIntakeResponse {
  project_id: string;
  project_reference: string;
  submission_token: string;
  status: string;
  upload_files?: UploadFileDescriptor[];
  uploads?: UploadAuthorization[];
  upload_authorization_incomplete?: boolean;
  authorization_missing_file_uuids?: string[];
}

export interface AuthorizedIntakeResponse {
  project_id: string;
  project_reference: string;
  status: string;
  already_finalized?: boolean;
}

export interface ResumeIntakeResponse extends AuthorizedIntakeResponse {
  missing_file_uuids?: string[];
  recovered_size_mismatch_file_uuids?: string[];
  uploads?: UploadAuthorization[];
  upload_authorization_incomplete?: boolean;
  authorization_missing_file_uuids?: string[];
}

export interface PublicApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface NamedSizedFile {
  name: string;
  size: number;
}
