import { isDecorativeIconText } from "../translation/decorative-text";
import { planReviewText } from "./text-plan";

/** A single source-owned missing text leaf, never caller HTML or a tag repair. */
export interface SourcePunctuationRestoration {
  parentPath: number[]; text: string; unitId: string; partIndex: number;
}
export interface SourcePunctuationDiagnostic {
  stage: "raw-walk" | "candidate" | "unit-alignment" | "ready";
  predicate: string;
  path?: string;
  candidateCount?: number;
  sourceChildren?: number;
  targetChildren?: number;
}
const BLOCKS = "p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,div,section,article,figcaption,dt,dd";
const EXCLUDED = "script,style,code,pre,textarea,noscript,template";
const INLINE = new Set(["STRONG", "EM", "B", "I", "U", "SPAN"]);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const attributes = (element: Element) => [...element.attributes].map(attr => [attr.name, attr.value]).sort();
function template(value: string) {
  const element = document.createElement("template"); element.innerHTML = value; element.content.normalize(); return element;
}
function serialize(fragment: DocumentFragment) {
  const element = document.createElement("div"); element.append(fragment.cloneNode(true)); return element.innerHTML;
}
function nodeAt(root: Node, path: readonly number[]): Node | undefined {
  let node: Node | undefined = root;
  for (const index of path) node = node?.childNodes[index];
  return node;
}
const address = (path: readonly number[]) => `html/${path.join("/")}`;

/** Strictly prove the only structural difference is one empty inline leaf.
 * All element names/attributes (including secrets, URLs and system gates) and
 * all other node shapes must match. Ordinary translated text is retained.
 */
export function restoreSourcePunctuation(source: string, before: string, diagnostic?: { value?: SourcePunctuationDiagnostic }): { value: string; proof: SourcePunctuationRestoration } | null {
  const reject = (stage: SourcePunctuationDiagnostic["stage"], predicate: string,
    details: Omit<SourcePunctuationDiagnostic, "stage" | "predicate"> = {}): null => {
    if (diagnostic) diagnostic.value = { stage, predicate, ...details };
    return null;
  };
  const mismatch = (predicate: string, path: number[], a: Node, b: Node): false => {
    reject("raw-walk", predicate, { path: address(path), sourceChildren: a.childNodes.length, targetChildren: b.childNodes.length });
    return false;
  };
  const original = template(source), copy = template(before);
  const candidates: { source: Element; target: Element; parentPath: number[] }[] = [];
  const walk = (a: Node, b: Node, path: number[]): boolean => {
    if (a.nodeType !== b.nodeType) return mismatch("node-type-equal", path, a, b);
    if (a.nodeType === 3) return true;
    if (a.nodeType === 1) {
      const element = a as Element, target = b as Element;
      if (element.tagName !== target.tagName || !equal(attributes(element), attributes(target))) return mismatch(element.tagName !== target.tagName ? "tag-equal" : "all-raw-attributes-equal", path, a, b);
      if (element.matches(EXCLUDED)) return element.outerHTML === target.outerHTML || mismatch("excluded-outerHTML-equal", path, a, b);
      if (a.childNodes.length === 1 && a.firstChild?.nodeType === 3 && b.childNodes.length === 0 &&
          INLINE.has(element.tagName) && !element.closest(EXCLUDED) && element.textContent!.length <= 16 && /^[,.;:!?]+$/u.test(element.textContent!.trim())) {
        candidates.push({ source: element, target, parentPath: [...path] }); return true;
      }
    } else if (a.nodeType !== 11 && a.textContent !== b.textContent) return mismatch("non-element-text-equal", path, a, b);
    return (a.childNodes.length === b.childNodes.length || mismatch("children-count-equal", path, a, b)) && [...a.childNodes].every((child, index) => walk(child, b.childNodes[index]!, [...path, index]));
  };
  if (!walk(original.content, copy.content, [])) return null;
  if (candidates.length !== 1) return reject("candidate", "exactly-one-inline-punctuation-candidate", { candidateCount: candidates.length });
  const candidate = candidates[0]!, block = candidate.source.closest(BLOCKS);
  if (!block) return reject("candidate", "existing-closest-prose-block"); // Never manufacture a new standalone editor row.
  const addresses = new Map<Node, number[]>();
  const visit = (node: Node, path: number[]) => {
    addresses.set(node, path); [...node.childNodes].forEach((child, index) => visit(child, [...path, index]));
  };
  visit(original.content, []);
  const unitId = address(addresses.get(block)!);
  const parts = [...addresses.keys()].filter(node => node.nodeType === 3 && node.textContent?.trim() &&
    !node.parentElement?.closest(EXCLUDED) && !isDecorativeIconText(node) && node.parentElement?.closest(BLOCKS) === block);
  const partIndex = parts.indexOf(candidate.source.firstChild!);
  if (partIndex < 0) return reject("candidate", "planned-nondecorative-text-leaf");
  const text = candidate.source.textContent!;
  candidate.target.append(document.createTextNode(text));
  const value = serialize(copy.content), beforePlan = planReviewText(before, "html"), afterPlan = planReviewText(value, "html");
  const beforeRow = beforePlan.units.find(unit => unit.id === unitId), afterRow = afterPlan.units.find(unit => unit.id === unitId);
  if (!beforeRow || !afterRow || afterRow.attribute || beforeRow.parts.length + 1 !== afterRow.parts.length || afterRow.parts[partIndex] !== text ||
      !equal(afterRow.parts.filter((_, index) => index !== partIndex), beforeRow.parts) || beforePlan.units.length !== afterPlan.units.length ||
      beforePlan.units.some(unit => !equal(unit, unit.id === unitId ? { ...afterRow, parts: beforeRow.parts } : afterPlan.units.find(other => other.id === unit.id)))) return reject("unit-alignment", "single-added-part-and-all-unrelated-units-exact", { path: unitId });
  if (diagnostic) diagnostic.value = { stage: "ready", predicate: "proved-single-punctuation-leaf", path: unitId, candidateCount: 1 };
  return { value, proof: { parentPath: candidate.parentPath, text, unitId, partIndex } };
}

/** The receipt-bound inverse removes only that exact source leaf. Later prose
 * in unrelated rows stays intact, and the prior plan will be re-proved on undo.
 */
export function removeSourcePunctuation(source: string, value: string, proof: SourcePunctuationRestoration): string | null {
  const original = template(source), copy = template(value);
  const a = nodeAt(original.content, proof.parentPath), b = nodeAt(copy.content, proof.parentPath);
  if (a?.nodeType !== 1 || b?.nodeType !== 1 || (a as Element).tagName !== (b as Element).tagName ||
      !equal(attributes(a as Element), attributes(b as Element)) || a.childNodes.length !== 1 || b.childNodes.length !== 1 ||
      a.firstChild?.nodeType !== 3 || b.firstChild?.nodeType !== 3 || a.textContent !== proof.text || b.textContent !== proof.text) return null;
  b.removeChild(b.firstChild);
  const before = serialize(copy.content), restored = restoreSourcePunctuation(source, before);
  if (!restored || !equal(restored.proof, proof) || restored.value !== serialize(template(value).content)) return null;
  return before;
}
