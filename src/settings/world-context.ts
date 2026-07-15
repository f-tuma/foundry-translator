const MAX_CONTEXT_SOURCE_CHARACTERS = 12_000;

function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  const element = document.createElement("div");
  element.innerHTML = value;
  return (element.textContent ?? "").replace(/\s+/gu, " ").trim();
}

function append(lines: string[], label: string, value: unknown): void {
  const text = plainText(value);
  if (text) lines.push(`${label}: ${text}`);
}

/**
 * Builds a bounded, review-only source sample for an LLM-generated world profile.
 * The generated profile is not persisted until the GM submits the settings form.
 */
export function collectWorldContextSource(): string {
  const lines: string[] = [];

  for (const journal of game.journal.contents) {
    append(lines, "Journal", journal.name);
    const data = journal.toObject();
    const pages = Array.isArray(data.pages) ? data.pages : [];
    for (const page of pages) {
      if (!page || typeof page !== "object") continue;
      const record = page as Record<string, unknown>;
      append(lines, "Page", record.name);
      const pageText = record.text;
      if (!pageText || typeof pageText !== "object") continue;
      const text = pageText as Record<string, unknown>;
      append(lines, "Text", text.markdown || text.content);
    }
  }

  for (const actor of game.actors.contents) append(lines, "Actor", actor.name);
  for (const item of game.items.contents) append(lines, "Item", item.name);
  for (const scene of game.scenes.contents) append(lines, "Scene", scene.name);

  const source = lines.join("\n");
  if (!source.trim()) {
    throw new Error("Svět zatím neobsahuje Journals, Actory, Itemy ani scény pro vytvoření profilu.");
  }
  return source.slice(0, MAX_CONTEXT_SOURCE_CHARACTERS);
}
