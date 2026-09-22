import { translatedOutputHash } from "./output-hash";

export class TranslationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationConflictError";
  }
}

export interface TranslationWriteGuard {
  id: string | null;
  fingerprint: string;
}

type StoredDocument = Pick<FoundryJournalDocument, "id" | "toObject">;

export async function captureTranslationWriteGuard(document: StoredDocument | null): Promise<TranslationWriteGuard | null> {
  if (!document) return null;
  // Wrap the document so flags, IDs and ownership participate in the hash too.
  // Foundry's volatile _stats remain ignored, including in embedded documents.
  return { id: document.id, fingerprint: await translatedOutputHash({ document: document.toObject() }) };
}

/** Reject detected intervening edits; this is not a server-side compare-and-swap. */
export async function assertTranslationWriteGuard(
  document: StoredDocument | null,
  expected: TranslationWriteGuard | null | undefined,
): Promise<void> {
  if (expected === undefined) return;
  const actual = await captureTranslationWriteGuard(document);
  if (actual?.id !== expected?.id || actual?.fingerprint !== expected?.fingerprint) {
    throw new TranslationConflictError(game.i18n.localize("FOUNDRY_TRANSLATE.JournalTranslation.Status.OutputChanged"));
  }
}
