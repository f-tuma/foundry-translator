import { prepareUnresolvedSourceRetention, type UnresolvedSourceRetention } from "./unresolved-source-references";
import { assertPortableText, diagnosePortableText, syntaxExpressions } from "../bundles/format";
import { absoluteReference } from "../bundles/reference-notation";
import { sha256 } from "../translation/hash";
import { FOUNDRY_EXPRESSION } from "../translation/foundry-syntax";
import { isDecorativeIconText } from "../translation/decorative-text";
import { proseNumbers } from "../polish/quality-guards";
import { editableEmbedTextOptions, embedTextOptionSignature } from "./embed-text-options";
import { portableReviewText, type ReviewChange, type ReviewSnapshot } from "./service";
import { maskReviewParts, planReviewText, restoreReviewParts, type ReviewTextDraft } from "./text-plan";
import { restoreSourcePunctuation, removeSourcePunctuation, type SourcePunctuationRestoration, type SourcePunctuationDiagnostic } from "./source-punctuation";

export interface RebuildReference {
  partIndex: number; marker: string; sourceCommand: string; command: string;
  sourceTarget?: string; target?: string;
  retentionPolicy?: "retain-exact-unresolved-original"; mappedTarget?: string;
  required?: boolean; inactiveSystem?: "dnd5e" | "crucible";
}
export interface ReferenceRebuildRow {
  rowId: string; unitId: string; partIndices: number[];
  source: string[]; before: string[]; baseline: string[];
  /** Source-owned punctuation can insert one part without changing before. */
  alignedBefore?: string[];
  edit: ReviewTextDraft; referenceMap: RebuildReference[];
}
export interface ReferenceRebuildPlan {
  version: 1; documentId: string; sourceHash: string; fieldId: string;
  fieldSourceHash: string; beforeHash: string; guardFingerprint: string; proofHash: string;
  systemId: string; emberActive: boolean; emberVersion: string;
  unresolvedSourceRetention?: UnresolvedSourceRetention;
  punctuation?: SourcePunctuationRestoration;
  rows: ReferenceRebuildRow[]; targets: { sourceTarget: string; target: string; required: boolean; inactiveSystem?: "dnd5e" | "crucible"; retentionPolicy?: "retain-exact-unresolved-original"; mappedTarget?: string }[];
}
export interface ReferenceRebuildEdit { rowId: string; text: string[]; labels?: { marker: string; label: string }[] }
export interface RebuildNumberProof { rowId: string; partIndex: number; source: string[]; before: string[]; after: string[]; restored: boolean }
export interface ReferenceRebuildReceipt {
  version: 1; fieldId: string; documentId: string; sourceHash: string; fieldSourceHash: string;
  proofHash: string; guardFingerprint: string; beforeHash: string;
  systemId: string; emberActive: boolean; emberVersion: string;
  unresolvedSourceRetention?: UnresolvedSourceRetention;
  punctuation?: SourcePunctuationRestoration;
  rows: { rowId: string; unitId: string; partIndices: number[]; beforeHash: string; afterHash: string }[];
  /** Canonical bindings are reconstructed on undo; never caller replacements. */
  referenceMap: RebuildReference[];
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const hash = (value: unknown) => sha256(JSON.stringify(value));
function fail(code = "InvalidReferenceRebuild"): never { throw new Error(`Review.${code}`); }

export function referenceRebuildEnvironment() {
  const module = typeof game === "undefined" ? undefined : game.modules?.get("ember");
  return { systemId: typeof game === "undefined" ? "" : game.system?.id ?? "", emberActive: module?.active === true, emberVersion: module?.version ?? "" };
}
export function assertReferenceRebuildEnvironment(plan: Pick<ReferenceRebuildPlan, "systemId" | "emberActive" | "emberVersion">): void {
  if (!equal(referenceRebuildEnvironment(), { systemId: plan.systemId, emberActive: plan.emberActive, emberVersion: plan.emberVersion })) fail("Conflict");
}

/** Mirror the existing text-plan addresses, then prove the parts against that
 * planner. Only known source Ember renderer gates can make a target optional. */
function sourcePartGates(source: string, format: ReviewSnapshot["fields"][number]["format"], environment: ReturnType<typeof referenceRebuildEnvironment>) {
  const gates = new Map<string, ("dnd5e" | "crucible" | null)[]>();
  if (format !== "html" || !environment.emberActive || environment.emberVersion !== "0.6.2" || !["dnd5e", "crucible"].includes(environment.systemId)) return gates;
  const template = document.createElement("template"); template.innerHTML = source; template.content.normalize();
  const addresses = new Map<Node, string>();
  const visit = (node: Node, path: string) => { addresses.set(node, path); [...node.childNodes].forEach((child, index) => visit(child, `${path}/${index}`)); };
  visit(template.content, "html");
  const texts = new Map<string, string[]>();
  for (const [node, path] of addresses) {
    if (node.nodeType !== 3 || !node.textContent?.trim() || isDecorativeIconText(node) || node.parentElement?.closest("script,style,code,pre,textarea,noscript,template")) continue;
    const block = node.parentElement?.closest("p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,div,section,article,figcaption,dt,dd");
    const id = block ? addresses.get(block)! : path;
    texts.set(id, [...texts.get(id) ?? [], node.textContent]);
    const branches: Element[] = [], containers: Element[] = [];
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hasAttribute("data-system")) branches.push(ancestor);
      if (ancestor.classList.contains("system-swap-block") || ancestor.classList.contains("system-swap-inline")) containers.push(ancestor);
    }
    let inactive: "dnd5e" | "crucible" | null = null;
    if (branches.length === 1 && containers.length === 1) {
      const branch = branches[0]!, container = containers[0]!, system = branch.getAttribute("data-system");
      const knownShape = branch.parentElement === container &&
        ((container.tagName === "DIV" && container.classList.contains("system-swap-block") && !container.classList.contains("system-swap-inline") && branch.tagName === "DIV") ||
         (container.tagName === "SUP" && container.classList.contains("system-swap-inline") && !container.classList.contains("system-swap-block") && branch.tagName === "SUB"));
      if (knownShape && (system === "dnd5e" || system === "crucible") && system !== environment.systemId) inactive = system;
    }
    gates.set(id, [...gates.get(id) ?? [], inactive]);
  }
  for (const unit of planReviewText(source, format).units) {
    if (!unit.attribute && !equal(texts.get(unit.id), unit.parts)) fail();
  }
  return gates;
}

