export type Branch = "FDM" | "RESIN";
export type FileDeliveryMode = "UPLOAD" | "LINK";
export type ExposureFactor = "HEAT" | "LOAD" | "OUTDOOR" | "IMPACT_FLEX" | "NONE" | "UNKNOWN";

export interface ProjectInput {
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
  session_id?: string;
}

export interface FileDescriptor {
  original_name: string;
  declared_size_bytes: number;
}

export interface StorageManifestEntry extends FileDescriptor {
  file_uuid: string;
  extension: string;
  storage_path: string;
  upload_status: "PENDING" | "UPLOADED" | "SIZE_MISMATCH";
  observed_size_bytes?: number;
}

export interface CreateRequest {
  action: "create";
  turnstileToken: string;
  project: ProjectInput;
  files: FileDescriptor[];
}

export interface AuthorizedProjectRequest {
  action: "finalize" | "resume";
  projectId: string;
  submissionToken: string;
}

export type IntakeRequest = CreateRequest | AuthorizedProjectRequest;

export interface UploadAuthorization {
  file_uuid: string;
  storage_path: string;
  signed_url: string;
  upload_token: string;
}
