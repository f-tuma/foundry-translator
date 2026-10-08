/** Dedicated append adapter. Capability refers to observed normal parent API behavior, not DB atomicity. */
import { MODULE_ID } from '../constants';
import { translatedOutputHash } from '../translation/output-hash';
import { AffixAppendError, affixAppendObservation, prepareAffixTextAppend, validateAffixTextAppend, affixAppendRequestHash, affixAppendOperation, assertAffixAppendAfter, assertAffixAppendUndone, undoAffixTextAppend, type AffixAppendEnvironment, type AffixAppendEdit, type AffixAppendOperation, type AffixAppendPlan } from './affix-text-append';
import type { JournalData } from '../translation/journal';
export interface AppendRequest {
    documentId: string;
    revision: string;
    planHash: string;
    edits: AffixAppendEdit[];
    reason: string;
    operationId: string;
}
export interface AffixAppendBackend {
    /** Read a complete original+translated pair, current claims/schema/glossary/scope. */
    load(documentId: string): Promise<AffixAppendEnvironment>;
    /** Required references must exist in exact original context; no retention bypass. */
    references(env: AffixAppendEnvironment, plan: AffixAppendPlan): Promise<void>;
    /** Must check same source/owner/schema/target/claim/scope observations after every await. */
    current(env: AffixAppendEnvironment): void;
    /** Backend-only, verified installed-version capability, not a client request field. */
    atomicCapability(): {
        foundryVersion: string;
        systemVersion: string;
        moduleVersion: string;
        evidenceHash: string;
    } | null;
    /** One parent persistence invocation containing pages, flags and history together. No hidden multistep writes. */
    persist(data: JournalData, env: AffixAppendEnvironment): Promise<void>;
    /** Exact persisted record, never proposed values. */
    userName(): string;
    now(): string;
}
function fail(s: string): never { throw new AffixAppendError(s); }
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const whole = (x: JournalData) => translatedOutputHash({ document: x });
function guardFor(backend: AffixAppendBackend, env: AffixAppendEnvironment) { const proof = affixAppendObservation(env); return () => { backend.current(env); if (affixAppendObservation(env) !== proof)
    fail('InterveningChange'); }; }
