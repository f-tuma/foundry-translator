import { MODULE_ID } from "../constants";
import { logger } from "../logger";
import { SETTINGS } from "../settings/settings";
import { parseDocumentReference, resolveSourceReference, resolveTranslationReference, TRANSLATION_IDENTITIES } from "./document-identity";

function targetLanguage(): string {
  return String(game.settings.get(MODULE_ID, SETTINGS.TARGET_LANGUAGE) ?? "cs");
}

/** Only presentation links are redirected; system UUID resolution stays untouched. */
export function isTranslatableDocumentReference(uuid: string): boolean {
  const ref = parseDocumentReference(uuid);
  return !!ref && !TRANSLATION_IDENTITIES.some(spec => ref.root.startsWith(`Compendium.${spec.pack}.`));
}

export function translatedEmbeddedUuid(sourceUuid: string, translatedRootUuid: string): string | null {
  const source = parseDocumentReference(sourceUuid);
  const target = parseDocumentReference(translatedRootUuid);
  if (!source || !target || target.type !== source.type || target.suffix || target.anchor) return null;
  return `${target.root}${source.suffix}${source.anchor}`;
}

async function renderReference(uuid: string): Promise<boolean> {
  const ref = parseDocumentReference(uuid);
  if (!ref) return false;
  const document = await fromUuid(`${ref.root}${ref.suffix}`);
  if (!document) return false;
  const isPage = document.documentName === "JournalEntryPage" && document.parent;
  const owner = (isPage ? document.parent : document) as FoundryUuidDocument & {
    sheet?: { render(options: Record<string, unknown>): unknown };
  };
  if (!owner?.sheet) return false;
  await owner.sheet.render({ force: true, ...(isPage ? { pageId: document.id } : {}),
    ...(ref.anchor ? { anchor: ref.anchor.slice(1) } : {}) });
  return true;
}

const pendingOpens = new Map<string, Promise<boolean>>();

/** Repeated/concurrent opens resolve one identity and reuse Foundry's existing sheet. */
export function openTranslationReference(uuid: string, options: { view: "source" | "translation"; language?: string }): Promise<boolean> {
  const language = options.language ?? targetLanguage();
  const key = JSON.stringify([uuid, options.view, language]);
  const pending = pendingOpens.get(key);
  if (pending) return pending;
  const work = (async () => {
    if (options.view === "source") {
      const source = await resolveSourceReference(uuid);
      return source ? renderReference(source) : false;
    }
    const pair = await resolveTranslationReference(uuid, language);
    if (pair.status === "invalid" || pair.status === "missing") return false;
    const target = pair.translatedUuid;
    return target ? renderReference(target) : false;
  })().finally(() => pendingOpens.delete(key));
  pendingOpens.set(key, work);
  return work;
}

export async function openTranslatedReference(uuid: string): Promise<boolean> {
  if (!isTranslatableDocumentReference(uuid)) return false;
  return openTranslationReference(uuid, { view: "translation" });
}

export function linkedDocumentUuid(event: MouseEvent): string | null {
  if (!(event.target instanceof Element)) return null;
  const link = event.target.closest<HTMLElement>("a.content-link[data-uuid]");
  // Action widgets may carry UUIDs too. Their own Ember/Foundry handler owns them.
  if (!link || link.closest("[data-action],button")) return null;
  return link.dataset.uuid?.trim() ?? null;
}

function onDocumentClick(event: MouseEvent): void {
  if (game.settings.get(MODULE_ID, SETTINGS.AUTO_OPEN_TRANSLATIONS) === false
    || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const uuid = linkedDocumentUuid(event);
  if (!uuid || !isTranslatableDocumentReference(uuid)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void openTranslatedReference(uuid).then(async opened => {
    if (!opened) await renderReference(uuid);
  }).catch(error => {
    logger.warn("Translated document link could not be opened; falling back to its source.", { uuid, error });
    void renderReference(uuid).catch(error => logger.warn("Source document could not be opened.", { uuid, error }));
  });
}

const registeredDocuments = new WeakSet<Document>();
export function registerTranslatedLinkNavigation(): void {
  if (registeredDocuments.has(document)) return;
  registeredDocuments.add(document);
  document.addEventListener("click", onDocumentClick, true);
}
