import { assertPortableText } from "../bundles/format";
import { absoluteReference, sourceReferenceNotation } from "../bundles/reference-notation";
import { logger } from "../logger";
import { proseNumbers } from "../polish/quality-guards";
import { getTranslatorSettings, preferTranslations } from "../settings/settings";
import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import { mapGlossaryLabel, mapGlossaryLabels } from "./map-glossary-labels";
import { resolveSourceReference, resolveTranslationReference, translationIdentity } from "./document-identity";
import { discoverDocumentDependencies, rewriteDocumentReferences } from "./document-dependencies";
import { itemSourceHash, readItemTranslationFlag, type ItemData } from "./item";
import { journalSourceHash, readJournalTranslationFlag, type JournalData } from "./journal";
import { translateAttunementSummary } from "./ember-creation-attunement";

interface DisplayDocument extends FoundryUuidDocument {
  name?: string; type?: string; visible?: boolean; isOwner?: boolean;
  system?: Record<string, any>; pages?: { contents?: DisplayDocument[] };
  toObject?(): Record<string, unknown>;
  getTags?(): Record<string, string>;
}
type Option = Record<string, any>;
type CreationMethod = (this: any, ...args: any[]) => any;
interface CreationClass { prototype: Record<string, CreationMethod>; _renderFeatureItem?: CreationMethod; optionSummaryHTML?: CreationMethod }
const LISTS = ["ancestries", "cultures", "paths", "attunements"] as const;
const SELECTED = ["ancestry", "culture", "path", "attunement", "aster", "soulbound"] as const;
const JOURNALS: Readonly<Record<string, { id: string; type: string }>> = {
  ancestry: { id: "emberAncestries0", type: "ember.ancestry" },
  aster: { id: "emberAncestries0", type: "ember.ancestry" },
  soulbound: { id: "emberAncestries0", type: "ember.ancestry" },
  culture: { id: "emberCultures000", type: "ember.culture" },
  attunement: { id: "emberCosmos00000", type: "ember.cosmos" },
};
const UI_LABELS: Readonly<Record<string, string>> = { Culture: "Culture", Path: "Path", Attunement: "Attunement", Token: "Token",
  "Aster Progression": "AsterProgression", "Soulbound Progression": "SoulboundProgression", Rarity: "Rarity", Lifespan: "Lifespan" };
function uiLabel(source: string): string {
  if (!Object.hasOwn(UI_LABELS, source)) return source;
  const key = `FOUNDRY_TRANSLATE.Creation.${UI_LABELS[source]}`, translated = game.i18n.localize(key);
  return translated === key ? source : translated;
}
function creationLabel(key: string, fallback: string): string {
  const full = `FOUNDRY_TRANSLATE.Creation.${key}`, value = game.i18n.localize(full);
  return value === full ? fallback : value;
}
function lifespanLabel(value: string): string {
  const fixed: Record<string, string> = { Unknown: "UnknownLifespan", Varied: "VariedLifespan" };
  if (Object.hasOwn(fixed, value)) return creationLabel(fixed[value]!, value);
  // Native display metadata, not the numerical movement/ability fields. Keep
  // every number, separator and punctuation exactly as authored.
  const years = /^(\d+\s*(?:-\s*\d+)?\s+)(years|Years)(\.?)$/u.exec(value);
  if (years) return `${years[1]}${creationLabel("Years", years[2]!)}${years[3]}`;
  const immortal = /^(\d+\s*-\s*\d+\s*)\(Immortal Exceptions\)$/u.exec(value);
  return immortal ? `${immortal[1]}(${creationLabel("ImmortalExceptions", "Immortal Exceptions")})` : value;
}
function featureLabel(source: unknown): unknown {
  if (typeof source !== "string") return source;
  if (Object.hasOwn(UI_LABELS, source)) return uiLabel(source);
  for (const prefix of ["Rarity", "Lifespan"]) if (source.startsWith(`${prefix}: `)) {
    const value = source.slice(prefix.length + 2);
    const rarity = ["Common", "Uncommon", "Rare", "Very Rare", "Unique", "Extinct"].includes(value)
      ? creationLabel(`Rarity${value.replaceAll(" ", "")}`, value) : value;
    return `${uiLabel(prefix)}: ${prefix === "Lifespan" ? lifespanLabel(value) : rarity}`;
  }
  return source;
}

