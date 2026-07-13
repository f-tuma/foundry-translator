import type { GlossaryCategory, GlossaryEntry } from "./types";

export interface NamedWorldDocument {
  name?: string | null;
  uuid?: string;
}
export interface GlossaryDiscoverySources {
  actors: Iterable<NamedWorldDocument>;
  scenes: Iterable<NamedWorldDocument>;
}

function normalizeKey(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

function entryFromDocument(
  document: NamedWorldDocument,
  category: GlossaryCategory,
): GlossaryEntry | null {
  const source = document.name?.normalize("NFC").trim() ?? "";
  if (!source) return null;

  return {
    source,
    replacement: source,
    category,
    aliases: [],
    ...(document.uuid ? { sourceUuid: document.uuid } : {}),
  };
}

export function discoverGlossaryEntries(
  sources: GlossaryDiscoverySources,
): GlossaryEntry[] {
  const discovered = new Map<string, GlossaryEntry>();

  for (const document of sources.actors) {
    const entry = entryFromDocument(document, "character");
    if (entry) discovered.set(normalizeKey(entry.source), entry);
  }

  for (const document of sources.scenes) {
    const entry = entryFromDocument(document, "location");
    if (entry && !discovered.has(normalizeKey(entry.source))) {
      discovered.set(normalizeKey(entry.source), entry);
    }
  }

  return [...discovered.values()].sort((left, right) =>
    left.source.localeCompare(right.source, undefined, { sensitivity: "base" }),
  );
}
