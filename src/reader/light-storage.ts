import type { LightLibrary } from "./light-library";
const DATABASE = "foundry-translate-light-reader-v1";
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("libraries")) request.result.createObjectStore("libraries", { keyPath: "id" }); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Reader.LightStorageBlocked"));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
export async function readLightLibrary(id: string): Promise<LightLibrary | undefined> {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction("libraries", "readonly").objectStore("libraries").get(id);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
/** Resolve on transaction commit, not request success. A quota/cancel failure
 * retains the previous snapshot, including when replacing an existing key. */
export async function writeLightLibrary(library: LightLibrary, signal?: AbortSignal): Promise<void> {
  const db = await open();
  try { await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const tx = db.transaction("libraries", "readwrite");
    const abort = () => { try { tx.abort(); } catch { /* A completed transaction is already atomic. */ } };
    const cleanup = () => signal?.removeEventListener("abort", abort);
    signal?.addEventListener("abort", abort, { once: true });
    tx.oncomplete = () => { cleanup(); resolve(); };
    tx.onabort = () => { cleanup(); reject(signal?.aborted ? new DOMException("Aborted", "AbortError") : tx.error ?? new Error("Reader.LightStorageFailed")); };
    tx.onerror = () => { cleanup(); reject(tx.error); }; tx.objectStore("libraries").put(library);
  });
    // Chooser labels need no other account's story HTML. Optional, tiny metadata
    // is written only after the snapshot commits, and safely falls back to keys.
    try { localStorage.setItem(`foundry-translate-light-reader-meta:${library.id}`, JSON.stringify({ worldName: library.worldName,
      userName: library.userName, language: library.language, createdAt: library.createdAt })); } catch { /* The library remains usable. */ }
  } finally { db.close(); }
}
