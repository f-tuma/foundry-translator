import { assertPortableText } from "../bundles/format";
import { absoluteReference, sourceReferenceNotation } from "../bundles/reference-notation";
import { logger } from "../logger";
import { proseNumbers } from "../polish/quality-guards";
import { getTranslatorSettings, preferTranslations } from "../settings/settings";
import { discoverDocumentDependencies, rewriteDocumentReferences } from "./document-dependencies";
import { parseDocumentReference, resolveSourceReference, resolveTranslationReference } from "./document-identity";
import { itemSourceHash, readItemTranslationFlag, type ItemData } from "./item";
import { readJournalTranslationFlag } from "./journal";

interface CardItem extends FoundryUuidDocument {
  name: string; type: string; isOwner?: boolean;
  system: { description?: string | { public?: string } };
  testUserPermission?(user: unknown, level: string): boolean;
  toObject?(): ItemData;
  renderCard?(): Promise<string>;
}
interface JournalApp { element?: HTMLElement | null; document?: FoundryUuidDocument; entry?: FoundryUuidDocument }
interface JournalScope { app: JournalApp; root: HTMLElement; journal: FoundryUuidDocument; proof: string; language: string }
interface HoverJob { event: Event; scope: JournalScope | null; language: string; user: typeof game.user; uuid: string }
const ITEM_TOOLTIPS = new Set(["equipment", "accessory", "armor", "backpack", "spell", "talent", "toolbelt", "weapon"]);
const scopes = new WeakMap<HTMLElement, JournalScope>();
const appRoots = new WeakMap<JournalApp, HTMLElement>();
const jobs = new WeakMap<HTMLElement, HoverJob>();
const owned = new Set<HTMLElement>();
const replays = new WeakSet<Event>();
let registered = false;

function readable(doc: FoundryUuidDocument | null, user: unknown): boolean {
  return !!doc && (doc as CardItem).testUserPermission?.(user, "OBSERVER") === true;
}
function description(item: CardItem): string | undefined {
  const value = item.system?.description;
  return typeof value === "string" ? value : value?.public;
}
function scopeDocument(app: JournalApp): FoundryUuidDocument | null {
  const doc = app.entry ?? app.document;
  return doc?.documentName === "JournalEntryPage" ? doc.parent ?? null : doc?.documentName === "JournalEntry" ? doc : null;
}
function translatedScope(element: HTMLElement): JournalScope | null {
  for (let root: HTMLElement | null = element; root; root = root.parentElement) {
    const scope = scopes.get(root);
    if (scope) return scope;
  }
  return null;
}
function scopeValid(scope: JournalScope, user: unknown): boolean {
  const current = scope.app.entry ?? scope.app.document;
  return scope.root.isConnected && scope.app.element === scope.root && scopeDocument(scope.app) === scope.journal
    && readable(scope.journal, user) && readable(current ?? null, user)
    && JSON.stringify(readJournalTranslationFlag(scope.journal.flags)) === scope.proof;
}

/** Replace prose only inside the source's native card. Its IDs, tags, actions,
 * prerequisites, controls and native visibility decisions retain source data.
 * Unsupported/embedded Item types and stale or malformed copies fail closed. */
