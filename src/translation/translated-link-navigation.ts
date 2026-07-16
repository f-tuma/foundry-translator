import { MODULE_ID } from "../constants";
import { logger } from "../logger";
import { SETTINGS } from "../settings/settings";
import { readActorTranslationFlag } from "./actor";
import {
  ACTOR_TRANSLATION_FLAG_PATH,
  ACTOR_TRANSLATIONS_PACK_ID,
} from "./compendium-actor-translation-repository";
import {
  ITEM_TRANSLATION_FLAG_PATH,
  ITEM_TRANSLATIONS_PACK_ID,
} from "./compendium-item-translation-repository";
import {
  TRANSLATION_FLAG_PATH,
  TRANSLATIONS_PACK_ID,
} from "./compendium-translation-repository";
import { readItemTranslationFlag } from "./item";
import { readJournalTranslationFlag } from "./journal";
import { rootDocumentReferenceUuid } from "./journal-service";

interface TranslationFlagIdentity {
  sourceUuid: string;
  targetLanguage: string;
}

interface TranslationPackSpec {
  packId: string;
  flagPath: string;
  readFlag(flags: Record<string, Record<string, unknown>> | undefined): TranslationFlagIdentity | null;
}

const PACKS: readonly TranslationPackSpec[] = [
  {
    packId: TRANSLATIONS_PACK_ID,
    flagPath: TRANSLATION_FLAG_PATH,
    readFlag: readJournalTranslationFlag,
  },
  {
    packId: ACTOR_TRANSLATIONS_PACK_ID,
    flagPath: ACTOR_TRANSLATION_FLAG_PATH,
    readFlag: readActorTranslationFlag,
  },
  {
    packId: ITEM_TRANSLATIONS_PACK_ID,
    flagPath: ITEM_TRANSLATION_FLAG_PATH,
    readFlag: readItemTranslationFlag,
  },
];

function autoOpenEnabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.AUTO_OPEN_TRANSLATIONS) !== false;
}

function targetLanguage(): string {
  return String(game.settings.get(MODULE_ID, SETTINGS.TARGET_LANGUAGE) ?? "cs");
}

function cleanUuid(uuid: string): string {
  return uuid.split("#", 1)[0] ?? uuid;
}

function isStoredTranslationUuid(uuid: string): boolean {
  return PACKS.some(({ packId }) => uuid.startsWith(`Compendium.${packId}.`));
}

/** Whether a Foundry UUID belongs to a document type translated by this module. */
export function isTranslatableDocumentReference(uuid: string): boolean {
  const rootUuid = rootDocumentReferenceUuid(cleanUuid(uuid));
  if (!rootUuid || isStoredTranslationUuid(rootUuid)) return false;
  const parts = rootUuid.split(".");
  const documentType = parts[0] === "Compendium" ? parts[3] : parts[0];
  return documentType === "JournalEntry" || documentType === "Actor" || documentType === "Item";
}

export function translatedEmbeddedUuid(
  sourceUuid: string,
  translatedRootUuid: string,
): string | null {
  const rootUuid = rootDocumentReferenceUuid(sourceUuid);
  if (!rootUuid || !sourceUuid.startsWith(rootUuid)) return null;
  return `${translatedRootUuid}${sourceUuid.slice(rootUuid.length)}`;
}

async function storedTranslation(
  sourceUuid: string,
  language: string,
): Promise<FoundryUuidDocument | null> {
  for (const spec of PACKS) {
    const pack = game.packs.get(spec.packId);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: [spec.flagPath] });
    const entry = [...index.values()].find((candidate) => {
      const flag = spec.readFlag(candidate.flags);
      return flag?.sourceUuid === sourceUuid && flag.targetLanguage === language;
    });
    if (!entry) continue;
    return (await pack.getDocument(entry._id) as unknown as FoundryUuidDocument | undefined) ?? null;
  }
  return null;
}

function renderDocument(document: FoundryUuidDocument, pageId?: string | null): void {
  const renderable = document as FoundryUuidDocument & {
    sheet?: {
      render(
        force?: boolean | Record<string, unknown>,
        options?: Record<string, unknown>,
      ): unknown;
    };
  };
  renderable.sheet?.render(true, pageId ? { pageId } : undefined);
}

async function openOriginal(uuid: string): Promise<void> {
  const original = await fromUuid(uuid);
  if (original) renderDocument(original);
}

/** Opens a stored translation when available and returns whether it did so. */
export async function openTranslatedReference(uuid: string): Promise<boolean> {
  const sourceUuid = cleanUuid(uuid);
  if (!isTranslatableDocumentReference(sourceUuid)) return false;
  const rootUuid = rootDocumentReferenceUuid(sourceUuid);
  if (!rootUuid) return false;

  const translatedRoot = await storedTranslation(rootUuid, targetLanguage());
  if (!translatedRoot?.uuid) return false;
  const targetUuid = translatedEmbeddedUuid(sourceUuid, translatedRoot.uuid);
  const translatedTarget = targetUuid ? await fromUuid(targetUuid) : null;
  if (translatedTarget) {
    renderDocument(translatedTarget);
    return true;
  }

  // A number of Ember links point at removed page IDs. The translated root is
  // still more useful than a broken link, so open it as a safe fallback.
  const suffix = sourceUuid.slice(rootUuid.length).split(".");
  const pageId = suffix[1] === "JournalEntryPage" ? suffix[2] : null;
  renderDocument(translatedRoot, pageId);
  return true;
}

function linkedUuid(event: MouseEvent): string | null {
  if (!(event.target instanceof Element)) return null;
  return event.target.closest<HTMLElement>("[data-uuid]")?.dataset.uuid?.trim() ?? null;
}

function onDocumentClick(event: MouseEvent): void {
  if (!autoOpenEnabled() || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  const uuid = linkedUuid(event);
  if (!uuid || !isTranslatableDocumentReference(uuid)) return;

  // Foundry's core content-link listener would otherwise open the source while
  // the compendium index lookup is in flight.
  event.preventDefault();
  event.stopImmediatePropagation();
  void openTranslatedReference(uuid).then((opened) => {
    if (!opened) return openOriginal(uuid);
    return undefined;
  }).catch((error) => {
    logger.warn("Translated document link could not be opened; falling back to its source.", {
      uuid,
      error,
    });
    return openOriginal(uuid);
  });
}

export function registerTranslatedLinkNavigation(): void {
  document.addEventListener("click", onDocumentClick, true);
}
