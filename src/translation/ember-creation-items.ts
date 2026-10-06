import { getTranslatorSettings } from "../settings/settings";
import { translationIdentity } from "./document-identity";
import { ITEM_TRANSLATIONS_PACK_ID, ITEM_TRANSLATION_FLAG_PATH } from "./compendium-item-translation-repository";
import { itemSourceHash, type ItemData } from "./item";

export const EMBER_CREATION_PACK = "ember.crucible-character";
export const MAX_CREATION_ITEMS = 256;
export const CRUCIBLE_EQUIPMENT_PACK = "crucible.equipment";
export type CreationItemsScope = "creation" | "equipment";
function assertScope(scope: CreationItemsScope): void {
  if (scope !== "creation" && scope !== "equipment") throw new Error(t("InvalidScope"));
}
function equipmentRuntime(): { packs: Set<string>; budget: number } {
  const system = (globalThis as any).crucible;
  const packs = system?.CONFIG?.packs?.equipment, budget = system?.CONST?.ACTOR?.STARTING_EQUIPMENT_BUDGET;
  if (system !== game.system || !(packs instanceof Set) || !packs.has(CRUCIBLE_EQUIPMENT_PACK)
    || typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) throw new Error(t("EquipmentUnavailable"));
  return { packs, budget };
}
function nativeEquipment(document: CreationItemDocument, budget: number): boolean {
  const price = document.system?.price;
  return typeof price === "number" && Number.isFinite(price) && price > 0 && price <= budget
    && !(document.type === "consumable" && document.system?.category === "scroll");
}
export type CreationItemDocument = FoundryItemWorldDocument & {
  visible?: boolean; folder?: { id?: string }; system?: FoundryRuntimeSystem & Record<string, any>;
};
const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.CreationItems.${key}`);

/** Only originals from the explicitly selected native creation pack are supported. */
export function assertCreationItem(document: CreationItemDocument, scope: CreationItemsScope = "creation"): void {
  assertScope(scope);
  if (!document || document.documentName !== "Item" || document.parent || document.visible !== true
    || !(scope === "equipment" ? /^Compendium\.crucible\.equipment\.Item\.[A-Za-z0-9_-]+$/u.test(document.uuid)
      && nativeEquipment(document, equipmentRuntime().budget)
      : scope === "creation" && /^Compendium\.ember\.crucible-character\.Item\.[A-Za-z0-9_-]+$/u.test(document.uuid)
        && ["ancestry", "background", "talent"].includes(document.type)) || !document.toObject
    || document.flags?.["foundry-translate"]?.itemTranslation !== undefined) throw new Error(t(scope === "equipment" ? "InvalidEquipmentSource" : "InvalidSource"));
}

export function creationRuntimeGuard(scope: CreationItemsScope = "creation"): () => void {
  assertScope(scope);
  const user = game.user, world = (game as any).world, system = game.system;
  const packId = scope === "equipment" ? CRUCIBLE_EQUIPMENT_PACK : EMBER_CREATION_PACK;
  const ember = game.modules.get("ember"), pack = game.packs.get(packId);
  const equipment = scope === "equipment" ? equipmentRuntime() : null;
  const equipmentPacks = equipment ? JSON.stringify([...equipment.packs]) : null;
  const settings = JSON.stringify(getTranslatorSettings()), systemVersion = (system as any)?.version, emberVersion = (ember as any)?.version;
  const check = () => {
    if (!user?.isGM || game.user !== user || !game.user?.isGM || (game as any).world !== world
      || game.system !== system || game.system?.id !== "crucible" || (game.system as any)?.version !== systemVersion
      || !ember?.active || game.modules.get("ember") !== ember || !game.modules.get("ember")?.active
      || (ember as any).version !== emberVersion || !pack || game.packs.get(packId) !== pack
      || JSON.stringify(getTranslatorSettings()) !== settings) throw new Error(t("RuntimeChanged"));
    if (equipment) {
      const current = equipmentRuntime();
      if (current.packs !== equipment.packs || current.budget !== equipment.budget
        || JSON.stringify([...current.packs]) !== equipmentPacks) throw new Error(t("RuntimeChanged"));
    }
  };
  check(); return check;
}

export interface CreationItemsPlan {
  sources: readonly CreationItemDocument[];
  missing: readonly CreationItemDocument[];
  existing: number;
}

/** Read-only classification. Even malformed flags reserve an existing identity. */
export async function planMissingCreationItems(sourceDocuments: readonly CreationItemDocument[], language: string, scope: CreationItemsScope = "creation"): Promise<CreationItemsPlan> {
  assertScope(scope);
  const sources = new Map<string, CreationItemDocument>();
  for (const source of sourceDocuments) { assertCreationItem(source, scope); sources.set(source.uuid, source); }
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

export type CreationSourceCheck = (() => Promise<void>) & { assertCurrent(): void };

/** Async resolution/hash proof plus a synchronous check of the original and
 * last resolved canonical Item. The latter closes the final index-read await
 * without introducing another asynchronous gap before createDocuments. */
export async function creationSourceGuard(source: CreationItemDocument, scope: CreationItemsScope = "creation"): Promise<CreationSourceCheck> {
  assertCreationItem(source, scope);
  const equipmentProof = scope === "equipment" ? JSON.stringify([source.system?.price, source.system?.category]) : null;
  const data = source.toObject(), uuid = source.uuid, type = source.type, proof = JSON.stringify(data), hash = await itemSourceHash(data as ItemData);
  let lastCanonical = source;
  const assertDocument = (document: CreationItemDocument) => {
    assertSourceProof(document, uuid, type, proof, "SourceChanged", scope);
    if (equipmentProof !== null && JSON.stringify([document.system?.price, document.system?.category]) !== equipmentProof) {
      throw new Error(t("SourceChanged"));
    }
  };
  const assertCurrent = () => { assertDocument(source); assertDocument(lastCanonical); };
  const check = Object.assign(async () => {
    assertCurrent();
    const canonical = await fromUuid(uuid) as CreationItemDocument;
    assertDocument(canonical);
    if (await itemSourceHash(source.toObject() as ItemData) !== hash
      || await itemSourceHash(canonical.toObject() as ItemData) !== hash) throw new Error(t("SourceChanged"));
    // Pin only a fully resolved and validated object. Recheck both objects
    // after every await even when compendium caches rehydrate the instance.
    assertDocument(source); assertDocument(canonical);
    lastCanonical = canonical;
  }, { assertCurrent });
  await check(); return check;
}

function assertSourceProof(document: CreationItemDocument, uuid: string, type: string, proof: string, error: string, scope: CreationItemsScope = "creation"): void {
  assertCreationItem(document, scope);
  if (document.uuid !== uuid || document.type !== type || JSON.stringify(document.toObject()) !== proof) throw new Error(t(error));
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
  const canonicalSources: CreationItemDocument[] = [];
  const selectedProofs: (() => void)[] = [];
  for (const document of selected.values()) {
    const uuid = document.uuid, type = document.type, proof = sourceProofs.get(document)!;
    assertSourceProof(document, uuid, type, proof, "InvalidSource");
    const canonical = await fromUuid(uuid) as CreationItemDocument;
    // Native getDocuments returns fresh instances even when getDocument (and
    // fromUuid) retains its cached instance. Accept only complete equivalence.
    const validate = () => {
      assertSourceProof(document, uuid, type, proof, "InvalidSource");
      assertSourceProof(canonical, uuid, type, proof, "InvalidSource");
    };
    validate(); selectedProofs.push(validate); canonicalSources.push(canonical);
    check();
  }
  if (!journalProofs.every(valid => valid())) throw new Error(t("SourceChanged"));
  for (const validate of selectedProofs) validate();
  check();
  return canonicalSources.sort((a, b) => a.uuid.localeCompare(b.uuid, "en"));
}

/** Match the inspected native purchase selector, restricted to the base pack.
 * No configured foreign pack, scroll setup, linked document or granted talent. */
export async function collectCrucibleCreationEquipment(): Promise<CreationItemDocument[]> {
  const check = creationRuntimeGuard("equipment"), budget = equipmentRuntime().budget;
  const pack = game.packs.get(CRUCIBLE_EQUIPMENT_PACK) as FoundryCompendiumCollection & { getDocuments(): Promise<CreationItemDocument[]> };
  const documents = await pack.getDocuments(); check();
  const selected = new Map<string, CreationItemDocument>();
  const proofs: (() => void)[] = [];
  const initial = new Map<CreationItemDocument, { uuid: string; type: string; proof: string; prepared: string }>();
  for (const document of documents) {
    if (document.visible !== true || translationIdentity(document, "Item") || !nativeEquipment(document, budget)) continue;
    assertCreationItem(document, "equipment");
    if (selected.has(document.uuid)) throw new Error(t("AmbiguousSource"));
    selected.set(document.uuid, document);
    initial.set(document, { uuid: document.uuid, type: document.type, proof: JSON.stringify(document.toObject()), prepared: JSON.stringify([document.system?.price, document.system?.category]) });
  }
  if (selected.size > MAX_CREATION_ITEMS) throw new Error(t("TooMany").replace("{limit}", String(MAX_CREATION_ITEMS)));
  const sources: CreationItemDocument[] = [];
  for (const document of selected.values()) {
    const { uuid, type, proof, prepared } = initial.get(document)!;
    const canonical = await fromUuid(uuid) as CreationItemDocument;
    const validate = () => {
      assertSourceProof(document, uuid, type, proof, "SourceChanged", "equipment");
      assertSourceProof(canonical, uuid, type, proof, "SourceChanged", "equipment");
      if ([document, canonical].some(value => JSON.stringify([value.system?.price, value.system?.category]) !== prepared)) {
        throw new Error(t("SourceChanged"));
      }
    };
    validate(); proofs.push(validate); sources.push(canonical); check();
  }
  for (const validate of proofs) validate(); check();
  return sources.sort((a, b) => a.uuid.localeCompare(b.uuid, "en"));
}
