export const GLOSSARY_SCHEMA_VERSION = 1 as const;

export const GLOSSARY_CATEGORIES = ["character", "location", "faction", "deity", "item", "lore", "term"] as const;
export type GlossaryCategory = typeof GLOSSARY_CATEGORIES[number];

export type GlossaryMode = "fixed" | "inflect";
export function isGlossaryMode(value: unknown): value is GlossaryMode {
  return value === "fixed" || value === "inflect";
}

export function isGlossaryCategory(value: unknown): value is GlossaryCategory {
  return GLOSSARY_CATEGORIES.includes(value as GlossaryCategory);
}

export interface GlossaryEntry {
  id?: string;
  source: string;
  replacement: string;
  category: GlossaryCategory;
  aliases: string[];
  notes?: string;
  sourceUuid?: string;
  /** Disabled entries remain stored so discovery cannot silently enable them again. */
  enabled?: boolean;
  /** Missing mode keeps legacy exact replacements. Disabled entries ignore either mode. */
  mode?: GlossaryMode;
  /** A human classification takes precedence over subsequent discovery. */
  customized?: boolean;
  /** A completed naming decision is stable until the user edits the glossary. */
  naming?: GlossaryNamingDecision;
}

export interface GlossaryNamingDecision {
  revision: 1;
  source: string;
  targetLanguage: string;
  action: "preserve" | "translate";
  confidence: "high" | "uncertain";
  reason: string;
  model: string;
  /** Local validation overrode the model; never populated from model metadata. */
  guard?: "protected-root" | "invalid-decision";
}

export function readNamingDecision(value: unknown): GlossaryNamingDecision | undefined {
  if (!value || typeof value !== "object") return undefined;
  const n = value as Partial<GlossaryNamingDecision>;
  if (n.revision !== 1 || typeof n.source !== "string" || typeof n.targetLanguage !== "string"
    || !["preserve", "translate"].includes(n.action ?? "") || !["high", "uncertain"].includes(n.confidence ?? "")
    || typeof n.reason !== "string" || typeof n.model !== "string") return undefined;
  return { revision: 1, source: n.source, targetLanguage: n.targetLanguage,
    action: n.action!, confidence: n.confidence!, reason: n.reason.slice(0, 300), model: n.model.slice(0, 160),
    ...(["protected-root", "invalid-decision"].includes(n.guard ?? "") ? { guard: n.guard! } : {}) };
}
export interface GlossaryDocumentFlag {
  schemaVersion: typeof GLOSSARY_SCHEMA_VERSION;
  source: string;
  replacement: string;
  category: GlossaryCategory;
  aliases: string[];
  notes?: string;
  sourceUuid?: string;
  enabled?: boolean;
  mode?: GlossaryMode;
  customized?: boolean;
  naming?: GlossaryNamingDecision;
}

export interface GlossaryProgress { completed: number; total: number }
export class GlossarySyncCancelledError extends Error {}