function readable(doc: DisplayDocument | null | undefined): doc is DisplayDocument {
  return !!doc && doc.visible === true;
}
function language(): string { return getTranslatorSettings().targetLanguage; }
function itemDescription(doc: DisplayDocument): string | undefined {
  return typeof doc.system?.description === "string" ? doc.system.description : undefined;
}

/** One render's cache only: live glossary/copy changes are seen on the next render. */
function presentationLookup(locale: string, guards: (() => boolean)[]) {
  const cache = new Map<string, Promise<DisplayDocument | null>>();
  return (source: DisplayDocument): Promise<DisplayDocument | null> => {
    if (!readable(source) || !source.uuid || translationIdentity(source, source.documentName ?? "")) return Promise.resolve(null);
    const known = cache.get(source.uuid); if (known) return known;
    const originalUuid = source.uuid, originalName = source.name, originalType = source.type;
    const originalFlags = JSON.stringify(source.flags), originalSystem = JSON.stringify(source.system);
    guards.push(() => readable(source) && source.uuid === originalUuid && source.name === originalName && source.type === originalType
      && JSON.stringify(source.flags) === originalFlags && JSON.stringify(source.system) === originalSystem
      && !translationIdentity(source, source.documentName ?? ""));
    const work = (async () => {
      const pair = await resolveTranslationReference(source.uuid, locale);
      if (pair.status !== "mapped" || pair.sourceUuid !== source.uuid || !pair.translatedUuid) return null;
      const target = await fromUuid(pair.translatedUuid) as DisplayDocument | null;
      if (!readable(source) || !readable(target) || target.uuid !== pair.translatedUuid
        || target.documentName !== source.documentName || target.type !== source.type) return null;
      const sourceProof = JSON.stringify(source.toObject?.() ?? source.system), sourceFlags = JSON.stringify(source.flags);
      const targetProof = JSON.stringify([target.name, target.type, target.system]);
      let proof: string;
      if (source.documentName === "Item") {
        const flag = readItemTranslationFlag(target.flags);
        if (flag?.sourceUuid !== source.uuid || flag.targetLanguage !== locale || flag.fallbackTextSegments > 0
          || (target.flags?.["foundry-translate"]?.itemTranslation as { partial?: boolean } | undefined)?.partial || !source.toObject
          || flag.sourceHash !== await itemSourceHash(source.toObject() as ItemData)) return null;
        proof = JSON.stringify(flag);
      } else if (source.documentName === "JournalEntryPage") {
        const flag = readJournalTranslationFlag(target.parent?.flags);
        if (!readable(source.parent as DisplayDocument) || !readable(target.parent as DisplayDocument)
          || source.parent?.documentName !== "JournalEntry" || target.parent?.documentName !== "JournalEntry"
          || !source.id || target.id !== source.id || source.uuid !== `${source.parent.uuid}.JournalEntryPage.${source.id}`
          || target.uuid !== `${target.parent.uuid}.JournalEntryPage.${source.id}`
          || flag?.sourceUuid !== source.parent.uuid || flag.targetLanguage !== locale
          || translationIdentity(source.parent, "JournalEntry")
          || (flag.partial && !flag.processedPageIds?.includes(target.id ?? ""))) return null;
        proof = JSON.stringify(flag);
      } else return null;
      guards.push(() => readable(source) && readable(target) && target.uuid === pair.translatedUuid
        && JSON.stringify(source.flags) === sourceFlags && !translationIdentity(source, source.documentName ?? "")
        && JSON.stringify(source.toObject?.() ?? source.system) === sourceProof
        && JSON.stringify([target.name, target.type, target.system]) === targetProof
        && (source.documentName === "Item" ? JSON.stringify(readItemTranslationFlag(target.flags)) === proof
          : readable(source.parent as DisplayDocument) && readable(target.parent as DisplayDocument)
            && source.uuid === `${source.parent?.uuid}.JournalEntryPage.${source.id}`
            && target.uuid === `${target.parent?.uuid}.JournalEntryPage.${source.id}`
            && !translationIdentity(source.parent!, "JournalEntry")
            && JSON.stringify(readJournalTranslationFlag(target.parent?.flags)) === proof));
      return readable(source) && readable(target) ? target : null;
    })().catch(error => { logger.warn("Creation display translation unavailable; keeping native content.", error); return null; });
    cache.set(source.uuid, work); return work;
  };
}

