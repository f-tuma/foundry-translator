import type { GlossaryEntry } from "./types";

export interface GlossaryCandidate {
  id: string;
  source: string;
  replacement: string;
  previousTranslation: string;
  documentName: string;
  fieldName: string;
  createdAt: string;
}

export interface CorrectionCandidateInput {
  sourceText: string;
  generatedText: string;
  correctedText: string;
  glossary: readonly GlossaryEntry[];
  documentName: string;
  fieldName: string;
  id?: string;
  createdAt?: string;
}

function visibleText(value: string): string {
  if (!/[<>]/u.test(value)) return value;
  const container = document.createElement("div");
  container.innerHTML = value;
  return container.textContent ?? "";
}

function tokens(value: string): string[] {
  return value.match(/[\p{L}\p{N}'’.-]+|\s+|[^\s\p{L}\p{N}'’.-]+/gu) ?? [];
}

function trimSpan(value: string): string {
  return value.replace(/^\s+|\s+$/gu, "").replace(/\s+/gu, " ").trim();
}

function occurrence(source: string, phrase: string): string {
  if (!phrase) return "";
  const index = source.toLocaleLowerCase().indexOf(phrase.toLocaleLowerCase());
  return index < 0 ? "" : source.slice(index, index + phrase.length);
}

/** Extracts one conservative changed phrase. Ambiguous source terms stay blank for review. */
export function extractCorrectionCandidate(
  input: CorrectionCandidateInput,
): GlossaryCandidate | null {
  const generated = tokens(visibleText(input.generatedText));
  const corrected = tokens(visibleText(input.correctedText));
  if (generated.join("") === corrected.join("")) return null;

  let start = 0;
  while (start < generated.length && start < corrected.length && generated[start] === corrected[start]) {
    start += 1;
  }
  let generatedEnd = generated.length;
  let correctedEnd = corrected.length;
  while (
    generatedEnd > start && correctedEnd > start &&
    generated[generatedEnd - 1] === corrected[correctedEnd - 1]
  ) {
    generatedEnd -= 1;
    correctedEnd -= 1;
  }

  const previousTranslation = trimSpan(generated.slice(start, generatedEnd).join(""));
  const replacement = trimSpan(corrected.slice(start, correctedEnd).join(""));
  const changedWordCount = tokens(replacement).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  if (!previousTranslation || !replacement || replacement.length > 160 || changedWordCount > 10) {
    return null;
  }

  const sourceText = visibleText(input.sourceText);
  const glossarySource = input.glossary.find(
    (entry) => entry.replacement.toLocaleLowerCase() === previousTranslation.toLocaleLowerCase(),
  )?.source;
  const source = glossarySource ?? occurrence(sourceText, previousTranslation);

  return {
    id: input.id ?? crypto.randomUUID(),
    source,
    replacement,
    previousTranslation,
    documentName: input.documentName,
    fieldName: input.fieldName,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function readGlossaryCandidates(value: unknown): GlossaryCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is GlossaryCandidate => {
    if (!candidate || typeof candidate !== "object") return false;
    const item = candidate as Partial<GlossaryCandidate>;
    return [item.id, item.source, item.replacement, item.previousTranslation,
      item.documentName, item.fieldName, item.createdAt].every((entry) => typeof entry === "string");
  });
}
