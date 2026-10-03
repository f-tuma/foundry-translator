import { assertPortableText } from "../bundles/format";
import { sourceReferenceNotation } from "../bundles/reference-notation";
import { discoverDocumentDependencies, rewriteDocumentReferences } from "./document-dependencies";
import { eventMechanics } from "./ember-runtime-bridge";
import { resolveSourceReference, resolveTranslationReference, sourceReferenceUuid } from "./document-identity";
import { readJournalTranslationFlag } from "./journal";

interface Page extends FoundryUuidDocument {
  type?: string; visible?: boolean; isOwner?: boolean; name?: string;
  system?: { questId?: string; eventId?: string; locationId?: string; overview?: string; _source?: Record<string, unknown> };
}
interface Step { id: string; page: string; text?: { overview?: string }; setting?: { locations?: Iterable<string> } }
interface Quest { page: string; getSteps(): Step[] }
interface Location { id: string; page?: Page }
interface Runtime {
  narrative: { quests: Record<string, Quest>; events: Record<string, Step> };
  region?: { locations: { get(id: string): Location | undefined } };
  api?: { applications?: { EmberQuestOverviewPageSheet?: { prototype: Record<string, any> } } };
}
interface Sheet { document: Page; isView?: boolean }
export interface QuestSummarySection { sectionClass?: string; content?: string; [key: string]: unknown }
export interface QuestSummaryEnvironment {
  resolve(uuid: string): Promise<Page | null>;
  pair: typeof resolveTranslationReference;
  source: typeof resolveSourceReference;
  runtime(): Runtime | undefined;
  enrich(text: string, options: { relativeTo: Page; secrets: boolean }): Promise<string>;
}
const environment: QuestSummaryEnvironment = {
  resolve: async uuid => await fromUuid(uuid) as Page | null,
  pair: resolveTranslationReference,
  source: resolveSourceReference,
  runtime: () => (globalThis as any).ember,
  enrich: (text, options) => (foundry.applications as any).ux.TextEditor.enrichHTML(text, options),
};
const flagText = (page: Page) => JSON.stringify(readJournalTranslationFlag(page.parent?.flags));
const visible = (page: Page) => page.visible === true && (page.parent as Page | null | undefined)?.visible === true;
const processed = (page: Page) => {
  const flag = readJournalTranslationFlag(page.parent?.flags);
  return flag && (!flag.partial || (!!page.id && flag.processedPageIds?.includes(page.id)));
};
function html(value: string): string { const root = document.createElement("div"); root.innerHTML = value; return root.innerHTML; }

/** Exact native card slots only. Neither names nor occurrence order establish identity. */
function anchor(root: Element): HTMLAnchorElement | null {
  const links = root.querySelectorAll<HTMLAnchorElement>("a.content-link[data-uuid]");
  return links.length === 1 ? links[0]! : null;
}

async function normalizeOverview(source: Page, value: string, env: QuestSummaryEnvironment): Promise<string> {
  const replacements = [];
  for (const dependency of discoverDocumentDependencies(value)) {
    const original = await env.source(dependency.sourceUuid);
    if (original && original !== dependency.sourceUuid) replacements.push({ sourceUuid: dependency.sourceUuid, translatedUuid: original });
  }
  const normalized = sourceReferenceNotation(source.system!.overview!, rewriteDocumentReferences(value, replacements), source.uuid);
  assertPortableText(source.system!.overview!, normalized, "html");
  // Enrichment uses the copy's context: retain its validated commands/relative
  // links rather than feeding original-relative commands into a copied page.
  return value;
}

/** Translate a transient native quest view, never the canonical narrative graph.
 * Reader uses the same native _getSections path; no separate reader registry is needed.
 */
