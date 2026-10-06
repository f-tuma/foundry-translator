export const LIVE_PROTOCOL = 1;
export const LIVE_PORT = 3112;
export type LiveMethod = "prepare_machine_proofreading" | "commit_machine_proofreading" | "status" | "list_documents" | "list_passages" | "get_context" | "get_context_batch" | "get_field_diagnostic" | "get_reference_context" | "search_passages" | "list_glossary" | "validate_correction" | "save_correction" | "validate_reference_identifiers" | "restore_reference_identifiers" | "prepare_reference_rebuild" | "validate_reference_rebuild" | "apply_reference_rebuild" | "list_history" | "undo_correction";
export interface LiveArgs {
  documentId?: string; rowId?: string; rowIds?: string[]; revision?: string; operationId?: string;
  fieldId?: string; planHash?: string; coverageHash?: string;
  edits?: { rowId: string; text: string[]; labels?: { marker: string; label: string }[] }[];
  text?: string[]; labels?: { marker: string; label: string }[]; reason?: string;
  options?: { marker: string; key: "readaloud" | "caption" | "label"; value: string }[];
  restoreSourceNumbers?: boolean;
  restoreSourceReferences?: boolean;
  referenceIndex?: number;
  offset: number; limit: number; query: string; radius: number; fuzzy: boolean;
}
export interface LiveRequest { id: string; method: LiveMethod; args: Record<string, unknown> }
export interface LiveResult { ok: boolean; value?: unknown; error?: { code: string; message: string; documentId?: string; rowId?: string; fieldId?: string; retry?: string } }
export interface LiveClaim { protocol: number; worldId: string; worldName: string; userId: string; language: string; systemId: string; moduleVersion: string; clientId: string }
const methods: readonly string[] = ["prepare_machine_proofreading", "commit_machine_proofreading", "status", "list_documents", "list_passages", "get_context", "get_context_batch", "get_field_diagnostic", "get_reference_context", "search_passages", "list_glossary", "validate_correction", "save_correction", "validate_reference_identifiers", "restore_reference_identifiers", "prepare_reference_rebuild", "validate_reference_rebuild", "apply_reference_rebuild", "list_history", "undo_correction"];
const keys = new Set(["documentId", "rowId", "rowIds", "revision", "operationId", "text", "labels", "options", "reason", "offset", "limit", "query", "radius", "fuzzy", "restoreSourceNumbers", "restoreSourceReferences", "referenceIndex", "fieldId", "planHash", "edits", "coverageHash"]);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function parseLiveRequest(value: unknown): { request: LiveRequest; args: LiveArgs } {
  const fail = (): never => { throw new Error("Live.InvalidRequest"); };
  if (!object(value) || typeof value.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/u.test(value.id) || !methods.includes(String(value.method)) || !object(value.args)) fail();
  const request = value as unknown as LiveRequest, input = request.args;
  if (Object.keys(input).some(key => !keys.has(key))) fail();
  if (["validate_reference_identifiers", "restore_reference_identifiers"].includes(request.method)) {
    const allowed = new Set(["documentId", "rowId", "revision", "reason", ...(request.method === "restore_reference_identifiers" ? ["operationId"] : [])]);
    if (Object.keys(input).some(key => !allowed.has(key))) fail();
    if (!input.documentId || !input.rowId || !input.revision || typeof input.reason !== "string" || input.reason.trim().length < 5 ||
      (request.method === "restore_reference_identifiers" && !input.operationId)) fail();
  }
  const fieldDiagnostic = request.method === "get_field_diagnostic";
  if (fieldDiagnostic) {
    const allowed = new Set(["documentId", "fieldId", "revision", "offset", "limit"]);
    if (Object.keys(input).some(key => !allowed.has(key)) || !input.documentId || !input.fieldId || !input.revision) fail();
  }
  const rebuild = ["prepare_reference_rebuild", "validate_reference_rebuild", "apply_reference_rebuild"].includes(request.method);
  if (rebuild) {
    const preparing = request.method === "prepare_reference_rebuild";
    const allowed = new Set(["documentId", "fieldId", "revision", ...(preparing ? [] : ["planHash", "edits", "reason", "restoreSourceNumbers"]),
      ...(request.method === "apply_reference_rebuild" ? ["operationId"] : [])]);
    if (Object.keys(input).some(key => !allowed.has(key)) || !input.documentId || !input.fieldId ||
      (!preparing && (!input.revision || !input.planHash || !Array.isArray(input.edits) || !input.edits.length ||
        typeof input.reason !== "string" || input.reason.trim().length < 5)) ||
      (request.method === "apply_reference_rebuild" && !input.operationId)) fail();
  } else if (["fieldId", "planHash", "edits"].some(key => input[key] !== undefined) && !fieldDiagnostic) fail();
  if (request.method === "get_context_batch" && (Object.keys(input).some(key => !["documentId", "rowIds"].includes(key)) || !input.documentId || input.rowIds === undefined)) fail();
  const machine = ["prepare_machine_proofreading", "commit_machine_proofreading"].includes(request.method);
  if (machine) {
    const preparing = request.method === "prepare_machine_proofreading";
    const allowed = new Set(["documentId", ...(preparing ? [] : ["rowIds", "revision", "coverageHash", "reason", "operationId"])]);
    if (Object.keys(input).some(key => !allowed.has(key)) || !input.documentId || (!preparing &&
      (!input.rowIds || !input.revision || !input.coverageHash || !input.operationId || typeof input.reason !== "string" || input.reason.trim().length < 5))) fail();
  } else if (input.coverageHash !== undefined) fail();
  const args: LiveArgs = { offset: 0, limit: 20, query: "", radius: 2, fuzzy: false };
  if (input.rowIds !== undefined) {
    if (!(request.method === "get_context_batch" || request.method === "commit_machine_proofreading") || !Array.isArray(input.rowIds) || input.rowIds.length < 1 || input.rowIds.length > (machine ? 1000 : 10) ||
      input.rowIds.some(id => typeof id !== "string" || !/^[a-f0-9]{64}$/u.test(id)) || new Set(input.rowIds).size !== input.rowIds.length) fail();
    args.rowIds = input.rowIds as string[];
  }
  if (input.referenceIndex !== undefined) {
    if (request.method !== "get_reference_context" || !Number.isSafeInteger(input.referenceIndex) || (input.referenceIndex as number) < 0 || (input.referenceIndex as number) > 1000) fail();
    args.referenceIndex = input.referenceIndex as number;
  }
  for (const key of ["restoreSourceNumbers", "restoreSourceReferences"] as const) if (input[key] !== undefined) {
    if (typeof input[key] !== "boolean" || !(["validate_correction", "save_correction"].includes(request.method) || (key === "restoreSourceNumbers" && rebuild && request.method !== "prepare_reference_rebuild"))) fail();
    args[key] = input[key] as boolean;
  }
  for (const key of ["offset", "limit", "radius"] as const) if (input[key] !== undefined) {
    const n = input[key]; if (typeof n !== "number" || !Number.isSafeInteger(n) || n < (key === "limit" ? 1 : 0) || n > (key === "limit" ? 50 : key === "radius" ? 5 : 100000)) fail();
    args[key] = n as number;
  }
  if (input.fuzzy !== undefined) { if (typeof input.fuzzy !== "boolean") fail(); args.fuzzy = input.fuzzy as boolean; }
  if (input.query !== undefined) { if (typeof input.query !== "string" || input.query.length > 160) fail(); args.query = input.query as string; }
  for (const key of ["documentId", "rowId", "revision", "operationId", "reason", "fieldId", "planHash", "coverageHash"] as const) if (input[key] !== undefined) {
    const s = input[key]; if (typeof s !== "string" || !s.trim() || s.length > (key === "reason" ? 3000 : key === "fieldId" ? 1000 : 500)) fail();
    args[key] = s as string;
  }
  for (const key of ["rowId", "revision", "planHash", "coverageHash"] as const) if (args[key] && !/^[a-f0-9]{64}$/u.test(args[key]!)) fail();
  if (args.operationId && !/^[a-zA-Z0-9-]{1,80}$/u.test(args.operationId)) fail();
  if (input.edits !== undefined) {
    if (!rebuild || request.method === "prepare_reference_rebuild" || !Array.isArray(input.edits) || input.edits.length < 1 || input.edits.length > 100) fail();
    for (const edit of input.edits as Record<string, unknown>[]) {
      if (!object(edit) || Object.keys(edit).some(key => !["rowId", "text", "labels"].includes(key)) ||
        typeof edit.rowId !== "string" || !/^[a-f0-9]{64}$/u.test(edit.rowId) || !Array.isArray(edit.text) ||
        !edit.text.length || edit.text.length > 1000 || edit.text.some(part => typeof part !== "string" || !part.trim()) || edit.text.join("").length > 60000) fail();
      if (edit.labels !== undefined && (!Array.isArray(edit.labels) || edit.labels.length > 1000 || (edit.labels as unknown[]).some(label =>
        !object(label) || Object.keys(label).some(key => !["marker", "label"].includes(key)) || typeof label.marker !== "string" ||
        !label.marker.trim() || label.marker.length > 120 || typeof label.label !== "string" || label.label.length > 2000) ||
        new Set((edit.labels as { marker: string }[]).map(label => label.marker)).size !== edit.labels.length)) fail();
    }
    args.edits = input.edits as NonNullable<LiveArgs["edits"]>;
    if (new Set(args.edits.map(edit => edit.rowId)).size !== args.edits.length || args.edits.reduce((total, edit) =>
      total + edit.text.join("").length + (edit.labels ?? []).reduce((sum, label) => sum + label.label.length, 0), 0) > 120000) fail();
  }
  if (input.text !== undefined) {
    if (!Array.isArray(input.text) || !input.text.length || input.text.length > 1000 || input.text.some(p => typeof p !== "string" || !p.trim()) || input.text.join("").length > 60000) fail();
    args.text = input.text as string[];
  }
  if (input.labels !== undefined) {
    if (!Array.isArray(input.labels) || input.labels.length > 1000 || input.labels.some(l => !object(l) || typeof l.marker !== "string" || l.marker.length > 120 || typeof l.label !== "string" || l.label.length > 2000 || Object.keys(l).some(k => !["marker", "label"].includes(k)))) fail();
    args.labels = input.labels as { marker: string; label: string }[];
    if (args.labels.reduce((total, label) => total + label.label.length, 0) > 60000) fail();
  }
  if (input.options !== undefined) {
    if (!["validate_correction", "save_correction"].includes(request.method) || !Array.isArray(input.options) || input.options.length > 1000 ||
      input.options.some(option => !object(option) || typeof option.marker !== "string" || !option.marker.trim() || option.marker.length > 120 ||
        typeof option.key !== "string" || !["readaloud", "caption", "label"].includes(option.key) || typeof option.value !== "string" ||
        Object.keys(option).some(key => !["marker", "key", "value"].includes(key)))) fail();
    args.options = input.options as NonNullable<LiveArgs["options"]>;
    if (args.options.reduce((total, option) => total + option.value.length, 0) > 60000 ||
      new Set(args.options.map(option => JSON.stringify([option.marker, option.key]))).size !== args.options.length) fail();
  }
  if (["list_passages", "get_context", "get_reference_context", "validate_correction", "save_correction", "list_history", "undo_correction"].includes(request.method) && !args.documentId) fail();
  if (["get_context", "get_reference_context", "validate_correction", "save_correction"].includes(request.method) && !args.rowId) fail();
  if (request.method === "get_reference_context" && args.referenceIndex === undefined) fail();
  if (["validate_correction", "save_correction"].includes(request.method) && (!args.revision || !args.text || !args.reason || args.reason.trim().length < 5)) fail();
  if (["save_correction", "undo_correction"].includes(request.method) && !args.operationId) fail();
  if (request.method === "search_passages" && args.query.trim().length < 2) fail();
  return { request, args };
}
export function liveBridgeAddress(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Live.InvalidAddress"); }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("Live.InvalidAddress");
  return url.origin;
}
