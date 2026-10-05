import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
const mock = vi.hoisted(() => ({ collect: vi.fn(), plan: vi.fn(), check: vi.fn(), source: vi.fn(), run: vi.fn(), active: vi.fn(), progress: undefined as any }));
vi.mock("../src/translation/ember-creation-items", () => ({ MAX_CREATION_ITEMS: 256, collectEmberCreationItems: mock.collect,
  planMissingCreationItems: mock.plan, creationRuntimeGuard: () => mock.check, creationSourceGuard: async () => mock.source }));
vi.mock("../src/settings/settings", () => ({ getTranslatorSettings: () => ({ targetLanguage: "cs" }) }));
vi.mock("../src/translation/active-translations-app", () => ({ openActiveTranslationsOverview: mock.active }));
vi.mock("../src/translation/journal-service", () => ({ JournalTranslationService: class {
  constructor(options: any) { mock.progress = options.onProgress; } translateMissingItems = mock.run;
}, TranslationCancelledError: class extends Error {} }));
let sources: any[];
beforeEach(() => {
  vi.resetModules();
  const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
  vi.stubGlobal("foundry", { applications: { api: { ApplicationV2: class {
    element: HTMLElement | null = null;
    async render() {
      this.element ??= document.createElement("section"); document.body.append(this.element);
      const app = this as any; app._replaceHTML(await app._renderHTML(), this.element); await app._onRender(); return this;
    }
    async close() { this.element?.remove(); this.element = null; }
  } } } });
  vi.stubGlobal("game", { i18n: { localize: (key: string) => ({
    "FOUNDRY_TRANSLATE.CreationItems.Plan": "Missing {missing}, keep {existing}",
    "FOUNDRY_TRANSLATE.CreationItems.Done": "Created {created}, kept {existing}",
  }[key] ?? key) } });
  vi.stubGlobal("ui", { notifications: { info: vi.fn(), warn: vi.fn() } });
  sources = [{ uuid: "Compendium.ember.crucible-character.Item.a" }];
  mock.collect.mockReset().mockResolvedValue(sources);
  mock.plan.mockReset().mockResolvedValue({ sources, missing: sources, existing: 12 });
  mock.check.mockReset(); mock.source.mockReset().mockResolvedValue(undefined); mock.run.mockReset().mockResolvedValue({ createdDocuments: 1, skippedDocuments: 12, fallbackTextSegments: 0 }); mock.active.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function app() { const { CreationItemsApplication } = await import("../src/translation/creation-items-app"); const application = new CreationItemsApplication(); await application.render(true); return application; }
describe("creation translation plan window", () => {
  it("shows the missing/existing counts before start and runs only after the user clicks", async () => {
    const application = await app();
    expect(application.element.textContent).toContain("Missing 1, keep 12"); expect(mock.run).not.toHaveBeenCalled();
    application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.click();
    await vi.waitFor(() => expect(mock.run).toHaveBeenCalledWith(sources));
    await vi.waitFor(() => expect(application.element.textContent).toContain("Created 1, kept 12"));
    expect(mock.source).toHaveBeenCalledOnce(); expect(mock.active).toHaveBeenCalledOnce();
  });
  it("disables start when the plan has no missing copies", async () => {
    mock.plan.mockResolvedValue({ sources, missing: [], existing: 13 }); const application = await app();
    expect(application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.disabled).toBe(true); expect(mock.run).not.toHaveBeenCalled();
  });
  it("shows a failed plan without starting a provider", async () => {
    mock.collect.mockRejectedValue(new Error("Ambiguous source")); const application = await app();
    expect(application.element.textContent).toContain("Ambiguous source"); expect(application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.disabled).toBe(true); expect(mock.run).not.toHaveBeenCalled();
  });
  it("rejects stale preview state before calling the service", async () => {
    const application = await app(); mock.source.mockRejectedValue(new Error("Source changed"));
    application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.click();
    await vi.waitFor(() => expect(application.element.textContent).toContain("Source changed")); expect(mock.run).not.toHaveBeenCalled();
  });
  it("rejects a changed native option selection instead of silently extending the preview", async () => {
    const application = await app();
    mock.collect.mockResolvedValue([...sources, { uuid: "Compendium.ember.crucible-character.Item.new" }]);
    application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.click();
    await vi.waitFor(() => expect(application.element.textContent).toContain("SourceChanged")); expect(mock.run).not.toHaveBeenCalled();
  });
  it("finishes safely after closing without changing detached UI or reopening it", async () => {
    let finish!: (result: any) => void; mock.run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const application = await app(); application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.click();
    await vi.waitFor(() => expect(mock.run).toHaveBeenCalledOnce());
    const root = application.element, text = root.textContent; await application.close();
    expect(() => mock.progress({ pageName: "Late paragraph" })).not.toThrow();
    finish({ createdDocuments: 1, skippedDocuments: 12, fallbackTextSegments: 0 });
    await vi.waitFor(() => expect(ui.notifications.info).toHaveBeenCalledOnce());
    expect(root.textContent).toBe(text); expect(application.element).toBeNull();
  });
});
