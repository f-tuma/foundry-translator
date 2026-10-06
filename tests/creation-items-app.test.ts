import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
const mock = vi.hoisted(() => ({ collect: vi.fn(), equipment: vi.fn(), runtime: vi.fn(), plan: vi.fn(), check: vi.fn(), source: vi.fn(), run: vi.fn(), active: vi.fn(), affixPlan: vi.fn(), affixGuard: vi.fn(), affixRun: vi.fn(), progress: undefined as any }));
vi.mock("../src/translation/ember-creation-items", () => ({ MAX_CREATION_ITEMS: 256, collectEmberCreationItems: mock.collect, collectCrucibleCreationEquipment: mock.equipment,
  planMissingCreationItems: mock.plan, creationRuntimeGuard: mock.runtime, creationSourceGuard: async () => mock.source }));
vi.mock("../src/translation/equipment-affixes", () => ({ planMissingEquipmentAffixes: mock.affixPlan, equipmentAffixSourceGuard: async () => mock.affixGuard }));
vi.mock("../src/settings/settings", () => ({ getTranslatorSettings: () => ({ targetLanguage: "cs" }) }));
vi.mock("../src/translation/active-translations-app", () => ({ openActiveTranslationsOverview: mock.active }));
vi.mock("../src/translation/journal-service", () => ({ JournalTranslationService: class {
  constructor(options: any) { mock.progress = options.onProgress; } translateMissingItems = mock.run; translateMissingEquipmentAffixes = mock.affixRun;
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
  mock.equipment.mockReset().mockResolvedValue([]); mock.runtime.mockReset().mockReturnValue(mock.check);
  mock.check.mockReset(); mock.source.mockReset().mockResolvedValue(undefined); mock.run.mockReset().mockResolvedValue({ createdDocuments: 1, skippedDocuments: 12, fallbackTextSegments: 0 }); mock.active.mockClear();
  mock.affixPlan.mockReset().mockResolvedValue({ sources: [], missing: [], extendable: [], existing: 0 });
  mock.affixGuard.mockReset().mockResolvedValue(undefined); mock.affixRun.mockReset().mockResolvedValue({ createdDocuments: 1, skippedDocuments: 0, fallbackTextSegments: 0 });
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

function chooseScope(application: any, value: string) {
  const select = application.element.querySelector("[data-creation-items-scope]")!;
  for (const option of select.options) option.selected = option.value === value;
  select.dispatchEvent(new document.defaultView!.Event("change"));
}

describe("explicit starting equipment choice", () => {
  it("keeps creation as the default and builds a separate equipment plan only after selection", async () => {
    const equipment = [{ uuid: "Compendium.crucible.equipment.Item.sword" }]; mock.equipment.mockResolvedValue(equipment);
    mock.plan.mockImplementation(async (items: any[]) => ({ sources: items, missing: items, existing: 0 }));
    const application = await app(); expect(application.element.querySelector<HTMLSelectElement>("select")!.value).toBe("creation");
    expect(mock.equipment).not.toHaveBeenCalled(); expect(mock.run).not.toHaveBeenCalled();
    chooseScope(application, "equipment");
    await vi.waitFor(() => expect(mock.plan).toHaveBeenLastCalledWith(equipment, "cs", "equipment"));
    await vi.waitFor(() => expect(application.element.querySelector<HTMLSelectElement>("select")!.disabled).toBe(false));
    expect(application.element.textContent).toContain("EquipmentScope");
    application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.click();
    await vi.waitFor(() => expect(mock.run).toHaveBeenCalledWith(equipment, "equipment"));
    expect(mock.runtime).toHaveBeenLastCalledWith("equipment");
  });
  it("does not reuse the creation plan when equipment preview fails", async () => {
    const application = await app(); mock.equipment.mockRejectedValue(new Error("Equipment unavailable"));
    chooseScope(application, "equipment");
    await vi.waitFor(() => expect(application.element.textContent).toContain("Equipment unavailable"));
    expect(application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.disabled).toBe(true);
    application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.click();
    expect(mock.run).not.toHaveBeenCalled();
  });
  it("pins the equipment preview and rejects a changed native purchase selection at Start", async () => {
    const equipment = [{ uuid: "Compendium.crucible.equipment.Item.sword" }]; mock.equipment.mockResolvedValue(equipment);
    mock.plan.mockImplementation(async (items: any[]) => ({ sources: items, missing: items, existing: 0 }));
    const application = await app(); chooseScope(application, "equipment");
    await vi.waitFor(() => {
      expect(application.element.querySelector<HTMLSelectElement>("select")!.value).toBe("equipment");
      expect(application.element.querySelector<HTMLSelectElement>("select")!.disabled).toBe(false);
    });
    mock.equipment.mockResolvedValue([...equipment, { uuid: "Compendium.crucible.equipment.Item.new" }]);
    application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.click();
    await vi.waitFor(() => expect(application.element.textContent).toContain("SourceChanged")); expect(mock.run).not.toHaveBeenCalled();
  });
  it("prevents changing scope while a translation runs, including synthetic change events", async () => {
    let finish!: (value: any) => void;
    mock.run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const application = await app(); application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.click();
    await vi.waitFor(() => expect(mock.run).toHaveBeenCalledOnce());
    expect(application.element.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true);
    chooseScope(application, "equipment"); expect(mock.equipment).not.toHaveBeenCalled();
    finish({ createdDocuments: 1, skippedDocuments: 0, fallbackTextSegments: 0 });
    await vi.waitFor(() => expect(ui.notifications.info).toHaveBeenCalledOnce());
  });
});

async function equipmentApp() {
  const owners = [{ uuid: "Compendium.crucible.equipment.Item.sword" }]; mock.equipment.mockResolvedValue(owners);
  mock.plan.mockResolvedValue({ sources: owners, missing: [], existing: 1 });
  const application = await app(); chooseScope(application, "equipment");
  await vi.waitFor(() => expect(application.element.querySelector<HTMLSelectElement>("select")!.disabled).toBe(false));
  return { application, owners };
}
describe("explicit enchantment Action translation", () => {
  it("shows an independent readonly plan and can fill Actions when all Item copies already exist", async () => {
    const effect = { uuid: "Compendium.crucible.equipment.Item.sword.ActiveEffect.affix" };
    mock.affixPlan.mockResolvedValue({ sources: [effect], missing: [effect], extendable: [], existing: 2 });
    const { application, owners } = await equipmentApp();
    expect(application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.disabled).toBe(true);
    expect(application.element.querySelector<HTMLButtonElement>("[data-creation-affixes-start]")!.disabled).toBe(false);
    expect(mock.affixRun).not.toHaveBeenCalled(); expect(mock.run).not.toHaveBeenCalled();
    application.element.querySelector<HTMLButtonElement>("[data-creation-affixes-start]")!.click();
    await vi.waitFor(() => expect(mock.affixRun).toHaveBeenCalledWith(owners));
    expect(mock.affixGuard).toHaveBeenCalled(); expect(mock.run).not.toHaveBeenCalled();
  });
  it("also offers append-only legacy candidates while retaining completed records", async () => {
    const effect = { uuid: "Compendium.crucible.equipment.Item.sword.ActiveEffect.affix" };
    mock.affixPlan.mockResolvedValue({ sources: [effect], missing: [], extendable: [effect], existing: 2 });
    const { application, owners } = await equipmentApp();
    application.element.querySelector<HTMLButtonElement>("[data-creation-affixes-start]")!.click();
    await vi.waitFor(() => expect(mock.affixRun).toHaveBeenCalledWith(owners));
  });
  it("disables the Action button for no eligible work and never shows it for character options", async () => {
    const initial = await app(); expect(initial.element.querySelector("[data-creation-affixes-start]")).toBeNull(); await initial.close();
    const { application } = await equipmentApp();
    expect(application.element.querySelector<HTMLButtonElement>("[data-creation-affixes-start]")!.disabled).toBe(true);
    expect(mock.affixRun).not.toHaveBeenCalled();
  });
  it("does not call the service when an embedded source changes after the plan", async () => {
    const effect = { uuid: "Compendium.crucible.equipment.Item.sword.ActiveEffect.affix" };
    mock.affixPlan.mockResolvedValue({ sources: [effect], missing: [effect], extendable: [], existing: 0 });
    const { application } = await equipmentApp(); mock.affixGuard.mockRejectedValue(new Error("Affix changed"));
    application.element.querySelector<HTMLButtonElement>("[data-creation-affixes-start]")!.click();
    await vi.waitFor(() => expect(application.element.textContent).toContain("Affix changed")); expect(mock.affixRun).not.toHaveBeenCalled();
  });
  it("rejects expanded affix selections instead of silently expanding a reviewed plan", async () => {
    const effect = { uuid: "Compendium.crucible.equipment.Item.sword.ActiveEffect.affix" };
    mock.affixPlan.mockResolvedValue({ sources: [effect], missing: [effect], extendable: [], existing: 0 });
    const { application } = await equipmentApp(); mock.affixPlan.mockResolvedValue({ sources: [effect, { uuid: "other" }], missing: [effect], extendable: [], existing: 0 });
    application.element.querySelector<HTMLButtonElement>("[data-creation-affixes-start]")!.click();
    await vi.waitFor(() => expect(application.element.textContent).toContain("SourceChanged")); expect(mock.affixRun).not.toHaveBeenCalled();
  });
  it("locks both start buttons while the Action run is pending and does not reopen a closed window", async () => {
    const effect = { uuid: "Compendium.crucible.equipment.Item.sword.ActiveEffect.affix" };
    mock.affixPlan.mockResolvedValue({ sources: [effect], missing: [effect], extendable: [], existing: 0 });
    let finish!: (value: any) => void; mock.affixRun.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { application } = await equipmentApp(); application.element.querySelector<HTMLButtonElement>("[data-creation-affixes-start]")!.click();
    await vi.waitFor(() => expect(mock.affixRun).toHaveBeenCalledOnce());
    expect(application.element.querySelector<HTMLButtonElement>("[data-creation-items-start]")!.disabled).toBe(true);
    expect(application.element.querySelector<HTMLButtonElement>("[data-creation-affixes-start]")!.disabled).toBe(true);
    const root = application.element, text = root.textContent; await application.close(); mock.progress({ documentName: "Late" });
    finish({ createdDocuments: 1, skippedDocuments: 0, fallbackTextSegments: 0 });
    await vi.waitFor(() => expect(ui.notifications.info).toHaveBeenCalledOnce()); expect(root.textContent).toBe(text); expect(application.element).toBeNull();
  });
});
