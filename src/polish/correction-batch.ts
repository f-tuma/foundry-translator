import { MODULE_ID, MODULE_VERSION } from "../constants";
import type { GlossaryEntry } from "../glossary/types";
import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import { sha256 } from "../translation/hash";
import { activeTranslations } from "../translation/active-translations";
import { assertPortableText, syntaxExpressions } from "../bundles/format";
import { correctionParts, correctionWarnings, proseNumbers } from "./quality-guards";
import { maskReviewParts } from "../review/text-plan";
import { hashSource, loadReview, portableReviewText, reviewCatalog, validateReviewCorrection, type ReviewChange, type ReviewDocument, type ReviewHistoryEntry, type ReviewSnapshot } from "../review/service";
import { sourceReferences } from "./reference-context";

import { BATCH_ROWS, BATCH_REQUEST_BYTES, BATCH_RESPONSE_BYTES, type BatchPayload, type BatchReceipt } from "./correction-batch-contract";
export type { BatchPayload, BatchReceipt } from "./correction-batch-contract";
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function batchFail(code: string, rowId?: string): never { throw new Error(`Live.${code}`, { cause: new Error(rowId ? `${code}: ${rowId}` : code) }); }
export function boundBatch(value: unknown, max = BATCH_RESPONSE_BYTES): void {
  if (new TextEncoder().encode(JSON.stringify({ ok: true, value })).length > max) batchFail("BatchTooLarge");
}
function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== "_stats").sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, normalized(v)]));
}
export const batchObject = (value: unknown) => JSON.stringify(normalized(value));
export const batchHash = (value: unknown) => sha256(JSON.stringify(value));
export function batchScope(): string {
  const ember = game.modules?.get("ember");
  return JSON.stringify([game.world?.id, game.user?.id, game.settings.get(MODULE_ID, "targetLanguage") ?? "cs", game.system?.id ?? null,
    game.modules?.get(MODULE_ID)?.version ?? MODULE_VERSION, game.modules?.get(MODULE_ID)?.active === true, ember?.active === true, String(ember?.version ?? "")]);
}
export function batchIdle(): void {
  if (!game.user?.isGM) throw new Error("Review.GMOnly");
  if (activeTranslations.list().some(run => run.finishedAt === undefined && run.pausedAt === undefined)) throw new Error("Review.PauseFirst");
}
export async function batchSource(snapshot: ReviewSnapshot) {
  const doc = await fromUuid(snapshot.entry.sourceUuid);
  if (!doc?.toObject || doc.uuid !== snapshot.entry.sourceUuid || doc.documentName !== snapshot.entry.kind) throw new Error("Review.Conflict");
  const data = doc.toObject(), proof = batchObject(data);
  if (await hashSource(snapshot.entry.kind,data) !== snapshot.sourceHash || batchObject(doc.toObject()) !== proof) throw new Error("Review.Conflict");
  return { doc, proof, fullSourceHash: await sha256(proof) };
}
export const batchCatalogHash = (catalog: ReviewDocument[]) => batchHash(catalog.map(({id,pack,uuid,kind,sourceUuid,language})=>({id,pack,uuid,kind,sourceUuid,language})).sort((a, b) => a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0));
export async function batchRevision(snapshot: ReviewSnapshot, glossaryHash: string): Promise<string> {
  const ember = game.modules?.get("ember");
  return batchHash([snapshot.guard.fingerprint, snapshot.sourceHash, glossaryHash, game.system?.id ?? null, ember?.active === true, String(ember?.version ?? "")]);
}
export async function batchEnvironment(entry: ReviewDocument) {
  const catalog = await reviewCatalog(entry.language), glossary = await new GlossaryCompendiumRepository().loadExisting();
  const snapshot = await loadReview(entry, catalog), glossaryHash = await batchHash(glossary);
  return { snapshot, catalog, glossary, glossaryHash, revision: await batchRevision(snapshot, glossaryHash) };
}
export function normalizedBatch(args: BatchPayload): BatchPayload {
  return { documentId: args.documentId, revision: args.revision, reason: args.reason.trim(), changes: args.changes.map(c => ({
    rowId: c.rowId, text: [...c.text], labels: (c.labels ?? []).map(l => ({marker:l.marker,label:l.label})), reason: c.reason.trim() })) };
}
export function batchPayloadHash(payload: BatchPayload): Promise<string> {
  return batchHash(["correction-batch-v1", payload.documentId, payload.revision, payload.reason,
    payload.changes.map(c => [c.rowId, c.text, c.labels ?? [], c.reason])]);
}
export const batchRequestHash = (payloadHash: string, planHash: string) => batchHash(["correction-batch-save-v1", payloadHash, planHash]);
async function receiptHash(receipt: Omit<BatchReceipt,"planHash"> | BatchReceipt): Promise<string> {
  return batchHash(["correction-batch-plan-v1", receipt.payloadHash, receipt.sourceHash, receipt.fullSourceHash,
    receipt.guardFingerprint, receipt.glossaryHash, receipt.catalogHash, receipt.scope, receipt.rows, receipt.fields]);
}
export async function buildCorrectionBatch(snapshot: ReviewSnapshot, args: BatchPayload, catalog: ReviewDocument[], glossary: GlossaryEntry[]) {
  batchIdle();
  const payload = normalizedBatch(args); boundBatch(payload,BATCH_REQUEST_BYTES);
  if (payload.documentId !== snapshot.entry.uuid || !payload.changes.length || payload.changes.length > BATCH_ROWS || new Set(payload.changes.map(c => c.rowId)).size !== payload.changes.length) batchFail("InvalidRequest");
  const glossaryHash = await batchHash(glossary);
  if (await batchRevision(snapshot,glossaryHash) !== payload.revision) throw new Error("Review.Conflict");
  if (snapshot.warning) throw new Error(`Review.${snapshot.warning}`);
  const source = await batchSource(snapshot), fields = new Map<string,string>(), changes: ReviewChange[] = [], rows: BatchReceipt["rows"] = [];
  for (const c of payload.changes) {
    const row = snapshot.rows.find(r=>r.id===c.rowId);
    if (!row) throw new Error("Review.MissingField");
    if (row.blocked) throw new Error(`Review.${row.blocked}`);
    const field = snapshot.fields.find(f=>f.id===row.fieldId)!;
    const parts = correctionParts(row.translation,c.text,c.labels??[]);
    if (equal(parts,row.translation)) batchFail("NoChange",row.id);
    if (parts.some((p,i)=>!equal(proseNumbers([p]),proseNumbers([row.translation[i]!])))) batchFail("NumbersChanged",row.id);
    if (!equal(syntaxExpressions(parts.join("")),syntaxExpressions(row.translation.join("")))) throw new Error("Review.ProtectedText");
    const warnings = correctionWarnings(row.translation,parts,glossary);
    if (warnings.length) batchFail("BatchWarnings",row.id);
    fields.set(field.id,validateReviewCorrection(snapshot,row.id,parts,fields.get(field.id)));
    changes.push({rowId:row.id,parts}); rows.push({rowId:row.id,beforeHash:await batchHash(row.translation),afterHash:await batchHash(parts),reason:c.reason});
  }
  const fieldProofs: BatchReceipt["fields"] = [];
  for (const [id,value] of fields) {
    const field = snapshot.fields.find(f=>f.id===id)!;
    assertPortableText(field.source,portableReviewText(snapshot,field,value),field.format);
    assertPortableText(field.translation,value,field.format);
    fieldProofs.push({fieldId:id,sourceHash:await batchHash(field.source),beforeHash:await batchHash(field.translation),afterHash:await batchHash(value)});
  }
  const body = {version:1 as const,payload,payloadHash:await batchPayloadHash(payload),sourceHash:snapshot.sourceHash,fullSourceHash:source.fullSourceHash,
    guardFingerprint:snapshot.guard.fingerprint,glossaryHash,catalogHash:await batchCatalogHash(catalog),scope:batchScope(),rows,fields:fieldProofs};
  const receipt: BatchReceipt = {...body,planHash:await receiptHash(body)};
  if (batchObject(source.doc.toObject!())!==source.proof) throw new Error("Review.Conflict");
  const preview = {documentId:payload.documentId,revision:payload.revision,normalizedPayload:payload,planHash:receipt.planHash,payloadHash:receipt.payloadHash,
    bindings:receipt,rows:changes.map(c=>{const row=snapshot.rows.find(r=>r.id===c.rowId)!;return {rowId:c.rowId,fieldId:row.fieldId,source:row.source,before:row.translation,after:c.parts,
      beforeEdit:maskReviewParts(row.translation),afterEdit:maskReviewParts(c.parts),sourceReferences:sourceReferences(snapshot,snapshot.fields.find(f=>f.id===row.fieldId)!,row),reason:payload.changes.find(x=>x.rowId===row.id)!.reason,warnings:[]};}),warnings:[],willVerify:false,complete:true,maxResponseBytes:BATCH_RESPONSE_BYTES};
  boundBatch(preview);
  // Forecast a complete ordinary receipt before persistence, not a fabricated saved receipt.
  const forecast: ReviewHistoryEntry={id:"x".repeat(80),at:new Date().toISOString(),userName:game.user?.name??"GM",sourceHash:snapshot.sourceHash,label:`MCP batch: ${payload.reason}`,
    agentRequestHash:await batchRequestHash(receipt.payloadHash,receipt.planHash),correctionBatch:receipt,rows:changes.map(c=>{const row=snapshot.rows.find(r=>r.id===c.rowId)!;return {rowId:row.id,before:row.translation,after:c.parts,label:row.label,group:row.group};})};
  boundBatch({...await batchOperationValue(snapshot,forecast,glossary,changes),glossaryCompatible:true,catalogCompatible:true,scopeCompatible:true,saved:true},BATCH_RESPONSE_BYTES-256);
  return {receipt,changes,preview};
}
export async function assertBatchReceipt(operation: ReviewHistoryEntry): Promise<BatchReceipt> {
  const r=operation.correctionBatch;
  if (!r || r.version!==1 || !Array.isArray(r.rows) || !r.rows.length || r.rows.length>BATCH_ROWS || !Array.isArray(r.fields) || !Array.isArray(r.payload?.changes) ||
    new Set(r.rows.map(x=>x.rowId)).size!==r.rows.length || r.payload.changes.length!==r.rows.length || operation.rows.length!==r.rows.length || operation.sourceHash!==r.sourceHash ||
    !equal(r.payload,normalizedBatch(r.payload)) || await batchPayloadHash(r.payload)!==r.payloadHash || await receiptHash(r)!==r.planHash ||
    await batchRequestHash(r.payloadHash,r.planHash)!==operation.agentRequestHash || operation.label!==`MCP batch: ${r.payload.reason}`) batchFail("OperationConflict");
  for (const [i,row] of operation.rows.entries()) {
    const proof=r.rows[i]!,change=r.payload.changes[i]!;
    if (row.rowId!==proof.rowId || change.rowId!==row.rowId || proof.reason!==change.reason || await batchHash(row.before)!==proof.beforeHash || await batchHash(row.after)!==proof.afterHash) batchFail("OperationConflict");
    if (!equal(correctionParts(row.before,change.text,change.labels??[]),row.after)) batchFail("OperationConflict");
  }
  return r;
}
export async function assertBatchApplicability(snapshot: ReviewSnapshot, operation: ReviewHistoryEntry): Promise<void> {
  const r=await assertBatchReceipt(operation), source=await batchSource(snapshot);
  if (operation.undoneAt || snapshot.entry.uuid!==r.payload.documentId || snapshot.sourceHash!==r.sourceHash || source.fullSourceHash!==r.fullSourceHash || batchScope()!==r.scope ||
    operation.rows.some(c=>!equal(snapshot.rows.find(row=>row.id===c.rowId)?.translation,c.after))) batchFail("OperationConflict");
  if (batchObject(source.doc.toObject!())!==source.proof) throw new Error("Review.Conflict");
}
export async function assertBatchFinal(snapshot: ReviewSnapshot, r: BatchReceipt): Promise<()=>void> {
  const catalog=await reviewCatalog(snapshot.entry.language), glossary=await new GlossaryCompendiumRepository().loadExisting(), source=await batchSource(snapshot);
  if (await batchCatalogHash(catalog)!==r.catalogHash || await batchHash(glossary)!==r.glossaryHash || source.fullSourceHash!==r.fullSourceHash || batchScope()!==r.scope) throw new Error("Review.Conflict");
  return ()=>{batchIdle(); if (batchObject(source.doc.toObject!())!==source.proof || batchScope()!==r.scope) throw new Error("Review.Conflict"); if(game.packs.get(snapshot.entry.pack)?.locked) throw new Error("Review.Locked");};
}
export async function batchOperationValue(snapshot: ReviewSnapshot, operation: ReviewHistoryEntry, glossary: GlossaryEntry[], proposed?: ReviewChange[]) {
  const receipt=await assertBatchReceipt(operation), source=await batchSource(snapshot);
  const rows=operation.rows.map(c=>{
    const row=snapshot.rows.find(r=>r.id===c.rowId);
    if (!row) return {rowId:c.rowId,missing:true};
    const translation=proposed?.find(r=>r.rowId===row.id)?.parts??row.translation;
    const text=[...row.source,...translation].join(" ").toLocaleLowerCase();
    const terms=glossary.filter(g=>g.enabled!==false&&[g.source,g.replacement,...g.aliases].some(t=>text.includes(t.toLocaleLowerCase())));
    return {rowId:row.id,fieldId:row.fieldId,format:row.format,source:row.source,translation,edit:maskReviewParts(translation),
      sourceReferences:sourceReferences(snapshot,snapshot.fields.find(f=>f.id===row.fieldId)!,row),blocked:row.blocked,currentVerified:proposed?false:!!row.verified,
      glossary:terms.map(({id:_,sourceUuid:__,...g})=>({...g,rule:g.mode==="inflect"?"INFLECT":"EXACT"})),glossaryMatches:terms.length};
  });
  return {documentId:snapshot.entry.uuid,operationId:operation.id,operation,operationHash:await batchHash(operation),revision:await batchRevision(snapshot,await batchHash(glossary)),
    historicalRequestedRevision:receipt.payload.revision,sourceCompatible:snapshot.sourceHash===receipt.sourceHash&&source.fullSourceHash===receipt.fullSourceHash,
    affectedRowsCompatible:operation.rows.every(c=>equal(proposed?.find(p=>p.rowId===c.rowId)?.parts??snapshot.rows.find(r=>r.id===c.rowId)?.translation,c.after)),
    undoneRowsCompatible:!!operation.undoneAt&&operation.rows.every(c=>equal(snapshot.rows.find(r=>r.id===c.rowId)?.translation,c.before)),
    rows,willVerify:false,complete:true,maxResponseBytes:BATCH_RESPONSE_BYTES};
}