async function glossaryLabels(locale: string): Promise<Map<string, string>> {
  // The shared world glossary has no per-entry locale. Never apply it to a
  // foreign explicit-language page or a changed translation-language setting.
  if (locale !== language()) return new Map();
  try { return mapGlossaryLabels(await new GlossaryCompendiumRepository().loadExisting()); }
  catch (error) { logger.warn("Creation glossary unavailable; keeping native labels.", error); return new Map(); }
}

async function featureHtml(html: string, lookup: ReturnType<typeof presentationLookup>, labels: ReadonlyMap<string, string>): Promise<string> {
  const root = document.createElement("div"); root.innerHTML = html;
  let changed = false;
  for (const heading of root.querySelectorAll<HTMLElement>("section.gameplay-traits.option-summary.crucible > .step-feature > h4")) {
    const before = heading.textContent?.trim();
    if (!before || heading.children.length) continue;
    const after = featureLabel(before);
    if (typeof after === "string" && after !== before) { heading.textContent = after; changed = true; }
  }
  for (const tag of root.querySelectorAll<HTMLElement>("section.gameplay-traits.option-summary.crucible > .step-feature > .tags > .tag")) {
    const before = tag.textContent?.trim();
    if (!before || tag.children.length) continue;
    const after = featureLabel(before);
    if (typeof after === "string" && after !== before) { tag.textContent = after; changed = true; }
  }
  for (const row of root.querySelectorAll<HTMLElement>("div.crucible-item-inline.talent[data-uuid]")) {
    const uuid = row.dataset.uuid;
    if (!uuid) continue;
    const source = await fromUuid(uuid) as DisplayDocument | null;
    if (!readable(source) || source.uuid !== uuid || source.documentName !== "Item" || source.type !== "talent"
      || typeof source.name !== "string" || translationIdentity(source, "Item")) continue;
    const target = await lookup(source);
    const replacement = target?.name ?? mapGlossaryLabel(labels, source.name);
    if (!readable(source)) continue;
    const heading = row.querySelector<HTMLElement>(":scope > .title > h4");
    // Native template escapes names. Replace only that exact plain-text slot.
    if (!heading || heading.children.length || heading.textContent?.trim() !== source.name) continue;
    if (replacement && replacement !== source.name) {
      heading.textContent = replacement;
      for (const image of row.querySelectorAll("img[alt]")) if (image.getAttribute("alt") === source.name) image.setAttribute("alt", replacement);
      changed = true;
    }
    // The native talent renderer formats source.getTags(). Display only its
    // exact ancestry tag; no substring replacement of arbitrary prose or IDs.
    const tags = new Set(Object.values(source.getTags?.() ?? {}));
    for (const tag of row.querySelectorAll<HTMLElement>(":scope > .title > .tags > .tag")) {
      const text = tag.textContent?.trim();
      if (!text || tag.children.length || !tags.has(text) || !text.startsWith("Ancestry: ")) continue;
      const original = text.slice("Ancestry: ".length), names = original.split(/([,/]\s*)/u);
      const translated = names.map((name, index) => index % 2 ? name : mapGlossaryLabel(labels, name) ?? name).join("");
      const label = game.i18n.localize("TYPES.Item.ancestry");
      const next = `${label === "TYPES.Item.ancestry" ? "Ancestry" : label}: ${translated}`;
      if (next !== text) { tag.textContent = next; changed = true; }
    }
  }
  return changed ? root.innerHTML : html;
}

/** Native optionSummaryHTML is also called from ancestry/culture journal sheets.
 * Retain its original talent UUIDs and actions, replacing only reviewed captions. */
