import { MODULE_ID } from "../constants";
import { readActorTranslationFlag } from "./actor";
import { readItemTranslationFlag } from "./item";
import { readJournalTranslationFlag } from "./journal";

export const TRANSLATION_IDENTITIES = [
  { type: "JournalEntry", pack: "world.foundry-translate-translations", flag: "translation", read: readJournalTranslationFlag },
  { type: "Actor", pack: "world.foundry-translate-actors", flag: "actorTranslation", read: readActorTranslationFlag },
  { type: "Item", pack: "world.foundry-translate-items", flag: "itemTranslation", read: readItemTranslationFlag },
] as const;

export interface DocumentReference {
  root: string;
  type: string;
  suffix: string;
  anchor: string;
}

/** Parse identity, never infer it from a translated name or a partial prefix. */
export function parseDocumentReference(uuid: string): DocumentReference | null {
  const anchorAt = uuid.indexOf("#");
  const bare = anchorAt < 0 ? uuid : uuid.slice(0, anchorAt);
  const parts = bare.split(".");
  const rootLength = parts[0] === "Compendium" ? 5 : 2;
  const type = parts[rootLength - 2];
  if (!type || !TRANSLATION_IDENTITIES.some(spec => spec.type === type)
    || parts.length < rootLength || parts.some(part => !/^[A-Za-z0-9_-]+$/u.test(part))
    || (parts.length - rootLength) % 2 !== 0) return null;
  const root = parts.slice(0, rootLength).join(".");
  return { root, type, suffix: bare.slice(root.length), anchor: anchorAt < 0 ? "" : uuid.slice(anchorAt) };
}

export function translationIdentity(document: Pick<FoundryUuidDocument, "flags">, type: string) {
  return TRANSLATION_IDENTITIES.find(spec => spec.type === type)?.read(document.flags) ?? null;
}

/** Deterministic reverse mapping. The caller must still resolve/validate the target. */
export function sourceReferenceUuid(uuid: string, root: Pick<FoundryUuidDocument, "uuid" | "flags">): string | null {
  const ref = parseDocumentReference(uuid);
  if (!ref || ref.root !== root.uuid) return null;
  const flag = translationIdentity(root, ref.type);
  if (!flag) return null;
  const source = parseDocumentReference(flag.sourceUuid);
  if (!source || source.type !== ref.type || source.suffix || source.anchor || source.root === ref.root) return null;
  return `${source.root}${ref.suffix}${ref.anchor}`;
}

export interface TranslationReferencePair {
  sourceUuid: string;
  translatedUuid: string | null;
  status: "mapped" | "source-only" | "ambiguous" | "missing" | "invalid";
}

/** Resolving the original must not depend on a healthy translation index. */
export async function resolveSourceReference(uuid: string): Promise<string | null> {
  const ref = parseDocumentReference(uuid);
  if (!ref) return null;
  const root = await fromUuid(ref.root);
  if (!root || root.uuid !== ref.root) return null;
  const identity = translationIdentity(root, ref.type);
  if (!identity && TRANSLATION_IDENTITIES.some(spec => ref.root.startsWith(`Compendium.${spec.pack}.`))) return null;
  const sourceUuid = identity ? sourceReferenceUuid(uuid, root) : uuid;
  if (!sourceUuid) return null;
  const source = parseDocumentReference(sourceUuid)!;
  const sourceRoot = identity ? await fromUuid(source.root) : root;
  if (!sourceRoot || sourceRoot.uuid !== source.root || translationIdentity(sourceRoot, ref.type)) return null;
  const target = source.suffix ? await fromUuid(`${source.root}${source.suffix}`) : sourceRoot;
  return target?.uuid === `${source.root}${source.suffix}` ? sourceUuid : null;
}

/** Read-only, bidirectional and fresh on every call. Duplicate/cyclic mappings fail closed. */
export async function resolveTranslationReference(uuid: string, language: string): Promise<TranslationReferencePair> {
  const fail = (status: TranslationReferencePair["status"], sourceUuid = uuid): TranslationReferencePair =>
    ({ sourceUuid, translatedUuid: null, status });
  const ref = parseDocumentReference(uuid);
  if (!ref) return fail("invalid");
  const root = await fromUuid(ref.root);
  if (!root || root.uuid !== ref.root) return fail("missing");
  const identity = translationIdentity(root, ref.type);
  if (!identity && TRANSLATION_IDENTITIES.some(spec => ref.root.startsWith(`Compendium.${spec.pack}.`))) return fail("invalid");
  const sourceUuid = identity ? sourceReferenceUuid(uuid, root) : uuid;
  if (!sourceUuid) return fail("invalid");
  const sourceRef = parseDocumentReference(sourceUuid)!;
  const sourceRoot = identity ? await fromUuid(sourceRef.root) : root;
  if (!sourceRoot || sourceRoot.uuid !== sourceRef.root) return fail("missing", sourceUuid);
  if (translationIdentity(sourceRoot, ref.type)) return fail("invalid", sourceUuid);
  const sourceTarget = sourceRef.suffix ? await fromUuid(`${sourceRef.root}${sourceRef.suffix}`) : sourceRoot;
  if (!sourceTarget || sourceTarget.uuid !== `${sourceRef.root}${sourceRef.suffix}`) return fail("missing", sourceUuid);

  const spec = TRANSLATION_IDENTITIES.find(candidate => candidate.type === ref.type)!;
  const pack = game.packs.get(spec.pack);
  if (!pack) return fail("source-only", sourceUuid);
  const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}.${spec.flag}`] });
  const matches = [...index.values()].filter(entry => {
    const flag = spec.read(entry.flags);
    return flag?.sourceUuid === sourceRef.root && flag.targetLanguage === language;
  });
  if (matches.length > 1) return fail("ambiguous", sourceUuid);
  if (!matches.length) return fail("source-only", sourceUuid);
  const targetRoot = await pack.getDocument(matches[0]!._id);
  const expectedRoot = `Compendium.${spec.pack}.${spec.type}.${matches[0]!._id}`;
  const flag = targetRoot && spec.read(targetRoot.flags);
  if (targetRoot?.uuid !== expectedRoot || flag?.sourceUuid !== sourceRef.root || flag.targetLanguage !== language) {
    return fail("invalid", sourceUuid);
  }
  const targetUuid = `${expectedRoot}${sourceRef.suffix}`;
  const target = sourceRef.suffix ? await fromUuid(targetUuid) : targetRoot;
  if (!target || target.uuid !== targetUuid) return fail("missing", sourceUuid);
  return { sourceUuid, translatedUuid: `${targetUuid}${sourceRef.anchor}`, status: "mapped" };
}
