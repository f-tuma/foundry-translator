export const GLOSSARY_SCHEMA_VERSION = 1 as const;

export const GLOSSARY_CATEGORIES = ["character", "location", "faction", "deity", "item", "lore", "term"] as const;
export type GlossaryCategory = typeof GLOSSARY_CATEGORIES[number];

export function isGlossaryCategory(value: unknown): value is GlossaryCategory {
  return GLOSSARY_CATEGORIES.includes(value as GlossaryCategory);
}

export interface GlossaryEntry {
  id?: string;
  source: string;
  replacement: string;
  category: GlossaryCategory;
  aliases: string[];
  sourceUuid?: string;
  /** Disabled entries remain stored so discovery cannot silently enable them again. */
  enabled?: boolean;
  /** A human classification takes precedence over subsequent discovery. */
  customized?: boolean;
}
export interface GlossaryDocumentFlag {
  schemaVersion: typeof GLOSSARY_SCHEMA_VERSION;
  source: string;
  replacement: string;
  category: GlossaryCategory;
  aliases: string[];
  sourceUuid?: string;
  enabled?: boolean;
  customized?: boolean;
}
