import { getTranslatorSettings } from "../settings/settings";
import { translationIdentity } from "./document-identity";
import { ITEM_TRANSLATIONS_PACK_ID, ITEM_TRANSLATION_FLAG_PATH } from "./compendium-item-translation-repository";
import { itemSourceHash, type ItemData } from "./item";

export const EMBER_CREATION_PACK = "ember.crucible-character";
export const MAX_CREATION_ITEMS = 256;
export type CreationItemDocument = FoundryItemWorldDocument & {
  visible?: boolean; folder?: { id?: string }; system?: FoundryRuntimeSystem & Record<string, any>;
};
const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.CreationItems.${key}`);

/** Only originals from the observed Ember Crucible option pack are supported. */
export function assertCreationItem(document: CreationItemDocument): void {
  if (!document || document.documentName !== "Item" || document.parent || document.visible !== true
    || !/^Compendium\.ember\.crucible-character\.Item\.[A-Za-z0-9_-]+$/u.test(document.uuid)
    || !["ancestry", "background", "talent"].includes(document.type) || !document.toObject
    || document.flags?.["foundry-translate"]?.itemTranslation !== undefined) throw new Error(t("InvalidSource"));
}

export function creationRuntimeGuard(): () => void {
  const user = game.user, world = (game as any).world, system = game.system;
  const ember = game.modules.get("ember"), pack = game.packs.get(EMBER_CREATION_PACK);
  const settings = JSON.stringify(getTranslatorSettings()), systemVersion = (system as any)?.version, emberVersion = (ember as any)?.version;
  const check = () => {
    if (!user?.isGM || game.user !== user || !game.user?.isGM || (game as any).world !== world
      || game.system !== system || game.system?.id !== "crucible" || (game.system as any)?.version !== systemVersion
      || !ember?.active || game.modules.get("ember") !== ember || !game.modules.get("ember")?.active
      || (ember as any).version !== emberVersion || !pack || game.packs.get(EMBER_CREATION_PACK) !== pack
      || JSON.stringify(getTranslatorSettings()) !== settings) throw new Error(t("RuntimeChanged"));
  };
  check(); return check;
}

export interface CreationItemsPlan {
  sources: readonly CreationItemDocument[];
  missing: readonly CreationItemDocument[];
  existing: number;
}

/** Read-only classification. Even malformed flags reserve an existing identity. */
export async function planMissingCreationItems(sourceDocuments: readonly CreationItemDocument[], language: string): Promise<CreationItemsPlan> {
  const sources = new Map<string, CreationItemDocument>();
  for (const source of sourceDocuments) { assertCreationItem(source); sources.set(source.uuid, source); }
  if (sources.size > MAX_CREATION_ITEMS) throw new Error(t("TooMany").replace("{limit}", String(MAX_CREATION_ITEMS)));
  const ordered = [...sources.values()].sort((a, b) => a.uuid.localeCompare(b.uuid, "en"));
  const index = await game.packs.get(ITEM_TRANSLATIONS_PACK_ID)?.getIndex({ fields: [ITEM_TRANSLATION_FLAG_PATH] });
  const reserved = new Set<string>();
  for (const entry of index?.values() ?? []) {
    const flag = entry.flags?.["foundry-translate"]?.itemTranslation as Record<string, unknown> | undefined;
    if (flag && typeof flag.sourceUuid === "string" && flag.targetLanguage === language) reserved.add(flag.sourceUuid);
  }
  const missing = ordered.filter(source => !reserved.has(source.uuid));
  return { sources: ordered, missing, existing: ordered.length - missing.length };
}

export async function creationSourceGuard(source: CreationItemDocument): Promise<() => Promise<void>> {
  assertCreationItem(source);
  const data = source.toObject(), uuid = source.uuid, proof = JSON.stringify(data), hash = await itemSourceHash(data as ItemData);
  const check = async () => {
    assertCreationItem(source);
    const current = source.toObject();
    if (source.uuid !== uuid || await fromUuid(uuid) !== source || JSON.stringify(current) !== proof
      || await itemSourceHash(current as ItemData) !== hash) throw new Error(t("SourceChanged"));
    assertCreationItem(source);
    if (JSON.stringify(source.toObject()) !== proof) throw new Error(t("SourceChanged"));
  };
  await check(); return check;
}

/** Mirror only the inspected native option selectors, then one level of
 * explicit talent slots. No prose links, foreign packs or dependency recursion. */
export async function collectEmberCreationItems(): Promise<CreationItemDocument[]> {
  const check = creationRuntimeGuard();
  const pack = game.packs.get(EMBER_CREATION_PACK) as FoundryCompendiumCollection & { getDocuments(): Promise<CreationItemDocument[]> };
  const documents = await pack.getDocuments(); check();
  const originals = documents.filter(document => document.visible === true && !translationIdentity(document, "Item"));
  const sourceProofs = new Map(originals.map(document => [document, JSON.stringify(document.toObject())]));
  const byUuid = new Map(originals.map(document => [document.uuid, document]));
  const byIdentifier = new Map<string, CreationItemDocument[]>();
  for (const document of originals) {
    const id = document.system?.identifier;
    if (typeof id === "string" && id.trim()) byIdentifier.set(id, [...byIdentifier.get(id) ?? [], document]);
  }
  const selected = new Map<string, CreationItemDocument>();
  const add = (document: CreationItemDocument) => { assertCreationItem(document); selected.set(document.uuid, document); };
  const journalProofs: (() => boolean)[] = [];
  for (const [journalId, pageType, itemType] of [["emberAncestries0", "ember.ancestry", "ancestry"], ["emberCultures000", "ember.culture", "background"]]) {
    const journal = (game.journal as any)?.get(journalId);
    if (!journal || journal.visible !== true || journal.uuid !== `JournalEntry.${journalId}`
      || translationIdentity(journal, "JournalEntry")) continue;
    const proof = JSON.stringify(journal.toObject());
    journalProofs.push(() => journal.visible === true && (game.journal as any)?.get(journalId) === journal && JSON.stringify(journal.toObject()) === proof);
    for (const page of journal.pages?.contents ?? []) {
      if (page.type !== pageType || page.visible !== true || typeof page.system?.identifier !== "string" || !page.system.identifier.trim()) continue;
      // Culture playability and identity use these exact selectors natively.
      if (itemType === "background" && !page.system.item) continue;
      const matches = byIdentifier.get(page.system.identifier) ?? [];
      if (matches.length > 1) throw new Error(t("AmbiguousSource"));
      if (matches[0] && matches[0].type === itemType) add(matches[0]);
      // Aster/Soulbound may be explicit talents. Never swap foreign pack IDs.
      const explicit = byUuid.get(page.system.item);
      if (explicit?.type === "talent") add(explicit);
    }
  }
  for (const document of originals) if (document.type === "background" && document.folder?.id === "emberPaths000000") add(document);
  for (const document of [...selected.values()]) {
    for (const slot of Array.isArray(document.system?.talents) ? document.system.talents : []) {
      const talent = byUuid.get(slot?.item);
      if (talent?.type === "talent") add(talent);
    }
  }
  if (selected.size > MAX_CREATION_ITEMS) throw new Error(t("TooMany").replace("{limit}", String(MAX_CREATION_ITEMS)));
  for (const document of selected.values()) {
    if (await fromUuid(document.uuid) !== document || JSON.stringify(document.toObject()) !== sourceProofs.get(document)) throw new Error(t("InvalidSource"));
    check();
  }
  if (!journalProofs.every(valid => valid())) throw new Error(t("SourceChanged"));
  return [...selected.values()].sort((a, b) => a.uuid.localeCompare(b.uuid, "en"));
}
