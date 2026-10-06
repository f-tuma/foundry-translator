import { MODULE_ID } from "../constants";
import { assertPortableText } from "../bundles/format";
import { portableFields, type PortableDocument } from "../bundles/fields";
import { itemSourceHash, readItemTranslationFlag, type ItemData } from "../translation/item";
import { translatedOutputHash } from "../translation/output-hash";
import { sha256 } from "../translation/hash";
import { assertSystemActionFieldIdentity, readPath } from "../translation/system-html-fields";
import { proseNumbers, embedOptionNumbersChanged } from "../polish/quality-guards";
import { planReviewText } from "./text-plan";
import { portableReviewText, type ReviewSnapshot } from "./service";

export interface MachineProofreadingReceipt {
  version: 1; kind: "Item"; operationId: string; at: string; userId: string; reason: string;
  documentId: string; sourceUuid: string; language: string;
  sourceHash: string; fullSourceHash: string; outputHash: string; coverageHash: string;
  rowIds: string[]; metadataHash: string;
}
export interface MachineProofreadingPlan {
  documentId: string; sourceUuid: string; language: string; sourceHash: string;
  fullSourceHash: string; outputHash: string; coverageHash: string; metadataHash: string;
  rowIds: string[]; fields: number; humanVerification: false;
}
function fail(): never { throw new Error("Review.MachineProofreadingInvalid"); }
const hash = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/u.test(s);
export function readMachineProofreading(data: Record<string, unknown>): MachineProofreadingReceipt | null {
  const flags = data.flags as ItemData["flags"];
  const value = flags?.[MODULE_ID]?.machineProofreading as MachineProofreadingReceipt | undefined;
  if (!value || value.version !== 1 || value.kind !== "Item" || typeof value.operationId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/u.test(value.operationId) ||
    typeof value.at !== "string" || !Number.isFinite(Date.parse(value.at)) || typeof value.userId !== "string" || !value.userId ||
    typeof value.reason !== "string" || value.reason.trim().length < 5 || value.reason.length > 3000 || typeof value.documentId !== "string" || typeof value.sourceUuid !== "string" ||
    typeof value.language !== "string" || !value.language || ![value.sourceHash, value.fullSourceHash, value.outputHash, value.coverageHash, value.metadataHash].every(hash) ||
    !Array.isArray(value.rowIds) || !value.rowIds.length || value.rowIds.length > 1000 || !value.rowIds.every(hash) || new Set(value.rowIds).size !== value.rowIds.length) return null;
  return value;
}
export function machineProofreadingSchemaProof(source: PortableDocument): string {
  return JSON.stringify(portableFields(source, source.toObject()));
}
async function evidence(source: PortableDocument, target: ItemData, documentId: string, language: string) {
  if (source.documentName !== "Item") fail();
  const original = source.toObject() as ItemData, flag = readItemTranslationFlag(target.flags);
  if (!flag || flag.sourceUuid !== source.uuid || flag.targetLanguage !== language || original.type !== target.type ||
    (target.flags?.[MODULE_ID]?.itemTranslation as { partial?: boolean } | undefined)?.partial) fail();
  const sourceHash = await itemSourceHash(original);
  if (flag.sourceHash !== sourceHash) fail();
  const descriptors = [], rowIds: string[] = [];
  for (const field of portableFields(source, original)) {
    const before = readPath(original, field.path);
    if (typeof before !== "string" || !before.trim()) continue;
    assertSystemActionFieldIdentity(original, target, field.path, field.path);
    const after = readPath(target, field.path);
    if (typeof after !== "string" || !after.trim()) fail();
    const fieldId = JSON.stringify(field.path), units = planReviewText(before, field.format).units;
    descriptors.push([fieldId, field.format, before, after, units.map(unit => [unit.id, unit.parts])]);
    for (const unit of units) rowIds.push(await sha256(JSON.stringify([source.uuid, language, fieldId, unit.id])));
  }
  if (!descriptors.length || !rowIds.length || new Set(rowIds).size !== rowIds.length || rowIds.length > 1000) fail();
  return { documentId, sourceUuid: source.uuid, language, sourceHash, fullSourceHash: await translatedOutputHash({ source: original }),
    outputHash: await translatedOutputHash(target), coverageHash: await sha256(JSON.stringify(descriptors)),
    metadataHash: await sha256(JSON.stringify(flag)), rowIds, fields: descriptors.length, humanVerification: false as const };
}
/** Mechanical validation is necessary, but never proves semantic translation quality.
 * Callers explicitly attest reading all server-derived rows after proofreading. */
