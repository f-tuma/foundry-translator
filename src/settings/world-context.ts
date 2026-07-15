const DEFAULT_MAX_CHARACTERS = 12_000;
const MAX_EXCERPT_CHARACTERS = 900;
const MAX_EXCERPTS = 8;

const PROFILE_KEYWORDS: readonly { pattern: RegExp; weight: number }[] = [
  { pattern: /game\s*master(?:'s)?\s+guide|gm\s+guide/iu, weight: 10 },
  { pattern: /world|setting|lore|cosmolog|history|timeline|faction|notable/iu, weight: 7 },
  { pattern: /gazetteer|primer|overview|religion|deit|pantheon|people|location|region/iu, weight: 5 },
  { pattern: /introduction|background|campaign\s+guide|player(?:'s)?\s+guide|glossary/iu, weight: 3 },
];

interface ExcerptCandidate {
  journalName: string;
  pageName: string;
  text: string;
  score: number;
}

export interface WorldContextSourceOptions {
  maxCharacters?: number;
  random?: () => number;
}

function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  const element = document.createElement("div");
  element.innerHTML = value;
  return (element.textContent ?? "").replace(/\s+/gu, " ").trim();
}

function keywordScore(...values: string[]): number {
  const text = values.join(" ");
  return PROFILE_KEYWORDS.reduce(
    (score, { pattern, weight }) => score + (pattern.test(text) ? weight : 0),
    0,
  );
}

function hasUsefulExcerptContent(content: string): boolean {
  if (/under construction|no further information is available/iu.test(content)) return false;
  const withoutFoundryReferences = content
    .replace(/@(?:UUID|Embed)\[[^\]]+\](?:\{[^}]*\})?/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return (withoutFoundryReferences.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) ?? []).length >= 8;
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex] as T, result[index] as T];
  }
  return result;
}

function uniqueNames(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.map((value) => plainText(value)).filter(Boolean))];
}

function boundedNameSample(
  names: readonly string[],
  budget: number,
  random: () => number,
  prioritizeKeywords = false,
): string {
  const ordered = prioritizeKeywords
    ? [
      ...names.filter((name) => keywordScore(name) > 0)
        .sort((left, right) => keywordScore(right) - keywordScore(left)),
      ...shuffled(names.filter((name) => keywordScore(name) === 0), random),
    ]
    : shuffled(names, random);
  const selected: string[] = [];
  let length = 0;
  for (const name of ordered) {
    const addition = name.length + (selected.length ? 2 : 0);
    if (length + addition > budget) continue;
    selected.push(name);
    length += addition;
  }
  return selected.join(", ");
}

function journalCandidates(): ExcerptCandidate[] {
  const candidates: ExcerptCandidate[] = [];
  for (const journal of game.journal.contents) {
    const data = journal.toObject();
    const pages = Array.isArray(data.pages) ? data.pages : [];
    for (const page of pages) {
      if (!page || typeof page !== "object") continue;
      const record = page as Record<string, unknown>;
      const pageName = plainText(record.name) || "Untitled page";
      const pageText = record.text;
      if (!pageText || typeof pageText !== "object") continue;
      const text = pageText as Record<string, unknown>;
      const content = plainText(text.markdown || text.content);
      if (!content || !hasUsefulExcerptContent(content)) continue;
      candidates.push({
        journalName: plainText(journal.name) || "Untitled journal",
        pageName,
        text: content,
        score: keywordScore(journal.name, pageName),
      });
    }
  }
  return candidates;
}