export async function translatedItemCard(source: CardItem, native: string, language: string): Promise<string> {
  try {
    const user = game.user, ref = parseDocumentReference(source.uuid);
    if (!user || source.documentName !== "Item" || !ref || ref.type !== "Item" || ref.suffix || ref.anchor
      || !readable(source, user) || readItemTranslationFlag(source.flags) || !source.toObject) return native;
    const sourceData = source.toObject(), sourceProof = JSON.stringify(sourceData), before = description(source);
    const sourceHash = await itemSourceHash(sourceData);
    const pair = await resolveTranslationReference(source.uuid, language);
    if (pair.status !== "mapped" || pair.sourceUuid !== source.uuid || !pair.translatedUuid) return native;
    const target = await fromUuid(pair.translatedUuid) as CardItem | null;
    const flag = readItemTranslationFlag(target?.flags);
    if (!target || target.uuid !== pair.translatedUuid || target.documentName !== "Item" || target.type !== source.type
      || !readable(target, user) || !flag || flag.sourceUuid !== source.uuid || flag.targetLanguage !== language
      || flag.sourceHash !== sourceHash || flag.fallbackTextSegments > 0
      || (target.flags?.["foundry-translate"]?.itemTranslation as { partial?: boolean } | undefined)?.partial) return native;
    const flagProof = JSON.stringify(flag), after = description(target), name = target.name;
    const holder = document.createElement("div"); holder.innerHTML = native;
    if (holder.children.length !== 1) return native;
    const card = holder.firstElementChild as HTMLElement;
    const physical = card.matches("div.action.line-item[data-item-id]") && card.dataset.itemId === source.id;
    const feature = card.matches("div.crucible-item-card.line-item.talent, div.crucible-item-card.line-item.spell")
      && card.dataset.uuid === source.uuid;
    if (!physical && !feature) return native;
    const heading = card.querySelector<HTMLElement>(physical ? ":scope > header.action-header > .title > h4" : ":scope > header > .title > h2");
    const body = card.querySelector<HTMLElement>(":scope > .description");
    if (!heading || heading.textContent !== source.name || !name?.trim()) return native;
    let enriched: string | undefined;
    const secrets = typeof source.system.description === "string" && source.isOwner === true && target.isOwner === true;
    if (body && before !== undefined && after !== undefined) {
      const replacements = [];
      for (const { sourceUuid } of discoverDocumentDependencies(after)) {
        const absolute = absoluteReference(sourceUuid, target.uuid);
        if (!absolute) continue;
        const original = await resolveSourceReference(absolute);
        if (original && original !== sourceUuid) replacements.push({ sourceUuid, translatedUuid: original });
      }
      const normalized = sourceReferenceNotation(before, rewriteDocumentReferences(after, replacements), source.uuid);
      assertPortableText(before, normalized, "html");
      if (JSON.stringify(proseNumbers([before])) !== JSON.stringify(proseNumbers([normalized]))) return native;
      const editor = (CONFIG as unknown as { ux?: { TextEditor?: { enrichHTML(html: string, options: Record<string, unknown>): Promise<string> } } }).ux?.TextEditor;
      if (!editor) return native;
      enriched = await editor.enrichHTML(normalized, { relativeTo: source, secrets });
    }
    // Native source and copy are checked again after hashing, lookup and enrichment.
    if (game.user !== user || !readable(source, user) || !readable(target, user)
      || source.uuid !== pair.sourceUuid || target.uuid !== pair.translatedUuid || target.type !== source.type
      || readItemTranslationFlag(source.flags) || JSON.stringify(source.toObject()) !== sourceProof
      || JSON.stringify(readItemTranslationFlag(target.flags)) !== flagProof || description(target) !== after || target.name !== name
      || secrets !== (typeof source.system.description === "string" && source.isOwner === true && target.isOwner === true)) return native;
    heading.textContent = name;
    if (body && enriched !== undefined) body.innerHTML = enriched;
    const image = card.querySelector<HTMLImageElement>(":scope > header img");
    if (image?.alt === source.name) image.alt = name;
    if (image?.title === source.name) image.title = name;
    return holder.innerHTML;
  } catch (error) { logger.warn("Translated Item tooltip unavailable; keeping the native card.", error); return native; }
}

function replay(element: HTMLElement, event: Event): void {
  const next = new (event.constructor as typeof Event)(event.type, event);
  replays.add(next); element.dispatchEvent(next);
}
function current(element: HTMLElement, job: HoverJob): boolean {
  return jobs.get(element) === job && element.isConnected && element.dataset.uuid === job.uuid && game.user === job.user
    && (job.scope ? scopeValid(job.scope, job.user) : preferTranslations() && getTranslatorSettings().targetLanguage === job.language);
}
async function produce(element: HTMLElement, job: HoverJob): Promise<void> {
  let html: string | null = null;
  let source: CardItem | null = null;
  try {
    const item = await fromUuid(job.uuid) as CardItem | null;
    if (item?.uuid === job.uuid && item.documentName === "Item") source = item;
    if (current(element, job) && source && readable(source, job.user) && typeof source.renderCard === "function") {
      const proof = JSON.stringify(source.toObject?.());
      const native = await source.renderCard();
      if (current(element, job) && readable(source, job.user) && JSON.stringify(source.toObject?.()) === proof) {
        html = await translatedItemCard(source, native, job.language);
      }
    }
  } catch (error) { logger.warn("Item hover translation unavailable; keeping the native tooltip.", error); }
  if (jobs.get(element) !== job) return;
  jobs.delete(element);
  if (!currentWithoutJob(element, job) || (source && !readable(source, job.user))) { delete element.dataset.tooltipHtml; owned.delete(element); return; }
  if (html === null) { delete element.dataset.tooltipHtml; owned.delete(element); replay(element, job.event); return; }
  element.dataset.tooltipHtml = html;
  element.dataset.tooltipClass = "crucible crucible-tooltip";
  replay(element, job.event);
}
function currentWithoutJob(element: HTMLElement, job: HoverJob): boolean {
  return element.isConnected && element.dataset.uuid === job.uuid && game.user === job.user
    && (job.scope ? scopeValid(job.scope, job.user) : preferTranslations() && getTranslatorSettings().targetLanguage === job.language);
}

