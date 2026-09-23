import type { ReviewDocument } from "./service";
/** Choose the longest known root; embedded items may also have their own standalone translation. */
export function resolveReviewTarget(catalog: readonly ReviewDocument[], uuid: string): { entry: ReviewDocument; group: string } | null {
  const matches = catalog.flatMap(entry => [entry.uuid, entry.sourceUuid].filter(root => uuid === root || uuid.startsWith(`${root}.`)).map(root => ({ entry, root })))
    .sort((a, b) => b.root.length - a.root.length);
  const best = matches[0];
  if (!best || matches.some(match => match.root === best.root && match.entry.uuid !== best.entry.uuid)) return null;
  const rest = uuid.slice(best.root.length), embedded = /^\.(JournalEntryPage|Item)\.([^.]+)/u.exec(rest);
  return { entry: best.entry, group: embedded ? `${embedded[1] === "Item" ? "items" : "pages"}:${embedded[2]}` : "document" };
}
