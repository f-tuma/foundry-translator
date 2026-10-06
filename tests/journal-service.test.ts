import { afterEach, describe, expect, it, vi } from "vitest";

import { journalSourceHash, type JournalData } from "../src/translation/journal";
import {
  assertJournalSourceUnchanged,
  rootDocumentReferenceUuid,
  translatedDocumentReferenceUuid,
  usableTranslatedDocumentReferenceUuid,
} from "../src/translation/journal-service";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Journal translation service protections", () => {
  it("builds a translated embedded-page UUID from the real document hierarchy", () => {
    const source = {
      id: "source",
      uuid: "JournalEntry.source",
      documentName: "JournalEntry",
      name: "Source",
      toObject: () => ({ name: "Source", pages: [] }),
    } satisfies FoundryJournalWorldDocument;
    const page = {
      id: "page-id",
      uuid: "JournalEntry.source.JournalEntryPage.page-id",
      documentName: "JournalEntryPage",
      parent: source,
    } satisfies FoundryUuidDocument;
    const translated = {
      id: "translated",
      uuid: "Compendium.world.translations.JournalEntry.translated",
      toObject: () => ({}),
    } satisfies FoundryJournalDocument;

    expect(translatedDocumentReferenceUuid(page, source, translated)).toBe(
      "Compendium.world.translations.JournalEntry.translated.JournalEntryPage.page-id",
    );
  });

  it("keeps an embedded suffix when only the referenced root could be resolved", () => {
    const source = {
      id: "source",
      uuid: "JournalEntry.source",
      documentName: "JournalEntry",
      name: "Source",
      toObject: () => ({ name: "Source", pages: [] }),
    } satisfies FoundryJournalWorldDocument;
    const translated = {
      id: "translated",
      uuid: "Compendium.world.translations.JournalEntry.translated",
      toObject: () => ({}),
    } satisfies FoundryJournalDocument;

    expect(translatedDocumentReferenceUuid(
      source,
      source,
      translated,
      "JournalEntry.source.JournalEntryPage.intro",
    )).toBe(
      "Compendium.world.translations.JournalEntry.translated.JournalEntryPage.intro",
    );
    expect(rootDocumentReferenceUuid(
      "Compendium.ember.character.Item.soulbound.ActiveEffect.blessed",
    )).toBe("Compendium.ember.character.Item.soulbound");
  });

  it("retains the original reference when a stale embedded page is also absent in the copy", async () => {
    const source = {
      id: "source",
      uuid: "JournalEntry.source",
      documentName: "JournalEntry",
      name: "Source",
      toObject: () => ({ name: "Source", pages: [] }),
    } satisfies FoundryJournalWorldDocument;
    const translated = {
      id: "translated",
      uuid: "Compendium.world.translations.JournalEntry.translated",
      toObject: () => ({}),
    } satisfies FoundryJournalDocument;
    const fromUuid = vi.fn(async () => null);
    vi.stubGlobal("fromUuid", fromUuid);

    await expect(usableTranslatedDocumentReferenceUuid(
      source,
      source,
      translated,
      "JournalEntry.source.JournalEntryPage.removed",
    )).resolves.toBeNull();
    expect(fromUuid).toHaveBeenCalledWith(`${translated.uuid}.JournalEntryPage.removed`);
  });

  it("keeps an embedded translated page when that page exists", async () => {
    const source = {
      id: "source",
      uuid: "JournalEntry.source",
      documentName: "JournalEntry",
      name: "Source",
      toObject: () => ({ name: "Source", pages: [] }),
    } satisfies FoundryJournalWorldDocument;
    const translated = {
      id: "translated",
      uuid: "Compendium.world.translations.JournalEntry.translated",
      toObject: () => ({}),
    } satisfies FoundryJournalDocument;
    vi.stubGlobal("fromUuid", vi.fn(async () => ({ id: "intro", uuid: `${translated.uuid}.JournalEntryPage.intro` })));

    await expect(usableTranslatedDocumentReferenceUuid(
      source,
      source,
      translated,
      "JournalEntry.source.JournalEntryPage.intro",
    )).resolves.toBe(`${translated.uuid}.JournalEntryPage.intro`);
  });

  it("includes page-category names in the source fingerprint", async () => {
    const source: JournalData = {
      name: "Guide",
      categories: [{ _id: "rules", name: "Playing the Game", sort: 100_000 }],
      pages: [{ name: "Rules", type: "text", category: "rules" }],
    };
    const changed: JournalData = structuredClone(source);
    changed.categories![0]!.name = "Running the Game";

    await expect(journalSourceHash(source)).resolves.not.toBe(
      await journalSourceHash(changed),
    );
  });

  it("refuses to save when the source changes during a long translation", async () => {
    const source: JournalData = {
      name: "Long Journal",
      pages: [{ name: "Page", type: "text", text: { format: 1, content: "<p>Before</p>" } }],
    };
    const changed: JournalData = structuredClone(source);
    changed.pages[0]!.text!.content = "<p>Changed while translating</p>";
    const document = {
      id: "long",
      uuid: "JournalEntry.long",
      name: source.name,
      toObject: () => changed,
    };

    await expect(
      assertJournalSourceUnchanged(document, await journalSourceHash(source)),
    ).rejects.toThrow(/během překladu změnil.*cache/);
  });
});