function selectExcerpts(
  candidates: readonly ExcerptCandidate[],
  random: () => number,
): Array<ExcerptCandidate & { selection: "keyword" | "random" }> {
  const selected: Array<ExcerptCandidate & { selection: "keyword" | "random" }> = [];
  const selectedCandidates = new Set<ExcerptCandidate>();
  const selectedJournals = new Set<string>();
  const priority = candidates
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);

  // Prefer broad-profile matches from different Journals so one guide cannot
  // consume the complete context budget.
  for (const candidate of priority) {
    if (selected.length >= 5) break;
    if (selectedJournals.has(candidate.journalName)) continue;
    selected.push({ ...candidate, selection: "keyword" });
    selectedCandidates.add(candidate);
    selectedJournals.add(candidate.journalName);
  }

  // Fill the remaining slots randomly, first favoring Journals not represented
  // by a keyword hit and then any remaining page.
  const remaining = shuffled(
    candidates.filter((candidate) => !selectedCandidates.has(candidate)),
    random,
  );
  for (const requireNewJournal of [true, false]) {
    for (const candidate of remaining) {
      if (selected.length >= MAX_EXCERPTS) break;
      if (selectedCandidates.has(candidate)) continue;
      if (requireNewJournal && selectedJournals.has(candidate.journalName)) continue;
      selected.push({ ...candidate, selection: "random" });
      selectedCandidates.add(candidate);
      selectedJournals.add(candidate.journalName);
    }
  }
  return selected;
}

function appendSection(parts: string[], heading: string, content: string): void {
  if (content) parts.push(`${heading}\n${content}`);
}

/**
 * Builds a stratified, bounded and review-only sample for an LLM-generated
 * world profile. The generated profile is not persisted until the GM submits
 * the settings form.
 */
export function collectWorldContextSource(
  options: WorldContextSourceOptions = {},
): string {
  const maxCharacters = Math.max(2_000, options.maxCharacters ?? DEFAULT_MAX_CHARACTERS);
  const random = options.random ?? Math.random;
  const journalNames = uniqueNames(game.journal.contents.map(({ name }) => name));
  const actorNames = uniqueNames(game.actors.contents.map(({ name }) => name));
  const itemNames = uniqueNames(game.items.contents.map(({ name }) => name));
  const sceneNames = uniqueNames(game.scenes.contents.map(({ name }) => name));
  const candidates = journalCandidates();

  if (!journalNames.length && !actorNames.length && !itemNames.length && !sceneNames.length) {
    throw new Error("Svět zatím neobsahuje Journals, Actory, Itemy ani scény pro vytvoření profilu.");
  }

  const parts = [
    [
      "SAMPLE NOTICE: This is an intentionally incomplete world sample.",
      "It combines keyword-selected setting/lore/guide material with random excerpts from other Journals and random document-name samples.",
      "Treat it as evidence of broader patterns, not as a complete or authoritative description of the world.",
    ].join(" "),
    [
      `World: ${plainText(game.world?.title) || "Unknown"}`,
      `Active system: ${plainText(game.system?.title) || plainText(game.system?.id) || "Unknown"}${game.system?.version ? ` ${plainText(game.system.version)}` : ""}`,
      ...(plainText(game.world?.description)
        ? [`Official world description: ${plainText(game.world?.description).slice(0, 1_200)}`]
        : []),
      `Available documents: ${journalNames.length} Journals, ${actorNames.length} Actors, ${itemNames.length} Items, ${sceneNames.length} Scenes`,
    ].join("\n"),
  ];

  appendSection(parts, "JOURNAL NAME INDEX (keyword matches first, then random):",
    boundedNameSample(journalNames, 1_800, random, true));
  appendSection(parts, "RANDOM ACTOR NAME SAMPLE:", boundedNameSample(actorNames, 850, random));
  appendSection(parts, "RANDOM ITEM NAME SAMPLE:", boundedNameSample(itemNames, 850, random));
  appendSection(parts, "RANDOM SCENE NAME SAMPLE:", boundedNameSample(sceneNames, 850, random));

  const selected = selectExcerpts(candidates, random);
  appendSection(
    parts,
    "SELECTED JOURNAL EXCERPTS:",
    selected.map(({ journalName, pageName, text, selection }) =>
      `[${selection}] ${journalName} / ${pageName}\n${text.slice(0, MAX_EXCERPT_CHARACTERS)}`
    ).join("\n\n"),
  );

  return parts.join("\n\n").slice(0, maxCharacters);
}