export async function translateEmberCreationFeatureHtml(html: string, locale: string): Promise<string> {
  const user = game.user, world = (game as any).world, selectedLanguage = language(), interfaceLanguage = (game.i18n as any).lang, preference = preferTranslations();
  const guards: (() => boolean)[] = [], lookup = presentationLookup(locale, guards);
  const labels = await glossaryLabels(locale);
  const result = await featureHtml(html, lookup, labels);
  return game.user === user && (game as any).world === world && language() === selectedLanguage
    && (game.i18n as any).lang === interfaceLanguage && preferTranslations() === preference && guards.every(valid => valid()) ? result : html;
}

/** Render translated prose with canonical links and unchanged command/HTML
 * structure. It is never submitted, and uses the original permission context. */
async function descriptionHtml(source: DisplayDocument, target: DisplayDocument): Promise<string | null> {
  const before = itemDescription(source), after = itemDescription(target);
  if (before === undefined || after === undefined) return null;
  const replacements = [];
  for (const { sourceUuid } of discoverDocumentDependencies(after)) {
    const absolute = absoluteReference(sourceUuid, target.uuid);
    if (!absolute) continue;
    const original = await resolveSourceReference(absolute);
    if (original && original !== sourceUuid) replacements.push({ sourceUuid, translatedUuid: original });
  }
  const normalized = sourceReferenceNotation(before, rewriteDocumentReferences(after, replacements), source.uuid);
  assertPortableText(before, normalized, "html");
  if (JSON.stringify(proseNumbers([before])) !== JSON.stringify(proseNumbers([normalized]))) return null;
  const html = await (foundry.applications as any).ux.TextEditor.enrichHTML(normalized, {
    relativeTo: source, secrets: false,
  });
  return readable(source) && readable(target) && itemDescription(source) === before && itemDescription(target) === after ? html : null;
}

/** One render's shared ancestry journal proof, including one final access and
 * content recheck even when many options use the same original parent. */
function overviewSourceHashes(guards: (() => boolean)[]) {
  const cache = new Map<DisplayDocument, Promise<string | null>>();
  return (parent: DisplayDocument): Promise<string | null> => {
    const known = cache.get(parent); if (known) return known;
    const work = (async () => {
      if (!readable(parent) || !parent.toObject) return null;
      const data = parent.toObject();
      if (typeof data.name !== "string" || !Array.isArray(data.pages)) return null;
      const proof = JSON.stringify(data), uuid = parent.uuid;
      guards.push(() => readable(parent) && parent.uuid === uuid && JSON.stringify(parent.toObject?.()) === proof);
      const hash = await journalSourceHash(data as JournalData);
      return readable(parent) ? hash : null;
    })();
    cache.set(parent, work); return work;
  };
}

function overviewComparisonHtml(html: string): string {
  const root = document.createElement("div"); root.innerHTML = html;
  // Ember's native overview renderer adds style="" to the paragraph. Ignore
  // only this inert attribute in detached comparison trees.
  for (const element of root.querySelectorAll("[style]")) {
    if (!element.getAttribute("style")?.trim()) element.removeAttribute("style");
  }
  return root.innerHTML;
}

/** The native Item may embed its own ancestry/culture overview. Replace only
 * that proven embed's children, never arbitrary Item
 * prose, its surrounding HTML, or its original document identity. */