export async function prepareMachineProofreading(snapshot: ReviewSnapshot, source: PortableDocument, target: ItemData): Promise<MachineProofreadingPlan> {
  if (snapshot.entry.kind !== "Item" || snapshot.warning || snapshot.partial || snapshot.rows.some(row => row.blocked) || !snapshot.rows.length) fail();
  const plan = await evidence(source, target, snapshot.entry.uuid, snapshot.entry.language);
  if (plan.sourceUuid !== snapshot.entry.sourceUuid || plan.sourceHash !== snapshot.sourceHash || JSON.stringify(plan.rowIds) !== JSON.stringify(snapshot.rows.map(row => row.id))) fail();
  for (const field of snapshot.fields) {
    assertPortableText(field.source, portableReviewText(snapshot, field, field.translation), field.format);
    const src = planReviewText(field.source, field.format).units, dst = new Map(planReviewText(portableReviewText(snapshot, field, field.translation), field.format).units.map(unit => [unit.id, unit]));
    for (const unit of src) {
      const translated = dst.get(unit.id);
      if (!translated || unit.parts.length !== translated.parts.length) fail();
      // Cross-part numerical swaps cannot satisfy an aggregate multiset.
      for (let i = 0; i < unit.parts.length; i++) if (JSON.stringify(proseNumbers([unit.parts[i]!])) !== JSON.stringify(proseNumbers([translated.parts[i]!])) ||
        embedOptionNumbersChanged([unit.parts[i]!], [translated.parts[i]!])) fail();
    }
  }
  return plan;
}
export function assertMachineProofreadingCoverage(plan: MachineProofreadingPlan, rowIds: readonly string[], coverageHash: string): void {
  if (coverageHash !== plan.coverageHash || rowIds.length !== plan.rowIds.length || new Set(rowIds).size !== rowIds.length ||
    JSON.stringify([...rowIds].sort()) !== JSON.stringify([...plan.rowIds].sort())) fail();
}
/** Display-only recovery: validates the complete current stored source/output and
 * freshly derived schema coverage. Historical fallback counters remain untouched. */
export async function isMachineProofreadingCurrent(source: PortableDocument, target: ItemData, language: string, documentId: string): Promise<boolean> {
  try {
    const receipt = readMachineProofreading(target);
    if (!receipt || receipt.documentId !== documentId) return false;
    const namespace = target.flags?.[MODULE_ID], history = namespace?.reviewHistory as Record<string, unknown> | undefined;
    const operation = history?.[receipt.operationId] as { sourceHash?: unknown; agentRequestHash?: unknown; label?: unknown; rows?: unknown; undoneAt?: unknown; machineProofreading?: { after?: unknown } } | undefined;
    if (!operation || operation.undoneAt || !hash(operation.agentRequestHash) || operation.sourceHash !== receipt.sourceHash || operation.label !== `MCP: ${receipt.reason}` ||
      !Array.isArray(operation.rows) || operation.rows.length || JSON.stringify(operation.machineProofreading?.after) !== JSON.stringify(receipt)) return false;
    const current = await evidence(source, target, documentId, language);
    return ["sourceUuid", "language", "sourceHash", "fullSourceHash", "outputHash", "coverageHash", "metadataHash"].every(key =>
      receipt[key as keyof MachineProofreadingReceipt] === current[key as keyof MachineProofreadingPlan]) && JSON.stringify(receipt.rowIds) === JSON.stringify(current.rowIds);
  } catch { return false; }
}
