import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import type { GlossaryEntry } from "../glossary/types";
import { renderHelpTooltip, activateHelpTooltips } from "../ui/help-tooltip";
import { button, el, selectControl, t } from "./elements";
import { displayParts, searchableSegments } from "./search";
import { maskReviewReferences } from "./text-plan";
import type { ReviewRow, ReviewSnapshot } from "./service";
import type { EditorialState } from "./editorial";

export interface NoteDraft { state: EditorialState; note: string }
export const noteFor = (row: ReviewRow): NoteDraft => ({ state: row.editorial?.state ?? "none", note: row.editorial?.note ?? "" });
export function contextTerms(row: ReviewRow, glossary: readonly GlossaryEntry[]): GlossaryEntry[] {
  const source = searchableSegments([row.source.join("")], row.format).map(segment => segment.text).join(" ");
  const matches: { term: GlossaryEntry; start: number; end: number }[] = [];
  for (const term of glossary.filter(term => term.enabled !== false)) for (const alias of [term.source, ...term.aliases].filter(Boolean)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
    for (const match of source.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu"))) {
      if (term.category !== "term" && !/\s/u.test(match[0]) && /\p{Lu}/u.test(alias[0] ?? "") && !/\p{Lu}/u.test(match[0][0] ?? "") && !row.heading) continue;
      matches.push({ term, start: match.index!, end: match.index! + match[0].length });
    }
  }
  const selected: typeof matches = [];
  for (const match of matches.sort((a, b) => (b.end - b.start) - (a.end - a.start))) if (!selected.some(other => match.start < other.end && match.end > other.start)) selected.push(match);
  return [...new Set(selected.sort((a, b) => a.start - b.start).map(match => match.term))];
}
export function contextLinks(row: ReviewRow): { uuid: string; label: string }[] {
  const links = new Map<string, string>();
  for (const part of row.source) for (const reference of maskReviewReferences(part).references) {
    const uuid = /^@UUID\[([^\]\r\n]+)\]/iu.exec(reference.command)?.[1];
    if (uuid && !uuid.startsWith(".") && /^(?:Compendium|JournalEntry|Actor|Item|Scene)\.[\w.-]+$/u.test(uuid)) links.set(uuid, reference.label || uuid);
  }
  return [...links].map(([uuid, label]) => ({ uuid, label }));
}
export class ReviewContextPanel {
  #glossary: GlossaryEntry[] = [];
  #loaded = false;
  async load(): Promise<void> { if (!this.#loaded) { this.#glossary = await new GlossaryCompendiumRepository().loadExisting(); this.#loaded = true; } }
  invalidate(): void { this.#loaded = false; }
  render(snapshot: ReviewSnapshot, row: ReviewRow, draft: NoteDraft, callbacks: {
    change(draft: NoteDraft): void; save(): void; discard(): void; close(): void; go(row: ReviewRow): void; open(uuid: string): void;
  }): HTMLElement {
    const root = el("aside", "ft-editorial__context"); root.dataset.reviewContext = ""; root.setAttribute("aria-label", t("Context"));
    const header = el("header", "ft-heading-with-help"); header.append(el("h3", "", t("Context")));
    const help = el("span"); help.innerHTML = renderHelpTooltip(t("EditorialHelp"), t("Context")); header.append(help, button(t("HideContext"), callbacks.close)); root.append(header);
    root.append(el("p", "ft-editorial__selected", displayParts(row.translation)));
    const stateLabel = el("label", "", t("EditorialState"));
    const save = button(t("SaveNote"), callbacks.save); save.dataset.editorialSave = "";
    const discard = button(t("Discard"), callbacks.discard);
    const update = () => { callbacks.change(draft); save.disabled = !!row.blocked || (JSON.stringify(draft) === JSON.stringify(noteFor(row)) && (!row.editorial || row.editorial.fingerprint === row.fingerprint)); discard.hidden = JSON.stringify(draft) === JSON.stringify(noteFor(row)); };
    const state = selectControl(t("EditorialState"), draft.state, [["none", t("EditorialNone")], ["discussion", t("EditorialDiscussion")], ["meaning", t("EditorialMeaning")]], value => { draft.state = value as EditorialState; update(); });
    state.disabled = !!row.blocked; stateLabel.append(state); root.append(stateLabel);
    const noteLabel = el("label", "", t("EditorialNote")), note = el("textarea"); note.value = draft.note; note.rows = 3; note.maxLength = 8000; note.disabled = !!row.blocked; note.setAttribute("aria-label", t("EditorialNote"));
    note.addEventListener("input", () => { draft.note = note.value; update(); }); noteLabel.append(note); root.append(noteLabel);
    save.disabled = !!row.blocked || (JSON.stringify(draft) === JSON.stringify(noteFor(row)) && (!row.editorial || row.editorial.fingerprint === row.fingerprint)); discard.hidden = JSON.stringify(draft) === JSON.stringify(noteFor(row));
    const actions = el("div", "ft-editorial__actions"); actions.append(save, discard); root.append(actions);
    if (row.editorial) root.append(el("small", "", `${row.editorial.userName} · ${new Date(row.editorial.at).toLocaleString()}`));
    if (row.editorial && row.editorial.fingerprint !== row.fingerprint) root.append(el("p", "ft-review__warning", t("EditorialStale")));
    const terms = contextTerms(row, this.#glossary);
    root.append(el("h4", "", t("ContextGlossary")));
    if (!terms.length) root.append(el("p", "", t("ContextNoTerms")));
    for (const term of terms) {
      const card = el("div", "ft-editorial__term"); card.append(el("strong", "", `${term.source} → ${term.replacement}`), el("small", "", t(term.mode === "inflect" ? "ContextInflect" : "ContextExact")));
      if (term.notes) { const info = el("span"); info.innerHTML = renderHelpTooltip(term.notes, term.source); card.append(info); }
      if (term.sourceUuid) card.append(button(t("ContextOpenOriginal"), () => callbacks.open(term.sourceUuid!)));
      root.append(card);
    }
    const links = contextLinks(row);
    if (links.length) { root.append(el("h4", "", t("ContextLinks"))); for (const link of links) root.append(button(link.label, () => callbacks.open(link.uuid))); }
    const field = snapshot.rows.filter(item => item.fieldId === row.fieldId), index = field.findIndex(item => item.id === row.id);
    for (const [neighbor, title] of [[field[index - 1], "ContextPrevious"], [field[index + 1], "ContextNext"]] as const) {
      if (!neighbor) continue;
      const details = el("details", "ft-editorial__neighbor"); details.append(el("summary", "", t(title)), el("p", "", displayParts(neighbor.source)), el("p", "", displayParts(neighbor.translation)), button(t("OpenPassage"), () => callbacks.go(neighbor))); root.append(details);
    }
    activateHelpTooltips(root); return root;
  }
}