export async function translatedQuestSummarySections(sheet: Sheet, sections: QuestSummarySection[], env: QuestSummaryEnvironment = environment): Promise<QuestSummarySection[]> {
  const page = sheet.document, flag = readJournalTranslationFlag(page.parent?.flags);
  if (!sheet.isView || page.type !== "ember.quest" || !flag || !processed(page) || !visible(page)) return sections;
  const origin = page.parent && sourceReferenceUuid(page.uuid, page.parent);
  if (!origin) return sections;
  const resolvedQuest = await env.resolve(origin);
  const runtime = env.runtime(), questId = page.system?.questId;
  const quest = questId && runtime?.narrative.quests[questId];
  if (!resolvedQuest || resolvedQuest.uuid !== origin || resolvedQuest.type !== page.type || !visible(resolvedQuest)
    || readJournalTranslationFlag(resolvedQuest.parent?.flags) || !quest || quest.page !== origin
    || resolvedQuest.system?.questId !== questId) return sections;
  const sourceQuest = resolvedQuest;
  const identity = flagText(page), sourceIdentity = sourceQuest.uuid;
  const pageOwner = page.isOwner, sourceQuestOwner = sourceQuest.isOwner;
  const steps = [...quest.getSteps()];
  if (steps.length > 500) return sections;
  const membership = () => JSON.stringify(quest.getSteps().map(event => [event.id, event.page, [...event.setting?.locations ?? []]]));
  const membershipIdentity = membership();
  const current = () => visible(page) && visible(sourceQuest) && processed(page) && flagText(page) === identity
    && sourceQuest.uuid === sourceIdentity && sourceQuest.system?.questId === questId && page.system?.questId === questId
    && !readJournalTranslationFlag(sourceQuest.parent?.flags) && page.isOwner === pageOwner && sourceQuest.isOwner === sourceQuestOwner
    && env.runtime()?.narrative.quests[questId!] === quest && quest.page === origin && membership() === membershipIdentity;
  const accepted: (() => boolean)[] = [];
  const events = new Map<string, Step[]>(), locations = new Map<string, Location[]>();
  for (const event of steps) {
    if (runtime!.narrative.events[event.id] !== event || typeof event.page !== "string") continue;
    const matches = events.get(event.page) ?? []; matches.push(event); events.set(event.page, matches);
    for (const id of event.setting?.locations ?? []) {
      const location = runtime?.region?.locations.get(id);
      if (!location?.page?.uuid || location.id !== id) continue;
      const matches = locations.get(location.page.uuid) ?? [];
      if (!matches.includes(location)) matches.push(location);
      locations.set(location.page.uuid, matches);
    }
  }
  async function replace(link: HTMLAnchorElement, slot: HTMLElement, kind: "event" | "location") {
    const uuid = link.dataset.uuid;
    if (!uuid || !current()) return;
    const event = kind === "event" ? events.get(uuid) : undefined;
    const location = kind === "location" ? locations.get(uuid) : undefined;
    if (kind === "event" ? event?.length !== 1 : location?.length !== 1) return;
    const native = kind === "event" ? event![0]! : location![0]!;
    const source = await env.resolve(uuid);
    const expected = kind === "event" ? ["ember.questEvent", "ember.standaloneEvent"] : ["ember.location"];
    if (!source || source.uuid !== uuid || source.documentName !== "JournalEntryPage" || !expected.includes(source.type ?? "") || !visible(source)
      || readJournalTranslationFlag(source.parent?.flags) || typeof source.system?.overview !== "string") return;
    const sourceText = source.system.overview;
    if (slot.innerHTML !== html(sourceText)) return;
    if (kind === "event" && (source.system.eventId !== (native as Step).id || (native as Step).text?.overview !== sourceText)) return;
    if (kind === "location" && ((native as Location).page !== source || source.system.locationId !== (native as Location).id)) return;
    const pair = await env.pair(uuid, flag!.targetLanguage);
    if (pair.status !== "mapped" || pair.sourceUuid !== uuid || !pair.translatedUuid || pair.translatedUuid === uuid) return;
    const target = await env.resolve(pair.translatedUuid);
    const targetFlag = readJournalTranslationFlag(target?.parent?.flags);
    if (!target || target.uuid !== pair.translatedUuid || target.documentName !== "JournalEntryPage"
      || target.type !== source.type || !visible(target) || !processed(target) || targetFlag?.targetLanguage !== flag!.targetLanguage
      || !target.parent || sourceReferenceUuid(target.uuid, target.parent) !== uuid || typeof target.system?.overview !== "string"
      || !target.system.overview.trim() || !target.name) return;
    if (kind === "event" && (target.system.eventId !== source.system.eventId || !source.system._source || !target.system._source
      || eventMechanics(source.system._source) !== eventMechanics(target.system._source))) return;
    if (kind === "location" && target.system.locationId !== source.system.locationId) return;
    const targetText = target.system.overview, targetIdentity = flagText(target);
    const sourceOwner = source.isOwner, targetOwner = target.isOwner;
    const originalName = target.name;
    const normalized = await normalizeOverview(source, targetText, env);
    const secrets = page.isOwner === true && sourceQuest.isOwner === true && source.isOwner === true && target.isOwner === true;
    const enriched = await env.enrich(normalized, { relativeTo: target, secrets });
    const unchanged = () => !!(current() && visible(source) && visible(target) && processed(target) && flagText(target) === targetIdentity
      && source.isOwner === sourceOwner && target.isOwner === targetOwner && !readJournalTranslationFlag(source.parent?.flags)
      && source.system?.overview === sourceText && target.system?.overview === targetText && target.name === originalName
      && source.type === target.type && source.uuid === uuid && target.uuid === pair.translatedUuid
      && !!target.parent && sourceReferenceUuid(target.uuid, target.parent) === uuid
      && (kind !== "event" || (env.runtime()?.narrative.events[(native as Step).id] === native
        && (native as Step).page === uuid && (native as Step).text?.overview === sourceText
        && source.system.eventId === (native as Step).id && target.system.eventId === source.system.eventId
        && !!source.system._source && !!target.system._source
        && eventMechanics(source.system._source) === eventMechanics(target.system._source)))
      && (kind !== "location" || (env.runtime()?.region?.locations.get((native as Location).id) === native
        && (native as Location).page === source && source.system.locationId === (native as Location).id
        && target.system.locationId === source.system.locationId)));
    if (!unchanged()) return;
    accepted.push(unchanged);
    // Keep icon children, source UUIDs, discovery metadata and native listeners.
    const textNodes = [...link.childNodes].filter(node => node.nodeType === 3);
    const text = textNodes.find(node => node.textContent?.trim());
    if (text) { text.textContent = target.name; for (const other of textNodes) if (other !== text) other.remove(); }
    else link.append(document.createTextNode(target.name));
    slot.innerHTML = enriched;
  }
  const result: QuestSummarySection[] = [];
  for (const section of sections) {
    if (!["events", "locations"].includes(section.sectionClass ?? "") || typeof section.content !== "string" || section.content.length > 500000) {
      result.push(section); continue;
    }
    const root = document.createElement("div"); root.innerHTML = section.content;
    if (section.sectionClass === "events") {
      for (const card of root.querySelectorAll<HTMLElement>(":scope > ol.event-summary-list > li.event-summary")) {
        const heading = card.querySelector(":scope > h4"), slot = card.querySelector<HTMLElement>(":scope > div.overview");
        const link = heading && anchor(heading);
        if (link && slot) { try { await replace(link, slot, "event"); } catch { /* Keep the native source card. */ } }
      }
    } else {
      for (const term of root.querySelectorAll<HTMLElement>(":scope > dl.event-location-list > dt.event-location")) {
        const link = anchor(term), slot = term.nextElementSibling as HTMLElement | null;
        if (link && slot?.tagName === "DD") { try { await replace(link, slot, "location"); } catch { /* Keep source prose. */ } }
      }
    }
    result.push(root.innerHTML === html(section.content) ? section : { ...section, content: root.innerHTML });
  }
  return current() && accepted.every(check => check()) ? result : sections;
}

