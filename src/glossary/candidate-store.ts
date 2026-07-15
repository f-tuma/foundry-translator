import { MODULE_ID } from "../constants";
import { SETTINGS } from "../settings/settings";
import { readGlossaryCandidates, type GlossaryCandidate } from "./candidates";

export function loadGlossaryCandidates(): GlossaryCandidate[] {
  return readGlossaryCandidates(game.settings.get(MODULE_ID, SETTINGS.GLOSSARY_CANDIDATES));
}

export async function saveGlossaryCandidates(candidates: readonly GlossaryCandidate[]): Promise<void> {
  await game.settings.set(MODULE_ID, SETTINGS.GLOSSARY_CANDIDATES, [...candidates]);
}

export async function addGlossaryCandidates(candidates: readonly GlossaryCandidate[]): Promise<void> {
  if (!candidates.length) return;
  const stored = loadGlossaryCandidates();
  const seen = new Set(stored.map((item) => [item.source, item.replacement, item.documentName, item.fieldName]
    .join("\u0000").toLocaleLowerCase()));
  for (const candidate of candidates) {
    const key = [candidate.source, candidate.replacement, candidate.documentName, candidate.fieldName]
      .join("\u0000").toLocaleLowerCase();
    if (!seen.has(key)) {
      stored.push(candidate);
      seen.add(key);
    }
  }
  await saveGlossaryCandidates(stored);
}
