import { MODULE_ID, MODULE_VERSION } from "../constants";
import { SETTINGS } from "../settings/settings";
import { canReadDocument, loadReaderContent, prepareReaderProse } from "./content";
import { parseDocumentReference, resolveSourceReference } from "../translation/document-identity";
import { buildLightLibrary, validLightUuid } from "./light-library";
import { readLightLibrary, writeLightLibrary } from "./light-storage";

const ALLOWED = new Set("a article aside b blockquote br caption code dd div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img li mark ol p pre s section small span strong sub sup table tbody td tfoot th thead tr u ul".split(" "));
const ATTRIBUTES = new Set("class id title lang dir role aria-label aria-hidden colspan rowspan scope alt".split(" "));
/** A static allowlist, stricter than the in-game sanitizer. Relative artwork is
 * fixed to the game base before moving into /modules/.../reader/. */
export function sanitizeLightHtml(html: string, base = document.baseURI): string {
  const root = prepareReaderProse(html);
  const Page = (CONFIG.JournalEntryPage as any)?.documentClass;
  if (typeof Page?.buildTOC === "function") {
    // Foundry gives repeated headings native $1/$2 suffixes and honors no-toc.
    // Materialize those targets while the original metadata is still present.
    for (const node of Object.values(Page.buildTOC(root)) as { element?: HTMLElement; slug?: string }[]) {
      if (node.element && typeof node.slug === "string") node.element.id = node.slug;
    }
  } else if (typeof Page?.slugifyHeading === "function") {
    for (const heading of root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")) if (!heading.id) heading.id = Page.slugifyHeading(heading);
  }
  for (const el of [...root.querySelectorAll("*")]) {
    if (["script", "style", "iframe", "object", "embed", "svg", "math", "link", "meta", "base", "template", "audio", "video"].includes(el.localName)) { el.remove(); continue; }
    if (!ALLOWED.has(el.localName)) { el.replaceWith(...el.childNodes); continue; }
    for (const attr of [...el.attributes]) {
      if (ATTRIBUTES.has(attr.name)) continue;
      if (el.localName === "a" && ["data-uuid", "data-hash", "data-reader-uuid"].includes(attr.name)) continue;
      if (el.localName === "a" && attr.name === "href") {
        if (attr.value.startsWith("#")) continue;
        try { const url = new URL(attr.value, base); if (/^https?:$/u.test(url.protocol)) { el.setAttribute("href", url.href); continue; } } catch { /* Drop malformed URL. */ }
      }
      if (el.localName === "img" && attr.name === "src") {
        try { const url = new URL(attr.value, base); if (/^https?:$/u.test(url.protocol) && url.origin === new URL(base).origin) { el.setAttribute("src", url.href); continue; } } catch { /* Drop malformed URL. */ }
      }
      el.removeAttribute(attr.name);
    }
    if (el.localName === "img") { el.setAttribute("loading", "lazy"); el.setAttribute("decoding", "async"); }
    if (el.localName === "a" && el.hasAttribute("href") && !el.getAttribute("href")!.startsWith("#")) { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
  }
  return root.innerHTML;
}
function scope() {
  const worldId = String(game.world?.id ?? ""), userId = String(game.user?.id ?? "");
  if (!worldId || !userId) throw new Error("Reader.LightLoginRequired");
  const language = String(game.settings.get(MODULE_ID, SETTINGS.TARGET_LANGUAGE) ?? game.i18n.lang ?? "cs");
  return { id: `${worldId}:${userId}:${language}`, worldId, userId, language,
    worldName: String((game.world as any)?.title ?? worldId), userName: String((game.user as any)?.name ?? userId) };
}
export function lightReaderUrl(library?: string, uuid?: string): string {
  const route = (foundry as any).utils.getRoute(`modules/${MODULE_ID}/reader/index.html`);
  const url = new URL(route, window.location.href);
  url.searchParams.set("v", MODULE_VERSION);
  if (library) url.searchParams.set("library", library);
  if (uuid) url.searchParams.set("uuid", uuid);
  return url.href;
}
/** Foundry deliberately serves uploaded HTML as plain text. A reverse proxy
 * must opt in only this trusted module shell, never arbitrary uploaded HTML. */
export async function assertLightReaderEndpoint(signal?: AbortSignal): Promise<void> {
  const response = await fetch(lightReaderUrl(), { method: "HEAD", cache: "no-store", redirect: "error", ...(signal ? { signal } : {}) });
  if (!response.ok || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "text/html") {
    throw new Error("Reader.LightServerHtmlRequired");
  }
}
export async function prepareLightReader(uuid: string, progress?: (done: number, pending: number) => void, signal?: AbortSignal): Promise<string> {
  const initial = scope(), initialGM = game.user?.isGM;
  await assertLightReaderEndpoint(signal);
  const old = await readLightLibrary(initial.id);
  const authorized = new Map<string, { sourceUuid: string; owner: boolean; sourceOwner: boolean }>();
  const assertAccount = () => { if (scope().id !== initial.id || game.user?.isGM !== initialGM) throw new Error("Reader.LightAccountChanged"); };
  const access = async (target: string) => {
    const sourceUuid = parseDocumentReference(target) ? await resolveSourceReference(target) : target;
    const native = await fromUuid(target), source = sourceUuid ? await fromUuid(sourceUuid) : null;
    const level = native?.documentName === "Actor" ? "LIMITED" : "OBSERVER";
    if (!sourceUuid || !canReadDocument(native, level) || !canReadDocument(source, level)) throw new Error("Reader.Unavailable");
    return { sourceUuid, owner: (native as { isOwner?: boolean } | null)?.isOwner === true, sourceOwner: (source as { isOwner?: boolean } | null)?.isOwner === true };
  };
  const previous = old?.version === 1 && old.id === initial.id && old.worldId === initial.worldId && old.userId === initial.userId && old.language === initial.language
    ? (Array.isArray(old.roots) ? old.roots : []).filter(r => typeof r === "string" && validLightUuid(r)).slice(0, 99) : [];
  const library = await buildLightLibrary({ ...initial, roots: [...previous, uuid] }, {
    load: async requested => {
      assertAccount(); const content = await loadReaderContent(requested);
      authorized.set(content.uuid, await access(content.uuid)); assertAccount(); return content;
    },
    sanitize: sanitizeLightHtml, ...(progress ? { progress } : {}), ...(signal ? { signal } : {}),
  });
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  // Permissions/ownership may change while hundreds of chapters are prepared.
  // Recheck originals and copies immediately before the single atomic commit.
  for (const [target, prior] of authorized) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    assertAccount(); const current = await access(target);
    if (current.sourceUuid !== prior.sourceUuid || current.owner !== prior.owner || current.sourceOwner !== prior.sourceOwner) throw new Error("Reader.LightAccountChanged");
  }
  assertAccount();
  library.startUuid = library.documents.find(d => d.aliases.includes(uuid.split("#")[0]!))?.uuid ?? library.startUuid;
  await writeLightLibrary(library, signal);
  return lightReaderUrl(library.id, library.startUuid);
}