const PATCHED = Symbol("foundry-translate-quest-summaries");
export function registerTranslatedQuestSummaries(): void {
  if (!game.modules.get("ember")?.active) return;
  const prototype = environment.runtime()?.api?.applications?.EmberQuestOverviewPageSheet?.prototype;
  if (!prototype || prototype[PATCHED as any] || typeof prototype._getSections !== "function") return;
  const original = prototype._getSections;
  prototype._getSections = async function(this: Sheet, ...args: unknown[]) {
    const sections = await original.apply(this, args);
    if (!Array.isArray(sections)) return sections;
    try { return await translatedQuestSummarySections(this, sections); } catch { return sections; }
  };
  if (typeof prototype._prepareContext === "function") {
    const prepare = prototype._prepareContext;
    prototype._prepareContext = async function(...args: unknown[]) {
      const context = await prepare.apply(this, args);
      if (this.isView && this.document.type === "ember.quest" && readJournalTranslationFlag(this.document.parent?.flags)
        && context.subtitle === "Quest Overview") {
        const key = "TYPES.JournalEntryPage.ember.quest", value = game.i18n.localize(key);
        if (value !== key) return { ...context, subtitle: value };
      }
      return context;
    };
  }
  Object.defineProperty(prototype, PATCHED, { value: true });
}
