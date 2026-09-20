import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertPortableText, parseTranslationBundle, type TranslationBundle } from "../src/bundles/format";
import { remapBundleReferences } from "../src/bundles/service";

function bundle(): TranslationBundle {
  return { format: "foundry-translate-bundle", version: 1, moduleVersion: "0.15.0", createdAt: "2026-09-20", systemId: "crucible", systemVersion: "0.11.0", targetLanguage: "cs", glossary: [], documents: [{
    kind: "JournalEntry", sourceUuid: "JournalEntry.source", sourceName: "Guide", sourceFingerprint: "a".repeat(64), partial: true, processedPageIds: ["page"], fallbackTextSegments: 0,
    providerId: "chrome-local", sourceLanguage: "en", translatedAt: "2026-09-20", engineRevision: 9,
    patches: [{ path: ["pages", 0, "text", "content"], format: "html", source: "<p>Hello</p>", translation: "<p>Ahoj</p>" }] }] };
}
beforeEach(() => vi.stubGlobal("document", parseHTML("<html><body></body></html>").document));
afterEach(() => vi.unstubAllGlobals());

describe("portable translation format", () => {
  it("roundtrips partial translations and strips unknown settings and record fields", () => {
    const input = { ...bundle(), apiKey: "secret", documents: bundle().documents.map((d) => ({ ...d, flags: { evil: true } })) };
    const parsed = parseTranslationBundle(JSON.stringify(input));
    expect(parsed).toEqual(bundle());
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });
  it("rejects invalid schemas, duplicate identities and prototype paths before writes", () => {
    expect(() => parseTranslationBundle('{"version":99}')).toThrow();
    const value = bundle();
    value.documents.push(value.documents[0]!);
    expect(() => parseTranslationBundle(JSON.stringify(value))).toThrow("duplicate document");
    value.documents.pop();
    value.documents[0]!.patches[0]!.path = ["__proto__", "bad"];
    expect(() => parseTranslationBundle(JSON.stringify(value))).toThrow("invalid field path");
  });
  it("rejects glossary alias conflicts and duplicate terms", () => {
    const value = bundle();
    value.glossary = [{ source: "Count", replacement: "Hrabě", category: "term", aliases: ["Strahd"] }, { source: "Strahd", replacement: "Strahd", category: "character", aliases: [] }];
    expect(() => parseTranslationBundle(JSON.stringify(value))).toThrow("conflicting");
    value.glossary[1]!.enabled = false;
    expect(parseTranslationBundle(JSON.stringify(value)).glossary).toHaveLength(2);
  });
  it("permits translated prose and visible labels, preserving commands and HTML mechanics", () => {
    expect(() => assertPortableText('<p class="read">Meet <strong>Strahd</strong>. @UUID[Actor.a]{Count} [[/r 1d20]]</p>', '<p class="read">Potkáte <strong>Strahd</strong>. @UUID[Actor.a]{Hrabě} [[/r 1d20]]</p>', "html")).not.toThrow();
    expect(() => assertPortableText('<img src="same.webp" title="Castle">', '<img src="same.webp" title="Hrad">', "html")).not.toThrow();
    expect(() => assertPortableText('@Embed[Actor.a caption="Hello"]', '@Embed[Actor.a caption="Ahoj"]', "text")).not.toThrow();
  });
  it.each([
    ['<p>Hello</p>', '<p onclick="evil()">Ahoj</p>', "html"],
    ['<a href="safe">Hi</a>', '<a href="javascript:evil()">Ahoj</a>', "html"],
    ['<p>Hello</p>', '<script>evil()</script>', "html"],
    ['<span data-tooltip="Hello">Hi</span>', '<span data-tooltip="&lt;img src=x onerror=evil()&gt;">Ahoj</span>', "html"],
    ['[[/r 1d20]]', '[[/r 100d20]]', "text"],
    ['@UUID[Actor.a]{Name}', '@UUID[Actor.b]{Jméno}', "text"],
    ['Text', '@Macro[evil]', "text"],
    ['[Hello](https://example.com)', '[Ahoj](javascript:evil)', "markdown"],
  ] as const)("rejects injected markup, commands and link changes", (source, translation, format) => {
    expect(() => assertPortableText(source, translation, format)).toThrow();
  });
  it("remaps only actual references, keeping embedded IDs and avoiding prefix collisions", () => {
    const mapped = remapBundleReferences({ text: '@UUID[JournalEntry.a.JournalEntryPage.p]{Chapter} @UUID[JournalEntry.ab]', id: 'JournalEntry.a' }, new Map([["JournalEntry.a", "Compendium.world.translations.JournalEntry.new"]]));
    expect(mapped.text).toContain('Compendium.world.translations.JournalEntry.new.JournalEntryPage.p');
    expect(mapped.text).toContain('@UUID[JournalEntry.ab]');
    expect(mapped.id).toBe('JournalEntry.a');
  });
});
