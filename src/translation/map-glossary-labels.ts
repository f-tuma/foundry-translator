import type { GlossaryEntry } from "../glossary/types";

const key = (text: string) => text.normalize("NFC").trim().toLocaleLowerCase();

/** Exact whole labels only. A substring or ambiguous alias must never rename a
 * map location. Maps use the glossary's canonical name, without inflection. */
export function mapGlossaryLabels(entries: readonly GlossaryEntry[]): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.enabled === false || !entry.source.trim() || !entry.replacement.trim()) continue;
    for (const original of [entry.source, ...entry.aliases]) {
      const normalized = key(original);
      if (!normalized) continue;
      const choices = candidates.get(normalized) ?? new Set<string>();
      choices.add(entry.replacement);
      candidates.set(normalized, choices);
    }
  }
  return new Map([...candidates].flatMap(([original, choices]) =>
    choices.size === 1 ? [[original, [...choices][0]!] as [string, string]] : []));
}

export function mapGlossaryLabel(labels: ReadonlyMap<string, string>, source: string): string | null {
  return labels.get(key(source)) ?? null;
}
