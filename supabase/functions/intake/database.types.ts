type ProjectRow = Record<string, unknown> & {
  id: string;
  project_number: number;
  status: string;
  file_delivery_mode: string;
  storage_manifest: unknown;
  file_delete_after: string;
  submission_token_hash: string;
};

interface EventRow extends Record<string, unknown> {
  id: string;
  created_at: string;
  event_name: string;
  session_id: string;
  branch: string;
  route: string;
  project_id: string | null;
  source: string | null;
  campaign: string | null;
  message_variant: string | null;
}

interface EventInsert extends Record<string, unknown> {
  event_name: string;
  session_id: string;
  branch: string;
  route: string;
  project_id?: string;
  source?: string;
  campaign?: string;
  message_variant?: string;
}

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: ProjectRow;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      events: {
        Row: EventRow;
        Insert: EventInsert;
        Update: Partial<EventInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
