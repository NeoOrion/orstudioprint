type ProjectRow = Record<string, unknown> & {
  id: string;
  project_number: number;
  status: string;
  file_delivery_mode: string;
  storage_manifest: unknown;
  file_delete_after: string;
  submission_token_hash: string;
};

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: ProjectRow;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
