import { afterEach, describe, expect, it, vi } from "vitest";
import { writeLightLibrary } from "../src/reader/light-storage";
import type { LightLibrary } from "../src/reader/light-library";

afterEach(() => vi.unstubAllGlobals());
function storage() {
  const request: any = {};
  const tx: any = { objectStore: () => ({ put: vi.fn() }), abort: vi.fn(() => tx.onabort()) };
  const connection = { close: vi.fn(), transaction: vi.fn(() => tx) };
  request.result = connection;
  vi.stubGlobal("indexedDB", { open: () => request });
  return { request, tx, connection };
}
describe("atomic local library persistence", () => {
  it("never begins a replacement after cancellation while IndexedDB is opening", async () => {
    const { request, connection } = storage(), controller = new AbortController();
    const promise = writeLightLibrary({ id: "w:u:cs" } as LightLibrary, controller.signal);
    controller.abort(); request.onsuccess(); await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(connection.transaction).not.toHaveBeenCalled(); expect(connection.close).toHaveBeenCalled();
  });
  it("aborts an in-progress transaction and reports cancellation", async () => {
    const { request, tx } = storage(), controller = new AbortController();
    const promise = writeLightLibrary({ id: "w:u:cs" } as LightLibrary, controller.signal);
    request.onsuccess(); await vi.waitFor(() => expect(tx.onabort).toBeTypeOf("function")); controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" }); expect(tx.abort).toHaveBeenCalledOnce();
  });
  it("waits for commit rather than reporting success from an uncommitted put", async () => {
    const { request, tx, connection } = storage(); let complete = false;
    const promise = writeLightLibrary({ id: "w:u:cs" } as LightLibrary).then(() => { complete = true; });
    request.onsuccess(); await vi.waitFor(() => expect(tx.oncomplete).toBeTypeOf("function")); expect(complete).toBe(false);
    tx.oncomplete(); await promise; expect(complete).toBe(true); expect(connection.close).toHaveBeenCalled();
  });
});
