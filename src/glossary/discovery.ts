import type { GlossaryCategory, GlossaryEntry } from "./types";

export interface NamedWorldDocument {
  name?: string | null;
  uuid?: string;
  type?: string;
  pages?: { contents?: NamedWorldDocument[] };
  flags?: Record<string, Record<string, unknown>>;
}
export interface GlossaryDiscoverySources {
  actors: Iterable<NamedWorldDocument>;
  scenes: Iterable<NamedWorldDocument>;
  journals?: Iterable<NamedWorldDocument>;
}

// Only semantic entity pages. Quest titles, class names and ordinary headings
// are prose/game terminology, not a reliable source of proper names.
const EMBER_ENTITY_TYPES: Record<string, GlossaryCategory> = {
  "ember.location": "location",
  "ember.biome": "location",
  "ember.cosmos": "location",
  "ember.organization": "faction",
  "ember.deity": "deity",
  "ember.lore": "lore",
  "ember.culture": "lore",
};

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
    if (document.flags?.["foundry-translate"]?.actorTranslation) continue;
    const creature = document.flags?.ember?.discoverable === "creature";
    const entry = entryFromDocument(document, creature ? "term" : document.type === "group" ? "faction" : "character");
    // Ember distinguishes named characters from creature templates. Keep the
    // latter discoverable in the glossary, but let their ordinary names translate.
    if (entry && creature) entry.enabled = false;
    if (entry) discovered.set(normalizeKey(entry.source), entry);
  }

  for (const document of sources.scenes) {
    const entry = entryFromDocument(document, "location");
    if (entry && !discovered.has(normalizeKey(entry.source))) {
      discovered.set(normalizeKey(entry.source), entry);
    }
  }

  for (const journal of sources.journals ?? []) {
    if (journal.flags?.["foundry-translate"]?.translation) continue;
    for (const page of journal.pages?.contents ?? []) {
      const category = EMBER_ENTITY_TYPES[page.type ?? ""];
      if (!category) continue;
      const entry = entryFromDocument(page, category);
      if (entry && (!discovered.has(normalizeKey(entry.source)) || discovered.get(normalizeKey(entry.source))?.enabled === false || category === "deity" || category === "faction")) {
        discovered.set(normalizeKey(entry.source), entry);
      }
    }
  }

  return [...discovered.values()].sort((left, right) =>
    left.source.localeCompare(right.source, undefined, { sensitivity: "base" }),
  );
}

export function discoverWorldGlossary(): GlossaryEntry[] {
  const entries = discoverGlossaryEntries({
    actors: game.actors?.contents ?? [],
    scenes: game.scenes?.contents ?? [],
    journals: game.journal?.contents ?? [],
  });
  if (game.modules?.get("ember")?.active && !entries.some((entry) => entry.source === "Ember")) {
    entries.push({ source: "Ember", replacement: "Ember", category: "lore", aliases: [] });
  }
  return entries;
}
