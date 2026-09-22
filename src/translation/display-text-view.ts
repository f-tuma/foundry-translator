import { sourceReferenceUuid } from "./document-identity";
import { openActiveTranslationsOverview } from "./active-translations-app";
import { MODULE_ID } from "../constants";
import { getTranslatorSettings } from "../settings/settings";
import { logger } from "../logger";
import { DISPLAY_TEXT_PACK, isDisplayDocument, readDisplayField, readDisplayTextFlag, readDisplayTranslation,
  type DisplayDocument, type DisplayTextFlag } from "./display-text";
import type { JournalData } from "./journal";
import { JournalTranslationService } from "./journal-service";

type TextRecord = { flag: DisplayTextFlag; fields: Map<string, { source: string; translation: string | null }> };
const records = new Map<string, TextRecord>();
let reloadNumber = 0;
let registered = false;
const previewApps = new Set<DisplayApplication>();
const replaced = new Map<Text, { source: string; translation: string }>();
const localize = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.DisplayText.${key}`);

/** Strictly a display lookup: callers keep the original Document and UUID. */
export function lookupDisplayText(doc: DisplayDocument, path: string[]): string | null {
  let uuid = doc.uuid;
  // Actor/Item copies retain embedded IDs. Resolve their effect text through
  // explicit source metadata, never through names or a global UUID override.
  if (doc.documentName === "ActiveEffect") {
    for (let parent = doc.parent; parent; parent = parent.parent) {
      const source = sourceReferenceUuid(doc.uuid, parent);
      if (source) { uuid = source; break; }
    }
  }
  const record = records.get(`${uuid}\0${getTranslatorSettings().targetLanguage}`);
  if (!record || record.flag.documentType !== doc.documentName) return null;
  const field = record.fields.get(JSON.stringify(path));
  if (!field) return null;
  // Read raw text only. Cloning a whole Scene and reparsing HTML during every
  // PIXI refresh is unnecessarily expensive on large maps.
  const source = (doc as DisplayDocument & { _source?: Record<string, unknown> })._source ?? doc.toObject();
  return readDisplayField(source, path) === field.source ? field.translation : null;
}

export async function reloadDisplayTexts(): Promise<void> {
  const generation = ++reloadNumber;
  const next = new Map<string, TextRecord>();
  const duplicate = new Set<string>();
  const pack = game.packs.get(DISPLAY_TEXT_PACK);
  try { if (pack) for (const entry of (await pack.getIndex({ fields: [`flags.${MODULE_ID}.displayTranslation`] })).values()) {
    if (generation !== reloadNumber) return;
    const doc = await pack.getDocument(entry._id);
    const claim = (doc?.flags ?? entry.flags)?.[MODULE_ID]?.displayTranslation as Partial<DisplayTextFlag> | undefined;
    if (typeof claim?.sourceUuid !== "string" || typeof claim.targetLanguage !== "string") continue;
    const key = `${claim.sourceUuid}\0${claim.targetLanguage}`;
    const flag = doc && readDisplayTextFlag(doc.flags);
    if (!doc || !flag || next.has(key) || duplicate.has(key)) { next.delete(key); duplicate.add(key); continue; }
    const data = doc.toObject() as JournalData;
    next.set(key, { flag, fields: new Map(flag.fields.map(field => [JSON.stringify(field.path),
      { source: field.source, translation: readDisplayTranslation(data, field) }])) });
  }
  } catch (error) {
    // Never keep a previously visible GM-only translation after access is revoked.
    next.clear();
    logger.warn("Scene/effect text could not be loaded.", error);
  }
  if (generation !== reloadNumber) return;
  records.clear();
  for (const [key, record] of next) records.set(key, record);
  await applyDisplayLabels(document.body);
  for (const app of previewApps) {
    if (!app.element?.isConnected) previewApps.delete(app);
    else await renderDisplayDocument(app);
  }
  const canvas = (globalThis as unknown as { canvas?: { drawings?: { placeables: DisplayPlaceable[] }; notes?: { placeables: DisplayPlaceable[] } } }).canvas;
  for (const object of [...canvas?.drawings?.placeables ?? [], ...canvas?.notes?.placeables ?? []]) applyCanvasDisplayText(object);
}

/** Preserve icons, native click listeners, data-action and data-uuid. */
export function replaceDisplayLabel(element: Element | null, source: string, translation: string | null): void {
  if (!element || !translation || source === translation) return;
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType !== 3 || node.textContent?.trim() !== source.trim()) continue;
    const value = node.textContent;
    node.textContent = value.replace(source.trim(), translation);
    replaced.set(node as Text, { source: value, translation: node.textContent });
  }
}

async function resolveDisplayDocument(uuid: string): Promise<DisplayDocument | null> {
  const doc = await fromUuid(uuid).catch(() => null);
  return doc && isDisplayDocument(doc) ? doc : null;
}

export async function applyDisplayLabels(root: HTMLElement): Promise<void> {
  // Undo only our own unchanged render text, never user edits or another renderer's text.
  for (const [node, prior] of replaced) {
    if (!node.isConnected) replaced.delete(node);
    else if (root.contains(node)) {
      if (node.textContent === prior.translation) node.textContent = prior.source;
      replaced.delete(node);
    }
  }
  for (const row of root.querySelectorAll<HTMLElement>("[data-scene-id]")) {
    const doc = await resolveDisplayDocument(`Scene.${row.dataset.sceneId}`);
    if (!doc || !row.isConnected) continue;
    const source = doc.toObject();
    const path = row.dataset.levelId ? ["levels", row.dataset.levelId, "name"] : null;
    const label = row.querySelector("span.ellipsis");
    for (const field of path ? [path] : [["name"], ["navName"]]) {
      const text = readDisplayField(source, field);
      if (typeof text === "string") replaceDisplayLabel(label, text, lookupDisplayText(doc, field));
    }
  }
  const scene = (globalThis as unknown as { canvas?: { scene?: DisplayDocument } }).canvas?.scene;
  if (scene) for (const row of root.querySelectorAll<HTMLElement>(".region-list [data-region-id]")) {
    const path = ["regions", row.dataset.regionId!, "name"];
    const source = readDisplayField(scene.toObject(), path);
    if (typeof source === "string") replaceDisplayLabel(row.querySelector(".region-name"), source, lookupDisplayText(scene, path));
  }
  if (scene) for (const collection of ["regions", "drawings", "notes"]) {
    for (const row of root.querySelectorAll<HTMLElement>(`.${collection}-tab .placeable-entry[data-entry-id]`)) {
      const path = [collection, row.dataset.entryId!, collection === "regions" ? "name" : "text"];
      const source = readDisplayField(scene.toObject(), path);
      if (typeof source === "string") replaceDisplayLabel(row.querySelector(".label"), source, lookupDisplayText(scene, path));
    }
  }
  for (const row of root.querySelectorAll<HTMLElement>("#scenes [data-entry-id], #effects [data-entry-id]")) {
    const kind = row.closest("#scenes") ? "Scene" : "ActiveEffect";
    const doc = await resolveDisplayDocument(`${kind}.${row.dataset.entryId}`);
    if (doc && row.isConnected) replaceDisplayLabel(row.querySelector(".entry-name"), doc.name, lookupDisplayText(doc, ["name"]));
  }
  for (const link of root.querySelectorAll<HTMLElement>("a.content-link[data-uuid], [data-effect-id][data-uuid]")) {
    const uuid = link.dataset.uuid ?? "";
    if (!records.has(`${uuid}\0${getTranslatorSettings().targetLanguage}`) && !/\.ActiveEffect\.[^.]+$/u.test(uuid)) continue;
    const doc = await resolveDisplayDocument(uuid);
    if (doc && link.isConnected) replaceDisplayLabel(link.matches("a") ? link : link.querySelector("h4, .effect-name"), doc.name, lookupDisplayText(doc, ["name"]));
  }
}

interface DisplayPlaceable {
  document: FoundryUuidDocument & { name?: string; text?: string; label?: string };
  text?: { text: string };
  tooltip?: { text: string };
  _pendingText?: string;
}
const canvasText = new WeakMap<object, { source: string; translation: string }>();
export function applyCanvasDisplayText(object: DisplayPlaceable): void {
  const doc = object.document;
  const parent = doc.parent;
  if (!parent || !isDisplayDocument(parent) || parent.documentName !== "Scene" || !doc.id || object._pendingText !== undefined) return;
  const drawing = doc.documentName === "Drawing";
  if (!drawing && doc.documentName !== "Note") return;
  const text = drawing ? object.text : object.tooltip;
  if (!text) return;
  const previous = canvasText.get(text);
  if (previous && text.text === previous.translation) text.text = previous.source;
  canvasText.delete(text);
  const source = typeof doc.text === "string" ? doc.text : "";
  const translated = lookupDisplayText(parent, [drawing ? "drawings" : "notes", doc.id, "text"]);
  if (!source || !translated || text.text !== source) return;
  text.text = translated;
  canvasText.set(text, { source, translation: translated });
}

interface DisplayApplication {
  document?: FoundryUuidDocument;
  object?: FoundryUuidDocument;
  element?: HTMLElement;
  render(options?: boolean | Record<string, unknown>): unknown;
  window?: { header: HTMLElement; controls: HTMLElement };
}

const previewGenerations = new WeakMap<object, number>();
async function renderDisplayDocument(app: DisplayApplication): Promise<void> {
  const doc = app.document ?? app.object;
  if (!doc || !isDisplayDocument(doc) || !app.element) return;
  previewApps.add(app);
  const generation = (previewGenerations.get(app) ?? 0) + 1;
  previewGenerations.set(app, generation);
  const title = lookupDisplayText(doc, ["name"]);
  const description = doc.documentName === "ActiveEffect" ? lookupDisplayText(doc, ["description"]) : null;
  // Read-only translated preview; never replace form values that Foundry could submit to the source.
  app.element.querySelector(".ft-display-preview")?.remove();
  if (title || description) {
    const preview = document.createElement("aside");
    preview.className = "ft-display-preview";
    const heading = document.createElement("strong");
    heading.textContent = title ?? doc.name;
    heading.title = localize("Help");
    preview.append(heading);
    if (description) {
      const content = document.createElement("div");
      const editor = (foundry as unknown as { applications: { ux: { TextEditor: { implementation: { enrichHTML(html: string, options: Record<string, unknown>): Promise<string> } } } } }).applications.ux.TextEditor.implementation;
      content.innerHTML = await editor.enrichHTML(description, { async: true, relativeTo: doc });
      preview.append(content);
    }
    if (previewGenerations.get(app) !== generation || !app.element.isConnected) return;
    app.element.querySelector(".window-content")?.prepend(preview);
  }
  const frame = app.window;
  if (!game.user?.isGM || !frame || frame.header.querySelector(".ft-display-translate")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control ft-display-translate";
  button.textContent = localize("Translate");
  button.title = localize("Help");
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const pending = new JournalTranslationService().translateDisplay(doc);
      openActiveTranslationsOverview();
      const result = await pending;
      await reloadDisplayTexts();
      ui.notifications.info(localize(result.fallbackTextSegments ? "Review" : "Done"));
      void app.render(true);
    } catch (error) {
      ui.notifications.warn(error instanceof Error ? error.message : String(error));
    } finally { button.disabled = false; }
  });
  frame.controls.before(button);
}

export function registerDisplayTextView(): void {
  if (registered) return;
  registered = true;
  const reload = () => { void reloadDisplayTexts().catch(error => logger.warn("Scene/effect text could not be loaded.", error)); };
  Hooks.on("foundryTranslateDisplayTextChanged", reload);
  for (const event of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry", "createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"]) {
    Hooks.on(event, (doc: { pack?: string; parent?: { pack?: string } }) => {
      if ((doc.pack ?? doc.parent?.pack) === DISPLAY_TEXT_PACK) reload();
    });
  }
  Hooks.on("updateSetting", (setting: { key?: string }) => { if (setting.key === `${MODULE_ID}.targetLanguage`) reload(); });
  Hooks.on("renderApplicationV2", (app: DisplayApplication, html: HTMLElement) => {
    if (html instanceof HTMLElement) void applyDisplayLabels(html).catch(error => logger.warn("Display labels could not be rendered.", error));
    void renderDisplayDocument(app).catch(error => logger.warn("Scene/effect preview could not be rendered.", error));
  });
  for (const type of ["Drawing", "Note"]) {
    Hooks.on(`draw${type}`, applyCanvasDisplayText);
    Hooks.on(`refresh${type}`, applyCanvasDisplayText);
  }
  registerEffectCards();
  reload();
}

// Crucible provides a dedicated presentation method for effect cards. Wrap only
// its returned HTML: never proxy a Document or replace getters used by mechanics.
const CARD_PATCHED = Symbol("foundry-translate-effect-card");
export function registerEffectCards(): void {
  if (game.system?.id !== "crucible") return;
  type CardMethod = (this: DisplayDocument, ...args: unknown[]) => Promise<string>;
  const prototype = (CONFIG as unknown as { ActiveEffect?: { documentClass?: { prototype: {
    renderCard?: CardMethod; [CARD_PATCHED]?: boolean;
  } } } }).ActiveEffect?.documentClass?.prototype;
  if (!prototype?.renderCard || prototype[CARD_PATCHED]) return;
  const original = prototype.renderCard;
  prototype.renderCard = async function(...args) {
    const html = await original.apply(this, args);
    try {
      const name = lookupDisplayText(this, ["name"]);
      const description = lookupDisplayText(this, ["description"]);
      if (!name && !description) return html;
      const template = document.createElement("div");
      template.innerHTML = html;
      const heading = template.querySelector(".action-header h4");
      if (name && heading?.textContent?.trim() === this.name) heading.textContent = name;
      const body = template.querySelector(".description");
      if (body && description) {
        const editor = (foundry as unknown as { applications: { ux: { TextEditor: { implementation: {
          enrichHTML(html: string, options: Record<string, unknown>): Promise<string>;
        } } } } }).applications.ux.TextEditor.implementation;
        const enriched = await editor.enrichHTML(description, { async: true, relativeTo: this });
        // The record or source may change during enrichment.
        if (lookupDisplayText(this, ["description"]) !== description) return html;
        body.innerHTML = enriched;
      }
      return template.innerHTML;
    } catch (error) { logger.warn("Effect card translation could not be rendered.", error); return html; }
  };
  prototype[CARD_PATCHED] = true;
}
