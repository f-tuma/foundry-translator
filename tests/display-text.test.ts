import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { displayFields, displaySourceHash, readDisplayTextFlag, readDisplayTranslation, translateDisplayText } from "../src/translation/display-text";

beforeEach(() => vi.stubGlobal("document", parseHTML("<html><body></body></html>").document));
afterEach(() => vi.unstubAllGlobals());
const settings = { providerId: "openai-compatible" as const, sourceLanguage: "en", targetLanguage: "cs" };
const scene = () => ({ name: "Old Gate", navName: "Gate", drawings: [{ _id: "drawing123456789", text: "Welcome", x: 50 }],
  notes: [{ _id: "note123456789012", text: "Gate", entryId: "journal123456789" }], levels: [{ _id: "level12345678901", name: "Upper Floor" }],
  regions: [{ _id: "region1234567890", name: "Danger", behaviors: [{ type: "executeScript", system: { source: "attack()" } }] }],
  tokens: [{ name: "Mechanical Name", actorId: "actor12345678901" }], flags: { ember: { name: "Secret", trigger: "macro()" } }, active: true,
});

it("sends only allowlisted display text to the model and stores no game mechanics", async () => {
  const source = scene(), before = structuredClone(source);
  const requests: string[] = [];
  const data = await translateDisplayText({ source, sourceUuid: "Scene.scene12345678901", kind: "Scene", glossary: [], settings,
    glossaryHash: "g", providerHash: "p", provider: { async testConnection() {}, async translate({ texts }) {
      requests.push(...texts); return texts.map(text => ({ translatedText: `CZ ${text}` }));
    } } });
  expect(source).toEqual(before);
  expect(requests.join(" ")).not.toMatch(/Mechanical|Secret|attack|macro/);
  expect(data.pages).toHaveLength(6);
  expect(data.flags?.["foundry-translate"]?.displayTranslation).toMatchObject({ documentType: "Scene", sourceUuid: "Scene.scene12345678901" });
  expect(JSON.stringify(data)).not.toMatch(/actorId|entryId|behaviors|active":|tokens"/);
  const flag = readDisplayTextFlag(data.flags)!;
  expect(flag).not.toBeNull();
  expect(flag.fields.map(field => readDisplayTranslation(data, field))).toEqual(["CZ Old Gate", "CZ Gate", "CZ Welcome", "CZ Gate", "CZ Upper Floor", "CZ Danger"]);
});

it("ignores runtime state and collection order but invalidates changes to display text", async () => {
  const source = scene(), copy = structuredClone(source);
  copy.active = false; copy.drawings[0]!.x = 99; copy.regions[0]!.behaviors[0]!.system.source = "other()";
  expect(await displaySourceHash("Scene", source)).toBe(await displaySourceHash("Scene", copy));
  copy.notes[0]!.text = "Other Gate";
  expect(await displaySourceHash("Scene", source)).not.toBe(await displaySourceHash("Scene", copy));
  const effect = { name: "Blessed", description: "<p>Protection.</p>", duration: { seconds: 10 }, statuses: ["blessed"], system: { changes: [1] } };
  expect(displayFields("ActiveEffect", effect).map(f => f.path)).toEqual([["name"], ["description"]]);
  const changed = { ...effect, duration: { seconds: 0 } };
  expect(await displaySourceHash("ActiveEffect", effect)).toBe(await displaySourceHash("ActiveEffect", changed));
});

it("keeps valid manual edits but rejects markup, changed UUIDs and forged field paths", async () => {
  const data = await translateDisplayText({ source: { name: "Blessed", description: '<p>Visit @UUID[Scene.scene12345678901]{Gate}.</p>' },
    sourceUuid: "ActiveEffect.effect1234567890", kind: "ActiveEffect", glossary: [], settings, glossaryHash: "g", providerHash: "p",
    provider: { async testConnection() {}, async translate({ texts }) { return texts.map(text => ({ translatedText: text })); } } });
  const flag = readDisplayTextFlag(data.flags)!;
  data.pages[0]!.text!.content = "<p>Požehnaný</p>";
  expect(readDisplayTranslation(data, flag.fields[0]!)).toBe("Požehnaný");
  data.pages[0]!.text!.content = '<p><img src="x" onerror="alert(1)"></p>';
  expect(readDisplayTranslation(data, flag.fields[0]!)).toBeNull();
  data.pages[1]!.text!.content = '<p>Visit @UUID[Scene.other12345678901]{Gate}.</p>';
  expect(readDisplayTranslation(data, flag.fields[1]!)).toBeNull();
  flag.fields[0]!.path = ["system", "damage"];
  expect(readDisplayTextFlag(data.flags)).toBeNull();
});
