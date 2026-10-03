import { assertPortableText } from "../bundles/format";
import { sourceReferenceNotation } from "../bundles/reference-notation";
import { discoverDocumentDependencies, rewriteDocumentReferences } from "./document-dependencies";
import { eventMechanics, resolveEmberBinding } from "./ember-runtime-bridge";
import { resolveSourceReference, resolveTranslationReference, sourceReferenceUuid } from "./document-identity";
import { readJournalTranslationFlag } from "./journal";

interface Page extends FoundryUuidDocument {
  type?: string; visible?: boolean; isOwner?: boolean;
  system?: { eventId?: string; event?: EventNode; _source?: Record<string, unknown> };
}
interface Outcome { id: string; label: string; summary: string }
interface EventNode { page?: string; outcomes?: Record<string, { id?: string; label?: string; summary?: string; text?: { summary?: string } }> }
export interface OutcomeSection { sectionClass?: string; content?: string; [key: string]: unknown }
export interface OutcomeEnvironment {
  resolve(uuid: string): Promise<Page | null>;
  pair: typeof resolveTranslationReference;
  source: typeof resolveSourceReference;
  binding(page: Page): EventNode | undefined;
}
const environment: OutcomeEnvironment = {
  resolve: async uuid => await fromUuid(uuid) as Page | null,
  pair: resolveTranslationReference, source: resolveSourceReference,
  binding: page => page.system ? resolveEmberBinding(page.system as any).event : undefined,
};
const identity = (page: Page) => JSON.stringify(readJournalTranslationFlag(page.parent?.flags));
const visible = (page: Page) => page.visible === true && (page.parent as Page | undefined)?.visible === true;
const processed = (page: Page) => {
  const flag = readJournalTranslationFlag(page.parent?.flags);
  return flag && (!flag.partial || (!!page.id && flag.processedPageIds?.includes(page.id)));
};
function outcomes(page: Page): Outcome[] | null {
  const values = page.system?._source?.outcomes;
  if (!Array.isArray(values) || values.length > 500) return null;
  const ids = new Set<string>();
  for (const value of values) {
    if (!value || typeof value.id !== "string" || !value.id || ids.has(value.id)
      || typeof value.label !== "string" || typeof value.summary !== "string") return null;
    ids.add(value.id);
  }
  return values;
}

/** Ember escapes outcome summaries in its native choice template. Replace only
 * those text slots, by exact outcome ID, before native/Reader enrichment. The
 * canonical event, choice state, controls and registry are never written. */
export async function translatedOutcomeSections(sheet: { document: Page; isView?: boolean }, sections: OutcomeSection[],
  env: OutcomeEnvironment = environment): Promise<OutcomeSection[]> {
  const page = sheet.document, flag = readJournalTranslationFlag(page.parent?.flags);
  if (!sheet.isView || !["ember.questEvent", "ember.standaloneEvent"].includes(page.type ?? "")
    || !flag || !processed(page) || !visible(page) || !page.parent) return sections;
  const uuid = sourceReferenceUuid(page.uuid, page.parent);
  if (!uuid) return sections;
  const source = await env.resolve(uuid);
  if (!source || source.uuid !== uuid || source.documentName !== "JournalEntryPage" || source.type !== page.type
    || !visible(source) || readJournalTranslationFlag(source.parent?.flags)) return sections;
  const pair = await env.pair(uuid, flag.targetLanguage);
  if (pair.status !== "mapped" || pair.sourceUuid !== uuid || pair.translatedUuid !== page.uuid) return sections;
  const original = outcomes(source), translated = outcomes(page), event = env.binding(page);
  if (!original || !translated || !event || event.page !== uuid || !source.system?._source || !page.system?._source
    || source.system.eventId !== page.system.eventId || !page.system.eventId
    || eventMechanics(source.system._source) !== eventMechanics(page.system._source)) return sections;
  const pageIdentity = identity(page), sourceValues = JSON.stringify(original), translatedValues = JSON.stringify(translated);
  const sourceOwner = source.isOwner, pageOwner = page.isOwner;
  const current = () => !!(visible(page) && visible(source) && processed(page) && identity(page) === pageIdentity
    && !readJournalTranslationFlag(source.parent?.flags) && page.isOwner === pageOwner && source.isOwner === sourceOwner
    && page.type === source.type && source.uuid === uuid && !!page.parent && sourceReferenceUuid(page.uuid, page.parent) === uuid
    && JSON.stringify(outcomes(source)) === sourceValues && JSON.stringify(outcomes(page)) === translatedValues
    && env.binding(page) === event && event.page === uuid && source.system?.eventId === page.system?.eventId
    && !!source.system?._source && !!page.system?._source && eventMechanics(source.system._source) === eventMechanics(page.system._source));
  const accepted: (() => boolean)[] = [];
  const result: OutcomeSection[] = [];
  for (const section of sections) {
    if (section.sectionClass !== "outcomes" || typeof section.content !== "string" || section.content.length > 500000) {
      result.push(section); continue;
    }
    const root = document.createElement("div"); root.innerHTML = section.content;
    let changed = false;
    const inputs = [...root.querySelectorAll<HTMLInputElement>("form.choices input.event-outcome-checkbox")];
    for (const input of inputs) {
      if (inputs.filter(other => other.value === input.value).length !== 1) continue;
      const before = original.find(value => value.id === input.value), after = translated.find(value => value.id === input.value);
      const native = event.outcomes?.[input.value];
      if (!before || !after || !after.summary.trim() || after.summary === before.summary || !native || native.id !== input.value
        || native.summary !== before.summary || native.text?.summary !== before.summary || native.label !== before.label) continue;
      const card = input.closest("div.outcome,fieldset.standalone.outcome");
      const notes = card?.querySelectorAll<HTMLElement>(":scope > p.notes");
      // Never replace enriched elements, unexpected template shapes or a stale native summary.
      if (!card || card.querySelectorAll("input.event-outcome-checkbox").length !== 1 || notes?.length !== 1
        || notes[0]!.children.length || notes[0]!.textContent !== before.summary) continue;
      const slot = notes[0]!;
      try {
        const replacements = [];
        for (const dependency of discoverDocumentDependencies(after.summary)) {
          const originalUuid = await env.source(dependency.sourceUuid);
          if (!originalUuid) throw new Error("Unresolved outcome reference");
          if (originalUuid !== dependency.sourceUuid) replacements.push({ sourceUuid: dependency.sourceUuid, translatedUuid: originalUuid });
        }
        assertPortableText(before.summary, sourceReferenceNotation(before.summary,
          rewriteDocumentReferences(after.summary, replacements), source.uuid), "text");
        const unchanged = () => current() && event.outcomes?.[input.value] === native && native.id === before.id
          && native.summary === before.summary && native.text?.summary === before.summary && native.label === before.label;
        if (!unchanged()) continue;
        accepted.push(unchanged);
        slot.textContent = after.summary;
        changed = true;
      } catch { /* Keep the source summary rather than expose invalid prose/commands. */ }
    }
    result.push(changed ? { ...section, content: root.innerHTML } : section);
  }
  if (!accepted.length) return sections;
  const finalPair = await env.pair(uuid, flag.targetLanguage);
  return current() && accepted.every(check => check()) && finalPair.status === "mapped" && finalPair.sourceUuid === uuid
    && finalPair.translatedUuid === page.uuid ? result : sections;
}
