import type { GlossaryEntry } from "./types";
import { normalizeCzechGlossaryForm } from "./inflection";

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

interface ProtectionCandidate {
  term: string;
  replacement: string;
  inflect: boolean;
}
export interface GlossaryToken {
  token: string;
  source: string;
  replacement: string;
  endToken?: string;
}

export interface GlossaryProtection {
  text: string;
  nonce: string;
  tokens: readonly GlossaryToken[];
  opaqueTokens?: readonly string[];
}

export interface ProtectGlossaryOptions {
  nonce?: string;
  /** Already protected syntax is opaque and separates words, even without spaces. */
  opaqueTokens?: readonly string[];
  allowInflection?: boolean;
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
    if (entry.enabled === false) continue;
    const replacement = entry.replacement.normalize("NFC").trim();
    const terms = [entry.source, ...entry.aliases];

    for (const rawTerm of terms) {
      const term = rawTerm.normalize("NFC").trim();
      if (!term || !replacement) continue;

      const existing = candidates.get(term);
      if (existing && (existing.replacement !== replacement || existing.inflect !== (entry.mode === "inflect"))) {
        throw new GlossaryConflictError(term);
      }
      candidates.set(term, { term, replacement, inflect: entry.mode === "inflect" });
    }
  }

  return [...candidates.values()].sort((left, right) =>
    right.term.length - left.term.length || left.term.localeCompare(right.term),
  );
}

/** Validate the entire glossary before persisting changes or starting a run. */
export function validateGlossary(entries: Iterable<GlossaryEntry>): void {
  collectCandidates(entries);
}

function opaqueBefore(text: string, offset: number, tokens: readonly string[]): boolean {
  return tokens.some((token) => offset >= token.length &&
    text.slice(offset - token.length, offset).toUpperCase() === token.toUpperCase());
}

function opaqueAfter(text: string, offset: number, tokens: readonly string[]): boolean {
  return tokens.some((token) =>
    text.slice(offset, offset + token.length).toUpperCase() === token.toUpperCase());
}

function hasValidBoundaries(text: string, start: number, term: string, opaqueTokens: readonly string[]): boolean {
  const end = start + term.length;
  const first = term[0] ?? "";
  const last = term.at(-1) ?? "";
  const before = start > 0 ? text[start - 1] ?? "" : "";
  const after = end < text.length ? text[end] ?? "" : "";

  if (WORD_CHARACTER.test(first) && WORD_CHARACTER.test(before) && !opaqueBefore(text, start, opaqueTokens)) return false;
  if (WORD_CHARACTER.test(last) && WORD_CHARACTER.test(after) && !opaqueAfter(text, end, opaqueTokens)) return false;
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asciiTokenPattern(token: string): RegExp {
  return new RegExp(escapeRegExp(token), "giu");
}

function restoreTokenWithWordBoundaries(
  text: string,
  token: string,
  replacement: string,
  opaqueTokens: readonly string[],
): string {
  const pattern = asciiTokenPattern(token);
  return text.replace(pattern, (matched, offset: number, whole: string) => {
    const before = offset > 0 ? whole[offset - 1] ?? "" : "";
    const after = whole[offset + matched.length] ?? "";
    const needsLeadingSpace = WORD_CHARACTER.test(before) &&
      WORD_CHARACTER.test(replacement[0] ?? "") && !opaqueBefore(whole, offset, opaqueTokens);
    const needsTrailingSpace = WORD_CHARACTER.test(replacement.at(-1) ?? "") &&
      WORD_CHARACTER.test(after) && !opaqueAfter(whole, offset + matched.length, opaqueTokens);
    return `${needsLeadingSpace ? " " : ""}${replacement}${needsTrailingSpace ? " " : ""}`;
  });
}

export function protectGlossaryTerms(
  text: string,
  entries: Iterable<GlossaryEntry>,
  options: ProtectGlossaryOptions = {},
): GlossaryProtection {
  const nonce = (options.nonce ?? createNonce()).toUpperCase();
  assertNonce(nonce);
  const opaqueTokens = [...new Set(options.opaqueTokens?.filter(Boolean) ?? [])];
  const opaqueStarts = new Map<number, string>();
  if (opaqueTokens.length) {
    const pattern = new RegExp(opaqueTokens.map(escapeRegExp).join("|"), "gu");
    for (const match of text.matchAll(pattern)) opaqueStarts.set(match.index, match[0]);
  }

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
    const opaque = opaqueStarts.get(cursor);
    if (opaque) {
      output.push(opaque);
      cursor += opaque.length;
      continue;
    }
    const matches = candidatesByFirstCharacter.get(text[cursor] ?? "") ?? [];
    const candidate = matches.find(
      ({ term }) => text.startsWith(term, cursor) && hasValidBoundaries(text, cursor, term, opaqueTokens),
    );

    if (!candidate) {
      output.push(text[cursor] ?? "");
      cursor += 1;
      continue;
    }

    const token = `__FTG_${nonce}_${tokens.length.toString(36).toUpperCase().padStart(4, "0")}__`;
    const endToken = candidate.inflect && options.allowInflection ? token.replace(/__$/u, "END__") : undefined;
    tokens.push({
      token,
      source: candidate.term,
      replacement: candidate.replacement,
      ...(endToken ? { endToken } : {}),
    });
    output.push(endToken ? `${token}${candidate.replacement}${endToken}` : token);
    cursor += candidate.term.length;
  }

  return { text: output.join(""), nonce, tokens, opaqueTokens };
}

export function restoreGlossaryTerms(
  translatedText: string,
  protection: GlossaryProtection,
): string {
  const knownTokens = new Set(protection.tokens.flatMap(({ token, endToken }) => [token, ...(endToken ? [endToken] : [])]).map(token => token.toUpperCase()));
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
  for (const { token, replacement, endToken } of protection.tokens) {
    const pattern = asciiTokenPattern(token);
    const count = [...restored.matchAll(pattern)].length;
    if (count !== 1) {
      throw new GlossaryIntegrityError(
        `Translation must contain glossary token ${token} exactly once; found ${count}.`,
      );
    }
    if (endToken) {
      const start = [...restored.matchAll(asciiTokenPattern(token))][0]!.index;
      const end = [...restored.matchAll(asciiTokenPattern(endToken))][0]?.index ?? -1;
      if ([...restored.matchAll(asciiTokenPattern(endToken))].length !== 1 || end < start + token.length) {
        throw new GlossaryIntegrityError("Translation lost or reordered an inflected glossary boundary.");
      }
      const inflected = normalizeCzechGlossaryForm(replacement, restored.slice(start + token.length, end));
      if (inflected === null) throw new GlossaryIntegrityError(`Translation renamed the glossary term: ${replacement}`);
      const whole = restored.slice(start, end + endToken.length);
      restored = restoreTokenWithWordBoundaries(restored, whole, inflected, protection.opaqueTokens ?? []);
      continue;
    }
    // Providers occasionally trim whitespace immediately next to a protected
    // token (for example `To__FTG...__dorazilo`). Restore a word boundary
    // around the fixed glossary replacement without adding spaces before
    // punctuation.
    restored = restoreTokenWithWordBoundaries(restored, token, replacement, protection.opaqueTokens ?? []);
  }

  return restored;
}
