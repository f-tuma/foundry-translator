export type Role = "admin" | "reviewer" | "translator";
export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface Unit {
  id: string;
  document_id: string | null;
  kind: "document" | "glossary";
  field_index: number;
  unit_key: string;
  label: string;
  position: number;
  source: string[];
  value: string[];
  revision: string;
  approval: { at: string; userName: string } | null;
  document_title?: string;
}
export interface Change {
  unitId: string;
  baseRevision: string;
  before: string[];
  after: string[];
}
export interface Proposal {
  id: string;
  title: string;
  author_id: string;
  author_name: string;
  status: "draft" | "submitted" | "approved" | "merged" | "rejected";
  revision: number;
  changes: Change[];
  approval: {
    revision: number;
    userId: string;
    userName: string;
    at: string;
  } | null;
  created_at: string;
  updated_at: string;
}
export interface Doc {
  id: string;
  title: string;
  source_uuid: string;
  units: number;
  reviewed: number;
}
export interface Release {
  id: string;
  title: string;
  notes: string;
  content_hash: string;
  document_count: number;
  reviewed_count: number;
  unit_count: number;
  created_at: string;
}
