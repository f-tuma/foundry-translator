import type { GlossaryEntry } from "./types";

interface ContextDocument {
  name?: string | null;
  uuid?: string;
  flags?: Record<string, Record<string, unknown>>;
  toObject?(): Record<string, unknown>;
  pages?: { contents?: ContextDocument[] };
}

export interface NameContextSources {
  actors: Iterable<ContextDocument>;
  scenes: Iterable<ContextDocument>;
  journals: Iterable<ContextDocument>;
}

function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  const template = document.createElement("template");
  template.innerHTML = value.slice(0, 48_000);
  template.content.querySelectorAll("script,style,template").forEach((node) => node.remove());
  return [...template.content.childNodes].map((node) => node.textContent ?? "").join(" ")
    .replace(/@(?:UUID|Embed)\[[^\]]+\](?:\{([^}]+)\})?/giu, "$1")
    .replace(/\[\[[^\]]*\]\]/gu, " ")
    .replace(/\s+/gu, " ").trim();
}

function read(data: Record<string, unknown>, path: string): unknown {
  let value: unknown = data;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Use descriptions and nearby mentions; export bounded reference text without mechanics. */
export function collectNameContexts(
  entries: readonly GlossaryEntry[],
  sources: NameContextSources = {
    actors: game.actors?.contents ?? [], scenes: game.scenes?.contents ?? [], journals: game.journal?.contents ?? [],
  },
): Map<string, string> {
  const documents: ContextDocument[] = [...sources.actors, ...sources.scenes];
  for (const journal of sources.journals) {
    if (journal.flags?.["foundry-translate"]?.translation) continue;
    documents.push(...(journal.pages?.contents ?? []));
  }
  const passages = documents.filter((doc) => !doc.flags?.["foundry-translate"]?.actorTranslation).map((doc) => {
    const data = doc.toObject?.() ?? {};
    const text = ["system.overview", "system.exposition", "system.description", "system.details.biography.public", "system.biography", "text.content", "text.markdown"]
      .map((path) => plainText(read(data, path))).filter(Boolean).join(" ");
    return { uuid: doc.uuid, name: doc.name ?? "", text };
  });
  const result = new Map<string, string>();
  for (const entry of entries) {
    const direct = passages.find((p) => p.uuid && p.uuid === entry.sourceUuid);
    const pieces = direct?.text ? [direct.text.slice(0, 700)] : [];
    for (const passage of passages) {
      if (passage === direct || !passage.text) continue;
      const index = passage.text.toLowerCase().indexOf(entry.source.toLowerCase());
      if (index < 0) continue;
      pieces.push(`${passage.name}: ${passage.text.slice(Math.max(0, index - 100), index + entry.source.length + 250)}`);
      if (pieces.length >= 3) break;
    }
    result.set(entry.source, pieces.join("\n").slice(0, 1_200));
  }
  return result;
}