function prosePartNumbers(part: string): string[] {
  // Reference resolver fallback labels are editable only in this rebuild mode;
  // the ordinary draft parser intentionally keeps them opaque.
  const values = proseNumbers([part]);
  for (const [, label] of part.matchAll(/&(?:amp;)?[Rr]eference\[[^\]\r\n]*\]\{([^}\r\n]*)\}/gu)) {
    values.push(...[...label!.matchAll(/\p{N}+(?:[.,]\p{N}+)*/gu)].map(match => match[0]));
  }
  return values.sort();
}

/** Resolve forward only from the stored, uniquely inverted translation provenance.
 * No current label/occurrence order participates in a source target identity. */
function forwardTarget(snapshot: ReviewSnapshot, sourceTarget: string): string {
  const roots = [...new Set(snapshot.reverse.values())].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const bare = sourceTarget.split("#")[0]!;
  const root = roots.find(root => bare === root || bare.startsWith(`${root}.`));
  if (!root) return sourceTarget; // Exact original target, checked by the live/save layer.
  const copies = [...snapshot.reverse].filter(([, source]) => source === root).map(([copy]) => copy);
  if (copies.length !== 1) fail();
  return copies[0]! + sourceTarget.slice(root.length);
}

function mapSourceCommand(snapshot: ReviewSnapshot, context: string, command: string, inactiveSystem?: "dnd5e" | "crucible", retention?: UnresolvedSourceRetention): { retentionPolicy?: "retain-exact-unresolved-original"; mappedTarget?: string; command: string; sourceTarget?: string; target?: string; required?: boolean; inactiveSystem?: "dnd5e" | "crucible" } {
  const parsed = /^(@(?:UUID|Embed)\[)([^\S\r\n]*)([^\]\s]+)([^\]\r\n]*\](?:\{[^}\r\n]*\})?)$/iu.exec(command);
  if (!parsed) return { command };
  const sourceTarget = absoluteReference(parsed[3]!, context);
  if (!sourceTarget || sourceTarget.includes("=")) fail();
  const mappedTarget = inactiveSystem ? sourceTarget : forwardTarget(snapshot, sourceTarget);
  const retained = retention?.mappings.find(m => m.sourceTarget === sourceTarget);
  if (retained && (inactiveSystem || retained.mappedTarget !== mappedTarget || retained.retainedTarget !== sourceTarget)) fail("Conflict");
  const target = retained ? sourceTarget : mappedTarget;
  // Rebuilding is source-owned, so each occurrence has its exact lexical
  // spelling even when the source mixes relative and absolute aliases of one
  // destination. A relative token is safe in the copy only if it resolves to
  // the same uniquely mapped target there. Keep the absolute target in the
  // plan/receipt for the independent existence guard; never choose a copy from
  // labels, occurrence order, or a caller-supplied replacement UUID.
  const sourceRoot = snapshot.entry.sourceUuid;
  const copiedContext = context === sourceRoot || context.startsWith(`${sourceRoot}.`)
    ? snapshot.entry.uuid + context.slice(sourceRoot.length) : null;
  if (parsed[3]!.startsWith(".") && !copiedContext) fail();
  const notation = parsed[3]!.startsWith(".") && copiedContext && absoluteReference(parsed[3]!, copiedContext) === target
    ? parsed[3]! : target;
  return { command: `${parsed[1]}${parsed[2]}${notation}${parsed[4]}`, sourceTarget, target, required: !inactiveSystem, ...(inactiveSystem ? { inactiveSystem } : {}), ...(retained ? { retentionPolicy: "retain-exact-unresolved-original" as const, mappedTarget } : {}) };
}

