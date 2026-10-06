import { assertPortableText } from "../bundles/format";
import { absoluteReference, sourceReferenceNotation } from "../bundles/reference-notation";
import { logger } from "../logger";
import { proseNumbers } from "../polish/quality-guards";
import { getTranslatorSettings, preferTranslations } from "../settings/settings";
import { discoverDocumentDependencies, rewriteDocumentReferences } from "./document-dependencies";
import { parseDocumentReference, resolveSourceReference, resolveTranslationReference } from "./document-identity";
import { itemSourceHash, readItemTranslationFlag, type ItemData } from "./item";
import { readJournalTranslationFlag } from "./journal";
import { discoverCrucibleActionNameFieldPaths, discoverCrucibleActionConditionFieldPaths } from "./system-html-fields";

interface CardAction { id: string; name: string; description?: string; condition?: string; item?: CardItem; toObject?(source: boolean): Record<string, unknown> }
interface CardItem extends FoundryUuidDocument {
  name: string; type: string; isOwner?: boolean;
  system: { description?: string | { public?: string } };
  actions?: readonly CardAction[];
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
function actionProof(item: CardItem): string {
  return JSON.stringify(item.actions?.map(action => ({ id: action.id, name: action.name,
    description: action.description, owned: action.item === item, prepared: action.toObject?.(false) })));
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

/** Replace prose only inside the source's native card. Its IDs, tags, action mechanics,
 * prerequisites, controls and native visibility decisions retain source data.
 * Unsupported/embedded Item types and stale or malformed copies fail closed. */
export async function translatedItemCard(source: CardItem, native: string, language: string): Promise<string> {
  try {
    const user = game.user, ref = parseDocumentReference(source.uuid);
    if (!user || source.documentName !== "Item" || !ref || ref.type !== "Item" || ref.suffix || ref.anchor
      || !readable(source, user) || readItemTranslationFlag(source.flags) || !source.toObject) return native;
    const sourceData = source.toObject(), sourceProof = JSON.stringify(sourceData), nativeActionsProof = actionProof(source),
      nativeActions = [...source.actions ?? []], before = description(source);
    const sourceHash = await itemSourceHash(sourceData);
    const pair = await resolveTranslationReference(source.uuid, language);
    if (pair.status !== "mapped" || pair.sourceUuid !== source.uuid || !pair.translatedUuid) return native;
    const target = await fromUuid(pair.translatedUuid) as CardItem | null;
    const flag = readItemTranslationFlag(target?.flags);
    if (!target || target.uuid !== pair.translatedUuid || target.documentName !== "Item" || target.type !== source.type
      || !readable(target, user) || !flag || flag.sourceUuid !== source.uuid || flag.targetLanguage !== language
      || flag.sourceHash !== sourceHash || flag.fallbackTextSegments > 0
      || (target.flags?.["foundry-translate"]?.itemTranslation as { partial?: boolean } | undefined)?.partial) return native;
    if (!target.toObject) return native;
    const targetData = target.toObject(), targetProof = JSON.stringify(targetData);
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
    const actionSecrets = source.isOwner === true && target.isOwner === true;
    if (body && before !== undefined && after !== undefined) {
      enriched = await enrichProse(before, after, source, target, source, secrets, {
        name: displayName(source.name, target.name),
      });
    }
    await translateIncludedActions(card, source, target, sourceData, targetData, actionSecrets);
    // Native source and copy are checked again after hashing, lookup and enrichment.
    if (game.user !== user || !readable(source, user) || !readable(target, user)
      || source.uuid !== pair.sourceUuid || target.uuid !== pair.translatedUuid || target.type !== source.type
      || readItemTranslationFlag(source.flags) || JSON.stringify(source.toObject()) !== sourceProof
      || actionProof(source) !== nativeActionsProof
      || nativeActions.length !== (source.actions?.length ?? 0) || nativeActions.some((action, index) => source.actions?.[index] !== action)
      || JSON.stringify(target.toObject()) !== targetProof
      || JSON.stringify(readItemTranslationFlag(target.flags)) !== flagProof || description(target) !== after || target.name !== name
      || actionSecrets !== (source.isOwner === true && target.isOwner === true)
      || secrets !== (typeof source.system.description === "string" && source.isOwner === true && target.isOwner === true)) return native;
    heading.textContent = name;
    if (body && enriched !== undefined) body.innerHTML = enriched;
    const image = card.querySelector<HTMLImageElement>(":scope > header img");
    if (image?.alt === source.name) image.alt = name;
    if (image?.title === source.name) image.title = name;
    return holder.innerHTML;
  } catch (error) { logger.warn("Translated Item tooltip unavailable; keeping the native card.", error); return native; }
}

async function enrichProse(before: string, after: string, source: CardItem, target: CardItem,
  relativeTo: CardItem | CardAction, secrets: boolean, names: DisplayNames = {}): Promise<string> {
  const replacements = [];
  for (const { sourceUuid } of discoverDocumentDependencies(after)) {
    const absolute = absoluteReference(sourceUuid, target.uuid);
    if (!absolute) continue;
    const original = await resolveSourceReference(absolute);
    if (original && original !== sourceUuid) replacements.push({ sourceUuid, translatedUuid: original });
  }
  const normalized = sourceReferenceNotation(before, rewriteDocumentReferences(after, replacements), source.uuid);
  assertPortableText(before, normalized, "html");
  if (JSON.stringify(proseNumbers([before])) !== JSON.stringify(proseNumbers([normalized]))) throw new Error("Action prose changed numbers");
  const editor = (CONFIG as unknown as { ux?: { TextEditor?: { enrichHTML(html: string, options: Record<string, unknown>): Promise<string> } } }).ux?.TextEditor;
  if (!editor) throw new Error("Native text editor unavailable");
  return enrichDisplayNames(normalized, names, secrets,
    html => editor.enrichHTML(html, { relativeTo, secrets }));
}

interface DisplayNames { name?: string | undefined; itemName?: string | undefined }
const NAME_REFERENCE = /^@ref\[(name|item\.name)\](?:\{[^}]+\})?$/u;
const EXCLUDED_NAME_TEXT = "script,style,code,pre,textarea,noscript,template";

function displayName(before: string, after: string): string | undefined {
  if (!before.trim() || !after.trim()) return undefined;
  try {
    assertPortableText(before, after, "text");
    if (JSON.stringify(proseNumbers([before])) !== JSON.stringify(proseNumbers([after]))) return undefined;
    return after;
  } catch { return undefined; }
}

function textNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3) nodes.push(node as Text);
    else for (const child of node.childNodes) visit(child);
  };
  visit(root); return nodes;
}

