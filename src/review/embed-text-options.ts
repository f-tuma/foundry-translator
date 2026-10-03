import { FOUNDRY_EXPRESSION } from "../translation/foundry-syntax";

export type EmbedTextOptionKey = "readaloud" | "caption" | "label";
export interface EmbedTextOption { key: EmbedTextOptionKey; value: string }
const KEYS = new Set<string>(["readaloud", "caption", "label"]);
const fail = (): never => { throw new Error("Review.ReferenceChanged"); };

/** Native Embed parsing does not support escaped quotes or '=' inside a value.
 * These fields are plain prose, never another HTML or executable syntax channel.
 */
export function safeEmbedOptionText(value: unknown): value is string {
  return typeof value === "string" && value.length <= 60000 && /[\p{L}\p{N}]/u.test(value)
    && !/[<>\[\]{}"=\u0000-\u001f⟦⟧]/u.test(value)
    && !/__FT[CS]_/iu.test(value);
}

interface Slot extends EmbedTextOption { start: number; end: number; editable: boolean }
interface Parsed { config: string; slots: Slot[]; signature: string }

/** Scan top-level tokens; a key name inside another quoted value is not an
 * option. Keep every unedited byte rather than serializing parsed config.
 */
function parse(command: string): Parsed | null {
  const expression = /^@Embed\[([^\]\r\n]*)\](?:\{[^}\r\n]*\})?$/iu.exec(command);
  if (!expression || /[\u0000-\u001f]/u.test(expression[1]!)) return null;
  const body = expression[1]!, config = command.slice(0, command.indexOf("]") + 1);
  const slots: Slot[] = [], seen = new Set<string>();
  let cursor = 0;
  while (cursor < body.length) {
    if (/\s/u.test(body[cursor]!)) { cursor++; continue; }
    const start = cursor;
    let quoted = false;
    while (cursor < body.length) {
      const char = body[cursor]!;
      if (char === '"') quoted = !quoted;
      if (!quoted && /\s/u.test(char)) break;
      cursor++;
    }
    if (quoted) return null;
    const token = body.slice(start, cursor), key = /^([A-Za-z][A-Za-z0-9_-]*)=/u.exec(token)?.[1];
    const quotedValue = /^([A-Za-z][A-Za-z0-9_-]*)="([^"=]*)"$/u.exec(token);
    if (token.includes('"') && !quotedValue) return null;
    if (!key || !KEYS.has(key.toLowerCase())) continue;
    // Native property keys are case-sensitive. Case variants stay immutable;
    // duplicates are ambiguous even if one variant or value is noneditable.
    if (seen.has(key.toLowerCase())) return null;
    seen.add(key.toLowerCase());
    if (!quotedValue || !KEYS.has(key)) continue;
    const value = quotedValue[2]!, valueStart = 7 + start + key.length + 2;
    slots.push({ key: key as EmbedTextOptionKey, value, start: valueStart, end: valueStart + value.length,
      editable: safeEmbedOptionText(value) });
  }
  let signature = config;
  for (const slot of [...slots].reverse()) signature = signature.slice(0, slot.start) + `\u0000${slot.key}\u0000` + signature.slice(slot.end);
  return { config, slots, signature };
}

export function editableEmbedTextOptions(command: string): EmbedTextOption[] {
  return parse(command)?.slots.filter(slot => slot.editable).map(({ key, value }) => ({ key, value })) ?? [];
}

/** Used only for unique source identity proofs, never occurrence-order binding. */
export function embedTextOptionSignature(command: string): string | null { return parse(command)?.signature ?? null; }

export function applyEmbedTextOptions(command: string, options: readonly EmbedTextOption[]): string {
  if (!options.length) return command;
  const parsed = parse(command); if (!parsed) return fail();
  const seen = new Set<string>(), changes: { slot: Slot; value: string }[] = [];
  for (const option of options) {
    const slot = parsed.slots.find(slot => slot.key === option.key);
    if (seen.has(option.key) || !slot?.editable || !safeEmbedOptionText(option.value)) return fail();
    seen.add(option.key); changes.push({ slot, value: option.value });
  }
  let result = command;
  for (const { slot, value } of changes.sort((a, b) => b.slot.start - a.slot.start)) {
    result = result.slice(0, slot.start) + value + result.slice(slot.end);
  }
  return result;
}

interface Record { command: string; config: string; parsed: Parsed | null }
function records(parts: readonly string[]): Record[] {
  const result = parts.flatMap(part => [...part.matchAll(FOUNDRY_EXPRESSION)].filter(match => /^@Embed\[/iu.test(match[0]))
    .map(match => ({ command: match[0], config: match[0].slice(0, match[0].indexOf("]") + 1), parsed: parse(match[0]) })));
  if (result.length > 1000 || result.reduce((size, record) => size + record.command.length, 0) > 1_000_000) return fail();
  return result;
}
function malformedEmbeds(parts: readonly string[]): string[] {
  return parts.flatMap(part => {
    const expressions = [...part.matchAll(FOUNDRY_EXPRESSION)];
    return [...part.matchAll(/@Embed\[/giu)].filter(start => !expressions.some(expression =>
      start.index! >= expression.index! && start.index! < expression.index! + expression[0].length))
      .map(start => part.slice(start.index!));
  }).sort();
}

export interface EmbedOptionChange {
  key: EmbedTextOptionKey; before: string; after: string; command: string; afterCommand: string;
}

/** First cancel exact unchanged configs, then match residual configs by their
 * immutable skeleton. Distinct competing candidates fail closed. Labels and
 * prose are not identity evidence, and marker/occurrence order is irrelevant.
 */
export function embedOptionChanges(beforeParts: readonly string[], afterParts: readonly string[]): EmbedOptionChange[] {
  // The general expression matcher cannot see an unterminated command. Do not
  // let a raw-string caller manufacture or alter one outside its option API.
  if (JSON.stringify(malformedEmbeds(beforeParts)) !== JSON.stringify(malformedEmbeds(afterParts))) return fail();
  const before = records(beforeParts), after = records(afterParts), used = new Set<number>();
  const residual = before.filter(record => {
    const index = after.findIndex((candidate, i) => !used.has(i) && candidate.config === record.config);
    if (index < 0) return true;
    used.add(index); return false;
  });
  const remaining = after.filter((_, i) => !used.has(i));
  if (residual.length !== remaining.length) return fail();
  const groups = new Map<string, { before: Record[]; after: Record[] }>();
  for (const side of ["before", "after"] as const) for (const record of side === "before" ? residual : remaining) {
    if (!record.parsed) return fail();
    const key = record.parsed.signature, group = groups.get(key) ?? { before: [], after: [] };
    group[side].push(record); groups.set(key, group);
  }
  const changes: EmbedOptionChange[] = [];
  for (const group of groups.values()) {
    if (!group.before.length || group.before.length !== group.after.length) return fail();
    if (new Set(group.before.map(record => record.config)).size > 1 && new Set(group.after.map(record => record.config)).size > 1) return fail();
    for (let i = 0; i < group.before.length; i++) {
      const old = group.before[i]!, current = group.after[i]!;
      for (const slot of old.parsed!.slots) {
        const next = current.parsed!.slots.find(next => next.key === slot.key);
        if (!next) return fail();
        if (slot.value === next.value) continue;
        if (!slot.editable || !next.editable) return fail();
        changes.push({ key: slot.key, before: slot.value, after: next.value, command: old.command, afterCommand: current.command });
      }
    }
  }
  return changes;
}

export function assertEmbedOptionEdits(beforeParts: readonly string[], afterParts: readonly string[]): void {
  embedOptionChanges(beforeParts, afterParts);
}