async function overviewEmbedHtml(summary: string, item: DisplayDocument, page: DisplayDocument,
  target: DisplayDocument, locale: string, guards: (() => boolean)[], sourceHash: ReturnType<typeof overviewSourceHashes>): Promise<string | null> {
  if (!preferTranslations() || locale !== language() || !["ember.ancestry", "ember.culture"].includes(page.type ?? "")
    || translationIdentity(item, "Item") || typeof item.system?.identifier !== "string" || !item.system.identifier.trim()
    || item.system.identifier !== page.system?.identifier) return null;
  const description = itemDescription(item), before = page.system?.content?.overview, after = target.system?.content?.overview;
  if (typeof description !== "string" || typeof before !== "string" || !before.trim() || typeof after !== "string") return null;
  // Only the observed native overview/inline form is supported. Other modes
  // can contain a full page, a caption, or interactive content.
  const commands = [...description.matchAll(/@(?:Embed|embed)\[([^\]\r\n]+)\](?!\{)/gu)];
  if (!commands.some(match => {
    const [uuid, ...options] = match[1]!.trim().split(/\s+/u);
    return uuid === page.uuid && options.length === 2 && new Set(options).size === 2
      && options.includes("overview") && options.includes("inline");
  })) return null;
  const root = document.createElement("div"); root.innerHTML = summary;
  const embeds = [...root.querySelectorAll<HTMLElement>("document-embed[data-uuid]")]
    .filter(embed => embed.dataset.uuid === page.uuid);
  if (embeds.length !== 1 || overviewComparisonHtml(embeds[0]!.innerHTML) !== overviewComparisonHtml(before)) return null;
  const parent = page.parent as DisplayDocument | undefined, flag = readJournalTranslationFlag(target.parent?.flags);
  // Fallback counts cover the entire journal and can concern unrelated pages.
  // Validate the selected overview itself below, retaining the fresh source
  // hash, page identity/access, completed-page, structure and number checks.
  if (!readable(parent) || !flag || flag.sourceHash !== await sourceHash(parent)) return null;
  const itemProof = JSON.stringify(item.toObject?.() ?? item.system);
  guards.push(() => readable(item) && !translationIdentity(item, "Item")
    && JSON.stringify(item.toObject?.() ?? item.system) === itemProof);
  const replacements = [];
  for (const { sourceUuid } of discoverDocumentDependencies(after)) {
    const absolute = absoluteReference(sourceUuid, target.uuid);
    if (!absolute) continue;
    const original = await resolveSourceReference(absolute);
    if (original && original !== sourceUuid) replacements.push({ sourceUuid, translatedUuid: original });
  }
  const normalized = sourceReferenceNotation(before, rewriteDocumentReferences(after, replacements), page.uuid);
  assertPortableText(before, normalized, "html");
  if (JSON.stringify(proseNumbers([before])) !== JSON.stringify(proseNumbers([normalized]))) return null;
  const html = await (foundry.applications as any).ux.TextEditor.enrichHTML(normalized, { relativeTo: page, secrets: false });
  if (!readable(item) || !readable(page) || !readable(target) || itemDescription(item) !== description
    || page.system?.content?.overview !== before || target.system?.content?.overview !== after) return null;
  embeds[0]!.innerHTML = html;
  return root.innerHTML;
}

function originalPage(family: string, option: Option): DisplayDocument | null {
  const spec = JOURNALS[family]; if (!spec || typeof option.identifier !== "string") return null;
  const journal = (game.journal as any)?.get(spec.id) as DisplayDocument | undefined;
  if (!readable(journal) || translationIdentity(journal, "JournalEntry")) return null;
  const matches = (journal.pages?.contents ?? []).filter(page => page.type === spec.type && page.system?.identifier === option.identifier);
  return matches.length === 1 && readable(matches[0]) ? matches[0]! : null;
}

/** Native state contains shared Item/option objects used to create characters.
 * Clone only the rendering records and retain original Item identity/mechanics. */
