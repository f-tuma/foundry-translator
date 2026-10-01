import { describe, expect, it } from "vitest";
import { absoluteReference, referenceContext, sourceReferenceNotation } from "../src/bundles/reference-notation";
import { assertPortableText } from "../src/bundles/format";
import { parseHTML } from "linkedom";

describe("Portable relative reference spelling", () => {
  it("follows Foundry sibling, child, parent and self-reference rules in world and compendium pages", () => {
    const root = "Compendium.ember.guides.JournalEntry.guide", page = `${root}.JournalEntryPage.intro`;
    expect(absoluteReference(".next", page)).toBe(`${root}.JournalEntryPage.next`);
    expect(absoluteReference("..JournalEntryPage.next", page)).toBe(`${root}.JournalEntryPage.next`);
    expect(absoluteReference(".", page)).toBe(page);
    expect(absoluteReference("...outside", page)).toBeNull();
    expect(absoluteReference(".other", "JournalEntry.guide")).toBe("JournalEntry.other");
    expect(referenceContext(root, { pages: [{ _id: "intro" }] }, ["pages", 0, "text", "content"])).toBe(page);
  });
  it("restores only source-equivalent notation, retaining anchors, labels and embed options", () => {
    const page = "JournalEntry.guide.JournalEntryPage.intro";
    const source = '@UUID[.next#section]{Next} @Embed[.#self caption="Look"]';
    const translated = '@UUID[JournalEntry.guide.JournalEntryPage.next#section]{Další} @Embed[JournalEntry.guide.JournalEntryPage.intro#self caption="Podívej"]';
    expect(sourceReferenceNotation(source, translated, page)).toBe('@UUID[.next#section]{Další} @Embed[.#self caption="Podívej"]');
    expect(sourceReferenceNotation(source, '@UUID[JournalEntry.guide]{Další}', page)).toBe('@UUID[JournalEntry.guide]{Další}');
    expect(sourceReferenceNotation(source, '@UUID[JournalEntry.other.JournalEntryPage.next#section]{Další}', page)).toContain('JournalEntry.other');
  });
  it("does not guess between ambiguous source spellings or lose embedded item suffixes", () => {
    const source = '@UUID[.next] @UUID[JournalEntry.guide.JournalEntryPage.next]';
    expect(sourceReferenceNotation(source, '@UUID[JournalEntry.guide.JournalEntryPage.next]', 'JournalEntry.guide.JournalEntryPage.intro')).toContain('JournalEntry.guide.JournalEntryPage.next');
    expect(sourceReferenceNotation('@UUID[Actor.hero.Item.skill]', '@UUID[Actor.hero]', 'JournalEntry.guide')).toBe('@UUID[Actor.hero]');
  });
  it("accepts supported command case and protects legacy system references", () => {
    Object.assign(globalThis, { document: parseHTML('<html></html>').document });
    expect(() => assertPortableText('@embed[Actor.hero]', '@Embed[Actor.hero]{Hrdina}', 'text')).not.toThrow();
    expect(() => assertPortableText('&amp;Reference[restrained]', '&amp;Odkaz[spoután]', 'html')).toThrow('references');
    expect(() => assertPortableText('@Macro[Delete]', '@macro[Delete]', 'text')).toThrow('references');
  });
});
