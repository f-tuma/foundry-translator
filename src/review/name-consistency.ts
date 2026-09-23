import { MODULE_ID } from "../constants";
import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import { normalizeCzechGlossaryForm } from "../glossary/inflection";
import type { GlossaryEntry } from "../glossary/types";
import { displayParts, findTextMatches, searchableSegments, type SearchIndex } from "./search";
import type { ReviewDocument, ReviewRow } from "./service";

export const NAME_FORMS_SETTING = "reviewNameForms";
export interface ApprovedNameForm { key: string; form: string; at: string; userName: string }
export interface NameForms { version: 1; entries: ApprovedNameForm[] }
export type NameStatus = "exact" | "inflected" | "approved" | "case" | "variant" | "original" | "missing";
export interface NameFinding {
  document: ReviewDocument; rowId: string; group: string; groupName: string;
  term: GlossaryEntry; candidate: string; status: NameStatus; source: string; translation: string; blocked: string | null;
}
export interface NameAudit { findings: NameFinding[]; checkedRows: number; checkedTerms: number; skippedRows: number }
export const nameFormKey = (term: GlossaryEntry, language: string) => JSON.stringify([language, term.source, term.replacement, term.mode ?? "fixed"]);
const fold = (text: string) => text.normalize("NFC").toLocaleLowerCase();
const wordPattern = /[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*/gu;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/gu, "\\s+");
export const isNameConcern = (finding: NameFinding) => !["exact", "inflected", "approved"].includes(finding.status);

/** Only prose and displayed reference labels participate, never UUIDs or code. */
function prose(row: ReviewRow, side: "source" | "translation"): string[] {
  const parts = row[side];
  // Inline formatting splits a sentence into adjacent nodes. Joining is safe for
  // this read-only audit; actual edits still use the structural paragraph editor.
  return searchableSegments([parts.join("")], row.format).map(segment => segment.text);
}
function windows(text: string, term: string): string[] {
  const words = [...text.matchAll(wordPattern)], count = [...term.matchAll(wordPattern)].length;
  if (!count || count > 30) return [];
  const result: string[] = [];
  for (let i = 0; i + count <= words.length; i++) {
    const first = words[i]!, last = words[i + count - 1]!;
    result.push(text.slice(first.index!, last.index! + last[0].length));
  }
  return result;
}
function classify(term: GlossaryEntry, candidate: string, language: string, forms: NameForms): NameStatus | null {
  const canonical = term.replacement.normalize("NFC"), text = candidate.normalize("NFC");
  if (text === canonical) return "exact";
  if (fold(text) === fold(canonical)) return term.category === "term" ? "exact" : "case";
  if (term.mode === "inflect") {
    if (forms.entries.some(entry => entry.key === nameFormKey(term, language) && entry.form === text)) return "approved";
    const normalized = language === "cs" ? normalizeCzechGlossaryForm(canonical, text) : null;
    if (normalized) return normalized === text || term.category === "term" ? "inflected" : "case";
  }
  return null;
}
/** Source-anchored check: longest glossary phrases win over shorter overlapping
 * names. Similarity is an invitation to inspect, never a grammatical verdict. */
