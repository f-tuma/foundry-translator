import { MAX_BUNDLE_BYTES, parseTranslationBundle, type TranslationBundle } from "../bundles/format";
import type { EditorialState } from "./editorial";
import type { UiOverride } from "./ui-catalog";

export const PROJECT_FORMAT = "foundry-translate-editorial";
export const MAX_PROJECT_BYTES = 2 * MAX_BUNDLE_BYTES;
export interface PortableReviewMetadata {
  rowId: string; binding: string;
  protected?: boolean;
  proof?: { at: string; userName: string };
  editorial?: { state: EditorialState; note: string; stale: boolean; at: string; userName: string };
}
export interface EditorialProject {
  format: typeof PROJECT_FORMAT; version: 1; bundle: TranslationBundle;
  reviews: { sourceUuid: string; rows: PortableReviewMetadata[] }[];
  ui: UiOverride[];
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 500): v is string => typeof v === "string" && v.length <= max;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const date = (v: unknown): v is string => text(v, 40) && Number.isFinite(Date.parse(v));
function requireValue(value: unknown): asserts value { if (!value) throw new Error("Review.ProjectInvalid"); }
export function parseEditorialProject(json: string): EditorialProject {
  requireValue(new TextEncoder().encode(json).length <= MAX_PROJECT_BYTES);
  const value: unknown = JSON.parse(json);
  requireValue(record(value) && value.format === PROJECT_FORMAT && value.version === 1);
  const bundle = parseTranslationBundle(JSON.stringify(value.bundle));
  requireValue(Array.isArray(value.reviews) && value.reviews.length <= bundle.documents.length);
  const sources = new Set(bundle.documents.map(doc => doc.sourceUuid)), seen = new Set<string>(); let rowCount = 0;
  const reviews = value.reviews.map(item => {
    requireValue(record(item) && text(item.sourceUuid) && sources.has(item.sourceUuid) && !seen.has(item.sourceUuid)); seen.add(item.sourceUuid);
    requireValue(Array.isArray(item.rows) && (rowCount += item.rows.length) <= 100000);
    const ids = new Set<string>();
    const rows = item.rows.map((raw): PortableReviewMetadata => {
      requireValue(record(raw) && hash(raw.rowId) && hash(raw.binding) && !ids.has(raw.rowId)); ids.add(raw.rowId);
      const row: PortableReviewMetadata = { rowId: raw.rowId, binding: raw.binding };
      requireValue(raw.protected === undefined || typeof raw.protected === "boolean"); if (raw.protected) row.protected = true;
      if (raw.proof !== undefined) { requireValue(record(raw.proof) && date(raw.proof.at) && text(raw.proof.userName)); row.proof = { at: raw.proof.at, userName: raw.proof.userName }; }
      if (raw.editorial !== undefined) {
        const note = raw.editorial;
        requireValue(record(note) && ["none", "meaning", "discussion"].includes(String(note.state)) && text(note.note, 8000) && typeof note.stale === "boolean" && date(note.at) && text(note.userName));
        row.editorial = { state: note.state as EditorialState, note: note.note, stale: note.stale, at: note.at, userName: note.userName };
      }
      return row;
    });
    return { sourceUuid: item.sourceUuid, rows };
  });
  requireValue(Array.isArray(value.ui) && value.ui.length <= 20000);
  const uiIds = new Set<string>();
  const ui = value.ui.map((raw): UiOverride => {
    requireValue(record(raw) && ["core", "ember", "crucible"].includes(String(raw.scope)) && text(raw.key) && raw.key.length > 0 && !raw.key.split(".").some(p => ["__proto__", "constructor", "prototype"].includes(p)));
    requireValue(text(raw.source, 100000) && text(raw.base, 100000) && text(raw.value, 100000) && date(raw.at) && text(raw.userName));
    const id = `${raw.scope}:${raw.key}`; requireValue(!uiIds.has(id)); uiIds.add(id);
    requireValue(raw.verified === undefined || hash(raw.verified));
    return { scope: raw.scope as UiOverride["scope"], key: raw.key, source: raw.source, base: raw.base, value: raw.value, at: raw.at, userName: raw.userName, ...(raw.verified ? { verified: raw.verified as string } : {}) };
  });
  return { format: PROJECT_FORMAT, version: 1, bundle, reviews, ui };
}
