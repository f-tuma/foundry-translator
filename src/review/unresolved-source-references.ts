import { sha256 } from "../translation/hash";
import { planReviewText } from "./text-plan";
import { parseDocumentReference, translationIdentity, TRANSLATION_IDENTITIES } from "../translation/document-identity";
import { batchCatalogHash, batchScope, batchSource, batchObject } from "../polish/correction-batch";
import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import { reviewCatalog, readReviewHistory, type ReviewSnapshot } from "./service";
import type { ReferenceRebuildPlan } from "./reference-rebuild";

export interface UnresolvedSourceMapping {
  sourceTarget: string; mappedTarget: string; retainedTarget: string;
  policy: "retain-exact-unresolved-original";
  sourceParentHash: string; mappedParentHash: string;
  evidence: { sourceExactAbsent: true; mappedExactAbsent: true; sourceSerializedChildAbsent: true;
    mappedSerializedChildAbsent: true; sourceEmbeddedAbsent: true; mappedEmbeddedAbsent: true };
}
export interface UnresolvedSourceRetention {
  version: 1; requested: true; scope: string; catalogHash: string; fullSourceHash: string; glossaryHash: string;
  mappings: UnresolvedSourceMapping[];
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fail = (): never => { throw new Error("Review.UnresolvedSourceRetentionDenied"); };
type Observed = FoundryUuidDocument & { toObject: () => Record<string, unknown>; getEmbeddedDocument: (kind: string, id: string) => unknown };
function childReference(uuid: string) {
  const ref = parseDocumentReference(uuid), child = ref && /^\.(Item|JournalEntryPage)\.([A-Za-z0-9_-]+)$/u.exec(ref.suffix);
  if (!ref || !child || !((ref.type === "Actor" && child[1] === "Item") || (ref.type === "JournalEntry" && child[1] === "JournalEntryPage"))) return fail();
  return { ...ref, kind: child[1]!, id: child[2]!, exact: ref.root + ref.suffix, collection: child[1] === "Item" ? "items" : "pages" };
}
async function absentChild(uuid: string, sourceRoot: string, original: boolean, language: string) {
  const ref = childReference(uuid);
  let parent: Observed | null, exact: FoundryUuidDocument | null, embedded: unknown;
  try { parent = await fromUuid(ref.root) as Observed | null; } catch { return fail(); }
  if (!parent || parent.uuid !== ref.root || parent.documentName !== ref.type ||
    typeof parent.toObject !== "function" || typeof parent.getEmbeddedDocument !== "function") return fail();
  if (original && TRANSLATION_IDENTITIES.some(spec => ref.root.startsWith(`Compendium.${spec.pack}.`))) return fail();
  const identity = translationIdentity(parent, ref.type);
  if (original ? !!identity : !identity || identity.sourceUuid !== sourceRoot || identity.targetLanguage !== language) return fail();
  const identityStamp = JSON.stringify(identity);
  let data: Record<string, unknown>, stamp: string;
  try { data = parent.toObject(); stamp = batchObject(data); } catch { return fail(); }
  if (!data || typeof data !== "object" || Array.isArray(data) || stamp.length > 2000000) return fail();
  const collection = data[ref.collection];
  if (!Array.isArray(collection) || collection.some(child => !child || typeof child !== "object" || (typeof child._id !== "string" && typeof child.id !== "string") || (!child._id && !child.id)) ||
    collection.some(child => child._id === ref.id || child.id === ref.id)) return fail();
  try { embedded = await parent.getEmbeddedDocument(ref.kind, ref.id); exact = await fromUuid(ref.exact); } catch { return fail(); }
  // A mismatched or inaccessible object is not an absent target. Only nullish
  // lookup results plus both independent child-absence cues qualify.
  if (embedded != null || exact != null) return fail();
  const check = () => {
    if (parent!.uuid !== ref.root || parent!.documentName !== ref.type || batchObject(parent!.toObject()) !== stamp ||
      typeof parent!.getEmbeddedDocument !== "function" || JSON.stringify(translationIdentity(parent!, ref.type)) !== identityStamp) fail();
  };
  check();
  const binding = original ? stamp : JSON.stringify([ref.root, ref.type, identity!.sourceUuid, identity!.targetLanguage,
    collection.map(child => child._id ?? child.id).sort()]);
  return { hash: await sha256(binding), check };
}
async function observe(snapshot: ReviewSnapshot, pairs: { sourceTarget: string; mappedTarget: string }[]) {
  const source = await batchSource(snapshot), scope = batchScope(), checks: (() => void)[] = [];
  const mappings: UnresolvedSourceMapping[] = [];
  for (const pair of pairs) {
    const original = childReference(pair.sourceTarget), mapped = childReference(pair.mappedTarget);
    if (original.kind !== mapped.kind || original.id !== mapped.id || original.anchor !== mapped.anchor) return fail();
    if (original.root !== mapped.root && snapshot.reverse.get(mapped.root) !== original.root) return fail();
    const a = await absentChild(pair.sourceTarget, original.root, true, snapshot.entry.language);
    const b = original.root === mapped.root ? await absentChild(pair.mappedTarget, original.root, true, snapshot.entry.language)
      : await absentChild(pair.mappedTarget, original.root, false, snapshot.entry.language);
    checks.push(a.check, b.check);
    mappings.push({ ...pair, retainedTarget: pair.sourceTarget, policy: "retain-exact-unresolved-original",
      sourceParentHash: a.hash, mappedParentHash: b.hash,
      evidence: { sourceExactAbsent: true, mappedExactAbsent: true, sourceSerializedChildAbsent: true,
        mappedSerializedChildAbsent: true, sourceEmbeddedAbsent: true, mappedEmbeddedAbsent: true } });
  }
  const catalog = await reviewCatalog(snapshot.entry.language), catalogHash = await batchCatalogHash(catalog);
  const glossaryHash = await sha256(JSON.stringify(await new GlossaryCompendiumRepository().loadExisting()));
  const proof: UnresolvedSourceRetention = { version: 1, requested: true, scope, catalogHash, fullSourceHash: source.fullSourceHash, glossaryHash, mappings };
  const assertUnchanged = () => {
    if (batchScope() !== scope || batchObject(source.doc.toObject!()) !== source.proof) fail();
    checks.forEach(check => check());
  };
  assertUnchanged();
  return { proof, assertUnchanged };
}
/** Called only with freshly built strict plan targets, never caller IDs/probes. */
export async function prepareUnresolvedSourceRetention(snapshot: ReviewSnapshot, targets: ReferenceRebuildPlan["targets"]) {
  const pairs: { sourceTarget: string; mappedTarget: string }[] = [];
  for (const target of targets) {
    if (target.required === false) continue; // Existing source-gated policy.
    const uuid = target.target.split("#")[0]!;
    let document: FoundryUuidDocument | null;
    try { document = await fromUuid(uuid); } catch { return fail(); }
    if (document != null) {
      const ref = parseDocumentReference(uuid), kind = ref?.suffix ? /\.(Item|JournalEntryPage)\.[^.]+$/u.exec(ref.suffix)?.[1] : ref?.type;
      if (document.uuid !== uuid || document.documentName !== kind) return fail();
      continue;
    }
    childReference(target.sourceTarget); // Bare missing roots remain held.
    pairs.push({ sourceTarget: target.sourceTarget, mappedTarget: target.target });
  }
  const first = await observe(snapshot, pairs), second = await observe(snapshot, pairs);
  if (!equal(first.proof, second.proof)) return fail();
  first.assertUnchanged(); second.assertUnchanged();
  return second.proof;
}
export async function bindUnresolvedSourceRetention(snapshot: ReviewSnapshot, proof: UnresolvedSourceRetention) {
  if (proof.version !== 1 || proof.requested !== true || !Array.isArray(proof.mappings) || proof.mappings.length > 50 ||
    new Set(proof.mappings.map(m => JSON.stringify([m.sourceTarget, m.mappedTarget]))).size !== proof.mappings.length) return fail();
  let observed = await observe(snapshot, proof.mappings);
  if (!equal(observed.proof, proof)) return fail();
  return { recheck: async () => {
    const next = await observe(snapshot, proof.mappings);
    if (!equal(next.proof, proof)) return fail();
    observed.assertUnchanged(); next.assertUnchanged(); observed = next;
  }, assertUnchanged: () => observed.assertUnchanged() };
}
/** Warning identity survives ordinary prose/label corrections. No historical
 * absence observation is relabeled as a fresh availability or deletion claim.
 */
export async function unresolvedSourceWarnings(snapshot: ReviewSnapshot, fieldId: string) {
  const field = snapshot.fields.find(f => f.id === fieldId); if (!field) return [];
  // Match the native decoded text units used to derive retention identities.
  // HTML serialization may entity-escape an anchor; raw markup is not identity.
  const tokens = new Set(planReviewText(field.translation, field.format).units.flatMap(unit =>
    unit.parts.flatMap(part => [...part.matchAll(/@(?:UUID|Embed)\[[^\S\r\n]*([^\]\s]+)/giu)].map(match => match[1]!))));
  const doc = await game.packs.get(snapshot.entry.pack)!.getDocument(snapshot.entry.id);
  const fieldSourceHash = await sha256(JSON.stringify(field.source)), seen = new Set<string>();
  const warnings = [] as { sourceTarget: string; retainedTarget: string; status: "retained-original-unresolved"; observedAt: string; availability: "not-refreshed"; humanVerified: false }[];
  for (const operation of readReviewHistory(doc?.flags)) {
    const receipt = operation.referenceRebuild, proof = receipt?.unresolvedSourceRetention;
    if (operation.undoneAt || !receipt || !proof || receipt.fieldId !== fieldId || receipt.sourceHash !== snapshot.sourceHash || receipt.fieldSourceHash !== fieldSourceHash) continue;
    for (const mapping of proof.mappings) {
      if (mapping.policy !== "retain-exact-unresolved-original" || mapping.retainedTarget !== mapping.sourceTarget || seen.has(mapping.sourceTarget)) continue;
      if (!tokens.has(mapping.retainedTarget)) continue;
      seen.add(mapping.sourceTarget);
      warnings.push({ sourceTarget: mapping.sourceTarget, retainedTarget: mapping.retainedTarget, status: "retained-original-unresolved", observedAt: operation.at, availability: "not-refreshed", humanVerified: false });
    }
  }
  return warnings;
}