// Integration boundary: real display translation/provider path, with an isolated
// persistence adapter. Native embedding/selection proofs have separate tests.
async function equipmentAffixServiceFixture() {
  vi.resetModules();
  const { parseHTML } = await import("linkedom"); vi.stubGlobal("document", parseHTML("<html><body></body></html>").document);
  class StringField {}
  class HTMLField {}
  class CrucibleActionField { fields = { id: new StringField(), name: new StringField(), description: new HTMLField(), condition: new StringField() }; }
  class ArrayField { element = new CrucibleActionField(); }
  class CrucibleAffixActiveEffect { static schema = { fields: { actions: new ArrayField() } }; }
  const data: any = { _id: "focusing", name: "Focusing", type: "affix", description: "<p>English affix.</p>",
    system: { tier: 1, actions: [{ id: "replenish", name: "Replenish Focus", description: "<p>Recover 4 Focus.</p>",
      condition: "While equipped", cost: { action: 2, heroism: 1 }, hooks: { postActivate: "nativeHook" } }] } };
  const owner: any = { uuid: "Compendium.crucible.equipment.Item.pearl" };
  const effect: any = { id: "focusing", uuid: `${owner.uuid}.ActiveEffect.focusing`, name: "Focusing", documentName: "ActiveEffect",
    type: "affix", parent: owner, system: new CrucibleAffixActiveEffect(), toObject: () => structuredClone(data) };
  const settings = { provider: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", openAiModel: "test", openAiBaseUrl: "http://test.invalid/v1", worldContext: "" };
  const assertRuntime = vi.fn(), proof = JSON.stringify(data);
  const assertSource = vi.fn(() => { if (JSON.stringify(data) !== proof) throw new Error("Source Affix changed"); });
  const guard = Object.assign(vi.fn(async () => { assertSource(); }), { assertCurrent: assertSource });
  const plan = vi.fn(async () => ({ sources: [effect], missing: [effect], extendable: [], existing: 0 }));
  const provider = { prepare: vi.fn(async () => {}), cacheIdentity: "equipment-affix-test", translate: vi.fn(async ({ texts }: { texts: string[] }) =>
    texts.map(text => ({ translatedText: text.replace("Replenish Focus", "Doplnit Soustředění").replace("English", "České") }))) };
  const createProvider = vi.fn(() => provider), save = vi.fn(async (record: any, _guard: unknown, beforeWrite?: () => void) => {
    beforeWrite?.(); return { id: "saved", uuid: "JournalEntry.saved", flags: record.flags, toObject: () => record };
  });
  const existing = vi.fn(async () => null);
  vi.doMock("../src/settings/settings", async original => ({ ...await original<object>(), getTranslatorSettings: () => ({ ...settings }) }));
  vi.doMock("../src/providers/factory", () => ({ createTranslationProvider: createProvider }));
  vi.doMock("../src/translation/ember-creation-items", async original => ({ ...await original<object>(), creationRuntimeGuard: () => assertRuntime }));
  vi.doMock("../src/translation/equipment-affixes", () => ({ planMissingEquipmentAffixes: plan, equipmentAffixSourceGuard: async () => guard }));
  vi.doMock("../src/glossary/compendium-repository", () => ({ GlossaryCompendiumRepository: class { async prepareForTranslation() { return []; } async loadExisting() { return []; } } }));
  vi.doMock("../src/translation/compendium-cache", () => ({ CompendiumTranslationCache: class {
    async get() { return null; } async getMany() { return new Map(); } async set() {} async setMany() {}
  } }));
  vi.doMock("../src/translation/compendium-display-text-repository", () => ({ CompendiumDisplayTextRepository: class { find = existing; save = save; } }));
  vi.stubGlobal("game", { user: { isGM: true, id: "gm" }, system: { id: "crucible" }, packs: new Map(), i18n: { localize: (key: string) => key } });
  vi.stubGlobal("CONFIG", { ActiveEffect: { dataModels: { affix: CrucibleAffixActiveEffect } } });
  vi.stubGlobal("Hooks", { callAll: vi.fn() }); vi.stubGlobal("fromUuid", vi.fn(async uuid => uuid === effect.uuid ? effect : null));
  const { JournalTranslationService } = await import("../src/translation/journal-service");
  const { activeTranslations } = await import("../src/translation/active-translations");
  return { data, owner, effect, plan, provider, save, createProvider, assertRuntime, assertSource, activeTranslations, service: new JournalTranslationService() };
}
describe("missing equipment Affix translation service", () => {
  afterEach(() => {
    for (const path of ["../src/settings/settings", "../src/providers/factory", "../src/translation/ember-creation-items", "../src/translation/equipment-affixes",
      "../src/glossary/compendium-repository", "../src/translation/compendium-cache", "../src/translation/compendium-display-text-repository"]) vi.doUnmock(path);
    vi.resetModules();
  });
  it("translates display fields only, retains native source mechanics, and creates a separate record", async () => {
    const f = await equipmentAffixServiceFixture(), before = JSON.stringify(f.data);
    await expect(f.service.translateMissingEquipmentAffixes([f.owner])).resolves.toMatchObject({ createdDocuments: 1, skippedDocuments: 0 });
    expect(f.save).toHaveBeenCalledOnce();
    const record = f.save.mock.calls[0]![0], flag = record.flags["foundry-translate"].displayTranslation;
    expect(flag.sourceUuid).toBe(f.effect.uuid); expect(flag.affixSourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(flag.fields.map((field: any) => field.path)).toContainEqual(["system", "actions", "replenish", "name"]);
    expect(record.system).toBeUndefined(); expect(JSON.stringify(f.data)).toBe(before);
    expect(JSON.stringify(f.provider.translate.mock.calls)).not.toMatch(/nativeHook|heroism|cost/);
    expect(f.assertSource).toHaveBeenCalled(); expect(f.plan).toHaveBeenCalledTimes(2);
  });
  it("does not prepare a provider when all claims are reserved", async () => {
    const f = await equipmentAffixServiceFixture(); f.plan.mockResolvedValue({ sources: [f.effect], missing: [], extendable: [], existing: 1 });
    await expect(f.service.translateMissingEquipmentAffixes([f.owner])).resolves.toMatchObject({ createdDocuments: 0, skippedDocuments: 1 });
    expect(f.createProvider).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
  });
  it("rechecks missing identities before translating a source newly claimed after the initial plan", async () => {
    const f = await equipmentAffixServiceFixture(); f.plan.mockResolvedValueOnce({ sources: [f.effect], missing: [f.effect], extendable: [], existing: 0 })
      .mockResolvedValue({ sources: [f.effect], missing: [], extendable: [], existing: 1 });
    await expect(f.service.translateMissingEquipmentAffixes([f.owner])).resolves.toMatchObject({ createdDocuments: 0, skippedDocuments: 1 });
    expect(f.provider.translate).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
  });
  it("rejects changed Affix mechanics after model generation without saving", async () => {
    const f = await equipmentAffixServiceFixture(); f.provider.translate.mockImplementation(async ({ texts }: { texts: string[] }) => {
      f.data.system.actions[0].cost.action = 99; return texts.map(text => ({ translatedText: text }));
    });
    await expect(f.service.translateMissingEquipmentAffixes([f.owner])).rejects.toThrow("Source Affix changed"); expect(f.save).not.toHaveBeenCalled();
  });
  it("checks the synchronous source proof immediately before the repository create", async () => {
    const f = await equipmentAffixServiceFixture(); let committed = false;
    f.save.mockImplementation(async (_data, _guard, beforeWrite) => {
      f.data.system.tier = 99; beforeWrite?.(); committed = true; return {} as any;
    });
    await expect(f.service.translateMissingEquipmentAffixes([f.owner])).rejects.toThrow("Source Affix changed"); expect(committed).toBe(false);
  });
  it("honors cancellation at the final create boundary", async () => {
    const f = await equipmentAffixServiceFixture(); let committed = false;
    f.save.mockImplementation(async (_data, _guard, beforeWrite) => {
      f.activeTranslations.requestCancel(f.activeTranslations.list().at(-1)!.id); beforeWrite?.(); committed = true; return {} as any;
    });
    await expect(f.service.translateMissingEquipmentAffixes([f.owner])).rejects.toThrow(); expect(committed).toBe(false);
  });
});
