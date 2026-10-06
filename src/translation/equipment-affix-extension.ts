import { MODULE_ID } from "../constants";
import { displayFields, displaySourceHash, readDisplayTextFlag, readDisplayTranslation } from "./display-text";
import { affixActionSourceHash, isAffixActionDisplayPath } from "./affix-action-display";
import { translatedOutputHash } from "./output-hash";
import type { JournalData } from "./journal";
import { proseNumbers } from "../polish/quality-guards";

/** Only the exact older name/description record can gain new Action pages.
 * Existing prose, names, permissions, review flags and history are preserved. */
export async function extendEquipmentAffixRecord(source: Record<string, unknown>, sourceUuid: string,
  language: string, existing: JournalData, addition: JournalData): Promise<JournalData> {
  const prior = readDisplayTextFlag(existing.flags), extra = readDisplayTextFlag(addition.flags);
  const fields = displayFields("ActiveEffect", source);
  const base = fields.filter(field => !isAffixActionDisplayPath(field.path)), actions = fields.filter(field => isAffixActionDisplayPath(field.path));
  const legacy = structuredClone(source);
  if (legacy.system && typeof legacy.system === "object") delete (legacy.system as Record<string, unknown>).actions;
  const equalFields = (actual: typeof base, expected: typeof base) => actual.length === expected.length && expected.every(field =>
    actual.some(saved => JSON.stringify([saved.path, saved.format, saved.source]) === JSON.stringify([field.path, field.format, field.source])));
  const invalid = () => { throw new Error("Existing Affix display record cannot be extended safely."); };
  if (!prior || !extra || source.type !== "affix" || !actions.length || prior.affixSourceHash || prior.fallbackTextSegments !== 0 || !extra.affixSourceHash
    || extra.affixSourceHash !== await affixActionSourceHash(source)
    || prior.documentType !== "ActiveEffect" || extra.documentType !== "ActiveEffect"
    || prior.sourceUuid !== sourceUuid || extra.sourceUuid !== sourceUuid || prior.targetLanguage !== language || extra.targetLanguage !== language
    || prior.sourceHash !== await displaySourceHash("ActiveEffect", legacy)
    || extra.sourceHash !== await displaySourceHash("ActiveEffect", source)
    || !equalFields(prior.fields, base) || !equalFields(extra.fields, actions)
    || existing.pages.length !== base.length || addition.pages.length !== actions.length
    || prior.fields.some(field => existing.pages.filter(page => page._id === field.pageId).length !== 1)
    || extra.fields.some(field => addition.pages.filter(page => page._id === field.pageId).length !== 1)
    || addition.pages.some(page => existing.pages.some(old => old._id === page._id))) invalid();
  for (const [data, metadata] of [[existing, prior!], [addition, extra!]] as const) for (const field of metadata.fields) {
    const value = readDisplayTranslation(data, field);
    if (!value?.trim() || JSON.stringify(proseNumbers([field.source])) !== JSON.stringify(proseNumbers([value]))) invalid();
  }
  const result = structuredClone(existing);
  result.pages.push(...structuredClone(addition.pages));
  const flag = readDisplayTextFlag(result.flags)!;
  flag.fields.push(...structuredClone(extra!.fields));
  flag.sourceHash = extra!.sourceHash;
  flag.affixSourceHash = extra!.affixSourceHash!;
  flag.fallbackTextSegments += extra!.fallbackTextSegments;
  // Keep prior generation provenance and editorial receipts; a separate record
  // describes only this append operation, without approving any existing prose.
  result.flags![MODULE_ID]!.affixActionAddition = { version: 1, at: new Date().toISOString(),
    prior: structuredClone(prior), addedPageIds: addition.pages.map(page => page._id),
    providerId: extra!.providerId, providerFingerprint: extra!.providerFingerprint,
    glossaryFingerprint: extra!.glossaryFingerprint };
  flag.outputHash = await translatedOutputHash(result);
  return result;
}