export async function auditNames(index: SearchIndex, glossary: readonly GlossaryEntry[], language: string, forms: NameForms,
  cancelled: () => boolean = () => false, progress: (done: number, total: number) => void = () => {}): Promise<NameAudit> {
  const terms = glossary.filter(term => term.enabled !== false && term.source.trim() && term.replacement.trim());
  const lookup = new Map<string, GlossaryEntry[]>();
  for (const term of terms) for (const source of [term.source, ...term.aliases]) {
    const key = fold(source).replace(/\s+/gu, " ");
    lookup.set(key, [...new Set([...(lookup.get(key) ?? []), term])]);
  }
  const pattern = [...lookup.keys()].sort((a, b) => b.length - a.length).map(escaped).join("|");
  const sourceNames = pattern ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, "giu") : null;
  const result: NameAudit = { findings: [], checkedRows: 0, checkedTerms: 0, skippedRows: 0 };
  const total = index.snapshots.reduce((sum, snapshot) => sum + snapshot.rows.length, 0);
  let done = 0;
  for (const snapshot of index.snapshots) for (const row of snapshot.rows) {
    if (done++ % 30 === 0) { progress(done - 1, total); await new Promise(resolve => setTimeout(resolve, 0)); if (cancelled()) throw new Error("Review.SearchCancelled"); }
    if (row.blocked) { result.skippedRows++; continue; }
    result.checkedRows++;
    const expected = new Set<GlossaryEntry>();
    for (const text of prose(row, "source")) for (const match of sourceNames ? text.matchAll(sourceNames) : []) {
      for (const term of lookup.get(fold(match[0]).replace(/\s+/gu, " ")) ?? []) {
        // Single-word proper names such as Tempest must not capture the common
        // noun "tempest". Generic terminology remains case-insensitive.
        if (term.category !== "term" && !/\s/u.test(match[0]) && /\p{Lu}/u.test(term.source[0] ?? "") && !/\p{Lu}/u.test(match[0][0] ?? "") && !row.heading) continue;
        expected.add(term);
      }
    }
    const translated = prose(row, "translation");
    for (const term of expected) {
      result.checkedTerms++;
      const candidates = new Map<string, NameStatus>();
      for (const text of translated) {
        for (const candidate of windows(text, term.replacement)) {
          const status = classify(term, candidate, language, forms);
          if (status) candidates.set(candidate, status);
        }
        for (const form of forms.entries.filter(entry => entry.key === nameFormKey(term, language) && term.mode === "inflect")) {
          for (const match of findTextMatches(text, form.form)) if (match.text === form.form) candidates.set(match.text, "approved");
        }
        for (const match of findTextMatches(text, term.replacement, true)) {
          if (!candidates.has(match.text) && ![...expected].some(other => other !== term && classify(other, match.text, language, forms))) candidates.set(match.text, "variant");
        }
        for (const original of [term.source, ...term.aliases]) for (const match of findTextMatches(text, original)) {
          if (fold(original) !== fold(term.replacement) && !classify(term, match.text, language, forms)
            && ![...candidates].some(([candidate, status]) => ["exact", "inflected", "approved"].includes(status) && candidate.includes(match.text))) candidates.set(match.text, "original");
        }
      }
      if (!candidates.size) candidates.set("", "missing");
      for (const [candidate, status] of candidates) result.findings.push({ document: snapshot.entry, rowId: row.id, group: row.group,
        groupName: snapshot.groups.find(group => group.id === row.group)?.name ?? row.group, term, candidate, status,
        source: displayParts(row.source), translation: displayParts(row.translation), blocked: row.blocked });
    }
  }
  progress(total, total); return result;
}
export function registerNameForms(): void {
  game.settings.register(MODULE_ID, NAME_FORMS_SETTING, { name: "Approved glossary forms", hint: "", scope: "world", config: false, type: Object, default: { version: 1, entries: [] } });
}
export function readNameForms(): NameForms {
  const value = game.settings.get(MODULE_ID, NAME_FORMS_SETTING) as NameForms | undefined;
  return value?.version === 1 && Array.isArray(value.entries) ? { version: 1, entries: value.entries.filter(entry => entry && typeof entry.key === "string" && typeof entry.form === "string" && typeof entry.at === "string" && typeof entry.userName === "string").map(entry => ({ ...entry })) } : { version: 1, entries: [] };
}
export async function saveNameForm(expected: NameForms, term: GlossaryEntry, language: string, form: string, remove = false): Promise<NameForms> {
  if (!game.user?.isGM) throw new Error("Review.GMOnly");
  if (term.mode !== "inflect" || !form.trim() || form.length > 300 || /[<>\r\n\t]|@(?:UUID|Embed)\[|\[\[/u.test(form)) throw new Error("Review.NameFormInvalid");
  const key = nameFormKey(term, language);
  const currentGlossary = await new GlossaryCompendiumRepository().loadExisting();
  if (!currentGlossary.some(entry => entry.enabled !== false && nameFormKey(entry, language) === key)) throw new Error("Review.NameGlossaryChanged");
  const current = readNameForms();
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("Review.Conflict");
  const entries = current.entries.filter(entry => entry.key !== key || entry.form !== form);
  if (!remove) entries.push({ key, form: form.normalize("NFC"), at: new Date().toISOString(), userName: (game.user as { name?: string }).name ?? "GM" });
  if (entries.length > 20000) throw new Error("Review.NameFormInvalid");
  const next: NameForms = { version: 1, entries }; await game.settings.set(MODULE_ID, NAME_FORMS_SETTING, next); return next;
}
