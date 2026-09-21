import { createHash } from "node:crypto";

export function catalogEntries(value, path = []) {
  if (typeof value === "string") return [[path, value]];
  if (!value || typeof value !== "object") throw new Error(`Unsupported localization value: ${path.join(".")}`);
  return Object.entries(value).flatMap(([key, child]) => catalogEntries(child, [...path, key]));
}

/** Tags stay in order; interpolation variables may move with Czech word order. */
export function formatSignature(text) {
  // Foundry uses angle brackets for three plain-text empty-state labels. They
  // are not HTML elements and their words should be translated as normal.
  const plainLabel = /^<(?:Unnamed Category|Multiple Values|Unknown Device|Nepojmenovaná kategorie|Více hodnot|Neznámé zařízení)>$/u.test(text);
  return {
    empty: !text.trim(),
    tags: plainLabel ? [] : text.match(/<[^>]*>/gu) ?? [],
    tokens: (text.match(/\{[^{}]*\}|https?:\/\/[^\s<>"']+|`[^`]+`|@(?:UUID|Embed)\[[^\]]*\]/gu) ?? []).sort(),
  };
}

/** Records keys and formatting, without shipping the source English catalog. */
export function catalogContract(catalog) {
  const entries = catalogEntries(catalog);
  const formats = entries.map(([path, text]) => [path, formatSignature(text)]).sort(([a], [b]) => {
    const left = JSON.stringify(a), right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return { strings: entries.length, signature: createHash("sha256").update(JSON.stringify(formats)).digest("hex") };
}
