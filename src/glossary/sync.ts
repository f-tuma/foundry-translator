import type { GlossaryEntry } from "./types";

export interface GlossarySyncPlan {
  create: GlossaryEntry[];
  update: GlossaryEntry[];
  unchanged: GlossaryEntry[];
}

function normalizeKey(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

function sameEntry(left: GlossaryEntry, right: GlossaryEntry): boolean {
  return (
    left.source === right.source &&
    left.replacement === right.replacement &&
    left.category === right.category &&
    left.sourceUuid === right.sourceUuid
  );
}

export type ManualTermPlan =
  | { action: "duplicate" }
  | { action: "create"; entry: GlossaryEntry }
  | { action: "update"; entry: GlossaryEntry };

/**
 * Decides what a manual add of `source` (with an optional custom translation)
 * should do: create a new entry, update the replacement of an existing one,
 * or report a duplicate.
 */
export function planManualTerm(
  stored: readonly GlossaryEntry[],
  source: string,
  replacement: string,
): ManualTermPlan {
  const existing = stored.find(
    (entry) => normalizeKey(entry.source) === normalizeKey(source),
  );
  const wanted = replacement || source;
  if (existing) {
    if (existing.replacement === wanted) return { action: "duplicate" };
    return { action: "update", entry: { ...existing, replacement: wanted } };
  }
  return {
    action: "create",
    entry: { source, replacement: wanted, category: "term", aliases: [] },
  };
}

export function planGlossarySync(
  existing: Iterable<GlossaryEntry>,
  discovered: Iterable<GlossaryEntry>,
): GlossarySyncPlan {
  const existingEntries = [...existing];
  const byUuid = new Map(
    existingEntries
      .filter((entry) => entry.sourceUuid)
      .map((entry) => [entry.sourceUuid as string, entry]),
  );
  const bySource = new Map(
    existingEntries.map((entry) => [normalizeKey(entry.source), entry]),
  );
  const plan: GlossarySyncPlan = { create: [], update: [], unchanged: [] };

  for (const incoming of discovered) {
    const matched =
      (incoming.sourceUuid ? byUuid.get(incoming.sourceUuid) : undefined) ??
      bySource.get(normalizeKey(incoming.source));

    if (!matched) {
      plan.create.push(incoming);
      continue;
    }

    const merged: GlossaryEntry = {
      ...matched,
      source: incoming.source,
      replacement:
        matched.sourceUuid && matched.replacement === matched.source
          ? incoming.replacement
          : matched.replacement,
      category: incoming.category,
      ...((incoming.sourceUuid ?? matched.sourceUuid)
        ? { sourceUuid: incoming.sourceUuid ?? matched.sourceUuid }
        : {}),
    };

    if (sameEntry(matched, merged)) plan.unchanged.push(matched);
    else plan.update.push(merged);
  }

  return plan;
}
