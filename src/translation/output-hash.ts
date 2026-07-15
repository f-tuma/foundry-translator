import { sha256 } from "./hash";

/**
 * Builds a stable fingerprint of the stored translated document while ignoring
 * Foundry bookkeeping and flags. Translation metadata therefore cannot change
 * its own hash, while user edits to document content remain detectable.
 */
export async function translatedOutputHash(data: Record<string, unknown>): Promise<string> {
  return sha256(JSON.stringify(normalize(data, true)));
}

function normalize(value: unknown, root = false): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalize(entry));
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "_stats") continue;
    if (root && ["_id", "folder", "ownership", "sort", "flags"].includes(key)) continue;
    output[key] = normalize(entry);
  }
  return output;
}

export async function hasManualOutputEdits(
  data: Record<string, unknown>,
  expectedHash: string | undefined,
): Promise<boolean> {
  return Boolean(expectedHash) && await translatedOutputHash(data) !== expectedHash;
}
