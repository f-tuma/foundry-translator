import { assertPortableText } from "../bundles/format";
import { sourceReferenceNotation } from "../bundles/reference-notation";
import { discoverDocumentDependencies, rewriteDocumentReferences } from "./document-dependencies";
import { eventMechanics, resolveEmberBinding } from "./ember-runtime-bridge";
import { resolveSourceReference, resolveTranslationReference, sourceReferenceUuid } from "./document-identity";
import { readJournalTranslationFlag } from "./journal";

interface Page extends FoundryUuidDocument {
  type?: string; visible?: boolean; isOwner?: boolean; name?: string;
  system?: { eventId?: string; event?: EventNode; _source?: Record<string, unknown> };
}
interface Outcome { id: string; label: string; summary: string }
interface EventNode { id?: string; label?: string; page?: string; active?: boolean; complete?: boolean; outcomes?: Record<string, { id?: string; label?: string; summary?: string; choice?: string; complete?: boolean; text?: { summary?: string } }> }
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

// Snapshot only presentation/provenance and mechanics, never serialize the live
// registry's cyclic document graph. Capture each known page before awaiting the
// next lookup so source and copy changing together cannot pass a late equality.
function pageSnapshot(page: Page): string | null {
  try {
    return JSON.stringify([page.uuid, page.id, page.documentName, page.type, page.name, page.visible, page.isOwner,
      page.parent?.uuid, (page.parent as Page | undefined)?.visible, (page.parent as Page | undefined)?.isOwner,
      identity(page), page.system?.eventId, page.system?._source && eventMechanics(page.system._source), outcomes(page)]);
  } catch { return null; }
}
function eventSnapshot(event: EventNode): string | null {
  try {
    return JSON.stringify([event.id, event.page, event.label, event.active, event.complete,
      Object.entries(event.outcomes ?? {}).map(([key, value]) => [key, value.id, value.label, value.summary,
        value.text?.summary, value.choice, value.complete])]);
  } catch { return null; }
}

/** Ember escapes outcome summaries in its native choice template. Replace only
 * those text slots, by exact outcome ID, before native/Reader enrichment. The
 * canonical event, choice state, controls and registry are never written. */
