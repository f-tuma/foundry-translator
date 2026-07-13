export const GLOSSARY_SCHEMA_VERSION = 1 as const;

export type GlossaryCategory = "character" | "location" | "term";

export interface GlossaryEntry {
  id?: string;
  source: string;
  replacement: string;
  category: GlossaryCategory;
  aliases: string[];
  sourceUuid?: string;
}
export interface GlossaryDocumentFlag {
  schemaVersion: typeof GLOSSARY_SCHEMA_VERSION;
  source: string;
  replacement: string;
  category: GlossaryCategory;
  aliases: string[];
  sourceUuid?: string;
}