export async function translateEmberCreationContext(context: unknown, locale = language()): Promise<unknown> {
  if (!context || typeof context !== "object" || Array.isArray(context)) return context;
  const source = context as Record<string, any>, result = { ...source };
  const user = game.user, world = (game as any).world, selectedLanguage = language(), interfaceLanguage = (game.i18n as any).lang, preference = preferTranslations();
  const guards: (() => boolean)[] = [];
  const lookup = presentationLookup(locale, guards);
  const overviewSourceHash = overviewSourceHashes(guards);
  const labels = await glossaryLabels(locale);
  const options = new Map<Option, Promise<Option>>();
  const overlay = (value: unknown, family: string): Promise<any> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return Promise.resolve(value);
    const option = value as Option;
    const current = options.get(option); if (current) return current;
    const work = (async () => {
      const copy = { ...option }, item = option.item as DisplayDocument | undefined;
      if (item?.documentName === "Item") {
        const target = await lookup(item);
        if (target) {
          if (option.name === item.name && typeof target.name === "string") copy.name = target.name;
          // Attunement summaries originate in config.description, not Item.description.
          if (family !== "attunement" && typeof option.summary === "string") {
            try { const html = await descriptionHtml(item, target); if (html !== null) copy.summary = html; }
            catch (error) { logger.warn("Creation description validation failed; keeping native prose.", error); }
          }
        }
        if (copy.name === option.name && readable(item) && option.name === item.name && typeof item.name === "string") {
          copy.name = mapGlossaryLabel(labels, item.name) ?? option.name;
        }
      }
      const page = originalPage(family, option), targetPage = page && await lookup(page);
      if (page && targetPage) {
        if (family === "attunement" && typeof option.summary === "string") {
          const html = await translateAttunementSummary(option.summary, page, targetPage, locale, guards, overviewSourceHash, lookup);
          if (html !== null) copy.summary = html;
          const config = (globalThis as any).ember?.CONST?.ATTUNEMENT_IDENTIFIERS?.[option.identifier];
          if (config?.identifier === option.identifier && config.pageUuid === page.uuid && option.name === config.label) {
            const proof = JSON.stringify(config);
            guards.push(() => (globalThis as any).ember?.CONST?.ATTUNEMENT_IDENTIFIERS?.[option.identifier] === config
              && JSON.stringify(config) === proof);
            copy.name = mapGlossaryLabel(labels, option.name) ?? copy.name;
          }
        }
        if (item?.documentName === "Item" && readable(item) && typeof copy.summary === "string") {
          try {
            const html = await overviewEmbedHtml(copy.summary, item, page, targetPage, locale, guards, overviewSourceHash);
            if (html !== null) copy.summary = html;
          } catch (error) { logger.warn("Creation overview embed validation failed; keeping native prose.", error); }
        }
        if (option.name === page.name && typeof targetPage.name === "string") copy.name = targetPage.name;
        if (option.title === page.name && typeof targetPage.name === "string") copy.title = targetPage.name;
        if (typeof option.subtitle === "string" && option.subtitle === page.system?.subtitle
          && typeof targetPage.system?.subtitle === "string") copy.subtitle = targetPage.system.subtitle;
        const before = page.system?.banner?.caption, after = targetPage.system?.banner?.caption;
        if (typeof before === "string" && typeof after === "string" && option.figure?.caption === before) {
          try { assertPortableText(before, after, "text"); copy.figure = { ...option.figure, caption: after }; }
          catch { /* A malformed/unrecognized caption keeps the native value. */ }
        }
        // Ember synthesizes this caption when the author left it empty. Match
        // only that exact native fallback; custom captions stay author-owned.
        if (family === "ancestry" && before === "" && option.figure?.caption === `An example ${option.name} character.`) {
          const template = creationLabel("ExampleCharacter", "An example {name} character.");
          copy.figure = { ...option.figure, caption: template.replace("{name}", copy.name) };
        }
      }
      if (Array.isArray(option.features)) copy.features = await Promise.all(option.features.map(async (feature: unknown) => {
        if (!feature || typeof feature !== "object") return feature;
        const current = feature as Record<string, any>, result: Record<string, any> = { ...current };
        if (typeof current.label === "string") result.label = featureLabel(current.label);
        if (Array.isArray(current.tags)) result.tags = current.tags.map((tag: unknown) => tag && typeof tag === "object"
          ? { ...tag, text: featureLabel((tag as any).text) } : tag);
        if (Array.isArray(current.items)) result.items = await Promise.all(current.items.map((html: unknown) =>
          typeof html === "string" ? featureHtml(html, lookup, labels) : html));
        return result;
      }));
      return copy;
    })();
    options.set(option, work); return work;
  };
  for (const list of LISTS) if (Array.isArray(source[list])) result[list] = await Promise.all(source[list].map((option: unknown) => overlay(option, list === "ancestries" ? "ancestry" : list.slice(0, -1))));
  for (const selected of SELECTED) if (source[selected]) result[selected] = await overlay(source[selected], selected);
  if (source.tabs && typeof source.tabs === "object" && !Array.isArray(source.tabs)) {
    result.tabs = { ...source.tabs };
    for (const [id, tab] of Object.entries(source.tabs)) if (tab && typeof tab === "object" && typeof (tab as any).label === "string") {
      const label = uiLabel((tab as any).label);
      if (label !== (tab as any).label) result.tabs[id] = { ...tab, label };
    }
    for (const selected of ["ancestry", "culture", "path", "attunement"] as const) {
      const tab = source.tabs[selected], before = source[selected], after = result[selected];
      if (tab && before && after && tab.selectionLabel === before.name && after.name !== before.name) {
        result.tabs[selected] = { ...result.tabs[selected], selectionLabel: after.name };
      }
    }
  }
  return game.user === user && (game as any).world === world && language() === selectedLanguage && preferTranslations() === preference
    && (game.i18n as any).lang === interfaceLanguage && guards.every(valid => valid()) ? result : context;
}

