import type { ReaderContent, ReaderChapter } from "./content";

export interface LightDocument {
  uuid: string; title: string; book: string; kind: string; html: string;
  subtitle?: string | undefined; pronunciation?: string | undefined;
  chapters: ReaderChapter[]; aliases: string[];
}
export interface LightLibrary {
  version: 1; id: string; worldId: string; worldName: string; userId: string;
  userName: string; language: string; createdAt: string; roots: string[];
  startUuid: string; documents: LightDocument[]; warnings: string[];
}
export type LightScope = Pick<LightLibrary, "id" | "worldId" | "worldName" | "userId" | "userName" | "language" | "roots">;
interface Dependencies {
  load(uuid: string): Promise<ReaderContent>;
  sanitize(html: string): string;
  progress?(done: number, pending: number): void;
  signal?: AbortSignal; maxDocuments?: number; maxBytes?: number;
}
export const validLightUuid = (uuid: string) => /^[A-Za-z0-9_.-]{1,500}$/u.test(uuid);
const bare = (uuid: string) => uuid.split("#")[0]!;
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); };

/** Build entirely in memory. A caller commits only a finished snapshot. Every
 * record is freshly permission-checked by load; never merge old cached prose. */
export async function buildLightLibrary(scope: LightScope, deps: Dependencies): Promise<LightLibrary> {
  const roots = [...new Set(scope.roots.map(bare))];
  if (!roots.length || roots.length > 100 || roots.some(uuid => !validLightUuid(uuid))) throw new Error("Reader.LightInvalidRoots");
  const maxDocuments = deps.maxDocuments ?? 5000, maxBytes = deps.maxBytes ?? 64 * 1024 * 1024;
  const records = new Map<string, LightDocument>(), aliases = new Map<string, string>();
  const queued = new Set<string>(), queue: string[] = [], warnings: string[] = [];
  const enqueue = (uuid: string) => {
    const id = bare(uuid);
    if (!validLightUuid(id) || queued.has(id)) return;
    if (queued.size >= maxDocuments) throw new Error("Reader.LightTooLarge");
    queued.add(id); queue.push(id);
  };
  roots.forEach(enqueue);
  let bytes = 0, startUuid = "";
  for (let cursor = 0; cursor < queue.length; cursor++) {
    checkAbort(deps.signal);
    const requested = queue[cursor]!;
    let content: ReaderContent;
    try { content = await deps.load(requested); }
    catch (error) {
      checkAbort(deps.signal);
      if (roots.includes(requested)) throw error; // Do not publish an empty replacement for a failed book.
      warnings.push(requested); deps.progress?.(cursor + 1, queue.length - cursor - 1); continue;
    }
    checkAbort(deps.signal);
    if (!validLightUuid(content.uuid)) throw new Error("Reader.LightInvalidDocument");
    if (!startUuid) startUuid = content.uuid;
    aliases.set(requested, content.uuid);
    // Only explicitly selected books expand to all their permitted chapters.
    if (roots.includes(requested)) content.chapters.forEach(chapter => enqueue(chapter.uuid));
    const existing = records.get(content.uuid);
    if (existing) { if (!existing.aliases.includes(requested)) existing.aliases.push(requested); continue; }
    const node = document.createElement("div"); node.innerHTML = deps.sanitize(content.html);
    for (const link of node.querySelectorAll<HTMLAnchorElement>("a[data-uuid],a[data-reader-uuid]")) {
      const uuid = link.dataset.uuid ?? link.dataset.readerUuid ?? "";
      if (!validLightUuid(bare(uuid))) { link.removeAttribute("href"); link.removeAttribute("data-uuid"); link.removeAttribute("data-reader-uuid"); continue; }
      const hash = link.dataset.hash ?? uuid.split("#").slice(1).join("#");
      link.dataset.readerUuid = bare(uuid) + (hash ? `#${hash}` : "");
      link.removeAttribute("data-uuid"); link.removeAttribute("data-hash");
      link.removeAttribute("href"); enqueue(uuid);
    }
    const record: LightDocument = {
      uuid: content.uuid, title: content.title, book: content.book, kind: content.kind,
      html: node.innerHTML, subtitle: content.subtitle, pronunciation: content.pronunciation,
      chapters: content.chapters.map(c => ({ uuid: c.uuid, name: c.name, category: c.category, level: c.level })),
      aliases: [...new Set([requested, content.uuid])],
    };
    bytes += new TextEncoder().encode(JSON.stringify(record)).length;
    if (bytes > maxBytes) throw new Error("Reader.LightTooLarge");
    records.set(content.uuid, record); deps.progress?.(cursor + 1, queue.length - cursor - 1);
    // Sheet enrichment can complete synchronously; let progress/cancel paint.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  checkAbort(deps.signal);
  for (const record of records.values()) {
    const node = document.createElement("div"); node.innerHTML = record.html;
    for (const link of node.querySelectorAll<HTMLElement>("[data-reader-uuid]")) {
      const value = link.dataset.readerUuid!, target = aliases.get(bare(value));
      if (target) link.dataset.readerUuid = target + (value.includes("#") ? value.slice(value.indexOf("#")) : "");
    }
    record.html = node.innerHTML;
  }
  const library: LightLibrary = { ...scope, roots, version: 1, createdAt: new Date().toISOString(), startUuid,
    documents: [...records.values()], warnings: [...new Set(warnings)] };
  if (new TextEncoder().encode(JSON.stringify(library)).length > maxBytes) throw new Error("Reader.LightTooLarge");
  return library;
}