function actualOperation(env: AffixAppendEnvironment, id: string): AffixAppendOperation | undefined {
    return (env.target.toObject().flags?.[MODULE_ID]?.reviewHistory as Record<string, AffixAppendOperation> | undefined)?.[id];
}
function capability(backend: AffixAppendBackend, env: AffixAppendEnvironment) {
    const cap = backend.atomicCapability();
    if (!cap || cap.systemVersion !== env.scope.systemVersion || cap.foundryVersion !== env.scope.foundryVersion || cap.moduleVersion !== env.scope.moduleVersion || !/^[a-f0-9]{64}$/u.test(cap.evidenceHash))
        fail('ParentSaveBehaviorUnproven');
}
export async function prepareAffixAppend(backend: AffixAppendBackend, documentId: string, revision: string) {
    const env = await backend.load(documentId), guard = guardFor(backend, env);
    guard();
    const plan = await prepareAffixTextAppend(env, revision);
    guard();
    await backend.references(env, plan);
    guard();
    return plan;
}
/** Idempotence is checked BEFORE preparing the now-modern appended record. */
export async function applyAffixAppend(backend: AffixAppendBackend, request: AppendRequest) {
    const env = await backend.load(request.documentId), guard = guardFor(backend, env);
    guard();
    capability(backend, env);
    const requestHash = await affixAppendRequestHash(request.documentId, request.revision, request.planHash, request.edits, request.reason);
    guard();
    const prior = actualOperation(env, request.operationId);
    if (prior) {
        if (prior.agentRequestHash !== requestHash || prior.affixTextAppend?.requestHash !== requestHash || prior.affixTextAppend.plan.planHash !== request.planHash || prior.affixTextAppend.plan.revision !== request.revision)
            fail('OperationConflict');
        await assertAffixAppendAfter(env, prior);
        guard();
        await backend.references(env, prior.affixTextAppend.plan);
        guard();
        return { saved: true, alreadyApplied: true, operation: prior, rows: prior.rows, willVerify: false };
    }
    const plan = await prepareAffixTextAppend(env, request.revision);
    guard();
    if (plan.planHash !== request.planHash)
        fail('PlanHash');
    await backend.references(env, plan);
    guard();
    const preview = await validateAffixTextAppend(env, plan, request.edits);
    guard();
    const staged = await affixAppendOperation(plan, preview, requestHash, request.operationId, request.reason, backend.userName(), backend.now());
    guard();
    // Last asynchronous source/reference checks precede final synchronous capability/current check.
    await backend.references(env, plan);
    guard();
    capability(backend, env);
    guard();
    if (new TextEncoder().encode(JSON.stringify({saved:true,alreadyApplied:false,operation:staged.operation,rows:staged.operation.rows,fields:staged.operation.affixTextAppend.fields,currentRaw:staged.data,sourceRaw:env.source.toObject(),complete:true,willVerify:false})).length > 500000) fail('CompleteReadbackOversize');
    await backend.persist(staged.data, env);
    // A missing response must be resolved by exact same request/operationId; never auto-replay here.
    const post = await backend.load(request.documentId), postGuard = guardFor(backend, post);
    postGuard();
    const operation = actualOperation(post, request.operationId);
    if (!operation || !eq(operation, staged.operation))
        fail('ActualReadback');
    await assertAffixAppendAfter(post, operation);
    postGuard();
    return { saved: true, alreadyApplied: false, operation, rows: operation.rows, willVerify: false };
}
export async function validateAffixAppend(backend: AffixAppendBackend, request: Omit<AppendRequest, 'operationId'>) {
    const env = await backend.load(request.documentId), guard = guardFor(backend, env);
    guard();
    const plan = await prepareAffixTextAppend(env, request.revision);
    guard();
    if (plan.planHash !== request.planHash)
        fail('PlanHash');
    await backend.references(env, plan);
    guard();
    const preview = await validateAffixTextAppend(env, plan, request.edits);
    guard();
    return preview;
}
export async function getAffixAppendOperation(backend: AffixAppendBackend, documentId: string, operationId: string) {
    const env = await backend.load(documentId), guard = guardFor(backend, env);
    guard();
    const operation = actualOperation(env, operationId);
    if (!operation)
        fail('OperationMissing');
    const undone=!!operation.undoneAt;
    if(undone)await assertAffixAppendUndone(env,operation);else await assertAffixAppendAfter(env, operation, true);
    guard();
    const operationHash = await (await import('../translation/hash')).sha256(JSON.stringify(operation));
    guard();
    return { documentId, operationId, operation, operationHash, rows: operation.rows, fields: operation.affixTextAppend.fields, currentRaw: env.target.toObject(), sourceRaw: env.source.toObject(), sourceCompatible: true, affectedRowsCompatible: !undone, undoneRowsCompatible: undone, complete: true, willVerify: false };
}
export async function undoAffixAppend(backend: AffixAppendBackend, documentId: string, operationId: string, undoId: string, revision?: string) {
    const env = await backend.load(documentId), guard = guardFor(backend, env);
    guard();
    capability(backend, env);
    const operation = actualOperation(env, operationId);
    if (!operation)
        fail('OperationMissing');
    if(operation.undoneAt){await assertAffixAppendUndone(env,operation,undoId);guard();return {undone:true,alreadyUndone:true,sourceChanged:true,operationId,undoId,willVerify:false};}
    if (revision !== undefined) {
        const actualRevision=await (await import('../translation/hash')).sha256(JSON.stringify([await whole(env.target.toObject()),operation.affixTextAppend.plan.sourceHash,env.glossaryHash,env.scope.systemId,env.scope.emberActive,env.scope.emberVersion]));
        guard();if(actualRevision!==revision)fail('Revision');
    }
    const data = await undoAffixTextAppend(env, operation, undoId, backend.userName(), backend.now());
    guard();
    await backend.references(env, operation.affixTextAppend.plan);
    guard();
    capability(backend, env);
    guard();
    await backend.persist(data, env);
    const post = await backend.load(documentId), postGuard = guardFor(backend, post);
    postGuard();
    const actualHash = await whole(post.target.toObject());
    postGuard();
    const expectedHash = await whole(data);
    postGuard();
    if (actualHash !== expectedHash)
        fail('UndoReadback');
    return { undone: true, sourceChanged: true, operationId, undoId, willVerify: false };
}