export async function translatedOutcomeSections(sheet: { document: Page; isView?: boolean }, sections: OutcomeSection[],
  env: OutcomeEnvironment = environment): Promise<OutcomeSection[]> {
  const page = sheet.document, flag = readJournalTranslationFlag(page.parent?.flags);
  if (!sheet.isView || page.documentName !== "JournalEntryPage" || !["ember.questEvent", "ember.standaloneEvent"].includes(page.type ?? "")
    || !flag || !processed(page) || !visible(page) || !page.parent) return sections;
  const uuid = sourceReferenceUuid(page.uuid, page.parent);
  if (!uuid) return sections;
  const pageIdentity = pageSnapshot(page);
  if (!pageIdentity) return sections;
  const source = await env.resolve(uuid);
  if (!source || source.uuid !== uuid || source.documentName !== "JournalEntryPage" || source.type !== page.type
    || !visible(source) || readJournalTranslationFlag(source.parent?.flags)) return sections;
  const sourceIdentity = pageSnapshot(source);
  if (!sourceIdentity) return sections;
  const pair = await env.pair(uuid, flag.targetLanguage);
  if (pair.status !== "mapped" || pair.sourceUuid !== uuid || pair.translatedUuid !== page.uuid) return sections;
  const original = outcomes(source), translated = outcomes(page), event = env.binding(page);
  if (!original || !translated || !event || event.page !== uuid || event.id !== page.system?.eventId || !source.system?._source || !page.system?._source
    || source.system.eventId !== page.system.eventId || !page.system.eventId
    || eventMechanics(source.system._source) !== eventMechanics(page.system._source)) return sections;
  const eventIdentity = eventSnapshot(event);
  if (!eventIdentity) return sections;
  const current = () => !!(visible(page) && visible(source) && processed(page) && pageSnapshot(page) === pageIdentity
    && !readJournalTranslationFlag(source.parent?.flags) && pageSnapshot(source) === sourceIdentity
    && ["ember.questEvent", "ember.standaloneEvent"].includes(page.type ?? "") && page.type === source.type && source.uuid === uuid && !!page.parent && sourceReferenceUuid(page.uuid, page.parent) === uuid
    && eventSnapshot(event) === eventIdentity
    && env.binding(page) === event && event.page === uuid && source.system?.eventId === page.system?.eventId
    && !!source.system?._source && !!page.system?._source && eventMechanics(source.system._source) === eventMechanics(page.system._source));
  const accepted: (() => boolean)[] = [];
  const result: OutcomeSection[] = [];
  for (const section of sections) {
    const inline = section.sectionClass === "inline-outcomes";
    if ((!inline && section.sectionClass !== "outcomes") || typeof section.content !== "string" || section.content.length > 500000) {
      result.push(section); continue;
    }
    const root = document.createElement("div"); root.innerHTML = section.content;
    let changed = false;
    const inputs = [...root.querySelectorAll<HTMLInputElement>("form.choices input.event-outcome-checkbox")];
    for (const input of inputs) {
      if (inputs.filter(other => other.value === input.value).length !== 1) continue;
      const before = original.find(value => value.id === input.value), after = translated.find(value => value.id === input.value);
      const native = event.outcomes?.[input.value];
      if (!before || !after || (inline && !after.label.trim()) || (!inline && (!after.summary.trim() || after.summary === before.summary)) || !native || native.id !== input.value
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
        const label = inline ? card.querySelector<HTMLElement>(":scope > label.checkbox") : null;
        let labelText: Text | undefined;
        if (inline) {
          // This is the native enricher's own fresh template, never a broad DOM
          // lookup. Match the source label as well as the immutable checkbox ID.
          if (!label || label.querySelectorAll("input.event-outcome-checkbox").length !== 1
            || label.querySelector("input") !== input || label.children.length !== 1) continue;
          const texts = [...label.childNodes].filter(node => node.nodeType === 3);
          const nonempty = texts.filter(node => node.textContent?.trim());
          if (nonempty.length !== 1 || nonempty[0]!.textContent?.trim() !== `${before.label}.`) continue;
          assertPortableText(before.label, after.label, "text");
          labelText = nonempty[0] as Text;
        }
        accepted.push(unchanged);
        slot.textContent = after.summary;
        if (labelText) labelText.textContent = ` ${after.label}.`;
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

interface EnrichmentOptions { relativeTo?: Page; [key: string]: unknown }
type EventEnricher = (match: string[], options: EnrichmentOptions) => Promise<HTMLElement | Text> | HTMLElement | Text;
interface EnricherEntry { id?: string; enricher?: EventEnricher; [key: string]: unknown }
export interface EventEnricherEnvironment extends OutcomeEnvironment { event(id: string): EventNode | undefined }
const enricherEnvironment: EventEnricherEnvironment = {
  ...environment, event: id => (globalThis as any).ember?.narrative?.events?.[id],
};
const wrappedEnrichers = new WeakSet<object>();

/** Localize the native enricher's own fresh result, retaining its authoritative
 * event, controls and source UUID. No render-tree scan or registry write. */
export async function translatedInlineOutcome(page: Page, node: HTMLElement | Text,
  env: OutcomeEnvironment = environment): Promise<HTMLElement | Text> {
  if (node.nodeType !== 1 || !(node as HTMLElement).matches("enriched-content.ember-enricher.event-outcome")) return node;
  const element = node as HTMLElement;
  if (element.children.length !== 1 || !element.firstElementChild?.matches("form.choices")) return node;
  const before = element.innerHTML;
  const controls = [...element.querySelectorAll<HTMLInputElement>("input")];
  const controlState = () => JSON.stringify(controls.map(input => [input.value, input.checked, input.disabled, input.indeterminate]));
  const beforeControls = controlState();
  const sections: OutcomeSection[] = [{ sectionClass: "inline-outcomes", content: before }];
  const result = await translatedOutcomeSections({ document: page, isView: true }, sections, env);
  // An async renderer must not clobber a later mutation of its returned node.
  if (result === sections || element.innerHTML !== before || controlState() !== beforeControls
    || !controls.every(input => element.contains(input))) return node;
  const projected = document.createElement("div"); projected.innerHTML = result[0]!.content!;
  const projectedInputs = [...projected.querySelectorAll<HTMLInputElement>("input")];
  if (projectedInputs.length !== controls.length) return node;
  const changes: { notes: HTMLElement; summary: string; label: Text; text: string }[] = [];
  const proof = element.cloneNode(true) as HTMLElement;
  const proofInputs = [...proof.querySelectorAll<HTMLInputElement>("input")];
  for (let i = 0; i < controls.length; i++) {
    const slots = [controls[i]!, projectedInputs[i]!, proofInputs[i]!].map(input => {
      const card = input.closest("div.outcome,fieldset.standalone.outcome");
      const notes = card?.querySelector<HTMLElement>(":scope > p.notes");
      const label = card?.querySelector<HTMLElement>(":scope > label.checkbox");
      const text = label && [...label.childNodes].find(child => child.nodeType === 3 && child.textContent?.trim());
      return { notes, text };
    });
    const [original, translated, cloned] = slots;
    // Re-check the exact narrow slots; a partial/unexpected tree stays native.
    if (controls[i]!.outerHTML !== projectedInputs[i]!.outerHTML || !original?.notes || !original.text
      || !translated?.notes || !translated.text || !cloned?.notes || !cloned.text) return node;
    cloned.notes.textContent = translated.notes.textContent;
    cloned.text.textContent = translated.text.textContent;
    changes.push({ notes: original.notes, summary: translated.notes.textContent ?? "", label: original.text as Text,
      text: translated.text.textContent ?? "" });
  }
  // Prove that no structural/control/attribute change is being projected, then
  // keep every native node/listener and live checkbox property in place.
  if (proof.innerHTML !== projected.innerHTML) return node;
  for (const change of changes) { change.notes.textContent = change.summary; change.label.textContent = change.text; }
  return node;
}

/** Exact eventId/outcomeId from the registered shortcode establishes identity.
 * The visible label is projected only; anchor UUID/icon/status remain native. */
export async function translatedEventState(match: string[], options: EnrichmentOptions, node: HTMLElement | Text,
  env: EventEnricherEnvironment = enricherEnvironment): Promise<HTMLElement | Text> {
  const context = options.relativeTo, flag = readJournalTranslationFlag(context?.parent?.flags);
  const eventId = match[1], outcomeId = match[2]?.trim();
  if (!context || context.documentName !== "JournalEntryPage" || !flag || !processed(context) || !visible(context)
    || !context.parent || !eventId || !/^\w+$/u.test(eventId) || (outcomeId && !/^\w+$/u.test(outcomeId))
    || node.nodeType !== 1 || !(node as HTMLElement).matches("enriched-content.ember-enricher.event-state")) return node;
  const element = node as HTMLElement;
  const links = element.querySelectorAll<HTMLAnchorElement>(":scope > a.content-link[data-uuid]");
  if (element.children.length !== 1 || links.length !== 1) return node;
  const link = links[0]!, event = env.event(eventId), beforeNode = element.innerHTML;
  if (!event || event.id !== eventId || !event.page || link.dataset.uuid !== event.page) return node;
  const contextSourceUuid = sourceReferenceUuid(context.uuid, context.parent);
  if (!contextSourceUuid) return node;
  const contextIdentity = pageSnapshot(context), eventIdentity = eventSnapshot(event);
  if (!contextIdentity || !eventIdentity) return node;
  const contextSource = await env.resolve(contextSourceUuid);
  if (!contextSource || contextSource.uuid !== contextSourceUuid || contextSource.documentName !== "JournalEntryPage"
    || contextSource.type !== context.type || !visible(contextSource) || readJournalTranslationFlag(contextSource.parent?.flags)) return node;
  const contextSourceIdentity = pageSnapshot(contextSource);
  if (!contextSourceIdentity) return node;
  const contextPair = await env.pair(contextSourceUuid, flag.targetLanguage);
  if (contextPair.status !== "mapped" || contextPair.sourceUuid !== contextSourceUuid || contextPair.translatedUuid !== context.uuid) return node;
  const source = await env.resolve(event.page);
  if (!source || source.uuid !== event.page || source.documentName !== "JournalEntryPage"
    || !["ember.questEvent", "ember.standaloneEvent"].includes(source.type ?? "")
    || !visible(source) || readJournalTranslationFlag(source.parent?.flags) || source.system?.eventId !== eventId
    || event.label !== source.name) return node;
  const sourceIdentity = pageSnapshot(source);
  if (!sourceIdentity) return node;
  const pair = await env.pair(source.uuid, flag.targetLanguage);
  if (pair.status !== "mapped" || pair.sourceUuid !== source.uuid || !pair.translatedUuid || pair.translatedUuid === source.uuid) return node;
  const target = await env.resolve(pair.translatedUuid);
  const targetFlag = readJournalTranslationFlag(target?.parent?.flags);
  if (!target || target.uuid !== pair.translatedUuid || target.documentName !== "JournalEntryPage" || target.type !== source.type
    || !visible(target) || !processed(target) || targetFlag?.targetLanguage !== flag.targetLanguage || !target.parent
    || sourceReferenceUuid(target.uuid, target.parent) !== source.uuid || target.system?.eventId !== eventId
    || !source.system?._source || !target.system?._source || env.binding(target) !== event) return node;
  const original = outcomes(source), translated = outcomes(target);
  if (!original || !translated || !pageSnapshot(target)
    || eventMechanics(source.system._source) !== eventMechanics(target.system._source)) return node;
  const beforeOutcome = outcomeId ? original.find(value => value.id === outcomeId) : undefined;
  const afterOutcome = outcomeId ? translated.find(value => value.id === outcomeId) : undefined;
  const nativeOutcome = outcomeId ? event.outcomes?.[outcomeId] : undefined;
  if (outcomeId && (!beforeOutcome || !afterOutcome || !nativeOutcome || nativeOutcome.id !== outcomeId
    || nativeOutcome.label !== beforeOutcome.label || nativeOutcome.summary !== beforeOutcome.summary
    || nativeOutcome.text?.summary !== beforeOutcome.summary)) return node;
  const beforeLabel = outcomeId ? beforeOutcome!.label : source.name;
  const afterLabel = outcomeId ? afterOutcome!.label : target.name;
  if (!beforeLabel || !afterLabel?.trim() || afterLabel === beforeLabel) return node;
  const texts = [...link.childNodes].filter(child => child.nodeType === 3 && child.textContent?.trim());
  if (texts.length !== 1 || texts[0]!.textContent?.trim() !== beforeLabel
    || [...link.children].some(child => !child.matches("i"))) return node;
  try { assertPortableText(beforeLabel, afterLabel, "text"); } catch { return node; }
  const targetIdentity = pageSnapshot(target);
  if (!targetIdentity) return node;
  const current = () => visible(context) && visible(contextSource) && visible(source) && visible(target)
    && processed(context) && processed(target) && pageSnapshot(context) === contextIdentity
    && pageSnapshot(contextSource) === contextSourceIdentity && pageSnapshot(source) === sourceIdentity && pageSnapshot(target) === targetIdentity
    && eventSnapshot(event) === eventIdentity
    && context.documentName === "JournalEntryPage" && contextSource.documentName === "JournalEntryPage" && contextSource.type === context.type
    && ["ember.questEvent", "ember.standaloneEvent"].includes(source.type ?? "") && target.type === source.type
    && source.system?.eventId === eventId && target.system?.eventId === eventId
    && !!source.system?._source && !!target.system?._source && eventMechanics(source.system._source) === eventMechanics(target.system._source)
    && !readJournalTranslationFlag(source.parent?.flags)
    && !readJournalTranslationFlag(contextSource.parent?.flags) && env.event(eventId) === event && env.binding(target) === event
    && event.page === source.uuid && event.id === eventId && event.label === source.name
    && source.uuid === pair.sourceUuid && target.uuid === pair.translatedUuid
    && context.parent && sourceReferenceUuid(context.uuid, context.parent) === contextSourceUuid
    && target.parent && sourceReferenceUuid(target.uuid, target.parent) === source.uuid
    && (!outcomeId || (event.outcomes?.[outcomeId] === nativeOutcome && nativeOutcome?.label === beforeOutcome!.label
      && nativeOutcome?.summary === beforeOutcome!.summary && nativeOutcome?.text?.summary === beforeOutcome!.summary))
    && element.innerHTML === beforeNode && link.parentElement === element && texts[0]?.parentNode === link;
  const finalPair = await env.pair(source.uuid, flag.targetLanguage);
  const finalContextPair = await env.pair(contextSourceUuid, flag.targetLanguage);
  if (!current() || finalPair.status !== "mapped" || finalPair.sourceUuid !== source.uuid || finalPair.translatedUuid !== target.uuid
    || finalContextPair.status !== "mapped" || finalContextPair.sourceUuid !== contextSourceUuid || finalContextPair.translatedUuid !== context.uuid) return node;
  texts[0]!.textContent = texts[0]!.textContent!.replace(beforeLabel, afterLabel);
  return node;
}

/** Ember exposes stable enricher IDs during setup. Install once on those entries
 * only, calling their native renderer with its unchanged match/options first. */
export function registerTranslatedEventEnrichers(entries: EnricherEntry[] = (CONFIG as any).TextEditor?.enrichers ?? [],
  env: EventEnricherEnvironment = enricherEnvironment): void {
  for (const entry of entries) {
    if (!["emberEventOutcome", "emberEventState"].includes(entry.id ?? "") || typeof entry.enricher !== "function" || wrappedEnrichers.has(entry)) continue;
    const original = entry.enricher;
    entry.enricher = async function(match, options = {}) {
      const node = await original.call(this, match, options);
      try {
        if (entry.id === "emberEventOutcome" && options.relativeTo) return await translatedInlineOutcome(options.relativeTo, node, env);
        if (entry.id === "emberEventState") return await translatedEventState(match, options, node, env);
      } catch { /* Native source presentation remains the safe fallback. */ }
      return node;
    };
    wrappedEnrichers.add(entry);
  }
}
