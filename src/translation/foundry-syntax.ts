import type { GlossaryEntry } from "../glossary/types";

const FOUNDRY_REFERENCE = /@[A-Za-z][A-Za-z0-9]*\[[^\]\r\n]*\]/gu;
const INLINE_ROLL = /\[\[[^\]\r\n]*\]\]/gu;

export function foundrySyntaxEntries(text: string): GlossaryEntry[] {
  const syntax = new Set<string>();
  for (const match of text.matchAll(FOUNDRY_REFERENCE)) syntax.add(match[0]);
  for (const match of text.matchAll(INLINE_ROLL)) syntax.add(match[0]);
  return [...syntax].map((source) => ({
    source,
    replacement: source,
    category: "term",
    aliases: [],
  }));
}
