import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localizeEmberSectionHeading, localizeEmberSectionRecords } from "../src/translation/ember-section-headings";
import { registerEmberJournalHeadings } from "../src/translation/ember-journal-headings";

let language: "cs" | "en";
const phrases = {
  CultureDetails: { cs: "Podrobnosti Kultury", en: "Culture Details" },
  AncestryDetails: { cs: "Podrobnosti Původu", en: "Ancestry Details" },
  Gamemaster: { cs: "Informace pro Vypravěče", en: "Gamemaster Information" },
};
beforeEach(() => {
  language = "cs";
  vi.stubGlobal("game", { modules: new Map([["ember", { active: true }]]), i18n: { localize: (key: string) => {
    const name = key.replace("FOUNDRY_TRANSLATE.Reader.Section.", "") as keyof typeof phrases;
    return phrases[name]?.[language] ?? key;
  } } });
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const calls = vi.fn();
  const data = Object.freeze({ banner: Object.freeze({ caption: "Original" }), talentId: "crafting" });
  class EmberPageSheet {
    document = { type: "ember.culture", system: data };
    async _getSections(_context: unknown) {
      calls();
      return [{ sectionClass: "content", header: null as string | null, content: '<a data-uuid="Item.original" data-action="gain">Talent</a>' },
        { sectionClass: "gamemaster", header: "Gamemaster Information", content: "Secret", id: "gm" }];
    }
    async _preparePartContext(part: string, context: Record<string, unknown>) {
      return part === "content" ? { ...context, sections: await this._getSections(context) } : context;
    }
  }
  class EmberCulturePageSheet extends EmberPageSheet {
    override async _getSections(context: unknown) {
      const sections = await super._getSections(context);
      sections[0]!.header = "Culture Details";
      return sections;
    }
  }
  vi.stubGlobal("ember", { api: { applications: { EmberPageSheet, EmberCulturePageSheet } } });
  return { EmberPageSheet, EmberCulturePageSheet, data, calls };
}

describe("shared Ember section headings", () => {
  it("follows the actual interface language, without forcing the translation target language", () => {
    expect(localizeEmberSectionHeading("Culture Details")).toBe("Podrobnosti Kultury");
    language = "en";
    expect(localizeEmberSectionHeading("Culture Details")).toBe("Culture Details");
  });
  it("copies only recognized render headers and leaves prose, unknown labels, IDs and input records untouched", () => {
    const known = Object.freeze({ header: "Ancestry Details", content: "Culture Details", id: "ancestry", data: { uuid: "Item.source" } });
    const custom = Object.freeze({ header: "Custom Label", content: "Keep" });
    const input = Object.freeze([known, custom, null, { header: null }]);
    const result = localizeEmberSectionRecords(input) as any[];
    expect(result[0]).toEqual({ ...known, header: "Podrobnosti Původu" });
    expect(result[0]).not.toBe(known);
    expect(result[0].data).toBe(known.data);
    expect(result[1]).toBe(custom);
    expect(known.header).toBe("Ancestry Details");
    expect(localizeEmberSectionRecords(result)).toEqual(result);
  });
  it("passes unsupported result shapes through", () => {
    for (const value of [null, undefined, "content", { sections: [] }]) expect(localizeEmberSectionRecords(value)).toBe(value);
  });
});

describe("native Ember journal presentation", () => {
  it("localizes subclass headers set after super and retains native actions and secret visibility", async () => {
    const f = fixture(); registerEmberJournalHeadings();
    const sheet = new f.EmberCulturePageSheet();
    const sections = await sheet._getSections({});
    expect(sections[0]).toEqual({ sectionClass: "content", header: "Podrobnosti Kultury", content: '<a data-uuid="Item.original" data-action="gain">Talent</a>' });
    expect(sections[1]).toMatchObject({ header: "Informace pro Vypravěče", content: "Secret", id: "gm" });
    expect(sheet.document.system).toBe(f.data);
    expect(f.calls).toHaveBeenCalledTimes(1);
  });
  it("registers idempotently without invoking native methods twice", async () => {
    const f = fixture(); registerEmberJournalHeadings();
    const method = f.EmberCulturePageSheet.prototype._getSections;
    registerEmberJournalHeadings();
    expect(f.EmberCulturePageSheet.prototype._getSections).toBe(method);
    const sheet = new f.EmberCulturePageSheet();
    await sheet._preparePartContext("content", { actionId: "original" });
    expect(f.calls).toHaveBeenCalledTimes(1);
  });
  it("localizes final content sections from later subclasses and preserves other render parts", async () => {
    const f = fixture(); registerEmberJournalHeadings();
    class LaterSheet extends f.EmberPageSheet {
      override async _getSections() { return [{ sectionClass: "content", header: "Culture Details", content: "Story" }]; }
    }
    const sheet = new LaterSheet();
    const context = { actionId: "source", flags: Object.freeze({ secret: true }) };
    const result = await sheet._preparePartContext("content", context);
    expect((result.sections as any[])[0].header).toBe("Podrobnosti Kultury");
    expect(result.flags).toBe(context.flags);
    expect(await sheet._preparePartContext("config", context)).toBe(context);
  });
  it("does not alter non-Ember pages or inactive installations", async () => {
    const f = fixture(); (game.modules.get("ember") as any).active = false;
    const method = f.EmberCulturePageSheet.prototype._getSections;
    registerEmberJournalHeadings(); expect(f.EmberCulturePageSheet.prototype._getSections).toBe(method);
    (game.modules.get("ember") as any).active = true; registerEmberJournalHeadings();
    const sheet = new f.EmberCulturePageSheet(); sheet.document.type = "text";
    expect((await sheet._getSections({}))[0]?.header).toBe("Culture Details");
  });
  it("preserves a native error instead of hiding rendering failures", async () => {
    class EmberCulturePageSheet { document = { type: "ember.culture" }; async _getSections() { throw new Error("native failure"); } }
    vi.stubGlobal("ember", { api: { applications: { EmberCulturePageSheet } } });
    registerEmberJournalHeadings();
    await expect(new EmberCulturePageSheet()._getSections()).rejects.toThrow("native failure");
  });
});
