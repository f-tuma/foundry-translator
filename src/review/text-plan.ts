import { FOUNDRY_EXPRESSION } from "../translation/foundry-syntax";
import type { FieldFormat } from "../bundles/fields";

export interface ReviewTextUnit { id: string; parts: string[]; heading: boolean; attribute?: string }
export interface ReviewTextPlan {
  units: ReviewTextUnit[];
  replace(id: string, parts: readonly string[]): string;
}
const BLOCKS = "p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,div,section,article,figcaption,dt,dd";
const EXCLUDED = "script,style,code,pre,textarea,noscript,template";
const ATTRIBUTES = new Set(["alt", "title", "aria-label", "data-tooltip", "data-tooltip-text", "placeholder"]);

/** Structural addresses align paragraphs without depending on translated text length.
 * Edits touch text nodes only: formatting, assets and system attributes stay intact. */
export function planReviewText(value: string, format: FieldFormat): ReviewTextPlan {
  if (format !== "html") return {
    units: [{ id: "text", parts: [value], heading: false }],
    replace(id, parts) { if (id !== "text" || parts.length !== 1) throw new Error("Invalid review block."); return parts[0]!; },
  };
  const template = document.createElement("template");
  template.innerHTML = value;
  const groups = new Map<string, { unit: ReviewTextUnit; setters: ((value: string) => void)[] }>();
  const address = new Map<Node, string>();
  const visit = (node: Node, path: string): void => {
    address.set(node, path);
    [...node.childNodes].forEach((child, i) => visit(child, `${path}/${i}`));
  };
  visit(template.content, "html");
  const add = (id: string, text: string, setter: (value: string) => void, heading = false, attribute?: string) => {
    const group = groups.get(id) ?? { unit: { id, parts: [], heading, ...(attribute ? { attribute } : {}) }, setters: [] };
    group.unit.parts.push(text); group.setters.push(setter); groups.set(id, group);
  };
  for (const [node, path] of address) {
    if (node.nodeType !== 3 || node.parentElement?.closest(EXCLUDED) || !node.textContent?.trim()) continue;
    const block = node.parentElement?.closest(BLOCKS);
    add(block ? address.get(block)! : path, node.textContent, value => { node.textContent = value; }, !!block?.matches("h1,h2,h3,h4,h5,h6"));
  }
  for (const element of template.content.querySelectorAll("*")) {
    if (element.closest(EXCLUDED)) continue;
    for (const attr of element.attributes) {
      if (ATTRIBUTES.has(attr.name) && attr.value.trim() && !/^[A-Z][A-Z0-9_]*(?:\.[A-Za-z0-9_-]+)+$/u.test(attr.value)) {
        add(`${address.get(element)}@${attr.name}`, attr.value, value => element.setAttribute(attr.name, value), false, attr.name);
      }
    }
  }
  return {
    units: [...groups.values()].map(group => group.unit),
    replace(id, parts) {
      const group = groups.get(id);
      if (!group || parts.length !== group.setters.length) throw new Error("Invalid review block.");
      group.setters.forEach((set, i) => set(parts[i]!));
      const serializer = document.createElement("div");
      serializer.append(template.content.cloneNode(true));
      return serializer.innerHTML;
    },
  };
}

export interface ReviewReference { marker: string; command: string; label: string; editable: boolean }
export interface ReviewTextDraft { text: string[]; references: ReviewReference[][] }
const MARKER = /⟦+[^⟦⟧]*⟧+/gu;

/** Number across the whole paragraph, including its formatted text fragments. */
export function maskReviewParts(values: readonly string[]): ReviewTextDraft {
  let number = 0;
  const literal = values.join("\n");
  const parts = values.map(value => {
    const references: ReviewReference[] = [];
    const text = value.replace(FOUNDRY_EXPRESSION, command => {
      let marker = `⟦${++number}⟧`;
      while (literal.includes(marker)) marker = `⟦${marker}⟧`;
      const match = /^(@(?:UUID|Embed)\[[^\]\r\n]*\])(?:\{([^}\r\n]*)\})?$/iu.exec(command);
      references.push({ marker, command, label: match?.[2] ?? "", editable: !!match });
      return marker;
    });
    return { text, references };
  });
  return { text: parts.map(part => part.text), references: parts.map(part => part.references) };
}
/** Friendly link markers keep UUIDs and executable syntax out of the editing surface. */
export function maskReviewReferences(value: string): { text: string; references: ReviewReference[] } {
  const draft = maskReviewParts([value]);
  return { text: draft.text[0]!, references: draft.references[0]! };
}

/** Validate complete markers, not substrings or original positions. Restore once,
 * so labels cannot manufacture another marker or a nested Foundry command. */
export function restoreReviewParts(draft: ReviewTextDraft): string[] {
  const references = draft.references.flat();
  const counts = new Map<string, number>();
  for (const text of draft.text) for (const [marker] of text.matchAll(MARKER)) counts.set(marker, (counts.get(marker) ?? 0) + 1);
  const replacements = new Map(references.map(reference => {
    if (counts.get(reference.marker) !== 1 || /[{}\r\n]|@[A-Za-z][A-Za-z0-9]*\[|\[\[/u.test(reference.label)) throw new Error("Review.ReferenceChanged");
    const command = reference.editable ? reference.command.replace(/\{[^}\r\n]*\}$/u, "") + (reference.label ? `{${reference.label}}` : "") : reference.command;
    return [reference.marker, command];
  }));
  if (replacements.size !== references.length) throw new Error("Review.ReferenceChanged");
  return draft.text.map(text => text.replace(MARKER, marker => replacements.get(marker) ?? marker));
}
export function restoreReviewReferences(text: string, references: readonly ReviewReference[]): string {
  return restoreReviewParts({ text: [text], references: [[...references]] })[0]!;
}
