export interface ReadingPlace { uuid: string; title: string; anchor?: string | undefined; scroll: number; ratio: number; width: number }
export interface ReaderTab { id: string; history: ReadingPlace[]; cursor: number }
export interface ReaderState {
  version: 1; tabs: ReaderTab[]; active: string; bookmarks: ReadingPlace[];
  theme: "dark" | "paper" | "sepia"; fontSize: number; wide: boolean;
}
export const MAX_TABS = 8;
export const freshReaderState = (): ReaderState => ({ version: 1, tabs: [], active: "", bookmarks: [], theme: "dark", fontSize: 21, wide: false });
const finite = (value: unknown, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
function place(value: unknown): ReadingPlace | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<ReadingPlace>;
  if (typeof v.uuid !== "string" || !/^[A-Za-z0-9_.-]{1,500}$/u.test(v.uuid) || typeof v.title !== "string") return null;
  return { uuid: v.uuid, title: v.title.slice(0, 300), anchor: typeof v.anchor === "string" ? v.anchor.slice(0, 200) : undefined,
    scroll: finite(v.scroll, 1e7), ratio: finite(v.ratio, 1), width: finite(v.width, 10000) };
}
/** Store identities and reading positions only, never document prose or secrets. */
export function parseReaderState(raw: string | null): ReaderState {
  const base = freshReaderState();
  try {
    const v = JSON.parse(raw ?? "null");
    if (!v || v.version !== 1) return base;
    base.theme = ["dark", "paper", "sepia"].includes(v.theme) ? v.theme : "dark";
    base.fontSize = typeof v.fontSize === "number" && Number.isFinite(v.fontSize) ? Math.max(16, Math.min(30, v.fontSize)) : 21;
    base.wide = v.wide === true;
    for (const t of Array.isArray(v.tabs) ? v.tabs.slice(0, MAX_TABS) : []) {
      if (typeof t.id !== "string" || !/^[A-Za-z0-9-]{1,80}$/u.test(t.id) || base.tabs.some(tab => tab.id === t.id)) continue;
      const history = (Array.isArray(t.history) ? t.history.slice(-80) : []).map(place).filter((p: ReadingPlace | null): p is ReadingPlace => !!p);
      if (history.length) base.tabs.push({ id: t.id, history, cursor: Math.min(history.length - 1, Math.floor(finite(t.cursor, 79))) });
    }
    base.active = base.tabs.some(t => t.id === v.active) ? v.active : base.tabs[0]?.id ?? "";
    base.bookmarks = (Array.isArray(v.bookmarks) ? v.bookmarks.slice(0, 100) : []).map(place).filter((p: ReadingPlace | null): p is ReadingPlace => !!p);
  } catch { /* Unavailable/corrupt client storage does not prevent reading. */ }
  return base;
}
export function activeTab(state: ReaderState): ReaderTab | undefined { return state.tabs.find(t => t.id === state.active); }
export function currentPlace(state: ReaderState): ReadingPlace | undefined { const t = activeTab(state); return t?.history[t.cursor]; }
export function navigateTab(state: ReaderState, next: ReadingPlace, newTab = false): void {
  const duplicate = newTab && state.tabs.find(t => t.history[t.cursor]?.uuid === next.uuid && t.history[t.cursor]?.anchor === next.anchor);
  if (duplicate) { state.active = duplicate.id; return; }
  let tab = activeTab(state);
  if (!tab || newTab) {
    if (state.tabs.length >= MAX_TABS) throw new Error("Reader.TabLimit");
    tab = { id: crypto.randomUUID(), history: [], cursor: -1 }; state.tabs.push(tab); state.active = tab.id;
  }
  const current = tab.history[tab.cursor];
  if (current?.uuid === next.uuid && current.anchor === next.anchor) return;
  tab.history.splice(tab.cursor + 1); tab.history.push(next);
  if (tab.history.length > 80) tab.history.shift();
  tab.cursor = tab.history.length - 1;
}
export function closeReaderTab(state: ReaderState, id: string): void {
  const index = state.tabs.findIndex(t => t.id === id); if (index < 0) return;
  state.tabs.splice(index, 1);
  if (state.active === id) state.active = state.tabs[Math.min(index, state.tabs.length - 1)]?.id ?? "";
}