const installed = new WeakSet<object>();
const installedSummaries = new WeakSet<object>();
/** Called after Ember has loaded its Crucible-specific class. Only the final
 * render context is overlaid; _state, _clone, choice handlers and submit stay native. */
export function registerEmberCreationDisplay(): void {
  if (game.system?.id !== "crucible" || !game.modules.get("ember")?.active) return;
  const Sheet = (globalThis as any).ember?.system?.applications?.EmberHeroCreationSheet as CreationClass | undefined;
  if (!Sheet?.prototype || installed.has(Sheet.prototype) || typeof Sheet.prototype._prepareContext !== "function") return;
  const original = Sheet.prototype._prepareContext;
  Sheet.prototype._prepareContext = async function(...args) {
    const context = await original.apply(this, args);
    if (!preferTranslations()) return context;
    try { return await translateEmberCreationContext(context); }
    catch (error) { logger.warn("Creation display overlay unavailable; keeping native context.", error); return context; }
  };
  installed.add(Sheet.prototype);
  if (installedSummaries.has(Sheet) || typeof Sheet.optionSummaryHTML !== "function") return;
  const summary = Sheet.optionSummaryHTML;
  Sheet.optionSummaryHTML = async function(page: DisplayDocument, ...args) {
    const pageSnapshot = () => JSON.stringify([page.uuid, page.id, page.type, page.name, page.system, page.parent?.uuid, page.parent?.flags]);
    const pageProof = pageSnapshot();
    const html = await summary.call(this, page, ...args);
    if (typeof html !== "string" || pageSnapshot() !== pageProof) return html;
    const flag = readJournalTranslationFlag(page.parent?.flags), explicit = !!flag;
    const locale = flag?.targetLanguage ?? language();
    if (!explicit && !preferTranslations()) return html;
    if (flag?.partial && (!page.id || !flag.processedPageIds?.includes(page.id))) return html;
    const proof = JSON.stringify(flag);
    try {
      let source: DisplayDocument | null = page;
      if (explicit) {
        const originalUuid = await resolveSourceReference(page.uuid);
        source = originalUuid ? await fromUuid(originalUuid) as DisplayDocument | null : null;
        if (!readable(source) || source.uuid !== originalUuid || source.documentName !== "JournalEntryPage" || source.id !== page.id || source.type !== page.type
          || source.parent?.uuid !== flag.sourceUuid || source.uuid !== `${flag.sourceUuid}.JournalEntryPage.${source.id}`
          || readJournalTranslationFlag(source.parent?.flags) || !readable(source.parent as DisplayDocument)) return html;
      }
      const sourceSnapshot = () => JSON.stringify([source?.uuid, source?.id, source?.type, source?.name, source?.system, source?.parent?.uuid, source?.parent?.flags]);
      const sourceProof = sourceSnapshot();
      const result = await translateEmberCreationFeatureHtml(html, locale);
      return pageSnapshot() === pageProof && sourceSnapshot() === sourceProof && readable(page) && readable(source) && (!explicit || (readable(page.parent as DisplayDocument)
        && readable(source.parent as DisplayDocument) && source.parent?.uuid === flag.sourceUuid))
        && JSON.stringify(readJournalTranslationFlag(page.parent?.flags)) === proof ? result : html;
    } catch (error) { logger.warn("Creation feature captions unavailable; keeping native summary.", error); return html; }
  };
  installedSummaries.add(Sheet);
}