/** Capture precedes Crucible's body listener. A native-compatible placeholder
 * prevents double production; UUID/click/drag identity is never changed. */
export function registerTranslatedItemTooltips(): void {
  if (registered || game.system?.id !== "crucible") return;
  registered = true;
  Hooks.on("renderApplicationV2", (app: JournalApp) => {
    const root = app.element, journal = scopeDocument(app), flag = readJournalTranslationFlag(journal?.flags);
    if (root instanceof HTMLElement) appRoots.set(app, root);
    if (root instanceof HTMLElement && journal && flag && !flag.partial) {
      scopes.set(root, { app, root, journal, proof: JSON.stringify(flag), language: flag.targetLanguage });
    }
  });
  Hooks.on("closeApplicationV2", (app: JournalApp) => {
    const root = appRoots.get(app); if (!root) return;
    for (const element of owned) if (root.contains(element)) {
      jobs.delete(element); delete element.dataset.tooltipHtml; owned.delete(element);
      if (game.tooltip.element === element) game.tooltip.deactivate();
    }
    scopes.delete(root); appRoots.delete(app);
  });
  document.addEventListener("pointerenter", event => {
    if (replays.has(event)) return;
    for (const stale of owned) if (!stale.isConnected) { jobs.delete(stale); delete stale.dataset.tooltipHtml; owned.delete(stale); }
    const element = event.target;
    if (!(element instanceof HTMLElement) || !element.matches("a.content-link[data-link][data-uuid], div.crucible-item-inline.line-item.talent[data-uuid][data-crucible-tooltip=talent]")
      || element.closest(".editor-content.ProseMirror, .ft-adventure-reader, [data-ft-reader-content], .ft-reader, [data-reader-prose]")
      || !ITEM_TOOLTIPS.has(element.dataset.crucibleTooltip ?? "") || "tooltipHtml" in element.dataset) return;
    const scope = translatedScope(element), user = game.user;
    if (!user || (scope ? !scopeValid(scope, user) : !preferTranslations())) return;
    const ref = parseDocumentReference(element.dataset.uuid!);
    if (!ref || ref.type !== "Item" || ref.suffix || ref.anchor) return;
    const job: HoverJob = { event, scope, language: scope?.language ?? getTranslatorSettings().targetLanguage, user, uuid: element.dataset.uuid! };
    jobs.set(element, job); owned.add(element); element.dataset.tooltipHtml = "";
    void produce(element, job);
  }, true);
  document.addEventListener("pointerleave", event => {
    const element = event.target;
    if (!(element instanceof HTMLElement)) return;
    if (jobs.has(element) && element.dataset.tooltipHtml === "") { delete element.dataset.tooltipHtml; owned.delete(element); }
    jobs.delete(element);
    // Match Crucible's delayed cache cleanup, preserving locked tooltips.
    if (owned.has(element)) window.setTimeout(() => {
      if (game.tooltip.element === element || element.matches(":hover") || jobs.has(element)) return;
      delete element.dataset.tooltipHtml; owned.delete(element);
    }, 2000);
  }, true);
  Hooks.on("updateSetting", () => {
    for (const element of owned) {
      jobs.delete(element); delete element.dataset.tooltipHtml;
      if (game.tooltip.element === element) game.tooltip.deactivate();
    }
    owned.clear();
  });
}
