import type { GlossaryEntry } from "./types";

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

interface ProtectionCandidate {
  term: string;
  replacement: string;
}
export interface GlossaryToken {
  token: string;
  source: string;
  replacement: string;
}

export interface GlossaryProtection {
  text: string;
  nonce: string;
  tokens: readonly GlossaryToken[];
}

export interface ProtectGlossaryOptions {
  nonce?: string;
}

export class GlossaryConflictError extends Error {
  constructor(term: string) {
    super(`Glossary term "${term}" has conflicting replacements.`);
    this.name = "GlossaryConflictError";
  }
}

export class GlossaryIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlossaryIntegrityError";
  }
}

function createNonce(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

function assertNonce(nonce: string): void {
  if (!/^[A-Za-z0-9]+$/.test(nonce)) {
    throw new TypeError("Glossary token nonce may contain only ASCII letters and digits.");
  }
}

function collectCandidates(entries: Iterable<GlossaryEntry>): ProtectionCandidate[] {
  const candidates = new Map<string, ProtectionCandidate>();

  for (const entry of entries) {
    const replacement = entry.replacement.normalize("NFC").trim();
    const terms = [entry.source, ...entry.aliases];

    for (const rawTerm of terms) {
      const term = rawTerm.normalize("NFC").trim();
      if (!term || !replacement) continue;

      const existing = candidates.get(term);
      if (existing && existing.replacement !== replacement) {
        throw new GlossaryConflictError(term);
      }
      candidates.set(term, { term, replacement });
    }
  }

  return [...candidates.values()].sort((left, right) =>
    right.term.length - left.term.length || left.term.localeCompare(right.term),
  );
}

function hasValidBoundaries(text: string, start: number, term: string): boolean {
  const end = start + term.length;
  const first = term[0] ?? "";
  const last = term.at(-1) ?? "";
  const before = start > 0 ? text[start - 1] ?? "" : "";
  const after = end < text.length ? text[end] ?? "" : "";

  if (WORD_CHARACTER.test(first) && WORD_CHARACTER.test(before)) return false;
  if (WORD_CHARACTER.test(last) && WORD_CHARACTER.test(after)) return false;
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asciiTokenPattern(token: string): RegExp {
  return new RegExp(escapeRegExp(token), "giu");
}

export function protectGlossaryTerms(
  text: string,
  entries: Iterable<GlossaryEntry>,
  options: ProtectGlossaryOptions = {},
): GlossaryProtection {
  const nonce = (options.nonce ?? createNonce()).toUpperCase();
  assertNonce(nonce);

  const candidates = collectCandidates(entries);
  const candidatesByFirstCharacter = new Map<string, ProtectionCandidate[]>();
  for (const candidate of candidates) {
    const first = candidate.term[0];
    if (!first) continue;
    const group = candidatesByFirstCharacter.get(first) ?? [];
    group.push(candidate);
    candidatesByFirstCharacter.set(first, group);
  }

  const output: string[] = [];
  const tokens: GlossaryToken[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const matches = candidatesByFirstCharacter.get(text[cursor] ?? "") ?? [];
    const candidate = matches.find(
      ({ term }) => text.startsWith(term, cursor) && hasValidBoundaries(text, cursor, term),
    );

    if (!candidate) {
      output.push(text[cursor] ?? "");
      cursor += 1;
      continue;
    }

    const token = `__FTG_${nonce}_${tokens.length.toString(36).toUpperCase().padStart(4, "0")}__`;
    tokens.push({
      token,
      source: candidate.term,
      replacement: candidate.replacement,
    });
    output.push(token);
    cursor += candidate.term.length;
  }

  return { text: output.join(""), nonce, tokens };
}

export function restoreGlossaryTerms(
  translatedText: string,
  protection: GlossaryProtection,
): string {
  const knownTokens = new Set(protection.tokens.map(({ token }) => token.toUpperCase()));
  const tokenPattern = new RegExp(
    `__FTG_${escapeRegExp(protection.nonce)}_[A-Z0-9]+__`,
    "giu",
  );

  for (const found of translatedText.matchAll(tokenPattern)) {
    if (!knownTokens.has(found[0].toUpperCase())) {
      throw new GlossaryIntegrityError(`Translation returned an unknown glossary token: ${found[0]}`);
    }
  }

  let restored = translatedText;
  for (const { token, replacement } of protection.tokens) {
    const pattern = asciiTokenPattern(token);
    const count = [...restored.matchAll(pattern)].length;
    if (count !== 1) {
      throw new GlossaryIntegrityError(
        `Translation must contain glossary token ${token} exactly once; found ${count}.`,
      );
    }
    restored = restored.replace(asciiTokenPattern(token), () => replacement);
  }

  return restored;
}
