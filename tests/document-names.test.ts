import { describe, expect, it, vi } from "vitest";
import { actorSourceHash, translateActorData } from "../src/translation/actor";
import { translateItemData } from "../src/translation/item";
import { labelGlossaryReferences } from "../src/translation/reference-labels";
import { translateUnits, glossaryFingerprint } from "../src/translation/unit-translator";
import type { GlossaryEntry } from "../src/glossary/types";
import { translateDocumentNames } from "../src/translation/document-names";

const settings = { providerId: "openai-compatible" as const, sourceLanguage: "en", targetLanguage: "cs" };
const actor: GlossaryEntry = { source: "Agraband Swift", replacement: "Agraband Rychlý", sourceUuid: "Actor.swift", category: "character", aliases: [], mode: "inflect" };
const item: GlossaryEntry = { source: "Silver Sword", replacement: "Stříbrný Meč", sourceUuid: "Item.sword", category: "item", aliases: [], mode: "inflect" };
const provider = { supportsGlossaryInflection: true, translate: vi.fn(async ({ texts }: { texts: readonly string[] }) => texts.map(text => ({ translatedText: text.replace("Speak with", "Promluvte s").replace("Agraband Rychlý", "Agrabandem Rychlým").replace("Attack", "Útok") }))), async testConnection() {} };

describe("document names and implicit labels", () => {
  it("uses reviewed canonical titles and aliases without a model request", async () => {
    const unavailable = { async translate(): Promise<never> { throw new Error("offline"); }, async testConnection() {} };
    expect(await translateDocumentNames(["Agraband Swift", "  Swift  "], { settings, glossary: [{ ...actor, aliases: ["Swift"] }], provider: unavailable })).toEqual({ names: ["Agraband Rychlý", "  Agraband Rychlý  "], fallbacks: 0 });
  });
  it("translates actor, token and embedded item names without changing IDs, mechanics or source", async () => {
    const source = { name: actor.source, type: "npc", prototypeToken: { name: actor.source }, system: { health: 12 }, items: [{ _id: "sword", name: item.source, system: { damage: 4 } }, { _id: "attack", name: "Attack" }] };
    const original = structuredClone(source);
    const result = await translateActorData({ source, sourceUuid: actor.sourceUuid!, glossary: [actor, item], provider, settings, systemHtmlFieldPaths: [], itemHtmlFieldPaths: [] });
    expect(result.data.name).toBe("Agraband Rychlý");
    expect(result.data.prototypeToken).toEqual({ name: "Agraband Rychlý" });
    expect(result.data.items).toEqual([{ _id: "sword", name: "Stříbrný Meč", system: { damage: 4 } }, { _id: "attack", name: "Útok" }]);
    expect(result.data.system.health).toBe(12);
    expect(source).toEqual(original);
    expect(await actorSourceHash(source)).not.toBe(await actorSourceHash({ ...source, prototypeToken: { name: "A Bard" } }));
  });
  it("uses canonical glossary names for standalone Items even without HTML fields", async () => {
    const result = await translateItemData({ source: { name: item.source, type: "weapon", system: { identifier: "silver-sword" } }, sourceUuid: item.sourceUuid!, glossary: [item], provider, settings, systemHtmlFieldPaths: [] });
    expect(result.data.name).toBe("Stříbrný Meč");
    expect(result.data.system.identifier).toBe("silver-sword");
  });
  it("supplies source names for unlabeled UUIDs and embeds, preserving anchors and explicit labels", () => {
    const text = '@UUID[Actor.swift#section] @Embed[Actor.swift inline readaloud="Hello"] @UUID[Actor.swift]{The Smith} @Embed[Actor.swift label="Custom"] @UUID[Item.unknown]';
    expect(labelGlossaryReferences(text, [actor])).toBe('@UUID[Actor.swift#section]{Agraband Swift} @Embed[Actor.swift inline readaloud="Hello"]{Agraband Swift} @UUID[Actor.swift]{The Smith} @Embed[Actor.swift label="Custom"] @UUID[Item.unknown]');
    expect(labelGlossaryReferences(text, [{ ...actor, enabled: false }])).toBe(text);
    expect(labelGlossaryReferences(text, [actor, { ...actor, source: "Other" }])).toBe(text);
  });
  it("translates implicit labels in sentence context and keeps standalone labels canonical", async () => {
    const translated = await translateUnits({ units: [["Speak with @UUID[Actor.swift]."], ["@Embed[Actor.swift inline]"], ["@UUID[Actor.swift]"]], glossary: [actor], provider, settings });
    expect(translated).toEqual([["Promluvte s @UUID[Actor.swift]{Agrabandem Rychlým}."], ["@Embed[Actor.swift inline]{Agraband Rychlý}"], ["@UUID[Actor.swift]{Agraband Rychlý}"]]);
    expect(await glossaryFingerprint([actor])).not.toBe(await glossaryFingerprint([{ ...actor, sourceUuid: "Actor.other" }]));
  });
});
