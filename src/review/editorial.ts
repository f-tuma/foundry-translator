import { MODULE_ID } from "../constants";
import type { ReviewDocument, ReviewRow } from "./service";
import type { SearchIndex } from "./search";

export const EDITORIAL_SETTING = "reviewEditorial";
export type EditorialState = "none" | "discussion" | "meaning";
export interface EditorialRecord { state: EditorialState; note: string; fingerprint: string; at: string; userName: string }
export interface EditorialStore { version: 1; entries: Record<string, EditorialRecord> }
export const editorialKey = (entry: ReviewDocument, rowId: string) => JSON.stringify([entry.uuid, entry.sourceUuid, entry.language, rowId]);
export function registerEditorial(): void {
  game.settings.register(MODULE_ID, EDITORIAL_SETTING, { name: "Editorial notes", hint: "", scope: "world", config: false, type: Object, default: { version: 1, entries: {} } });
}
export function readEditorial(): EditorialStore {
  const value = game.settings?.get(MODULE_ID, EDITORIAL_SETTING) as EditorialStore | undefined;
  const entries: EditorialStore["entries"] = {};
  if (value?.version === 1 && value.entries && typeof value.entries === "object") for (const [key, entry] of Object.entries(value.entries)) {
    if (entry && ["none", "discussion", "meaning"].includes(entry.state) && typeof entry.note === "string" && typeof entry.fingerprint === "string" && typeof entry.at === "string" && typeof entry.userName === "string") entries[key] = { ...entry };
  }
  return { version: 1, entries };
}
export async function writeEditorial(entry: ReviewDocument, row: ReviewRow, expected: EditorialRecord | null, state: EditorialState, note: string): Promise<void> {
  if (!game.user?.isGM) throw new Error("Review.GMOnly");
  if (!["none", "discussion", "meaning"].includes(state) || typeof note !== "string" || note.length > 8000) throw new Error("Review.NoteInvalid");
  const current = readEditorial(), key = editorialKey(entry, row.id);
  if (JSON.stringify(current.entries[key] ?? null) !== JSON.stringify(expected)) throw new Error("Review.Conflict");
  if (state === "none" && !note.trim()) delete current.entries[key];
  else current.entries[key] = { state, note: note.trim(), fingerprint: row.fingerprint, at: new Date().toISOString(), userName: (game.user as { name?: string }).name ?? "GM" };
  if (Object.keys(current.entries).length > 20000) throw new Error("Review.NoteInvalid");
  await game.settings.set(MODULE_ID, EDITORIAL_SETTING, current);
}
export type QueueFilter = "unverified" | "discussion" | "meaning" | "notes";
export interface QueueItem { entry: ReviewDocument; row: ReviewRow; groupName: string }
export function queueItems(index: SearchIndex, filter: QueueFilter): QueueItem[] {
  const items: QueueItem[] = [];
  for (const snapshot of index.snapshots) for (const group of snapshot.groups) for (const row of snapshot.rows.filter(row => row.group === group.id)) {
    if (row.blocked) continue;
    const matches = filter === "unverified" ? !row.verified : filter === "notes" ? !!row.editorial?.note : row.editorial?.state === filter;
    if (matches) items.push({ entry: snapshot.entry, row, groupName: group.name });
  }
  return items;
}
export interface ReviewBookmark { uuid: string; sourceUuid: string; rowId: string; group: string }
function bookmarkKey(language: string): string | null {
  const world = (game.world as { id?: string } | undefined)?.id, user = (game.user as { id?: string } | undefined)?.id;
  return world && user ? `${MODULE_ID}.review-position.${JSON.stringify([world, user, language])}` : null;
}
export function readBookmark(language: string): ReviewBookmark | null {
  try {
    const key = bookmarkKey(language), value = key ? JSON.parse(localStorage.getItem(key) ?? "null") as ReviewBookmark | null : null;
    return value && [value.uuid, value.sourceUuid, value.rowId, value.group].every(v => typeof v === "string") ? value : null;
  } catch { return null; }
}
export function saveBookmark(entry: ReviewDocument, row: ReviewRow): void {
  try { const key = bookmarkKey(entry.language); if (key) localStorage.setItem(key, JSON.stringify({ uuid: entry.uuid, sourceUuid: entry.sourceUuid, rowId: row.id, group: row.group })); } catch { /* Restricted browser storage must not prevent editing. */ }
}