/** Refuse changes to existing embedded descriptions in this first rebuild mode.
 * Their translation cannot be matched by display position or reverted to English. */
function assertUnchangedEmbedOptions(snapshot: ReviewSnapshot, field: ReviewSnapshot["fields"][number], source: string, before: string): void {
  const sourceEmbeds = [...source.matchAll(FOUNDRY_EXPRESSION)].map(match => match[0]).filter(command => /^@Embed\[/iu.test(command));
  const currentEmbeds = [...before.matchAll(FOUNDRY_EXPRESSION)].map(match => match[0]).filter(command => /^@Embed\[/iu.test(command));
  for (const sourceCommand of sourceEmbeds) {
    const signature = embedTextOptionSignature(sourceCommand);
    const current = currentEmbeds.filter(command => embedTextOptionSignature(portableReviewText(snapshot, field, command)) === signature);
    if (!signature || current.length !== 1 || !equal(editableEmbedTextOptions(sourceCommand), editableEmbedTextOptions(current[0]!))) fail();
  }
  if (sourceEmbeds.length !== currentEmbeds.length) fail();
}

/** Complete field plan: command-damaged parts or one proved punctuation leaf.
 * Every new marker originates in the authoritative source of that same part. */
export interface ReferenceRebuildDiagnostic {
  stage: string; predicate: string; canPrepare: boolean;
  details?: Record<string, string | number | boolean | null>;
  errorCode?: string; punctuation?: SourcePunctuationDiagnostic;
}
/** Same builder, read-only report; this is not a proof accepted by any write API. */
export async function diagnoseReferenceRebuild(snapshot: ReviewSnapshot, fieldId: string): Promise<ReferenceRebuildDiagnostic> {
  const diagnostic: ReferenceRebuildDiagnostic = { stage: "field", predicate: "not-started", canPrepare: false };
  try {
    const plan = await buildPlan(snapshot, fieldId, diagnostic);
    if (plan) { diagnostic.stage = "ready"; diagnostic.predicate = "complete-plan-proved"; diagnostic.canPrepare = true; }
  } catch (error) {
    // Never return raw exception messages or stacks (may contain application data).
    const code = error instanceof Error && /^Review\.[A-Za-z]+$/u.test(error.message) ? error.message : "InternalDiagnosticError";
    diagnostic.errorCode = code;
  }
  return diagnostic;
}
export async function prepareReferenceRebuild(snapshot: ReviewSnapshot, fieldId: string, retainUnresolvedSourceReferences = false): Promise<ReferenceRebuildPlan | null> {
  if (!retainUnresolvedSourceReferences) { try { return await buildPlan(snapshot, fieldId); } catch { return null; } }
  const strict = await buildPlan(snapshot, fieldId);
  if (!strict) return null;
  const retention = await prepareUnresolvedSourceRetention(snapshot, strict.targets);
  return buildPlan(snapshot, fieldId, undefined, retention);
}
async function buildPlan(snapshot: ReviewSnapshot, fieldId: string, diagnostic?: ReferenceRebuildDiagnostic, retention?: UnresolvedSourceRetention): Promise<ReferenceRebuildPlan | null> {
  const stage = (value: string, predicate: string) => { if (diagnostic) { diagnostic.stage = value; diagnostic.predicate = predicate; } };
  const reject = (predicate: string, details: ReferenceRebuildDiagnostic["details"] = {}): null => {
    if (diagnostic) { diagnostic.predicate = predicate; diagnostic.details = details; }
    return null;
  };
  stage("field", "allowlisted-field-with-nonempty-translation-and-no-warning");
  const field = snapshot.fields.find(field => field.id === fieldId);
  if (!field || snapshot.warning || !field.translation.trim()) return reject("allowlisted-field-with-nonempty-translation-and-no-warning", { fieldFound: !!field, warning: snapshot.warning, nonemptyTranslation: !!field?.translation.trim() });
  // The only markup repair admitted here is a separately proved source-owned
  // punctuation leaf. Normal validation below still checks the complete field.
  stage("punctuation", "raw-punctuation-proof");
  const punctuationTrace: { value?: SourcePunctuationDiagnostic } = {};
  const punctuation = field.format === "html" ? restoreSourcePunctuation(field.source, field.translation, diagnostic ? punctuationTrace : undefined, referenceRebuildEnvironment()) : null;
  if (diagnostic && punctuationTrace.value) diagnostic.punctuation = punctuationTrace.value;
  const alignedTranslation = punctuation?.value ?? field.translation;
  stage("canonical-integrity", "portable-reference-notation-and-structure");
  const canonical = portableReviewText(snapshot, field, alignedTranslation);
  const integrity = diagnosePortableText(field.source, canonical, field.format);
  // A punctuation-only repair needs no command defect: restoring the proved
  // leaf can already make the complete field portable. Its text is immutable
  // in materializeReferenceRebuild, while every unrelated part stays exact.
  if (!integrity && !punctuation) return reject("repair-required");
  if (integrity && (integrity.markup.length || integrity.markupTruncated || integrity.commands.truncated ||
      (!integrity.commands.missing.length && !integrity.commands.extra.length))) return reject("only-command-defects-after-proved-punctuation", { markup: integrity.markup.length, markupTruncated: integrity.markupTruncated, commandTruncated: integrity.commands.truncated, missingCommands: integrity.commands.missing.length, extraCommands: integrity.commands.extra.length });
  const sourcePlan = planReviewText(field.source, field.format), currentPlan = planReviewText(alignedTranslation, field.format);
  const beforePlan = planReviewText(field.translation, field.format);
  stage("source-gates", "source-part-addresses-match-planner");
  const environment = referenceRebuildEnvironment(), gates = sourcePartGates(field.source, field.format, environment);
  const sourceRequirements = new Map<string, boolean>();
  const classifiedOccurrences = new Map<string, number>();
  // An active or ungated occurrence anywhere in the source field defeats the
  // exception, even when that paragraph is already translated and not rebuilt.
  for (const unit of sourcePlan.units) for (const [partIndex, part] of unit.parts.entries()) {
    const inactive = gates.get(unit.id)?.[partIndex] ?? null;
    for (const [command] of part.matchAll(FOUNDRY_EXPRESSION)) {
      const target = /^@(?:UUID|Embed)\[[^\S\r\n]*([^\]\s]+)/iu.exec(command)?.[1];
      const canonical = target && absoluteReference(target, field.referenceContext ?? snapshot.entry.sourceUuid);
      if (canonical) { const key = canonical.split("#")[0]!; sourceRequirements.set(key, (sourceRequirements.get(key) ?? false) || !inactive); classifiedOccurrences.set(key, (classifiedOccurrences.get(key) ?? 0) + 1); }
    }
  }
  // Immutable attributes/excluded nodes are not editable text parts. An
  // unclassified occurrence can never silently inherit another part's gate.
  const allOccurrences = new Map<string, number>();
  for (const [command] of field.source.matchAll(FOUNDRY_EXPRESSION)) {
    const target = /^@(?:UUID|Embed)\[[^\S\r\n]*([^\]\s]+)/iu.exec(command)?.[1];
    const canonical = target && absoluteReference(target, field.referenceContext ?? snapshot.entry.sourceUuid);
    if (canonical) { const key = canonical.split("#")[0]!; allOccurrences.set(key, (allOccurrences.get(key) ?? 0) + 1); }
  }
  for (const [target, count] of allOccurrences) if (count > (classifiedOccurrences.get(target) ?? 0)) sourceRequirements.set(target, true);
  if (field.format === "html") {
    const template = document.createElement("template"); template.innerHTML = field.source;
    for (const element of template.content.querySelectorAll("[data-uuid]")) {
      const canonical = absoluteReference(element.getAttribute("data-uuid")!.trim(), field.referenceContext ?? snapshot.entry.sourceUuid);
      if (canonical) sourceRequirements.set(canonical.split("#")[0]!, true);
    }
  }
  stage("field-rows", "unit-count-and-unique-complete-blocked-rows");
  const fieldRows = snapshot.rows.filter(row => row.fieldId === fieldId);
  if (sourcePlan.units.length !== currentPlan.units.length || fieldRows.length !== sourcePlan.units.length ||
      new Set(fieldRows.map(row => row.id)).size !== fieldRows.length || new Set(fieldRows.map(row => row.unitId)).size !== fieldRows.length ||
      fieldRows.some(row => row.blocked !== "StructureChanged")) return reject("unit-count-and-unique-complete-blocked-rows", { sourceUnits: sourcePlan.units.length, currentUnits: currentPlan.units.length, fieldRows: fieldRows.length, uniqueRowIds: new Set(fieldRows.map(row => row.id)).size, uniqueUnitIds: new Set(fieldRows.map(row => row.unitId)).size, allStructureChanged: fieldRows.every(row => row.blocked === "StructureChanged") });
  const rows: ReferenceRebuildRow[] = [], targets: ReferenceRebuildPlan["targets"] = [];
  for (const sourceUnit of sourcePlan.units) {
    stage("unit-alignment", "unit-and-row-source-current-exact");
    const currentUnit = currentPlan.units.find(unit => unit.id === sourceUnit.id);
    const beforeUnit = beforePlan.units.find(unit => unit.id === sourceUnit.id);
    const row = fieldRows.find(row => row.unitId === sourceUnit.id);
    if (!currentUnit || !beforeUnit || !row || row.format !== field.format || sourceUnit.parts.length !== currentUnit.parts.length ||
        !equal(row.source, sourceUnit.parts) || !equal(row.translation, beforeUnit.parts)) return reject("unit-and-row-source-current-exact", { unitId: sourceUnit.id, currentFound: !!currentUnit, beforeFound: !!beforeUnit, rowFound: !!row, formatEqual: row?.format === field.format, sourceParts: sourceUnit.parts.length, currentParts: currentUnit?.parts.length ?? -1, beforeParts: beforeUnit?.parts.length ?? -1, rowSourceEqual: !!row && equal(row.source, sourceUnit.parts), rowCurrentEqual: !!row && !!beforeUnit && equal(row.translation, beforeUnit.parts) });
    const partIndices = sourceUnit.parts.flatMap((part, index) => equal(syntaxExpressions(part), syntaxExpressions(portableReviewText(snapshot, field, currentUnit.parts[index]!))) ? [] : [index]);
    if (punctuation?.proof.unitId === sourceUnit.id && !partIndices.includes(punctuation.proof.partIndex)) partIndices.push(punctuation.proof.partIndex);
    partIndices.sort((a, b) => a - b);
    if (!partIndices.length) continue;
    if (sourceUnit.attribute) return reject("affected-unit-is-not-prose-attribute", { unitId: sourceUnit.id });
    const baseline = [...currentUnit.parts];
    const mapped = new Map<number, ReturnType<typeof mapSourceCommand>[]>();
    for (const partIndex of partIndices) {
      const part = sourceUnit.parts[partIndex]!;
      stage("embed-options", "source-current-embed-options-uniquely-bound-and-unchanged");
      assertUnchangedEmbedOptions(snapshot, field, part, currentUnit.parts[partIndex]!);
      stage("source-command-map", "exact-source-command-forward-provenance");
      const refs: ReturnType<typeof mapSourceCommand>[] = [];
      baseline[partIndex] = part.replace(FOUNDRY_EXPRESSION, command => {
        const rawTarget = /^@(?:UUID|Embed)\[[^\S\r\n]*([^\]\s]+)/iu.exec(command)?.[1];
        const canonical = rawTarget && absoluteReference(rawTarget, field.referenceContext ?? snapshot.entry.sourceUuid);
        const gate = gates.get(sourceUnit.id)?.[partIndex] ?? undefined;
        const inactive = gate && canonical && sourceRequirements.get(canonical.split("#")[0]!) === false ? gate : undefined;
        const ref = mapSourceCommand(snapshot, field.referenceContext ?? snapshot.entry.sourceUuid, command, inactive, retention);
        refs.push(ref); if (ref.target && ref.sourceTarget) targets.push({ sourceTarget: ref.sourceTarget, target: ref.target, required: ref.required !== false, ...(ref.inactiveSystem ? { inactiveSystem: ref.inactiveSystem } : {}), ...(ref.retentionPolicy ? { retentionPolicy: ref.retentionPolicy, mappedTarget: ref.mappedTarget! } : {}) });
        return ref.command;
      });
      // Source text with command-like corruption is not a safe rebuilding authority.
      if (/&(?:amp;)?(?![Rr]eference\[)[\p{L}][\p{L}\p{N}_]*\[/u.test(baseline[partIndex]!)) return reject("source-has-no-unknown-command-prefix", { unitId: sourceUnit.id, partIndex });
      mapped.set(partIndex, refs);
    }
    stage("source-mask", "source-derived-inventory-paired");
    const edit = maskReviewParts(baseline), referenceMap: RebuildReference[] = [];
    for (const partIndex of partIndices) {
      const sourceCommands = [...sourceUnit.parts[partIndex]!.matchAll(FOUNDRY_EXPRESSION)].map(match => match[0]);
      edit.references[partIndex]!.forEach((reference, index) => {
        // Existing Reference brace labels are prose, but its braces must survive
        // full source validation. This does not change ordinary editor behavior.
        const resolver = /^&(?:amp;)?[Rr]eference\[[^\]\r\n]+\]\{([^}\r\n]*)\}$/u.exec(reference.command);
        if (resolver) { reference.editable = true; reference.label = resolver[1]!; }
        referenceMap.push({ partIndex, marker: reference.marker, sourceCommand: sourceCommands[index]!, ...mapped.get(partIndex)![index]! });
      });
    }
    rows.push({ rowId: row.id, unitId: row.unitId, partIndices, source: [...sourceUnit.parts], before: [...row.translation], baseline, edit, referenceMap,
      ...(punctuation?.proof.unitId === sourceUnit.id ? { alignedBefore: [...currentUnit.parts] } : {}) });
  }
  stage("plan-bounds", "nonempty-at-most-50-rows-and-120000-prose-chars");
  if (!rows.length || rows.length > 50 || rows.reduce((sum, row) => sum + row.source.join("").length + row.before.join("").length, 0) > 120000) return reject("nonempty-at-most-50-rows-and-120000-prose-chars", { affectedRows: rows.length, proseChars: rows.reduce((sum, row) => sum + row.source.join("").length + row.before.join("").length, 0) });
  stage("final-field-proof", "all-source-derived-replacements-pass-full-portable-validation");
  const value = replaceRows(alignedTranslation, field.format, rows.map(row => ({ unitId: row.unitId, parts: row.baseline })));
  assertPortableText(field.source, portableReviewText(snapshot, field, value), field.format);
  stage("proof-hash", "deterministic-plan-hash");
  const body = { version: 1 as const, documentId: snapshot.entry.uuid, sourceHash: snapshot.sourceHash, fieldId,
    fieldSourceHash: await hash(field.source), beforeHash: await hash(field.translation), guardFingerprint: snapshot.guard.fingerprint,
    ...environment, ...(retention ? { unresolvedSourceRetention: retention } : {}), ...(punctuation ? { punctuation: punctuation.proof } : {}), rows, targets: targets.filter((target, index) => targets.findIndex(other => equal(other, target)) === index) };
  return { ...body, proofHash: await hash(body) };
}

function replaceRows(value: string, format: ReviewSnapshot["fields"][number]["format"], rows: { unitId: string; parts: string[] }[]): string {
  // One shared plan retains earlier replacements while compiling the atomic field.
  const plan = planReviewText(value, format);
  let result = value;
  for (const row of rows) result = plan.replace(row.unitId, row.parts);
  return result;
}

/** Compile only prose/labels through the fresh source-owned inventory. */
export async function materializeReferenceRebuild(snapshot: ReviewSnapshot, plan: ReferenceRebuildPlan, edits: ReferenceRebuildEdit[], restoreSourceNumbers = false) {
  const fresh = await prepareReferenceRebuild(snapshot, plan.fieldId, !!plan.unresolvedSourceRetention);
  if (!fresh || !equal(plan, fresh)) fail("Conflict");
  if (edits.length !== fresh.rows.length || new Set(edits.map(edit => edit.rowId)).size !== edits.length) fail();
  const changes: ReviewChange[] = [], numbers: RebuildNumberProof[] = [];
  for (const row of fresh.rows) {
    const edit = edits.find(edit => edit.rowId === row.rowId);
    if (!edit || edit.text.length !== row.baseline.length || edit.text.some(text => typeof text !== "string" || !text.trim()) || edit.text.join("").length > 60000) fail();
    const draft = structuredClone(row.edit), editableParts = new Set(row.partIndices), known = new Set(draft.references.flat().map(ref => ref.marker));
    for (const [index, text] of edit.text.entries()) {
      if (fresh.punctuation?.unitId === row.unitId && fresh.punctuation.partIndex === index && text !== row.edit.text[index]) fail("ProtectedText");
      if (!editableParts.has(index) && text !== row.edit.text[index]) fail("ProtectedText");
      if (/(?:@[\p{L}][\p{L}\p{N}]*|&(?:amp;)?[\p{L}][\p{L}\p{N}_]*)\[|\[\[|__FT[NGS]_/u.test(text)) fail("ReferenceChanged");
      for (const [marker] of text.matchAll(/⟦+[^⟦⟧]*⟧+/gu)) if (!known.has(marker)) fail("ReferenceChanged");
    }
    const labels = new Set<string>();
    for (const label of edit.labels ?? []) {
      const partIndex = draft.references.findIndex(refs => refs.some(ref => ref.marker === label.marker));
      const ref = draft.references[partIndex]?.find(ref => ref.marker === label.marker);
      if (!editableParts.has(partIndex) || !ref?.editable || labels.has(label.marker) || typeof label.label !== "string" || label.label.length > 2000 ||
          /[{}\r\n]|(?:@[\p{L}]|&(?:amp;)?[\p{L}])[^\[]*\[|\[\[|⟦|⟧/u.test(label.label)) fail("ReferenceChanged");
      labels.add(label.marker); ref.label = label.label;
    }
    const parts = restoreReviewParts({ ...draft, text: [...edit.text] });
    const field = snapshot.fields.find(field => field.id === plan.fieldId)!;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      if (!editableParts.has(partIndex)) { if (parts[partIndex] !== (row.alignedBefore ?? row.before)[partIndex]) fail("ProtectedText"); continue; }
      if (!equal(syntaxExpressions(row.source[partIndex]!), syntaxExpressions(portableReviewText(snapshot, field, parts[partIndex]!)))) fail("ReferenceChanged");
      const proof = { rowId: row.rowId, partIndex, source: prosePartNumbers(row.source[partIndex]!), before: prosePartNumbers((row.alignedBefore ?? row.before)[partIndex]!),
        after: prosePartNumbers(parts[partIndex]!), restored: restoreSourceNumbers };
      if (!equal(proof.after, restoreSourceNumbers ? proof.source : proof.before)) fail("NumbersChanged");
      numbers.push(proof);
    }
    changes.push({ rowId: row.rowId, parts });
  }
  const field = snapshot.fields.find(field => field.id === fresh.fieldId)!;
  if (restoreSourceNumbers && !numbers.some(proof => !equal(proof.before, proof.source))) fail("NumbersChanged");
  const punctuation = fresh.punctuation ? restoreSourcePunctuation(field.source, field.translation, undefined, referenceRebuildEnvironment()) : null;
  if (fresh.punctuation && (!punctuation || !equal(punctuation.proof, fresh.punctuation))) fail("Conflict");
  const value = replaceRows(punctuation?.value ?? field.translation, field.format, changes.map(change => ({ unitId: fresh.rows.find(row => row.rowId === change.rowId)!.unitId, parts: change.parts })));
  assertPortableText(field.source, portableReviewText(snapshot, field, value), field.format);
  const receipt: ReferenceRebuildReceipt = { version: 1, fieldId: fresh.fieldId, documentId: fresh.documentId, sourceHash: fresh.sourceHash,
    fieldSourceHash: fresh.fieldSourceHash, proofHash: fresh.proofHash, guardFingerprint: fresh.guardFingerprint, beforeHash: fresh.beforeHash,
    systemId: fresh.systemId, emberActive: fresh.emberActive, emberVersion: fresh.emberVersion,
    ...(fresh.unresolvedSourceRetention ? { unresolvedSourceRetention: fresh.unresolvedSourceRetention } : {}),
    ...(fresh.punctuation ? { punctuation: fresh.punctuation } : {}),
    rows: await Promise.all(fresh.rows.map(async row => ({ rowId: row.rowId, unitId: row.unitId, partIndices: [...row.partIndices],
      beforeHash: await hash(row.before), afterHash: await hash(changes.find(change => change.rowId === row.rowId)!.parts) }))), referenceMap: fresh.rows.flatMap(row => row.referenceMap) };
  return { changes, value, receipt, numbers };
}

/** Independently prove service callers supplied the exact compiled rebuild. */
export async function validateReferenceRebuildChanges(snapshot: ReviewSnapshot, fieldId: string, proofHash: string, changes: readonly ReviewChange[], restoreSourceNumbers = false, retainUnresolvedSourceReferences = false) {
  const plan = await prepareReferenceRebuild(snapshot, fieldId, retainUnresolvedSourceReferences);
  if (!plan || plan.proofHash !== proofHash || changes.length !== plan.rows.length) fail("Conflict");
  const edits = plan.rows.map(row => {
    const change = changes.find(change => change.rowId === row.rowId);
    if (!change) fail();
    // Recover marker labels from already-materialized commands by exact immutable
    // identity, never from collapsed before occurrences. Duplicate identities
    // are equivalent; their arbitrary prose labels cannot choose a different UUID.
    const draft = structuredClone(row.edit);
    const parts = change.parts.map((part, partIndex) => {
      if (!row.partIndices.includes(partIndex)) return row.edit.text[partIndex]!;
      const available = [...draft.references[partIndex]!];
      return part.replace(FOUNDRY_EXPRESSION, command => {
        const candidates = available.filter(ref => equal(syntaxExpressions(ref.command), syntaxExpressions(command)));
        if (!candidates.length) fail("ReferenceChanged");
        const ref = candidates[0]!; available.splice(available.indexOf(ref), 1);
        const resolverLabel = /\{([^}\r\n]*)\}$/u.exec(command)?.[1];
        if (ref.editable) ref.label = resolverLabel ?? "";
        return ref.marker;
      });
    });
    return { rowId: row.rowId, text: parts, labels: draft.references.flat().filter(ref => ref.editable && row.partIndices.some(index => draft.references[index]!.includes(ref))).map(ref => ({ marker: ref.marker, label: ref.label })) };
  });
  const result = await materializeReferenceRebuild(snapshot, plan, edits, restoreSourceNumbers);
  if (!equal(result.changes, changes)) fail("ProtectedText");
  return { ...result, plan };
}

/** Exact receipt-bound inverse; ordinary invalid-field writes remain forbidden. */
export async function undoReferenceRebuild(snapshot: ReviewSnapshot, receipt: ReferenceRebuildReceipt, recorded: { rowId: string; before: string[]; after: string[] }[]) {
  assertReferenceRebuildEnvironment(receipt);
  const field = snapshot.fields.find(field => field.id === receipt.fieldId);
  if (!field || receipt.version !== 1 || receipt.documentId !== snapshot.entry.uuid || receipt.sourceHash !== snapshot.sourceHash ||
      receipt.fieldSourceHash !== await hash(field.source) || receipt.rows.length !== recorded.length) fail("UndoConflict");
  const restore = [] as { unitId: string; parts: string[] }[];
  for (const binding of receipt.rows) {
    const saved = recorded.find(row => row.rowId === binding.rowId), current = snapshot.rows.find(row => row.id === binding.rowId);
    if (!saved || !current || current.fieldId !== receipt.fieldId || current.unitId !== binding.unitId || !equal(current.translation, saved.after) ||
        binding.beforeHash !== await hash(saved.before) || binding.afterHash !== await hash(saved.after)) fail("UndoConflict");
    restore.push({ unitId: current.unitId, parts: saved.before });
  }
  const withoutPunctuation = receipt.punctuation ? removeSourcePunctuation(field.source, field.translation, receipt.punctuation, referenceRebuildEnvironment()) : field.translation;
  if (withoutPunctuation === null) fail("UndoConflict");
  const before = replaceRows(withoutPunctuation, field.format, restore), beforePlan = planReviewText(before, field.format);
  const prior: ReviewSnapshot = { ...snapshot, guard: { ...snapshot.guard, fingerprint: receipt.guardFingerprint },
    fields: snapshot.fields.map(item => item.id === field.id ? { ...item, translation: before } : item),
    rows: snapshot.rows.map(row => row.fieldId === field.id ? { ...row, translation: beforePlan.units.find(unit => unit.id === row.unitId)?.parts ?? [], blocked: "StructureChanged" } : row) };
  // Later unrelated rows may legitimately differ, so the original field before
  // hash/proof is not reused. Re-prove the same damaged scope and source targets.
  const plan = await buildPlan(prior, field.id, undefined, receipt.unresolvedSourceRetention);
  if (!plan || !equal(plan.rows.map(row => ({ rowId: row.rowId, unitId: row.unitId, partIndices: row.partIndices })),
    receipt.rows.map(row => ({ rowId: row.rowId, unitId: row.unitId, partIndices: row.partIndices }))) || !equal(plan.rows.flatMap(row => row.referenceMap), receipt.referenceMap) || !equal(plan.punctuation, receipt.punctuation)) fail("UndoConflict");
  const { proofHash: _proof, ...body } = plan;
  if (await hash({ ...body, beforeHash: receipt.beforeHash }) !== receipt.proofHash) fail("UndoConflict");
  return { fieldId: field.id, value: before };
}
