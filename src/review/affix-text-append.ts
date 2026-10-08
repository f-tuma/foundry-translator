/** Dedicated source-owned append. Ordinary SourceChanged guards and originals stay unchanged. */
import { MODULE_ID } from "../constants";
import { assertPortableText } from "../bundles/format";
import { displayFields, displaySourceHash, DISPLAY_TEXT_PACK, escapeDisplayText, readDisplayTextFlag, readDisplayTranslationContent, type DisplayTextFlag } from "../translation/display-text";
import { affixActionDisplayFields, affixActionSourceHash, type AffixSchemaRuntime } from "../translation/affix-action-display";
import type { JournalData, JournalPageData } from "../translation/journal";
import { translatedOutputHash } from "../translation/output-hash";
import { sha256 } from "../translation/hash";
import { maskReviewParts, planReviewText, type ReviewTextDraft } from "./text-plan";
import { protectGlossaryTerms } from "../glossary/protection";
import type { GlossaryEntry } from "../glossary/types";
import { correctionParts, correctionWarnings, proseNumbers } from "../polish/quality-guards";
type Data = Record<string, unknown>;
export interface AffixAppendSource extends AffixSchemaRuntime {
    id: string;
    uuid: string;
    documentName: string;
    type: string;
    pack?: string;
    parent?: {
        id: string;
        uuid: string;
        documentName: string;
        toObject(): Data;
        effects: {
            contents: AffixAppendSource[];
        };
    };
    toObject(): Data;
}
export interface AffixAppendTarget {
    id: string;
    uuid: string;
    pack: string;
    toObject(): JournalData;
}
export interface AffixAppendEnvironment {
    source: AffixAppendSource;
    target: AffixAppendTarget;
    /** Trusted backend snapshots, never accepted as request arguments. */
    claims: {
        sourceUuid: string;
        language: string;
        documentId: string;
    }[];
    scope: {
        worldId: string;
        language: string;
        systemId: string;
        systemVersion: string;
        foundryVersion: string;
        moduleVersion: string;
        clientId: string;
        userId: string;
        isGM: boolean;
        packLocked: boolean;
        activeTranslations: boolean;
        emberActive: boolean;
        emberVersion: string;
    };
    glossaryHash: string;
    glossary?: GlossaryEntry[];
    nativePage?: (field: DisplayTextFlag["fields"][number]) => JournalPageData;
    pageSchemaProof?: string;
}
export interface AppendRow {
    rowId: string;
    fieldId: string;
    unitId: string;
    source: string[];
    before: null;
    edit: ReviewTextDraft;
}
export interface AffixAppendPlan {
    version: 1;
    documentId: string;
    sourceUuid: string;
    language: string;
    revision: string;
    planHash: string;
    proofHash: string;
    sourceHash: string;
    affixSourceHash: string;
    ownerProof: string;
    schemaProof: string;
    catalogProof: string;
    glossaryHash: string;
    scope: AffixAppendEnvironment['scope'];
    beforeGuard: string;
    priorFlag: DisplayTextFlag;
    beforeData: JournalData;
    oldFields: {
        field: DisplayTextFlag['fields'][number];
        sourceRaw: string;
        currentRaw: string;
        sourceHash: string;
        currentHash: string;
    }[];
    addedFields: DisplayTextFlag['fields'];
    addedPageTemplates: JournalPageData[];
    pageSchemaProof: string | null;
    rows: AppendRow[];
    willVerify: false;
}
export interface AffixAppendEdit {
    rowId: string;
    text: string[];
    labels?: {
        marker: string;
        label: string;
    }[];
}
export interface AffixAppendPreview {
    documentId: string;
    revision: string;
    planHash: string;
    changes: {
        rowId: string;
        fieldId: string;
        source: string[];
        before: null;
        after: string[];
    }[];
    fields: {
        field: DisplayTextFlag['fields'][number];
        sourceRaw: string;
        before: null;
        afterRaw: string;
        afterHash: string;
    }[];
    afterData: JournalData;
    willVerify: false;
}
export interface AffixAppendReceipt {
    version: 1;
    origin: 'native-manual-affix-text-append';
    plan: AffixAppendPlan;
    requestHash: string;
    addedPageIds: string[];
    afterCoreHash: string;
    fields: AffixAppendPreview['fields'];
    humanVerified: false;
}
export interface AffixAppendOperation {
    id: string;
    at: string;
    userName: string;
    sourceHash: string;
    label: string;
    agentRequestHash: string;
    affixTextAppend: AffixAppendReceipt;
    rows: {
        rowId: string;
        fieldId: string;
        source: string[];
        before: string[];
        beforeMissing: true;
        after: string[];
        label: string;
        group: string;
    }[];
    undoneAt?: string;
}
export class AffixAppendError extends Error {
    constructor(public predicate: string) { super('AffixAppend.' + predicate); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function need(ok: unknown, predicate: string): asserts ok { if (!ok)
    throw new AffixAppendError(predicate); }
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : record(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value; }
const hash = (value: unknown) => sha256(JSON.stringify(stable(value)));
const whole = (value: JournalData) => translatedOutputHash({ document: value });
const record = (v: unknown): v is Data => !!v && typeof v === 'object' && !Array.isArray(v);
function schemaShape(v: unknown, depth = 0): unknown {
    need(depth < 16, 'SchemaBounds');
    if (!record(v))
        return typeof v;
    const result: Data = { kind: v.constructor?.name };
    for (const key of ['required', 'nullable', 'blank', 'min', 'max'])
        if (['boolean', 'number', 'string'].includes(typeof v[key]))
            result[key] = v[key];
    if (record(v.fields))
        result.fields = Object.fromEntries(Object.entries(v.fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, schemaShape(x, depth + 1)]));
    if (v.element)
        result.element = schemaShape(v.element, depth + 1);
    return result;
}
/** Every await in the pure pipeline rechecks all synchronous underlying observations. */
function observe(env: AffixAppendEnvironment): {
    proof: string;
    source: Data;
    data: JournalData;
    owner: Data | null;
    schema: unknown;
} {
    need(env.scope.isGM && !env.scope.packLocked && !env.scope.activeTranslations && env.scope.systemId === 'crucible', 'Scope');
    need(typeof game !== 'undefined' && game.system?.id === 'crucible' && game.user?.isGM, 'GMSystem');
    need(env.scope.userId === game.user.id, 'UserIdentity');
    need(env.target.pack === DISPLAY_TEXT_PACK && env.target.uuid === `Compendium.${DISPLAY_TEXT_PACK}.JournalEntry.${env.target.id}`, 'TargetIdentity');
    const model = (CONFIG as unknown as {
        ActiveEffect?: {
            dataModels?: {
                affix?: {
                    name?: string;
                    schema?: {
                        fields?: Data;
                    };
                };
            };
        };
    }).ActiveEffect?.dataModels?.affix;
    need(model?.name === 'CrucibleAffixActiveEffect' && env.source.system?.constructor === model && model.schema?.fields, 'Schema');
    const source = env.source.toObject(), data = env.target.toObject();
    need(data._id === env.target.id, 'TargetId');
    need(env.source.documentName === 'ActiveEffect' && env.source.type === 'affix' && source.type === 'affix' && source._id === env.source.id, 'SourceIdentity');
    need(!env.source.uuid.includes('foundry-translate'), 'OriginalOnly');
    let owner: Data | null = null;
    if (env.source.parent) {
        const parent = env.source.parent;
        owner = parent.toObject();
        need(parent.documentName === 'Item' && owner._id === parent.id && env.source.uuid === `${parent.uuid}.ActiveEffect.${env.source.id}`, 'EmbeddedOwner');
        need(parent.effects.contents.filter(x => x.id === env.source.id).length === 1 && parent.effects.contents.includes(env.source), 'RuntimeMembership');
        need(Array.isArray(owner.effects) && owner.effects.filter(x => record(x) && x._id === env.source.id).length === 1 && eq(owner.effects.find(x => record(x) && x._id === env.source.id), source), 'SerializedMembership');
    }
    else
        need(!!env.source.pack && env.source.uuid === `Compendium.${env.source.pack}.ActiveEffect.${env.source.id}`, 'StandaloneIdentity');
    const flag = readDisplayTextFlag(data.flags);
    need(flag && flag.sourceUuid === env.source.uuid && flag.documentType === 'ActiveEffect' && flag.targetLanguage === env.scope.language, 'Pairing');
    const matches = env.claims.filter(x => x.sourceUuid === env.source.uuid && x.language === env.scope.language);
    need(matches.length === 1 && matches[0]?.documentId === env.target.uuid, 'UniqueClaim');
    const schema = schemaShape(model.schema);
    return { proof: JSON.stringify([source, data, owner, schema, env.claims, env.scope, env.glossaryHash, env.glossary ?? [], env.target.uuid, env.source.uuid, env.pageSchemaProof ?? null]), source, data, owner, schema };
}
export function affixAppendObservation(env: AffixAppendEnvironment): string { return observe(env).proof; }
async function bound<T>(env: AffixAppendEnvironment, proof: string, promise: Promise<T>): Promise<T> { const value = await promise; need(observe(env).proof === proof, 'InterveningChange'); return value; }
function bounded(value: unknown) { need(new TextEncoder().encode(JSON.stringify(value)).length <= 500000, 'CompletePlanBounds'); }
/** Fail closed; no caller paths, source data, page IDs, targets or provenance. */
export async function prepareAffixTextAppend(env: AffixAppendEnvironment, revision?: string): Promise<AffixAppendPlan> {
    const o = observe(env), check = <T>(p: Promise<T>) => bound(env, o.proof, p);
    const flag = readDisplayTextFlag(o.data.flags)!;
    need(flag.fallbackTextSegments === 0 && !flag.affixSourceHash && !('partial' in flag) && flag.fields.length === 2, 'LegacyRecord');
    const base = displayFields('ActiveEffect', { ...o.source, system: undefined }), added = affixActionDisplayFields(o.source, env.source);
    need(base.length === 2 && base.some(x => eq(x.path, ['name'])) && base.some(x => eq(x.path, ['description'])) && added.length > 0, 'SourceInventory');
    const actions = (o.source.system as Data)?.actions;
    need(Array.isArray(actions) && new Set(actions.map(x => record(x) ? x.id : null)).size === actions.length, 'UniqueActionIds');
    need(flag.fields.every(x => base.some(b => eq([x.path, x.format, x.source], [b.path, b.format, b.source]))) && o.data.pages.length === 2 && flag.fields.every(x => o.data.pages.filter(p => p._id === x.pageId).length === 1), 'ExactBaseFieldsPages');
    const legacy = structuredClone(o.source);
    if (record(legacy.system))
        delete legacy.system.actions;
    need(flag.sourceHash === await check(displaySourceHash('ActiveEffect', legacy)), 'LegacySourceHash');
    const sourceHash = await check(displaySourceHash('ActiveEffect', o.source)), affixSourceHash = await check(affixActionSourceHash(o.source));
    const beforeGuard = await check(whole(o.data));
    const actualRevision = await check(hash([beforeGuard, sourceHash, env.glossaryHash, env.scope.systemId, env.scope.emberActive, env.scope.emberVersion]));
    need(revision === undefined || revision === actualRevision, 'Revision');
    const oldFields: AffixAppendPlan['oldFields'] = [];
    for (const f of flag.fields) {
        const current = readDisplayTranslationContent(o.data, f), page = o.data.pages.find(p => p._id === f.pageId);
        need(page?.type === 'text' && page.text?.format === 1 && typeof current === 'string' && current.trim(), 'CompleteCurrent');
        assertPortableText(f.source, current, f.format);
        const a = planReviewText(f.source, f.format).units, b = planReviewText(current, f.format).units;
        need(a.length === b.length && a.every((u, i) => u.id === b[i]?.id && u.parts.length === b[i]?.parts.length && u.parts.every((s, j) => eq(proseNumbers([s]), proseNumbers([b[i]!.parts[j]!])))), 'BaseNumbersParts');
        oldFields.push({ field: structuredClone(f), sourceRaw: f.source, currentRaw: current, sourceHash: await check(hash(f.source)), currentHash: await check(hash(current)) });
    }
    const addedFields: AffixAppendPlan['addedFields'] = [], rows: AppendRow[] = [];
    for (const field of added) {
        const pageId = (await check(hash(field.path))).slice(0, 16);
        need(!o.data.pages.some(p => p._id === pageId) && !addedFields.some(f => f.pageId === pageId) && !flag.fields.some(f => eq(f.path, field.path)), 'MissingOnlyCollision');
        addedFields.push({ ...field, pageId });
        const units = planReviewText(field.source, field.format).units;
        need(units.length, 'NonemptyUnits');
        for (const u of units) {
            const fieldId = JSON.stringify(field.path);
            rows.push({ rowId: await check(hash([env.source.uuid, env.scope.language, fieldId, u.id])), fieldId, unitId: u.id, source: [...u.parts], before: null, edit: maskReviewParts(u.parts) });
        }
    }
    need(rows.length > 0 && rows.length <= 100, 'RowBounds');
    const reviews = (o.data.flags?.[MODULE_ID]?.review as {
        entries?: Record<string, unknown>;
    } | undefined)?.entries ?? {};
    need(rows.every(r => !Object.hasOwn(reviews, r.rowId)), 'NewRowAttestation');
    const body = { version: 1 as const, documentId: env.target.uuid, sourceUuid: env.source.uuid, language: env.scope.language, revision: actualRevision, sourceHash, affixSourceHash, ownerProof: await check(hash(o.owner)), schemaProof: await check(hash(o.schema)), catalogProof: await check(hash(env.claims)), glossaryHash: env.glossaryHash, scope: structuredClone(env.scope), beforeGuard, priorFlag: structuredClone(flag), beforeData: structuredClone(o.data), oldFields, addedFields, addedPageTemplates: addedFields.map(f => env.nativePage?.(f) ?? ({ _id: f.pageId, name: f.path.join(" / "), type: "text", text: { format: 1, content: "" } })), pageSchemaProof: env.pageSchemaProof ?? null, rows, willVerify: false as const };
    const proofHash = await check(hash(body)), planHash = await check(hash(['affix-text-append-v1', proofHash]));
    const plan = { ...body, proofHash, planHash };
    bounded(plan);
    return plan;
}
export async function validateAffixTextAppend(env: AffixAppendEnvironment, expected: AffixAppendPlan, edits: AffixAppendEdit[]): Promise<AffixAppendPreview> {
    const fresh = await prepareAffixTextAppend(env, expected.revision);
    need(eq(fresh, expected), 'PlanHash');
    need(edits.length === fresh.rows.length && new Set(edits.map(e => e.rowId)).size === edits.length && edits.every(e => fresh.rows.some(r => r.rowId === e.rowId)), 'EveryNewUnitOnce');
    const o = observe(env), check = <T>(p: Promise<T>) => bound(env, o.proof, p), changes: AffixAppendPreview['changes'] = [];
    for (const row of fresh.rows) {
        const e = edits.find(e => e.rowId === row.rowId)!;
        need(Object.keys(e).every(k => ['rowId', 'text', 'labels'].includes(k)) && e.text.length === row.source.length, 'EditParts');
        need(e.text.every(t => typeof t === 'string' && !!t.trim() && !/<|>|@[A-Za-z][A-Za-z0-9]*\[|&(?:amp;)?[A-Za-z][A-Za-z0-9_]*\[|\[\[|__FT[NGS]_/u.test(t)), 'CallerSyntax');
        const markers = (s: string) => [...s.matchAll(/⟦+[^⟦⟧]*⟧+/gu)].map(m => m[0]).sort();
        need(e.text.every((t, i) => eq(markers(t), markers(row.edit.text[i]!))), 'SamePartMarkers');
        const after = correctionParts(row.source, e.text, e.labels ?? []);
        need(after.every((t, i) => eq(proseNumbers([t]), proseNumbers([row.source[i]!]))), 'SourcePartNumbers');
        // Source has no current translation. The existing matcher proves EXACT
        // source matches/aliases/boundaries; correctionWarnings THROWS on their
        // removal. Its returned numeric/length heuristics are not applicable to
        // this token-only baseline (source-part numbers are separately exact).
        const exact=(env.glossary??[]).filter(g=>g.mode!=='inflect');
        const requireExact=(sourceText:string,afterText:string)=>{
          const baseline=protectGlossaryTerms(sourceText,exact,{nonce:'affixAppendExact',allowInflection:false});
          correctionWarnings(baseline.tokens.map(t=>t.replacement),[afterText],exact);
        };
        requireExact(row.edit.text.join(' '),e.text.join(' '));
        const afterRefs=maskReviewParts(after).references.flat();
        for(const ref of row.edit.references.flat()){
          if(!ref.editable||!ref.label)continue;
          const target=afterRefs.find(r=>r.marker===ref.marker);
          need(target,'CaptionBinding');requireExact(ref.label,target.label??'');
        }
        changes.push({ rowId: row.rowId, fieldId: row.fieldId, source: [...row.source], before: null, after });
    }
    const data = structuredClone(fresh.beforeData), fields: AffixAppendPreview['fields'] = [];
    for (const f of fresh.addedFields) {
        let raw = f.source;
        for (const row of fresh.rows.filter(r => r.fieldId === JSON.stringify(f.path)))
            raw = planReviewText(raw, f.format).replace(row.unitId, changes.find(c => c.rowId === row.rowId)!.after);
        assertPortableText(f.source, raw, f.format);
        need(eq(proseNumbers([f.source]), proseNumbers([raw])), 'FieldNumbers');
        fields.push({ field: structuredClone(f), sourceRaw: f.source, before: null, afterRaw: raw, afterHash: await check(hash(raw)) });
        const page = structuredClone(fresh.addedPageTemplates.find(p => p._id === f.pageId)); need(page?.type === 'text' && page.text?.format === 1 && page.text.content === '', 'NativePageTemplate'); page.text.content = f.format === 'html' ? raw : `<p>${escapeDisplayText(raw)}</p>`; data.pages.push(page);
    }
    const flag = readDisplayTextFlag(data.flags)!;
    flag.fields.push(...structuredClone(fresh.addedFields));
    flag.sourceHash = fresh.sourceHash;
    flag.affixSourceHash = fresh.affixSourceHash;
    // outputHash and all generation/editor/human provenance deliberately stay literal.
    need(readDisplayTextFlag(data.flags), 'ResultFlag');
    const preview = { documentId: fresh.documentId, revision: fresh.revision, planHash: fresh.planHash, changes, fields, afterData: data, willVerify: false as const };
    bounded(preview);
    return preview;
}
export async function affixAppendRequestHash(documentId: string, revision: string, planHash: string, edits: AffixAppendEdit[], reason: string) { return hash(['affix-text-append-v1', documentId, revision, planHash, edits, reason]); }
export async function affixAppendOperation(plan: AffixAppendPlan, preview: AffixAppendPreview, requestHash: string, id: string, reason: string, userName: string, at: string): Promise<{
    data: JournalData;
    operation: AffixAppendOperation;
}> {
    need(/^[a-zA-Z0-9-]{1,80}$/u.test(id) && reason.trim().length >= 5 && reason.length <= 3000, 'OperationInput');
    const data = structuredClone(preview.afterData), flags = data.flags![MODULE_ID]!;
    const history = (flags.reviewHistory ?? {}) as Record<string, unknown>;
    need(!Object.hasOwn(history, id), 'OperationId');
    const receipt: AffixAppendReceipt = { version: 1, origin: 'native-manual-affix-text-append', plan: structuredClone(plan), requestHash, addedPageIds: plan.addedFields.map(f => f.pageId), afterCoreHash: await whole(data), fields: structuredClone(preview.fields), humanVerified: false };
    const operation: AffixAppendOperation = { id, at, userName, sourceHash: plan.sourceHash, label: 'MCP affix append: ' + reason, agentRequestHash: requestHash, affixTextAppend: receipt, rows: preview.changes.map(c => ({ ...structuredClone(c), before: [], beforeMissing: true, label: c.fieldId, group: 'affix-action-append' })) };
    flags.reviewHistory = { ...history, [id]: operation };
    bounded(operation);
    return { data, operation };
}
async function assertPlanProof(plan: AffixAppendPlan) { const { proofHash, planHash, ...body } = plan; need(proofHash === await hash(body) && planHash === await hash(['affix-text-append-v1', proofHash]), 'PersistedPlanProof'); }
export async function assertAffixAppendAfter(env: AffixAppendEnvironment, operation: AffixAppendOperation): Promise<void> {
    need(!operation.undoneAt && operation.affixTextAppend?.version === 1 && operation.affixTextAppend.humanVerified === false, 'OperationConflict');
    const receipt = operation.affixTextAppend, plan = receipt.plan, o = observe(env), data = structuredClone(o.data);
    await bound(env, o.proof, assertPlanProof(plan));
    need(receipt.origin === 'native-manual-affix-text-append' && receipt.requestHash === operation.agentRequestHash && operation.sourceHash === plan.sourceHash && eq(operation.rows.map(r => [r.rowId, r.fieldId, r.source, r.beforeMissing, r.before]), plan.rows.map(r => [r.rowId, r.fieldId, r.source, true, []])), 'ReceiptBindings');
    need(eq(receipt.fields.map(f=>f.field),plan.addedFields),'ReceiptFieldBindings');
    for(const f of receipt.fields){
      need(f.sourceRaw===f.field.source&&f.before===null&&await bound(env,o.proof,hash(f.afterRaw))===f.afterHash,'ReceiptFieldHash');
      assertPortableText(f.sourceRaw,f.afterRaw,f.field.format);
      const units=planReviewText(f.afterRaw,f.field.format).units;
      for(const row of plan.rows.filter(r=>r.fieldId===JSON.stringify(f.field.path))){
        const unit=units.find(u=>u.id===row.unitId),saved=operation.rows.find(r=>r.rowId===row.rowId);
        need(unit&&saved&&eq(saved.after,unit.parts),'ReceiptActualRows');
      }
    }
    const history = data.flags![MODULE_ID]!.reviewHistory as Record<string, unknown>;
    need(eq(history?.[operation.id], operation), 'ActualOperation');
    delete history[operation.id];
    const priorFlags = plan.beforeData.flags![MODULE_ID]!;
    need(eq(history, priorFlags.reviewHistory ?? {}), 'HistoryChanged');
    if (Object.hasOwn(priorFlags, 'reviewHistory'))
        data.flags![MODULE_ID]!.reviewHistory = structuredClone(priorFlags.reviewHistory);
    else
        delete data.flags![MODULE_ID]!.reviewHistory;
    need(await bound(env, o.proof, whole(data)) === receipt.afterCoreHash, 'AfterDataChanged');
    need(await bound(env, o.proof, affixActionSourceHash(o.source)) === plan.affixSourceHash && await bound(env, o.proof, displaySourceHash('ActiveEffect', o.source)) === plan.sourceHash, 'SourceChanged');
    need(await bound(env, o.proof, hash(o.owner)) === plan.ownerProof && await bound(env, o.proof, hash(o.schema)) === plan.schemaProof && await bound(env, o.proof, hash(env.claims)) === plan.catalogProof && env.glossaryHash === plan.glossaryHash && (env.pageSchemaProof ?? null) === plan.pageSchemaProof && eq({ ...env.scope, clientId: '' }, { ...plan.scope, clientId: '' }), 'EnvironmentChanged');
    const flag = readDisplayTextFlag(o.data.flags)!;
    need(flag.sourceHash === plan.sourceHash && flag.affixSourceHash === plan.affixSourceHash, 'AfterFlag');
    for (const f of receipt.fields)
        need(readDisplayTranslationContent(o.data, f.field) === f.afterRaw, 'AfterField');
    need(eq(o.data.pages.slice(0, plan.beforeData.pages.length), plan.beforeData.pages), 'OldPagesChanged');
}
export async function undoAffixTextAppend(env: AffixAppendEnvironment, operation: AffixAppendOperation, undoId: string, userName: string, at: string): Promise<JournalData> {
    await assertAffixAppendAfter(env, operation);
    need(/^[a-zA-Z0-9-]{1,80}$/u.test(undoId) && undoId !== operation.id, 'UndoId');
    const data = structuredClone(operation.affixTextAppend.plan.beforeData), flags = data.flags![MODULE_ID]!;
    const history = (flags.reviewHistory ?? {}) as Record<string, unknown>;
    need(!Object.hasOwn(history, undoId), 'UndoId');
    flags.reviewHistory = { ...history, [operation.id]: { ...structuredClone(operation), undoneAt: at }, [undoId]: { id: undoId, at, userName, sourceHash: operation.sourceHash, label: 'Undo affix append', undoOf: operation.id, rows: operation.rows.map(r => ({ ...r, before: r.after, beforeMissing: false, after: [], afterMissing: true })), humanVerified: false } };
    return data;
}

/** Reconstruct the authenticated append and inverse, then compare the COMPLETE actual record.
 * Used only to reconcile a lost undo response; never treats hypothetical data as actual. */
export async function assertAffixAppendUndone(env:AffixAppendEnvironment,operation:AffixAppendOperation,undoId?:string){
 const o=observe(env),check=<T>(p:Promise<T>)=>bound(env,o.proof,p);
 need(typeof operation.undoneAt==='string','UndoMissing');
 const history=o.data.flags![MODULE_ID]!.reviewHistory as Record<string,Data>;
 const inverses=Object.values(history).filter(x=>x.undoOf===operation.id);
 need(inverses.length===1,'UndoReceipt');const inverse=inverses[0]!;
 need(typeof inverse.id==='string'&&inverse.id!==operation.id&&(!undoId||inverse.id===undoId)&&typeof inverse.at==='string'&&typeof inverse.userName==='string'&&inverse.humanVerified===false,'UndoReceipt');
 const prior={...structuredClone(operation)};delete prior.undoneAt;
 const receipt=prior.affixTextAppend,plan=receipt.plan,append=structuredClone(plan.beforeData),flag=readDisplayTextFlag(append.flags)!;
 flag.fields.push(...structuredClone(plan.addedFields));flag.sourceHash=plan.sourceHash;flag.affixSourceHash=plan.affixSourceHash;
 for(const f of receipt.fields){const page=structuredClone(plan.addedPageTemplates.find(p=>p._id===f.field.pageId));need(page?.text,'NativePageTemplate');page.text.content=f.field.format==='html'?f.afterRaw:`<p>${escapeDisplayText(f.afterRaw)}</p>`;append.pages.push(page);}
 const oldHistory=append.flags![MODULE_ID]!.reviewHistory as Record<string,unknown>|undefined;
 append.flags![MODULE_ID]!.reviewHistory={...(oldHistory??{}),[prior.id]:prior};
 const simulated:AffixAppendEnvironment={...env,target:{...env.target,toObject:()=>structuredClone(append)}};
 const expected=await check(undoAffixTextAppend(simulated,prior,inverse.id as string,inverse.userName as string,inverse.at as string));
 need(await check(whole(expected))===await check(whole(o.data)),'UndoReadback');
 return inverse.id as string;
}
