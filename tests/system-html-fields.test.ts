import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { portableFields, type PortableDocument } from "../src/bundles/fields";
import { exportTranslationBundle, planBundleImport } from "../src/bundles/service";
import { TRANSLATIONS_PACK_ID } from "../src/translation/compendium-translation-repository";
import { translateJournalData, type JournalData } from "../src/translation/journal";
import { loadReview, reviewCatalog, updateReview } from "../src/review/service";

import {
  discoverSystemHtmlFieldPaths,
  discoverEmberTextFieldPaths,
  readPath,
  writePath,
} from "../src/translation/system-html-fields";

class HTMLField {}

class StringField {}

class FilePathField {}

class SchemaField {
  constructor(readonly fields: Record<string, unknown>) {}
}

class ArrayField {
  constructor(readonly element: unknown) {}
}

afterEach(() => vi.unstubAllGlobals());

describe("custom system HTML fields", () => {
  it("discovers concrete HTML paths through schemas and arrays", () => {
    const fields = {
      content: new SchemaField({
        overview: new HTMLField(),
        identifier: new StringField(),
      }),
      outcomes: new ArrayField(new SchemaField({ summary: new HTMLField() })),
    };
    const system = {
      content: { overview: "<p>Player text</p>", identifier: "do-not-translate" },
      outcomes: [{ summary: "<p>First</p>" }, { summary: "<p>Second</p>" }],
    };

    expect(discoverSystemHtmlFieldPaths(fields, system)).toEqual([
      ["content", "overview"],
      ["outcomes", 0, "summary"],
      ["outcomes", 1, "summary"],
    ]);
  });

  it("reads and writes only the requested concrete path", () => {
    const system = { content: { overview: "Original", identifier: "keep" } };
    const path = ["content", "overview"] as const;

    expect(readPath(system, path)).toBe("Original");
    expect(writePath(system, path, "Překlad")).toBe(true);
    expect(system).toEqual({ content: { overview: "Překlad", identifier: "keep" } });
  });
});