/** Consume a whole outer command before considering a name token. In particular,
 * bracketed @ref text in quoted Embed options or brace labels is never editable. */
function nameReferences(text: string): { start: number; end: number; path: "name" | "item.name" }[] {
  const starts = /@[A-Za-z][A-Za-z0-9]*\[|&(?:amp;)?[Rr]eference\[|\[\[/gu;
  const references: ReturnType<typeof nameReferences> = [];
  const endOf = (start: number, open: string, close: string, quoted: boolean): number => {
    let depth = 0, quote = "";
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (quote) {
        if (char === "\\") index++;
        else if (char === quote) quote = "";
      } else if (quoted && (char === '"' || char === "'")) quote = char;
      else if (char === open) depth++;
      else if (char === close && --depth === 0) return index + 1;
    }
    return -1;
  };
  for (let found = starts.exec(text); found; found = starts.exec(text)) {
    const start = found.index, bracket = start + found[0].indexOf("[");
    let end = endOf(bracket, "[", "]", true);
    if (end < 0) return []; // Ambiguous/malformed nesting never grants a text binding.
    if (text[end] === "{") {
      end = endOf(end, "{", "}", false);
      if (end < 0) return [];
    }
    const match = NAME_REFERENCE.exec(text.slice(start, end));
    if (match) references.push({ start, end, path: match[1] as "name" | "item.name" });
    starts.lastIndex = end;
  }
  return references;
}

/** Terminal display text only. Native enrichment still receives the exact source
 * Action/Item: costs, IDs, other @ref paths, rolls and hooks cannot resolve against
 * a copy. Names are filled AFTER enrichers, never interpreted as HTML or commands. */
async function enrichDisplayNames(html: string, names: DisplayNames, secrets: boolean,
  enrich: (html: string) => Promise<string>): Promise<string> {
  if (names.name === undefined && names.itemName === undefined) return enrich(html);
  const root = document.createElement("div"); root.innerHTML = html;
  let prefix: string;
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    prefix = `FTCARDNAME${[...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("")}TOKEN`;
  } while (html.includes(prefix) || Object.values(names).some(name => name?.includes(prefix)));
  const values = new Map<string, string>();
  const nodes = textNodes(root), references = nameReferences(nodes.map(node => node.data).join(""));
  let offset = 0;
  let hiddenNameReference = false;
  for (const node of nodes) {
    const start = offset; offset += node.data.length;
    // Native text nodes can split an outer label around markup. Scan the joined
    // text first so an inner @ref does not gain eligibility in its own child node;
    // only references wholly contained in one original Text node may be filled.
    const local = references.filter(reference => reference.start >= start && reference.end <= offset)
      .map(reference => ({ ...reference, start: reference.start - start, end: reference.end - start }));
    if (node.parentElement?.closest(EXCLUDED_NAME_TEXT)) continue;
    if (!secrets && node.parentElement?.closest("section.secret:not(.revealed)")) {
      hiddenNameReference ||= local.some(reference => (reference.path === "name" ? names.name : names.itemName) !== undefined);
      continue;
    }
    // Match outermost existing commands, not a name reference nested in another
    // UUID label, embed configuration, inline roll or HTML attribute.
    let cursor = 0, masked = "";
    for (const reference of local) {
      const name = reference.path === "name" ? names.name : names.itemName;
      if (name === undefined) continue;
      const marker = `${prefix}${values.size}END`;
      values.set(marker, name);
      masked += node.data.slice(cursor, reference.start) + marker;
      cursor = reference.end;
    }
    if (cursor) node.data = masked + node.data.slice(cursor);
  }
  // Keep the raw baseline byte-for-byte when no eligible displayed reference was found.
  if (!values.size && !hiddenNameReference) return enrich(html);
  const output = await enrich(values.size ? root.innerHTML : html), result = document.createElement("div"); result.innerHTML = output;
  if (!secrets && result.querySelector("section.secret:not(.revealed)")) throw new Error("Unrevealed source secret survived enrichment");
  if (!values.size) return output;
  for (const element of result.querySelectorAll("*")) {
    if ([...element.attributes].some(attribute => attribute.value.includes(prefix))) throw new Error("Name marker moved into an attribute");
  }
  const pattern = new RegExp(`${prefix}\\d+END`, "gu"), counts = new Map<string, number>();
  for (const node of textNodes(result)) {
    for (const [marker] of node.data.matchAll(pattern)) {
      if (!values.has(marker) || node.parentElement?.closest(EXCLUDED_NAME_TEXT)) throw new Error("Unknown or misplaced name marker");
      counts.set(marker, (counts.get(marker) ?? 0) + 1);
    }
  }
  if ([...values.keys()].some(marker => counts.get(marker) !== 1)) throw new Error("Name marker missing or duplicated after enrichment");
  for (const node of textNodes(result)) node.data = node.data.replace(pattern, marker => values.get(marker)!);
  if (result.innerHTML.includes(prefix)) throw new Error("Unrestored name marker");
  return result.innerHTML;
}

/** Only reviewed native included-action cards. Never install translated Action
 * models: execution and @ref enrichment keep the original runtime context. */
async function translateIncludedActions(card: HTMLElement, source: CardItem, target: CardItem,
  sourceData: ItemData, targetData: ItemData, secrets: boolean): Promise<void> {
  const fields = (source.system.constructor as { schema?: { fields?: Record<string, unknown> } })?.schema?.fields;
  const paths = discoverCrucibleActionNameFieldPaths(fields, sourceData.system);
  const before = sourceData.system.actions as CardAction[] | undefined;
  const after = targetData.system.actions as CardAction[] | undefined;
  if (!paths.length || !before || !after || !source.actions
    || !discoverCrucibleActionNameFieldPaths(fields, targetData.system).length
    || before.length !== after.length || before.some((action, index) => action.id !== after[index]?.id)) return;
  const runtime = new Map(source.actions.map(action => [action.id, action]));
  if (runtime.size !== source.actions.length) return;
  const conditionIndexes = new Set(discoverCrucibleActionConditionFieldPaths(fields, sourceData.system).map(path => path[1]));
  const rows = [...card.querySelectorAll<HTMLElement>(":scope > section.actions > div.action.line-item[data-action-id]")];
  if (new Set(rows.map(row => row.dataset.actionId)).size !== rows.length) return;
  for (const row of rows) {
    const index = before.findIndex(action => action.id === row.dataset.actionId);
    if (index < 0) continue;
    const original = before[index]!, translated = after[index]!, action = runtime.get(original.id);
    const heading = row.querySelector<HTMLElement>(":scope > header.action-header > .title > h4");
    const body = row.querySelector<HTMLElement>(":scope > .description");
    if (!action || typeof action.toObject !== "function" || action.item !== source || action.name !== original.name || action.description !== original.description
      || !heading || heading.textContent !== original.name || typeof translated.name !== "string" || !translated.name.trim()) continue;
    try {
      // Finish validation and enrichment before replacing any part of this row.
      assertPortableText(original.name, translated.name, "text");
      if (JSON.stringify(proseNumbers([original.name])) !== JSON.stringify(proseNumbers([translated.name]))) continue;
      const prose = body && typeof original.description === "string" && typeof translated.description === "string"
        ? await enrichProse(original.description, translated.description, source, target, action, secrets, {
          name: translated.name, itemName: displayName(source.name, target.name),
        }) : undefined;
      const conditionElements = row.querySelectorAll<HTMLElement>(":scope > p.condition.activation > em");
      const condition = conditionElements.length === 1 ? conditionElements[0] : undefined;
      const conditionText = conditionIndexes.has(index) && action.condition === original.condition
        && condition?.textContent === original.condition && typeof original.condition === "string"
        && typeof translated.condition === "string" && translated.condition.trim()
        ? safeConditionText(original.condition, translated.condition) : undefined;
      heading.textContent = translated.name;
      if (body && prose !== undefined) body.innerHTML = prose;
      if (condition && conditionText !== undefined) condition.textContent = conditionText;
      const image = row.querySelector<HTMLImageElement>(":scope > header.action-header img");
      if (image?.alt === original.name) image.alt = translated.name;
      if (image?.title === original.name) image.title = translated.name;
    } catch (error) { logger.warn("Included Action translation unavailable; keeping its native presentation.", error); }
  }
}

/** The native trigger sentence is display-only text. Invalid copies leave that
 * sentence untouched; neither a condition nor an Action model is executed here. */
function safeConditionText(before: string, after: string): string | undefined {
  try {
    assertPortableText(before, after, "text");
    if (JSON.stringify(proseNumbers([before])) !== JSON.stringify(proseNumbers([after]))) return undefined;
    return after;
  } catch { return undefined; }
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
      const proof = JSON.stringify(source.toObject?.()), actionsProof = actionProof(source), actions = [...source.actions ?? []];
      const native = await source.renderCard();
      if (current(element, job) && readable(source, job.user) && JSON.stringify(source.toObject?.()) === proof
        && actionProof(source) === actionsProof && actions.length === (source.actions?.length ?? 0)
        && actions.every((action, index) => source?.actions?.[index] === action)) {
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
