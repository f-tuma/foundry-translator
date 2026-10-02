import { resolveTranslationReference, resolveSourceReference, parseDocumentReference, translationIdentity } from "../translation/document-identity";
import { readJournalTranslationFlag } from "../translation/journal";
import { isTranslatedEmberPage, translateOutcomeLabels } from "../translation/ember-runtime-bridge";
import { MODULE_ID } from "../constants";
import { SETTINGS } from "../settings/settings";

interface ReaderDocument extends FoundryUuidDocument {
  name?: string; type?: string; visible?: boolean; isOwner?: boolean; sort?: number; category?: string | null;
  text?: { content?: string }; src?: string; img?: string; system?: Record<string, any>;
  pages?: { contents: ReaderDocument[] }; categories?: { contents: { id: string; name: string; sort?: number }[] };
  sheet?: any; title?: { level?: number };
  testUserPermission?(user: unknown, level: string): boolean;
}
export interface ReaderChapter { uuid: string; name: string; category: string; level: number }
export interface ReaderPage { html: string; subtitle?: string | undefined; pronunciation?: string | undefined; unsupported?: boolean }
export interface ReaderContent extends ReaderPage {
  uuid: string; title: string; book: string; chapters: ReaderChapter[]; kind: string; anchor?: string | undefined;
  native: ReaderDocument;
}
const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.Reader.${key}`);
export const escapeReader = (text: string) => text.replace(/[&<>"']/gu, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// The reader renders its own "Open in Foundry" control next to this notice.
const unsupportedPage = (): ReaderPage => ({ html: `<p class="ft-reader-notice">${escapeReader(t("Unsupported"))}</p>`, unsupported: true });
/** Ember 0.6.2 passes literal English section headers to its template. Map the
 * known ones to reader strings; unknown/system-localized headers pass through. */
const EMBER_HEADERS: Record<string, string> = {
  "At a Glance": "AtAGlance", "Setting the Scene": "SettingTheScene", "Event Details": "EventDetails", "Journal Summary": "JournalSummary",
  "Event Outcomes": "EventOutcomes", "Secret Lore": "SecretLore", "Gamemaster Information": "Gamemaster", "Ancestry Details": "AncestryDetails",
  "Culture Details": "CultureDetails", "Biome Details": "BiomeDetails", "Location Details": "LocationDetails", "Quest Details": "QuestDetails",
  "Biomes": "Biomes", "Locations": "Locations", "Notable Inhabitants": "NotableInhabitants", "Events": "Events", "Event Summary": "EventSummary",
  "Related Locations": "RelatedLocations", "Involved Locations": "InvolvedLocations",
};
const sectionHeader = (header: string) => EMBER_HEADERS[header] ? t(`Section.${EMBER_HEADERS[header]}`) : game.i18n.localize(header);
/** Translated event copies read outcome labels from the original's live event;
 * localize them by outcome ID exactly as the native translated sheet does. */
function localizedOutcomes(html: string, page: ReaderDocument): string {
  const outcomes = (page.system as any)?._source?.outcomes;
  if (!Array.isArray(outcomes) || !isTranslatedEmberPage(page as any)) return html;
  const root = document.createElement("div"); root.innerHTML = html;
  translateOutcomeLabels(root, outcomes);
  return root.innerHTML;
}

export function canReadDocument(doc: ReaderDocument | null | undefined, level = "OBSERVER"): boolean {
  if (!doc) return false;
  if (game.user?.isGM) return true;
  return doc.testUserPermission?.(game.user, level) === true;
}
async function enrich(html: string, relativeTo: ReaderDocument, secrets: boolean): Promise<string> {
  const editor = (foundry.applications as any).ux.TextEditor;
  return editor.enrichHTML(html, { relativeTo, secrets });
}

/** Native Ember view models retain all sections, system branches and visibility.
 * A separate view-only sheet is prepared, never rendered or submitted. No live
 * sheet options, event state or stored document data are changed. */
export async function readerPageHtml(page: ReaderDocument, secrets: boolean): Promise<string> {
  return (await readerPage(page, secrets)).html;
}
export async function readerPage(page: ReaderDocument, secrets: boolean): Promise<ReaderPage> {
  if (page.type === "image") return { html: `<figure><img src="${escapeReader(page.src ?? "")}" alt="${escapeReader(page.name ?? "")}"></figure>` };
  if (page.type?.startsWith("ember.")) {
    const Sheet = page.sheet?.constructor;
    if (!Sheet || Sheet === Object) return unsupportedPage();
    const view = new Sheet({ document: page, mode: "view", editable: false, window: { frame: false } });
    if (typeof view._getSections !== "function") return unsupportedPage();
    let context = await view._prepareContext({});
    context = await view._preparePartContext("content", context, {});
    const sections = context.sections as { sectionClass?: string; contentClass?: string; content?: string; header?: string }[] | undefined;
    if (!Array.isArray(sections)) return unsupportedPage();
    const html: string[] = [];
    for (const section of sections) {
      // Automation controls are not part of a reading surface.
      const kind = section.sectionClass ?? "";
      if (!section.content || ["actions", "warnings"].includes(kind)) continue;
      if (!game.user?.isGM && ["gamemaster", "secrets"].includes(kind)) continue;
      const heading = section.header ? `<h2>${escapeReader(sectionHeader(section.header))}</h2>` : "";
      let body = await enrich(section.content, page, secrets);
      if (kind === "outcomes") body = localizedOutcomes(body, page);
      if (kind === "edict") body = body.replace(`<h4>Edict of ${page.name}</h4>`, () => `<h4>${escapeReader(t("Section.Edict").replace("{name}", page.name ?? ""))}</h4>`);
      // Keep Ember's section/content classes: they distinguish read-aloud,
      // creature lists, page summaries and event outcomes for reader styling.
      html.push(`<section class="ft-reader-section ft-ember-${escapeReader(kind || "content")}">${heading}<div class="${escapeReader(section.contentClass ?? "")}">${body}</div></section>`);
    }
    const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
    return { html: html.join(""), subtitle: text(context.subtitle), pronunciation: text(context.pronunciation) };
  }
  if (page.type !== "text") return unsupportedPage();
  // Native text context also supports Markdown without guessing conversion.
  const Sheet = page.sheet?.constructor;
  if (Sheet && Sheet !== Object) {
    const view = new Sheet({ document: page, mode: "view", editable: false, window: { frame: false } });
    let context = await view._prepareContext({});
    context = await view._preparePartContext("content", context, {});
    if (typeof context.text?.enriched === "string") return { html: context.text.enriched };
  }
  return { html: await enrich(page.text?.content ?? "", page, secrets) };
}

/** Same order as Foundry's journal sheet: categories by sort, then pages without
 * a (valid) category under "Uncategorized"; title.level keeps sub-pages nested. */
export function readerChapters(root: ReaderDocument, source: ReaderDocument): ReaderChapter[] {
  const categories = [...(root.categories?.contents ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const uncategorized = categories.length ? game.i18n.localize("JOURNAL.Uncategorized") : "";
  return [...(root.pages?.contents ?? [])].filter(page => {
    const original = source.pages?.contents.find(p => p.id === page.id);
    return canReadDocument(page) && canReadDocument(original);
  }).sort((a, b) => (order.get(a.category ?? "") ?? categories.length) - (order.get(b.category ?? "") ?? categories.length) || (a.sort ?? 0) - (b.sort ?? 0))
    .map(p => ({ uuid: p.uuid, name: p.name ?? "", category: categories.find(c => c.id === p.category)?.name ?? uncategorized,
      level: Math.max(1, Math.min(3, Number(p.title?.level) || 1)) }));
}

export async function loadReaderContent(requested: string): Promise<ReaderContent> {
  const [bare, ...anchorParts] = requested.split("#"), anchor = anchorParts.join("#") || undefined;
  let doc = await fromUuid(bare!) as ReaderDocument | null;
  if (!canReadDocument(doc, doc?.documentName === "Actor" ? "LIMITED" : "OBSERVER")) throw new Error("Reader.Unavailable");
  const sourceUuid = parseDocumentReference(bare!) ? await resolveSourceReference(bare!) : bare;
  const source = sourceUuid ? await fromUuid(sourceUuid.split("#")[0]!) as ReaderDocument | null : null;
  if (!canReadDocument(source, source?.documentName === "Actor" ? "LIMITED" : "OBSERVER")) throw new Error("Reader.Unavailable");
  const sourceDoc = source!;
  // Explicit translated links keep their language. Original links follow the
  // existing auto-open preference, with ambiguity/missing targets falling back.
  const root = doc!.documentName === "JournalEntryPage" ? doc!.parent : doc;
  const alreadyTranslated = root && translationIdentity(root, root.documentName ?? "");
  // Open roots through a page so partially completed books use a translated
  // first chapter when available, and source chapters otherwise.
  if (doc!.documentName === "JournalEntry") {
    const chapters = readerChapters(doc!, sourceDoc);
    if (!chapters[0]) throw new Error("Reader.Unavailable");
    return loadReaderContent(chapters[0].uuid + (anchor ? `#${anchor}` : ""));
  }
  const explicitFlag = readJournalTranslationFlag(root?.flags);
  if (alreadyTranslated && doc!.documentName === "JournalEntryPage" && explicitFlag?.partial && !explicitFlag.processedPageIds?.includes(doc!.id ?? "")) doc = sourceDoc;
  if (!alreadyTranslated && parseDocumentReference(bare!) && game.settings.get(MODULE_ID, SETTINGS.AUTO_OPEN_TRANSLATIONS) !== false) {
    const language = String(game.settings.get(MODULE_ID, SETTINGS.TARGET_LANGUAGE) ?? "cs");
    const pair = await resolveTranslationReference(bare!, language);
    if (pair.status === "mapped" && pair.translatedUuid) {
      const target = await fromUuid(pair.translatedUuid.split("#")[0]!) as ReaderDocument | null;
      const pageRoot = target?.documentName === "JournalEntryPage" ? target.parent : target;
      const flag = readJournalTranslationFlag(pageRoot?.flags);
      const processed = !flag?.partial || (target?.documentName === "JournalEntryPage" && flag.processedPageIds?.includes(target.id ?? ""));
      if (processed && canReadDocument(target, target?.documentName === "Actor" ? "LIMITED" : "OBSERVER")) doc = target;
    }
  }
  const native = doc!;
  const owner = (native.documentName === "JournalEntryPage" ? native.parent : native) as ReaderDocument;
  const sourceOwner = (sourceDoc.documentName === "JournalEntryPage" ? sourceDoc.parent : sourceDoc) as ReaderDocument;
  const secrets = native.isOwner === true && sourceDoc.isOwner === true;
  if (["JournalEntry", "JournalEntryPage"].includes(native.documentName ?? "")) {
    const chapters = readerChapters(owner, sourceOwner);
    const selected = native.documentName === "JournalEntryPage" ? native : owner.pages?.contents.find(p => p.uuid === chapters[0]?.uuid);
    if (!selected || !chapters.some(c => c.uuid === selected.uuid)) throw new Error("Reader.Unavailable");
    const originalPage = sourceOwner.pages?.contents.find(p => p.id === selected.id);
    const page = await readerPage(selected, selected.isOwner === true && originalPage?.isOwner === true);
    return { ...page, uuid: selected.uuid, title: selected.name ?? "", book: owner.name ?? "", chapters, kind: "JournalEntryPage", anchor, native: selected };
  }
  const data = native.toObject?.() ?? {}, system = data.system as any;
  const sections: string[] = [];
  if (native.documentName === "Actor" && canReadDocument(native) && canReadDocument(sourceDoc)) {
    const biography = system?.details?.biography;
    if (biography && typeof biography === "object") {
      for (const key of ["appearance", "public"]) if (typeof biography[key] === "string") sections.push(biography[key]);
      if (game.user?.isGM && typeof biography.private === "string" && biography.private) sections.push(`<h2>${escapeReader(t("Gamemaster"))}</h2>${biography.private}`);
      if (typeof biography.value === "string") sections.push(biography.value);
    } else if (typeof biography === "string") sections.push(biography);
  } else if (["Item", "ActiveEffect"].includes(native.documentName ?? "")) {
    const description = system?.description;
    if (typeof description === "string") sections.push(description);
    else if (description && typeof description === "object") {
      for (const key of ["value", "public"]) if (typeof description[key] === "string") sections.push(description[key]);
      if (game.user?.isGM && typeof description.private === "string" && description.private) sections.push(`<h2>${escapeReader(t("Gamemaster"))}</h2>${description.private}`);
    }
    if (native.documentName === "ActiveEffect" && typeof data.description === "string") sections.push(data.description);
  }
  const image = native.img ?? (native.documentName === "Scene" ? (data.background as any)?.src ?? data.thumb : undefined);
  const figure = typeof image === "string" && image ? `<figure class="ft-reader-portrait"><img src="${escapeReader(image)}" alt="${escapeReader(native.name ?? "")}"></figure>` : "";
  return { uuid: native.uuid, title: native.name ?? "", book: t("Preview"), kind: native.documentName ?? "", chapters: [], anchor, native,
    unsupported: !sections.length, html: figure + (sections.length ? await enrich(sections.join("\n"), native, secrets) : `<p class="ft-reader-notice">${escapeReader(t("NativeHint"))}</p>`) };
}

