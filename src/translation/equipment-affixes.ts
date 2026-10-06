import { affixActionDisplayFields, affixActionSourceHash, type NativeAffixDocument } from "./affix-action-display";
import { DISPLAY_TEXT_PACK, displayFields, displaySourceHash, readDisplayTextFlag, type DisplayDocument } from "./display-text";
import { assertCreationItem, creationRuntimeGuard, creationSourceGuard, MAX_CREATION_ITEMS,
  type CreationItemDocument, type CreationSourceCheck } from "./ember-creation-items";

export type EquipmentAffixDocument = DisplayDocument & NativeAffixDocument & { parent: CreationItemDocument };
export interface EquipmentAffixesPlan {
  sources: readonly EquipmentAffixDocument[];
  missing: readonly EquipmentAffixDocument[];
  /** A single valid legacy name/description claim, subject to final page proofs
   * in the service. Existing base text is preserved when Actions are appended. */
  extendable: readonly EquipmentAffixDocument[];
  existing: number;
}
type EquipmentOwner = CreationItemDocument & {
  effects?: { contents: readonly NativeAffixDocument[] };
  testUserPermission?(user: unknown, level: string): boolean;
};
const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.CreationItems.${key}`);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function readableOwner(owner: EquipmentOwner): void {
  assertCreationItem(owner, "equipment");
  if (owner.testUserPermission?.(game.user, "OBSERVER") !== true) throw new Error(t("InvalidEquipmentSource"));
}
function assertAffix(source: NativeAffixDocument, owner: EquipmentOwner): void {
  readableOwner(owner);
  const data = source?.toObject?.(), embedded = owner.toObject().effects, members = owner.effects?.contents;
  if (!source || source.documentName !== "ActiveEffect" || source.type !== "affix" || source.parent !== owner
    || !source.id || !/^[A-Za-z0-9_-]+$/u.test(source.id) || source.uuid !== `${owner.uuid}.ActiveEffect.${source.id}`
    || source.testUserPermission?.(game.user, "OBSERVER") !== true || !members || !members.includes(source)
    || members.filter(effect => effect.id === source.id).length !== 1
    || !object(data) || data._id !== source.id || data.type !== "affix" || !Array.isArray(embedded)
    || embedded.filter(effect => object(effect) && effect._id === source.id).length !== 1
    || JSON.stringify(embedded.find(effect => object(effect) && effect._id === source.id)) !== JSON.stringify(data)
    || source.flags?.["foundry-translate"]?.displayTranslation !== undefined
    || !affixActionDisplayFields(data, source).length) throw new Error(t("InvalidAffixSource"));
}

/** Read-only, missing-only classification. A malformed or duplicate record still
 * reserves its claimed identity: generation never replaces an existing edit. */
export async function planMissingEquipmentAffixes(ownerItems: readonly CreationItemDocument[], language: string): Promise<EquipmentAffixesPlan> {
  const runtime = creationRuntimeGuard("equipment");
  if (!language.trim() || ownerItems.length > MAX_CREATION_ITEMS) throw new Error(t("InvalidAffixSource"));
  const owners = new Set<string>(), sources = new Map<string, EquipmentAffixDocument>(), checks: CreationSourceCheck[] = [];
  const ownerChecks: (() => void)[] = [];
  for (const candidate of ownerItems) {
    const owner = candidate as EquipmentOwner; readableOwner(owner);
    if (owners.has(owner.uuid)) throw new Error(t("AmbiguousSource"));
    owners.add(owner.uuid);
    const proof = JSON.stringify(owner.toObject()), members = [...owner.effects?.contents ?? []], uuid = owner.uuid, type = owner.type,
      prepared = JSON.stringify([owner.system?.price, owner.system?.category]);
    const stored = owner.toObject().effects;
    if ((stored !== undefined && !Array.isArray(stored)) || (Array.isArray(stored) && stored.length !== members.length)
      || new Set(members.map(effect => effect.id)).size !== members.length) throw new Error(t("InvalidAffixSource"));
    const current = () => {
      readableOwner(owner);
      if (owner.uuid !== uuid || owner.type !== type || JSON.stringify(owner.toObject()) !== proof
        || JSON.stringify([owner.system?.price, owner.system?.category]) !== prepared || (owner.effects?.contents.length ?? 0) !== members.length
        || members.some((effect, index) => owner.effects?.contents[index] !== effect)) throw new Error(t("SourceChanged"));
    };
    ownerChecks.push(current);
    for (const effect of members) {
      if (effect.type !== "affix" || !affixActionDisplayFields(effect.toObject(), effect).length) continue;
      assertAffix(effect, owner);
      if (sources.has(effect.uuid)) throw new Error(t("AmbiguousSource"));
      if (sources.size >= MAX_CREATION_ITEMS) throw new Error(t("AffixTooMany").replace("{limit}", String(MAX_CREATION_ITEMS)));
      const check = await equipmentAffixSourceGuard(effect as EquipmentAffixDocument, owner); runtime(); current();
      checks.push(check); sources.set(effect.uuid, effect as EquipmentAffixDocument);
    }
  }
  const pack = game.packs.get(DISPLAY_TEXT_PACK), index = await pack?.getIndex({ fields: ["flags.foundry-translate.displayTranslation"] });
  runtime(); for (const current of ownerChecks) current(); for (const check of checks) check.assertCurrent();
  if (game.packs.get(DISPLAY_TEXT_PACK) !== pack) throw new Error(t("SourceChanged"));
  const reserved = new Set<string>(), claims = new Map<string, { flags?: Record<string, Record<string, unknown>> }[]>();
  for (const row of index?.values() ?? []) {
    const claim = row.flags?.["foundry-translate"]?.displayTranslation as Record<string, unknown> | undefined;
    if (claim && typeof claim.sourceUuid === "string" && claim.targetLanguage === language) {
      reserved.add(claim.sourceUuid); claims.set(claim.sourceUuid, [...claims.get(claim.sourceUuid) ?? [], row]);
    }
  }
  const ordered = [...sources.values()].sort((a, b) => a.uuid.localeCompare(b.uuid, "en"));
  const missing = ordered.filter(source => !reserved.has(source.uuid));
  const extendable: EquipmentAffixDocument[] = [], indexProof = JSON.stringify([...(index?.values() ?? [])]);
  for (const source of ordered) {
    const records = claims.get(source.uuid);
    if (records?.length !== 1) continue;
    if ((records[0]!.flags?.["foundry-translate"]?.displayTranslation as { partial?: unknown } | undefined)?.partial) continue;
    const flag = readDisplayTextFlag(records[0]!.flags);
    if (!flag || flag.documentType !== "ActiveEffect" || flag.affixSourceHash !== undefined || flag.fallbackTextSegments !== 0) continue;
    const data = source.toObject(), legacy = { name: data.name, description: data.description }, fields = displayFields("ActiveEffect", legacy);
    if (flag.fields.length !== fields.length || fields.some(field => !flag.fields.some(previous => previous.format === field.format
      && previous.source === field.source && JSON.stringify(previous.path) === JSON.stringify(field.path)))) continue;
    const legacyHash = await displaySourceHash("ActiveEffect", legacy);
    runtime(); for (const current of ownerChecks) current(); for (const check of checks) check.assertCurrent();
    if (game.packs.get(DISPLAY_TEXT_PACK) !== pack || JSON.stringify([...(index?.values() ?? [])]) !== indexProof) throw new Error(t("SourceChanged"));
    if (flag.sourceHash === legacyHash) extendable.push(source);
  }
  return { sources: ordered, missing, extendable, existing: ordered.length - missing.length - extendable.length };
}

/** Full owner and embedded Affix proofs survive every await. assertCurrent is
 * also available for the synchronous final create boundary in the repository. */
export async function equipmentAffixSourceGuard(source: DisplayDocument,
  ownerItem: CreationItemDocument = source.parent as CreationItemDocument): Promise<CreationSourceCheck> {
  const owner = ownerItem as EquipmentOwner, affix = source as EquipmentAffixDocument;
  const runtime = creationRuntimeGuard("equipment"); assertAffix(affix, owner);
  const proof = JSON.stringify(affix.toObject()), uuid = affix.uuid;
  const ownerCheck = await creationSourceGuard(owner, "equipment"); runtime(); assertAffix(affix, owner);
  if (JSON.stringify(affix.toObject()) !== proof) throw new Error(t("SourceChanged"));
  const hash = await affixActionSourceHash(affix.toObject());
  let canonical: NativeAffixDocument = affix;
  const assertCurrent = () => {
    runtime(); ownerCheck.assertCurrent(); assertAffix(affix, owner); assertAffix(canonical, owner);
    if (affix.uuid !== uuid || canonical.uuid !== uuid || JSON.stringify(affix.toObject()) !== proof
      || JSON.stringify(canonical.toObject()) !== proof) throw new Error(t("SourceChanged"));
  };
  const check = Object.assign(async () => {
    assertCurrent(); await ownerCheck(); assertCurrent();
    const resolved = await fromUuid(uuid) as NativeAffixDocument | null;
    assertCurrent();
    if (!resolved) throw new Error(t("SourceChanged"));
    assertAffix(resolved, owner);
    if (resolved.uuid !== uuid || JSON.stringify(resolved.toObject()) !== proof
      || await affixActionSourceHash(resolved.toObject()) !== hash) throw new Error(t("SourceChanged"));
    assertCurrent(); assertAffix(resolved, owner);
    if (JSON.stringify(resolved.toObject()) !== proof) throw new Error(t("SourceChanged"));
    canonical = resolved;
  }, { assertCurrent });
  await check(); return check;
}