describe("reviewed Ember plain-text fields", () => {
  const fields = {
    banner: new SchemaField({ img: new FilePathField(), caption: new StringField() }),
    edict: new StringField(),
    pronunciation: new StringField(),
    identifier: new StringField(),
    development: new SchemaField({ notes: new StringField() }),
    clerics: new ArrayField(new StringField()),
  };
  const system = {
    banner: { img: "modules/ember/banner.webp", caption: "Remember the mountain." },
    edict: "Protect travellers.", pronunciation: "MOUN-tain", identifier: "unchanged-id",
    development: { notes: "Developer notes" }, clerics: ["Actor.cleric"],
  };

  it.each(["ember.lore", "ember.ancestry", "ember.characterClass", "ember.culture",
    "ember.cosmos", "ember.deity", "ember.organization"])("includes the banner quote for reviewed %s lore pages", type => {
    expect(discoverEmberTextFieldPaths(type, fields, system)).toEqual([
      ["banner", "caption"], ...(type === "ember.deity" ? [["edict"]] : []),
    ]);
    expect(discoverSystemHtmlFieldPaths(fields, system)).toEqual([]);
  });

  it.each(["text", "other.deity", "ember.character", "ember.location", "ember.biome",
    "ember.quest", "ember.questEvent", "ember.standaloneEvent", "ember.lore.custom"])("does not broaden the new field allowlist for %s", type => {
    expect(discoverEmberTextFieldPaths(type, fields, system)).toEqual([]);
  });

  it.each([
    { banner: new StringField() },
    { banner: { fields: { img: new FilePathField(), caption: new StringField() } } },
    { banner: new SchemaField({ img: new StringField(), caption: new StringField() }) },
    { banner: new SchemaField({ img: new FilePathField(), caption: new HTMLField() }) },
    { banner: new SchemaField({ img: new FilePathField() }) },
  ])("requires the reviewed nested banner schema", wrong => {
    expect(discoverEmberTextFieldPaths("ember.ancestry", wrong, system)).toEqual([]);
  });

  it.each([undefined, null, [], "quote", { caption: 123 }, { caption: null }])("rejects malformed banner data: %j", banner => {
    expect(discoverEmberTextFieldPaths("ember.ancestry", fields, { ...system, banner })).toEqual([]);
  });

  it("requires an actual StringField and string value for the deity's edict", () => {
    expect(discoverEmberTextFieldPaths("ember.deity", { edict: new HTMLField() }, system)).toEqual([]);
    expect(discoverEmberTextFieldPaths("ember.deity", fields, { edict: 123 })).toEqual([]);
    expect(discoverEmberTextFieldPaths("ember.deity", undefined, system)).toEqual([]);
  });

  it("keeps subtitle and event outcome labels without translating their adjacent automation", () => {
    const schema = { ...fields, subtitle: new StringField(), eventId: new StringField(),
      outcomes: new ArrayField(new SchemaField({ label: new StringField(), id: new StringField(), next: new StringField() })) };
    const data = { ...system, subtitle: "A quiet place", eventId: "event-id",
      outcomes: [{ label: "Make an ally", id: "success", next: "next-event" }] };
    expect(discoverEmberTextFieldPaths("ember.questEvent", schema, data)).toEqual([
      ["subtitle"], ["outcomes", 0, "label"],
    ]);
  });

  it("translates, edits and exports/import-validates the same allowlisted text without altering other fields", async () => {
    const dom = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", dom.document);
    const source: JournalData = { name: "Deity", pages: [{ _id: "one", name: "Mountain", type: "ember.deity",
      system: structuredClone(system) }] };
    const original = structuredClone(source);
    const providerCalls: string[] = [];
    const translated = await translateJournalData({ source, sourceUuid: "JournalEntry.source", glossary: [],
      provider: { async translate(request) { providerCalls.push(...request.texts); return request.texts.map(text => ({
        translatedText: text.replace("Remember the mountain.", "Pamatuj na horu.").replace("Protect travellers.", "Chraň poutníky."),
      })); }, async testConnection() {} },
      settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" },
      ownerDocument: dom.document, nonceFactory: () => "EMBERFIELDS",
      systemTextFieldPaths: [discoverEmberTextFieldPaths("ember.deity", fields, system)],
    });
    expect(translated.data.pages[0]?.system).toEqual({ ...system,
      banner: { ...system.banner, caption: "Pamatuj na horu." }, edict: "Chraň poutníky." });
    expect(source).toEqual(original);
    expect(providerCalls).toContain("Remember the mountain.");
    expect(providerCalls).toContain("Protect travellers.");
    expect(providerCalls.join("\n")).not.toMatch(/banner\.webp|Developer notes|MOUN-tain|unchanged-id|Actor\.cleric/);

    const copy = translated.data;
    copy._id = "copy";
    const runtime = { system: { constructor: { schema: { fields } } } };
    const sourceDocument = { id: "source", uuid: "JournalEntry.source", documentName: "JournalEntry",
      toObject: () => structuredClone(source), pages: { contents: [{ id: "one", ...runtime }] } } as unknown as PortableDocument;
    const writes: Record<string, unknown>[] = [];
    function dotted(data: Record<string, unknown>, patch: Record<string, unknown>) {
      for (const [key, value] of Object.entries(patch)) {
        const path = key.split("."); let parent = data;
        for (const part of path.slice(0, -1)) {
          parent[part] ??= {};
          parent = parent[part] as Record<string, unknown>;
        }
        parent[path.at(-1)!] = structuredClone(value);
      }
    }
    const copyDocument = { id: "copy", uuid: `Compendium.${TRANSLATIONS_PACK_ID}.JournalEntry.copy`,
      name: copy.name, get flags() { return copy.flags; }, toObject: () => structuredClone(copy),
      update: async (patch: Record<string, unknown>) => {
        writes.push(patch); const { pages, ...root } = patch; dotted(copy, root);
        for (const update of (pages ?? []) as Record<string, unknown>[]) {
          const { _id, ...changed } = update;
          dotted(copy.pages.find(page => page._id === _id)!, changed);
        }
      } };
    const pack = { collection: TRANSLATIONS_PACK_ID, locked: false,
      getDocument: async () => copyDocument,
      getIndex: async () => new Map([["copy", { _id: "copy", name: copy.name, flags: copy.flags }]]) };
    vi.stubGlobal("game", { user: { isGM: true, id: "gm", name: "Reviewer" },
      system: { id: "crucible", version: "test" }, world: { id: "test", title: "Test" },
      packs: new Map([[TRANSLATIONS_PACK_ID, pack]]), settings: { get: () => undefined },
      i18n: { localize: (key: string) => key } });
    vi.stubGlobal("fromUuid", vi.fn(async (uuid: string) => uuid === sourceDocument.uuid ? sourceDocument : null));
    vi.stubGlobal("Hooks", { callAll: vi.fn() });

    expect(portableFields(sourceDocument).map(field => field.path)).toEqual([
      ["name"], ["pages", 0, "name"], ["pages", 0, "system", "banner", "caption"], ["pages", 0, "system", "edict"],
    ]);
    const catalog = await reviewCatalog("cs");
    const view = await loadReview(catalog[0]!, catalog);
    const quote = view.rows.find(row => row.label === "system.banner.caption")!;
    const edict = view.rows.find(row => row.label === "system.edict")!;
    expect(quote.translation).toEqual(["Pamatuj na horu."]);
    expect(edict.translation).toEqual(["Chraň poutníky."]);
    expect(quote.blocked).toBeNull(); expect(edict.blocked).toBeNull();
    await updateReview(view, quote.id, { type: "save", parts: ["Nezapomínej na horu."] });
    expect(writes[0]).toMatchObject({ pages: [{ _id: "one", "system.banner.caption": "Nezapomínej na horu." }] });
    expect(copy.pages[0]?.system).toEqual({ ...system,
      banner: { ...system.banner, caption: "Nezapomínej na horu." }, edict: "Chraň poutníky." });
    expect(source).toEqual(original);

    const exported = await exportTranslationBundle("cs");
    expect(exported.skipped).toEqual([]);
    expect(exported.bundle.documents[0]?.patches).toEqual([
      { path: ["pages", 0, "system", "banner", "caption"], format: "text", source: system.banner.caption, translation: "Nezapomínej na horu." },
      { path: ["pages", 0, "system", "edict"], format: "text", source: system.edict, translation: "Chraň poutníky." },
    ]);
    expect((await planBundleImport(exported.bundle)).rows[0]?.state).toBe("existing");
    const injected = structuredClone(exported.bundle);
    injected.documents[0]!.patches.push({ path: ["pages", 0, "system", "pronunciation"], format: "text",
      source: system.pronunciation, translation: "Do not accept this" });
    expect((await planBundleImport(injected)).rows[0]).toMatchObject({ state: "invalid", detail: expect.stringContaining("Field is not translatable") });
  });
});