/** Keep prose, artwork and native link metadata; strip executable UI/actions. */
export function prepareReaderProse(html: string): HTMLElement {
  const root = document.createElement("div"); root.className = "ft-reader-prose ember journal-page-content"; root.innerHTML = html;
  // Foundry's custom document-embed calls Document#onEmbed on connection and
  // can reattach gameplay handlers. Keep its prose as an inert ordinary div.
  for (const embed of root.querySelectorAll("document-embed")) {
    const staticEmbed = document.createElement("div");
    for (const attr of [...embed.attributes]) if (attr.name !== "uuid") staticEmbed.setAttribute(attr.name, attr.value);
    staticEmbed.classList.add("ft-reader-static-embed"); staticEmbed.append(...embed.childNodes); embed.replaceWith(staticEmbed);
  }
  // Ember lists event outcomes as checkboxes inside a form. Keep the prose and
  // the completion state as static text instead of dropping the whole section.
  for (const box of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"],input[type="radio"]')) {
    const mark = document.createElement("span"), checked = box.hasAttribute("checked");
    mark.className = `ft-reader-check${checked ? " is-checked" : ""}`;
    mark.setAttribute("role", "img"); mark.setAttribute("aria-label", t(checked ? "OutcomeComplete" : "OutcomeOpen"));
    mark.textContent = checked ? "✓" : "";
    box.replaceWith(mark);
  }
  for (const form of root.querySelectorAll("form,fieldset")) {
    const block = document.createElement("div");
    block.className = `${form.getAttribute("class") ?? ""} ft-reader-${form.localName}`.trim(); block.append(...form.childNodes); form.replaceWith(block);
  }
  root.querySelectorAll("script,style,iframe,object,embed,input,textarea,select,button,code-mirror").forEach(e => e.remove());
  for (const el of root.querySelectorAll("*")) for (const attr of [...el.attributes]) {
    if (/^on/iu.test(attr.name) || ["srcdoc", "autofocus", "contenteditable", "data-action"].includes(attr.name)) el.removeAttribute(attr.name);
    if (["href", "src", "xlink:href"].includes(attr.name) && /^\s*(?:javascript|vbscript|file|data):/iu.test(attr.value)
      && !(attr.name === "src" && /^data:image\/(?:png|jpeg|webp|gif);/iu.test(attr.value))) el.removeAttribute(attr.name);
  }
  // Security follows native ownership AND the original; never expose GM blocks
  // from a publicly readable translated compendium to players.
  if (!game.user?.isGM) root.querySelectorAll(".gamemaster,.secret:not(.revealed),.secrets").forEach(e => e.remove());
  for (const a of root.querySelectorAll<HTMLAnchorElement>("a[href]")) if (/^https?:/iu.test(a.getAttribute("href") ?? "")) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  return root;
}
