/** A conservative Czech word-form guard, not a morphological analyser.
 * The model chooses the grammar; this rejects renaming, added words and markup.
 * Unrecognised irregular forms are retried by the normal translation pipeline.
 */
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|\p{N}+/gu;
const NOUN_ENDINGS = ["", "a", "u", "e", "ě", "i", "í", "o", "y", "ů", "em", "om", "ou", "ovi", "ové", "ům", "ami", "emi", "ách", "ích", "ech", "ama", "ma", "ím", "ata", "at", "aty", "atům", "atech"];
const ADJECTIVE_ENDINGS = ["ý", "á", "é", "í", "ého", "ému", "ém", "ým", "ou", "ých", "ými", "ího", "ímu", "ím", "ích", "ími"];
const CONSONANT = "bcčdďfghjklmnňpqrřsštťvwxzž";

function stemVariants(stem: string): Set<string> {
  const result = new Set([stem]);
  // Czech palatalisation, e.g. kočk-a/kočc-e and permoníc-i/permoník-ům.
  for (const [left, right] of [["ch", "š"], ["k", "c"], ["h", "z"], ["r", "ř"], ["n", "ň"], ["d", "ď"], ["t", "ť"]] as const) {
    if (stem.endsWith(left)) result.add(stem.slice(0, -left.length) + right);
    if (stem.endsWith(right)) result.add(stem.slice(0, -right.length) + left);
  }
  // Fleeting e and the common ů/o alternation: paprsek/paprsku, bůh/boha.
  if (new RegExp(`[${CONSONANT}]e[${CONSONANT}]$`, "u").test(stem)) result.add(stem.slice(0, -2) + stem.slice(-1));
  if (new RegExp(`[${CONSONANT}]{2}$`, "u").test(stem)) result.add(stem.slice(0, -1) + "e" + stem.slice(-1));
  if (stem.includes("ů")) result.add(stem.replaceAll("ů", "o"));
  return result;
}

function wordForm(original: string, candidate: string): boolean {
  const base = original.toLocaleLowerCase("cs"), form = candidate.toLocaleLowerCase("cs");
  if (base === form) return true;
  if (["v", "ve"].includes(base)) return ["v", "ve"].includes(form);
  if (["z", "ze"].includes(base)) return ["z", "ze"].includes(form);
  if (["s", "se"].includes(base)) return ["s", "se"].includes(form);
  if (["k", "ke"].includes(base)) return ["k", "ke"].includes(form);
  if (base.length < 3 || /^\p{N}/u.test(base)) return false;
  if (/[eiyí]$/u.test(base) && ["ho", "mu", "m"].some(ending => base + ending === form)) return true;
  const roots = new Set([base]);
  if (/[aeěioyůuíé]$/u.test(base)) roots.add(base.slice(0, -1));
  if (/ové$/u.test(base)) roots.add(base.slice(0, -3));
  for (const root of roots) for (const variant of stemVariants(root)) {
    if (variant.length >= 2 && NOUN_ENDINGS.some(ending => variant + ending === form)) return true;
  }
  if (/[ýáéí]$/u.test(base)) {
    const root = base.slice(0, -1);
    if (ADJECTIVE_ENDINGS.some(ending => root + ending === form)) return true;
  }
  return false;
}

/** Returns a checked form with the glossary's capitalization, or null. */
export function normalizeCzechGlossaryForm(original: string, candidate: string): string | null {
  const value = candidate.normalize("NFC").trim();
  if (!value || value.length > 300 || /[<>\r\n\t]|__FT|@(?:UUID|Embed)\[|\[\[/iu.test(value)) return null;
  const originalWords = original.match(WORD) ?? [], words = value.match(WORD) ?? [];
  const skeleton = (text: string) => text.replace(WORD, "#").replace(/\s+/gu, " ");
  if (!words.length || originalWords.length !== words.length || skeleton(original) !== skeleton(value)) return null;
  if (!words.every((word, index) => wordForm(originalWords[index]!, word))) return null;
  let index = 0;
  return value.replace(WORD, word => {
    const canonical = originalWords[index++]!;
    if (canonical.length > 1 && canonical === canonical.toUpperCase()) return word.toUpperCase();
    return [...word.toLocaleLowerCase("cs")].map((letter, offset) => {
      const source = [...canonical][offset];
      return source && /\p{Lu}/u.test(source) && (offset === 0 || source.toLocaleLowerCase("cs") === letter)
        ? letter.toLocaleUpperCase("cs") : letter;
    }).join("");
  });
}
