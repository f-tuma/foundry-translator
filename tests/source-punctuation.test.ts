import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { restoreSourcePunctuation, removeSourcePunctuation } from "../src/review/source-punctuation";
beforeEach(() => vi.stubGlobal("document", parseHTML("<html></html>").document));
afterEach(() => vi.unstubAllGlobals());
const source = '<section class="block"><p>First<strong>,</strong> then second.</p><p>Keep other prose.</p></section>';
const before = '<section class="block"><p>První<strong></strong> a druhá.</p><p>Zachovat další text.</p></section>';

it("restores only one source-owned comma leaf with its structural address and retains all translated prose", () => {
  const restored = restoreSourcePunctuation(source, before)!;
  expect(restored.value).toBe(before.replace("<strong></strong>", "<strong>,</strong>"));
  expect(restored.proof).toEqual({ parentPath: [0, 0, 1], text: ",", unitId: "html/0/0", partIndex: 1 });
  expect(removeSourcePunctuation(source, restored.value, restored.proof)).toBe(before);
  expect(restoreSourcePunctuation(source, restored.value)).toBeNull();
});

it.each([
  source.replace(",", "2"), source.replace(",", "missing prose"), source.replace(",", "[["), source.replace(",", "@"),
  source.replace(",", "&Reference[Exhaustion]"), source.replace(",", " "),
])("never restores missing words, numbers, executable delimiters or whitespace: %s", candidate => {
  expect(restoreSourcePunctuation(candidate, before)).toBeNull();
});

it.each([
  before.replace("<strong></strong>", "<em></em>"),
  before.replace("<strong></strong>", '<strong class="secret"></strong>'),
  before.replace('class="block"', 'class="secret"'),
  before.replace("<strong></strong>", "<strong> </strong>"),
  before.replace("<strong></strong>", "<strong><span></span></strong>"),
  before.replace("<p>Zachovat další text.</p>", "<div>Zachovat další text.</div>"),
  before.replace("<p>Zachovat další text.</p>", '<p><a href="https://attacker.invalid">Zachovat další text.</a></p>'),
])("rejects tag, attribute, secret boundary or other structural mutations: %s", candidate => {
  expect(restoreSourcePunctuation(source, candidate)).toBeNull();
});

it("refuses two missing leaves, excluded/code content and a new standalone editor row", () => {
  expect(restoreSourcePunctuation(source.replace("second.", "<em>;</em>second."), before.replace("druhá.", "<em></em>druhá."))).toBeNull();
  expect(restoreSourcePunctuation('<p><code><strong>,</strong></code>Rest.</p>', '<p><code><strong></strong></code>Zbytek.</p>')).toBeNull();
  expect(restoreSourcePunctuation('<strong>,</strong><p>Rest.</p>', '<strong></strong><p>Zbytek.</p>')).toBeNull();
});

it.each(["address", "text", "part", "unit", "current-punctuation", "current-attribute"])("the inverse refuses forged or changed restoration proof: %s", kind => {
  const restored = restoreSourcePunctuation(source, before)!, proof = structuredClone(restored.proof);
  let value = restored.value;
  if (kind === "address") proof.parentPath = [0, 1];
  if (kind === "text") proof.text = ";";
  if (kind === "part") proof.partIndex = 0;
  if (kind === "unit") proof.unitId = "foreign";
  if (kind === "current-punctuation") value = value.replace("<strong>,</strong>", "<strong>;</strong>");
  if (kind === "current-attribute") value = value.replace("<strong>,</strong>", '<strong title="Changed">,</strong>');
  expect(removeSourcePunctuation(source, value, proof)).toBeNull();
});

it("inverse retains unrelated later prose", () => {
  const restored = restoreSourcePunctuation(source, before)!;
  const value = restored.value.replace("Zachovat další text.", "Později upravený text.");
  expect(removeSourcePunctuation(source, value, restored.proof)).toBe(before.replace("Zachovat další text.", "Později upravený text."));
});
