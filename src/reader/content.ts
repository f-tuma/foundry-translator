import { resolveTranslationReference, resolveSourceReference, parseDocumentReference, translationIdentity } from "../translation/document-identity";
import { readJournalTranslationFlag } from "../translation/journal";
import { MODULE_ID } from "../constants";
import { SETTINGS } from "../settings/settings";

interface ReaderDocument extends FoundryUuidDocument {
  name?: string; type?: string; visible?: boolean; isOwner?: boolean; sort?: number; category?: string;
  text?: { content?: string }; src?: string; img?: string; system?: Record<string, any>;
  pages?: { contents: ReaderDocument[] }; categories?: { contents: { id: string; name: string; sort?: number }[] };
  sheet?: any;
  testUserPermission?(user: unknown, level: string): boolean;
}
export interface ReaderChapter { uuid: string; name: string; category: string }
export interface ReaderContent {
  uuid: string; title: string; book: string; html: string; chapters: ReaderChapter[]; kind: string; anchor?: string | undefined;
  native: ReaderDocument;
}
const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.Reader.${key}`);
export const escapeReader = (text: string) => text.replace(/[&<>"']/gu, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const unsupportedPage = () => `<p class="ft-reader-notice">${escapeReader(t("Unsupported"))}</p><p class="ft-reader-notice">${escapeReader(t("NativeHint"))}</p>`;

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
  if (page.type === "image") return `<figure><img src="${escapeReader(page.src ?? "")}" alt="${escapeReader(page.name ?? "")}"></figure>`;
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
      if (!section.content || ["actions", "warnings"].includes(section.sectionClass ?? "")) continue;
      if (!game.user?.isGM && ["gamemaster", "secrets"].includes(section.sectionClass ?? "")) continue;
      const heading = section.header ? `<h2>${escapeReader(game.i18n.localize(section.header))}</h2>` : "";
      html.push(`<section class="ft-reader-section ${escapeReader(section.contentClass ?? "")}">${heading}${await enrich(section.content, page, secrets)}</section>`);
    }
    return html.join("");
  }
  if (page.type !== "text") return unsupportedPage();
  // Native text context also supports Markdown without guessing conversion.
  const Sheet = page.sheet?.constructor;
  if (Sheet && Sheet !== Object) {
    const view = new Sheet({ document: page, mode: "view", editable: false, window: { frame: false } });
    let context = await view._prepareContext({});
    context = await view._preparePartContext("content", context, {});
    if (typeof context.text?.enriched === "string") return context.text.enriched;
  }
  return enrich(page.text?.content ?? "", page, secrets);
}

export function readerChapters(root: ReaderDocument, source: ReaderDocument): ReaderChapter[] {
  const categories = [...(root.categories?.contents ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const order = new Map(categories.map((c, i) => [c.id, i]));
  return [...(root.pages?.contents ?? [])].filter(page => {
    const original = source.pages?.contents.find(p => p.id === page.id);
    return canReadDocument(page) && canReadDocument(original);
  }).sort((a, b) => (order.get(a.category ?? "") ?? categories.length) - (order.get(b.category ?? "") ?? categories.length) || (a.sort ?? 0) - (b.sort ?? 0))
    .map(p => ({ uuid: p.uuid, name: p.name ?? "", category: categories.find(c => c.id === p.category)?.name ?? "" }));
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
    const html = await readerPageHtml(selected, selected.isOwner === true && originalPage?.isOwner === true);
    return { uuid: selected.uuid, title: selected.name ?? "", book: owner.name ?? "", html, chapters, kind: "JournalEntryPage", anchor, native: selected };
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
    html: figure + (sections.length ? await enrich(sections.join("\n"), native, secrets) : `<p class="ft-reader-notice">${escapeReader(t("NativeHint"))}</p>`) };
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
  root.querySelectorAll("script,style,iframe,object,embed,form,input,textarea,select,button").forEach(e => e.remove());
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
