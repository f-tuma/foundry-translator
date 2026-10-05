import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranslationBundle } from "../src/bundles/format";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture() {
  vi.resetModules();
  const { document, Event } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });
  vi.stubGlobal("foundry", { applications: { api: { ApplicationV2: class {
    element: HTMLElement | null = null;
    async render() {
      this.element ??= document.createElement("section");
      document.body.append(this.element);
      const self = this as any;
      self._replaceHTML(await self._renderHTML(), this.element);
      await self._onRender();
      return this;
    }
    async close() { this.element?.remove(); this.element = null; return this; }
  } } } });
  const createObjectURL = vi.fn(() => "blob:bundle");
  vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const settings = await import("../src/settings/settings");
  vi.spyOn(settings, "getTranslatorSettings").mockReturnValue({ targetLanguage: "cs" } as ReturnType<typeof settings.getTranslatorSettings>);
  const service = await import("../src/bundles/service");
  const format = await import("../src/bundles/format");
  const bundle: TranslationBundle = { format: "foundry-translate-bundle", version: 3,
    createdAt: "2026-10-05T00:00:00.000Z", moduleVersion: "0.34.5", systemId: "ember", systemVersion: "1",
    targetLanguage: "cs", documents: [], glossary: [] };
  const plan = { bundle, rows: [], glossary: [{}], glossaryConflicts: [] } as any;
  vi.spyOn(format, "parseTranslationBundle").mockReturnValue(bundle);
  const planImport = vi.spyOn(service, "planBundleImport").mockResolvedValue(plan);
  const exporting = deferred<any>(), importing = deferred<any>();
  let exportProgress!: (message: string) => void, importProgress!: (message: string) => void;
  const exportRun = vi.spyOn(service, "exportTranslationBundle").mockImplementation(async (_language, progress) => { exportProgress = progress!; return exporting.promise; });
  const importRun = vi.spyOn(service, "importTranslationBundle").mockImplementation(async (_plan, progress) => { importProgress = progress!; return importing.promise; });
  const { BundleApplication } = await import("../src/bundles/bundle-app");
  const app = new BundleApplication(); await app.render({ force: true });
  const root = () => app.element as HTMLElement;
  const click = (name: string) => root().querySelector<HTMLButtonElement>(`[data-bundle-${name}]`)!.click();
  const choose = async () => {
    const input = root().querySelector<HTMLInputElement>("[data-bundle-file]")!;
    Object.defineProperty(input, "files", { value: [{ name: "test.json", size: 2, text: async () => "{}" }] });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(root().querySelector<HTMLButtonElement>("[data-bundle-import]")?.disabled).toBe(false));
  };
  return { app, root, click, choose, bundle, exporting, importing, exportRun, importRun, planImport, createObjectURL, exportProgress: () => exportProgress, importProgress: () => importProgress };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("bundle transfer window lifecycle", () => {
  it("finishes an export after closing without touching detached UI and releases the busy state", async () => {
    const f = await fixture(); f.click("export");
    await vi.waitFor(() => expect(f.exportRun).toHaveBeenCalledOnce());
    const oldRoot = f.root(), oldText = oldRoot.textContent;
    await f.app.close();
    expect(() => f.exportProgress()("Late export progress")).not.toThrow();
    f.exporting.resolve({ bundle: f.bundle, skipped: ["late warning"] });
    await vi.waitFor(() => expect(f.createObjectURL).toHaveBeenCalledOnce());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.app.element).toBeNull(); expect(oldRoot.textContent).toBe(oldText);
    await f.app.render({ force: true });
    expect(f.root().querySelector<HTMLButtonElement>("[data-bundle-export]")!.disabled).toBe(false);
    f.exportRun.mockResolvedValue({ bundle: f.bundle, skipped: [] }); f.click("export");
    await vi.waitFor(() => expect(f.createObjectURL).toHaveBeenCalledTimes(2));
  });

  it("handles a failed export after closing and permits another attempt", async () => {
    const f = await fixture(); f.click("export");
    await vi.waitFor(() => expect(f.exportRun).toHaveBeenCalledOnce());
    await f.app.close(); f.exporting.reject(new Error("Export failed"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.app.element).toBeNull(); expect(f.createObjectURL).not.toHaveBeenCalled();
    await f.app.render({ force: true });
    expect(f.root().querySelector<HTMLButtonElement>("[data-bundle-export]")!.disabled).toBe(false);
  });

  it("completes an import and refreshes its plan without reopening a dismissed window", async () => {
    const f = await fixture(); await f.choose(); f.click("import");
    await vi.waitFor(() => expect(f.importRun).toHaveBeenCalledOnce());
    await f.app.close(); const render = vi.spyOn(f.app, "render");
    expect(() => f.importProgress()("Late import progress")).not.toThrow();
    f.importing.resolve({ imported: 1, skipped: 0, glossaryAdded: 0, issues: ["late issue"] });
    await vi.waitFor(() => expect(f.planImport).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(render).not.toHaveBeenCalled(); expect(f.app.element).toBeNull();
    await f.app.render({ force: true });
    expect(f.root().querySelector<HTMLButtonElement>("[data-bundle-import]")!.disabled).toBe(false);
  });
});
