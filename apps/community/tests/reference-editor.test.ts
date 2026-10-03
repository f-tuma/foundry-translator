import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { parseHTML } from "linkedom";
import { maskReviewParts } from "../../../src/review/text-plan";
import { RowReferences } from "../src/components/reference-editor";

it("shows source and current existing embed prose in one disclosure with a separate brace label", () => {
  const source = ['@Embed[Actor.a inline readaloud="English prose" caption="English caption" label="English name"]{Brace source}'];
  const target = maskReviewParts(['@Embed[Actor.a inline readaloud="Český text" caption="Titulek" label="Název"]{Popisek}']);
  const html = renderToStaticMarkup(createElement(RowReferences, { source, target, label: "Oddíl", onChange: vi.fn() }));
  const { document } = parseHTML(html);
  expect(document.querySelectorAll("details")).toHaveLength(1);
  expect(document.querySelectorAll('[data-reference-option="readaloud"]')).toHaveLength(2);
  const original = document.querySelector('textarea[aria-label="Originál Oddíl — Text ke čtení nahlas ⟦1⟧"]')!;
  expect(original.textContent).toBe("English prose");
  expect(original.hasAttribute("readonly") || original.hasAttribute("readOnly")).toBe(true);
  expect(document.querySelector('input[aria-label="Oddíl — popisek ⟦1⟧"]')?.getAttribute("value")).toBe("Popisek");
  expect(document.querySelector('input[aria-label="Oddíl — Název vloženého náhledu ⟦1⟧"]')?.getAttribute("value")).toBe("Název");
  expect(document.querySelectorAll('[data-reference-option]')).toHaveLength(6);
  expect(document.querySelector('input[value="Actor.a"]')).toBeNull();
});
it("does not add absent or structural options and escapes unfinished option text as a value", () => {
  const target = maskReviewParts(['@Embed[Actor.a inline width="300" caption="Caption"]']);
  target.references[0]![0]!.options![0]!.value = '<img src=x onerror=alert(1)>';
  const { document } = parseHTML(renderToStaticMarkup(createElement(RowReferences, { target, label: "Oddíl", onChange: vi.fn() })));
  expect(document.querySelectorAll('[data-reference-option]')).toHaveLength(1);
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('[data-reference-option="caption"]')?.getAttribute("value")).toBe('<img src=x onerror=alert(1)>');
  expect(document.querySelector('[data-reference-option="width"]')).toBeNull();
});
it("keeps safe existing options editable independently of a protected brace label", () => {
  const target = maskReviewParts(['@Embed[Actor.a caption="Caption"]']);
  target.references[0]![0]!.editable = false;
  const { document } = parseHTML(renderToStaticMarkup(createElement(RowReferences, { target, label: "Oddíl", onChange: vi.fn() })));
  const option = document.querySelector('[data-reference-option="caption"]')!;
  expect(option.hasAttribute("readonly") || option.hasAttribute("readOnly")).toBe(false);
  expect(document.querySelector('input[aria-label="Oddíl — popisek ⟦1⟧"]')).toBeNull();
});
it("pairs moved embeds by immutable command identity and leaves competing duplicates unmatched", () => {
  const source = ['@Embed[Actor.a readaloud="Original A"] @Embed[Actor.b readaloud="Original B"]'];
  const target = maskReviewParts(['@Embed[Actor.b readaloud="Překlad B"] @Embed[Actor.a readaloud="Překlad A"]']);
  const { document } = parseHTML(renderToStaticMarkup(createElement(RowReferences, { source, target, label: "Oddíl", onChange: vi.fn() })));
  const entries = document.querySelectorAll('.reference-entry');
  expect(entries[0]!.querySelector('textarea[aria-label^="Originál"]')?.textContent).toBe('Original B');
  expect(entries[1]!.querySelector('textarea[aria-label^="Originál"]')?.textContent).toBe('Original A');
  const duplicates = maskReviewParts(['@Embed[Actor.a readaloud="Překlad A"] @Embed[Actor.a readaloud="Další A"]']);
  const { document: ambiguous } = parseHTML(renderToStaticMarkup(createElement(RowReferences, {
    source: ['@Embed[Actor.a readaloud="Original A"] @Embed[Actor.a readaloud="Another A"]'], target: duplicates, label: 'Oddíl', onChange: vi.fn(),
  })));
  expect(ambiguous.querySelectorAll('textarea[aria-label^="Originál"]')).toHaveLength(0);
  expect(ambiguous.querySelector('.reference-columns p')?.textContent).toBe('Originál nelze jednoznačně přiřadit.');
});
