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
  it("keeps different anchors on one page independent when a field mixes relative and absolute links", () => {
    Object.assign(globalThis, { document: parseHTML('<html></html>').document });
    const page = 'JournalEntry.guide.JournalEntryPage.chapter';
    // The problematic field shape: one relative subsection link alongside two
    // absolute subsection links to that same page. No adventure prose needed.
    const source = `<p>@UUID[${page}#first]{First}</p><p>@UUID[.chapter#second]{Second}</p><p>@UUID[${page}#third]{Third}</p>`;
    const translation = `<p>@UUID[${page}#first]{První}</p><p>@UUID[${page}#second]{Druhý}</p><p>@UUID[${page}#third]{Třetí}</p>`;
    const result = sourceReferenceNotation(source, translation, page);
    expect(result).toBe(`<p>@UUID[${page}#first]{První}</p><p>@UUID[.chapter#second]{Druhý}</p><p>@UUID[${page}#third]{Třetí}</p>`);
    expect(() => assertPortableText(source, result, 'html')).not.toThrow();
    expect(sourceReferenceNotation(source, result, page)).toBe(result);
    // An incorrect destination or missing occurrence must still fail validation.
    expect(() => assertPortableText(source, sourceReferenceNotation(source, translation.replace('#second', '#unknown'), page), 'html')).toThrow('references');
    expect(() => assertPortableText(source, sourceReferenceNotation(source, translation.replace(/<p>[^<]*#second[^<]*<\/p>/u, ''), page), 'html')).toThrow();
  });
  it("rewrites each anchored token without disturbing command case, options, labels, whitespace or attribute quotes", () => {
    const page = 'Compendium.example.guides.JournalEntry.guide.JournalEntryPage.chapter';
    const source = `@UUID[.chapter#link] @Embed[.chapter#preview count=2] <a data-uuid=".chapter#attribute">Link</a>`;
    const translation = [
      `@uUiD[  ${page}#link\t]{Český Název} @eMbEd[ ${page}#preview\tcount=2 caption="Náhled"]`,
      `<a class="link" data-uuid = '  ${page}#attribute  '>Odkaz</a> @UUID[${page}#unrelated]{Jiný}`,
    ];
    expect(sourceReferenceNotation(source, translation, page)).toEqual([
      '@uUiD[  .chapter#link\t]{Český Název} @eMbEd[ .chapter#preview\tcount=2 caption="Náhled"]',
      `<a class="link" data-uuid = '  .chapter#attribute  '>Odkaz</a> @UUID[${page}#unrelated]{Jiný}`,
    ]);
  });
  it("fails closed for genuinely ambiguous same-anchor aliases and preserves child UUID identity", () => {
    const page = 'JournalEntry.guide.JournalEntryPage.chapter';
    const source = `@UUID[.chapter#same] @UUID[${page}#same] @UUID[.chapter#other] @UUID[Actor.hero.Item.skill#detail]`;
    const translation = `@UUID[${page}#same]{Stejný} @UUID[${page}#other]{Jiný} @UUID[Actor.hero.Item.wrong#detail]{Chybný} @UUID[Actor.hero]{Rodič}`;
    expect(sourceReferenceNotation(source, translation, page)).toBe(`@UUID[${page}#same]{Stejný} @UUID[.chapter#other]{Jiný} @UUID[Actor.hero.Item.wrong#detail]{Chybný} @UUID[Actor.hero]{Rodič}`);
  });
  it("retains command multiplicity and does not normalize changed options or unrelated commands", () => {
    const page = 'JournalEntry.guide.JournalEntryPage.chapter';
    const source = '@UUID[.chapter#one] @UUID[.chapter#one] @Embed[.chapter#two count=2]';
    const translation = `@UUID[${page}#one] @UUID[${page}#one] @Embed[${page}#two count=3] @Macro[${page}#one]`;
    const result = sourceReferenceNotation(source, translation, page);
    expect(result).toBe(`@UUID[.chapter#one] @UUID[.chapter#one] @Embed[.chapter#two count=3] @Macro[${page}#one]`);
    expect(() => assertPortableText(source, result, 'text')).toThrow('references');
  });
  it("accepts supported command case and protects legacy system references", () => {
    Object.assign(globalThis, { document: parseHTML('<html></html>').document });
    expect(() => assertPortableText('@embed[Actor.hero]', '@Embed[Actor.hero]{Hrdina}', 'text')).not.toThrow();
    expect(() => assertPortableText('&amp;Reference[restrained]', '&amp;Odkaz[spoután]', 'html')).toThrow('references');
    expect(() => assertPortableText('@Macro[Delete]', '@macro[Delete]', 'text')).toThrow('references');
  });
});
