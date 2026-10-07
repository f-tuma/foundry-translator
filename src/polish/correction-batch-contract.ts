export const BATCH_ROWS = 10, BATCH_REQUEST_BYTES = 120000, BATCH_RESPONSE_BYTES = 512000;
export interface BatchChange { rowId: string; text: string[]; labels?: { marker: string; label: string }[]; reason: string }
export interface BatchPayload { documentId: string; revision: string; reason: string; changes: BatchChange[] }
export interface BatchReceipt {
  version: 1; payload: BatchPayload; payloadHash: string; planHash: string;
  sourceHash: string; fullSourceHash: string; guardFingerprint: string; glossaryHash: string; catalogHash: string; scope: string;
  rows: { rowId: string; beforeHash: string; afterHash: string; reason: string }[];
  fields: { fieldId: string; sourceHash: string; beforeHash: string; afterHash: string }[];
}
