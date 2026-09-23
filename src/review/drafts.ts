import { MODULE_ID } from "../constants";
import type { EditorialRecord, EditorialState } from "./editorial";
import type { ReviewRow, ReviewSnapshot } from "./service";
import { maskReviewReferences, type ReviewReference } from "./text-plan";
import type { UiRow, UiScope } from "./ui-catalog";
import { labelFor } from "./labels";

export interface TextDraft { text: string[]; references: ReviewReference[][] }
export function draftFor(row: Pick<ReviewRow, "translation">): TextDraft {
  const parts = row.translation.map(maskReviewReferences);
  return { text: parts.map(part => part.text), references: parts.map(part => part.references) };
}
interface DocumentDraft {
  uuid: string; sourceUuid: string; rowId: string; group: string; name: string;
  source: string; baseline: string[];
  section?: string;
}
export type DraftPayload = (DocumentDraft & (
  { kind: "text"; text: string[]; labels: string[][] } |
  { kind: "note"; baselineNote: EditorialRecord | null; state: EditorialState; note: string }
)) | { kind: "ui"; scope: UiScope; key: string; source: string; baseline: string; value: string };
export interface SavedDraft { version: 1; id: string; at: string; payload: DraftPayload }
export const draftIdentity = (draft: DraftPayload) => draft.kind === "ui" ? `ui:${draft.scope}:${draft.key}` : `${draft.kind}:${draft.uuid}:${draft.rowId}`;
export function documentDraft(snapshot: ReviewSnapshot, row: ReviewRow) {
  return { uuid: snapshot.entry.uuid, sourceUuid: snapshot.entry.sourceUuid, rowId: row.id, group: row.group, name: snapshot.entry.name,
    section: `${snapshot.groups.find(group => group.id === row.group)?.name ?? snapshot.entry.name} · ${labelFor(row.label)}`,
    source: snapshot.fields.find(field => field.id === row.fieldId)!.source, baseline: [...row.translation] };
}
export function textPayload(snapshot: ReviewSnapshot, row: ReviewRow, draft: TextDraft): DraftPayload {
  return { ...documentDraft(snapshot, row), kind: "text", text: [...draft.text], labels: draft.references.map(parts => parts.map(part => part.label)) };
}
export function uiPayload(row: UiRow, value: string): DraftPayload { return { kind: "ui", scope: row.scope, key: row.key, source: row.source, baseline: row.value, value }; }
export function recoverText(payload: Extract<DraftPayload, { kind: "text" }>): TextDraft {
  // Commands always come from the saved baseline, never from editable labels.
  const draft = draftFor({ translation: payload.baseline });
  if (draft.text.length !== payload.text.length || draft.references.some((parts, index) => parts.length !== payload.labels[index]?.length)) throw new Error("Review.DraftInvalid");
  draft.text = [...payload.text];
  draft.references.forEach((parts, index) => parts.forEach((part, n) => { if (part.editable) part.label = payload.labels[index]![n]!; }));
  return draft;
}
function valid(value: unknown): value is SavedDraft {
  if (!value || typeof value !== "object") return false;
  const record = value as SavedDraft, p = record.payload;
  const string = (v: unknown) => typeof v === "string" && v.length <= 1_000_000;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 5000 && v.every(string);
  if (record.version !== 1 || !string(record.id) || !string(record.at) || !p || !string(p.source)) return false;
  if (p.kind === "ui") return ["core", "ember", "crucible"].includes(p.scope) && string(p.key) && string(p.baseline) && string(p.value);
  if (![p.uuid, p.sourceUuid, p.rowId, p.group, p.name].every(string) || !strings(p.baseline)) return false;
  if (p.kind === "note") return ["none", "discussion", "meaning"].includes(p.state) && string(p.note) && p.note.length <= 8000;
  return p.kind === "text" && strings(p.text) && Array.isArray(p.labels) && p.labels.length === p.text.length && p.labels.every(strings);
}

/** One storage key per editor session and row: another tab cannot erase this tab's drafts. */
export class LocalReviewDrafts {
  #session = crypto.randomUUID();
  #owned = new Map<string, SavedDraft>();
  #recovered = new Map<string, SavedDraft>();
  constructor(private language: () => string, private report: (message: string) => void) {}
  #memoryScope(): string { return JSON.stringify([(game.world as { id?: string } | undefined)?.id, (game.user as { id?: string } | undefined)?.id, this.language()]) + "|"; }
  #prefix(): string {
    const world = (game.world as { id?: string } | undefined)?.id, user = (game.user as { id?: string } | undefined)?.id;
    if (!world || !user) throw new Error("Review.DraftStorageFailed");
    return `${MODULE_ID}.review-draft.${JSON.stringify([world, user, this.language()])}.`;
  }
  #remove(record: SavedDraft): void {
    const key = this.#prefix() + record.id;
    // A recovery card is a snapshot. Do not remove a version changed in another tab.
    if (localStorage.getItem(key) === JSON.stringify(record)) localStorage.removeItem(key);
  }
  write(payload: DraftPayload): void {
    const identity = this.#memoryScope() + draftIdentity(payload), previous = this.#owned.get(identity);
    const record: SavedDraft = { version: 1, id: previous?.id ?? `${this.#session}.${crypto.randomUUID()}`, at: new Date().toISOString(), payload: structuredClone(payload) };
    this.#owned.set(identity, record); // Keep an in-memory download even if storage is unavailable.
    try { localStorage.setItem(this.#prefix() + record.id, JSON.stringify(record)); }
    catch { this.report("DraftStorageFailed"); }
  }
  clear(identity: string): void {
    identity = this.#memoryScope() + identity;
    try {
      const own = this.#owned.get(identity), recovered = this.#recovered.get(identity);
      if (own) this.#remove(own);
      if (recovered) this.#remove(recovered);
      this.#owned.delete(identity); this.#recovered.delete(identity);
    } catch { this.report("DraftStorageFailed"); }
  }
  adopt(record: SavedDraft, payload: DraftPayload): void { this.#recovered.set(this.#memoryScope() + draftIdentity(payload), record); this.write(payload); }
  isActive(record: SavedDraft): boolean { return this.#owned.has(this.#memoryScope() + draftIdentity(record.payload)); }
  discard(record: SavedDraft): void {
    try { this.#remove(record); }
    catch { this.report("DraftStorageFailed"); }
  }
  list(): SavedDraft[] {
    const records = new Map<string, SavedDraft>();
    try {
      const prefix = this.#prefix();
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index); if (!key?.startsWith(prefix)) continue;
        try { const item: unknown = JSON.parse(localStorage.getItem(key) ?? "null"); if (valid(item) && key === prefix + item.id) records.set(item.id, item); else this.report("DraftInvalid"); }
        catch { this.report("DraftInvalid"); }
      }
    } catch { this.report("DraftStorageFailed"); }
    for (const [identity, item] of this.#owned) if (identity.startsWith(this.#memoryScope())) records.set(item.id, item);
    return [...records.values()].sort((a, b) => b.at.localeCompare(a.at));
  }
}
