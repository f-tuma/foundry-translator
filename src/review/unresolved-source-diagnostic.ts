/** Fixed, body-free reason for a denied source-derived retention observation.
 * This is diagnostic metadata only, never a proof accepted by a write API. */
export const UNRESOLVED_SOURCE_RETENTION_DENIED = "Review.UnresolvedSourceRetentionDenied";
/** Bound the complete normalized parent stamp without omitting proof-bearing fields. */
export const UNRESOLVED_SOURCE_MAX_NORMALIZED_CHARACTERS = 4_000_000;
const phases = ["preflight", "prepare-first", "prepare-second", "bind", "recheck"] as const;
const roles = ["source", "mapped", "pair", "environment"] as const;
const predicates = [
  "unsupported-child-reference", "target-lookup-threw", "target-identity-mismatch",
  "parent-lookup-threw", "parent-identity-or-methods-mismatch", "original-translated-root-forbidden",
  "translation-provenance-mismatch", "serialization-threw", "serialized-parent-shape",
  "normalized-size-exceeded", "serialized-collection-shape", "serialized-child-id-invalid",
  "serialized-child-present", "embedded-or-exact-lookup-threw", "embedded-or-exact-nonnull",
  "parent-or-identity-changed", "pair-identity-mismatch", "reverse-provenance-mismatch",
  "scope-or-source-changed", "proof-observations-differ", "invalid-retention-proof",
] as const;
export interface UnresolvedSourceFailureContext {
  phase: typeof phases[number]; role: typeof roles[number]; pairIndex: number | null;
}
export interface UnresolvedSourceFailureTrace extends UnresolvedSourceFailureContext {
  version: 1; predicate: typeof predicates[number];
  /** UTF-16 length of the existing normalized JSON stamp, not bytes. */
  normalizedCharacters: number | null; limitCharacters: number | null;
}
const traces = new WeakMap<UnresolvedSourceRetentionError, Readonly<UnresolvedSourceFailureTrace>>();
export class UnresolvedSourceRetentionError extends Error {
  constructor(context: UnresolvedSourceFailureContext, predicate: UnresolvedSourceFailureTrace["predicate"], normalizedCharacters?: number) {
    super(UNRESOLVED_SOURCE_RETENTION_DENIED);
    traces.set(this, Object.freeze({ version: 1, phase: context.phase, role: context.role, pairIndex: context.pairIndex,
      predicate, normalizedCharacters: predicate === "normalized-size-exceeded" ? normalizedCharacters ?? null : null,
      limitCharacters: predicate === "normalized-size-exceeded" ? UNRESOLVED_SOURCE_MAX_NORMALIZED_CHARACTERS : null }));
  }
}
export function isUnresolvedSourceRetentionError(error: unknown): error is UnresolvedSourceRetentionError {
  return error instanceof UnresolvedSourceRetentionError && traces.has(error);
}
/** Recognize our own error type, whitelist every scalar, and copy no arbitrary
 * properties, exception causes, document metadata, UUIDs or serialized bodies. */
export function unresolvedSourceFailureTrace(error: unknown): UnresolvedSourceFailureTrace | undefined {
  if (!isUnresolvedSourceRetentionError(error)) return;
  const trace = traces.get(error)!;
  if (trace.version !== 1 || !phases.includes(trace.phase) || !roles.includes(trace.role) || !predicates.includes(trace.predicate) ||
    (trace.pairIndex !== null && (!Number.isSafeInteger(trace.pairIndex) || trace.pairIndex < 0))) return;
  if (trace.predicate === "normalized-size-exceeded"
    ? trace.limitCharacters !== UNRESOLVED_SOURCE_MAX_NORMALIZED_CHARACTERS || !Number.isSafeInteger(trace.normalizedCharacters) || trace.normalizedCharacters! <= UNRESOLVED_SOURCE_MAX_NORMALIZED_CHARACTERS
    : trace.normalizedCharacters !== null || trace.limitCharacters !== null) return;
  return { version: 1, phase: trace.phase, role: trace.role, pairIndex: trace.pairIndex, predicate: trace.predicate,
    normalizedCharacters: trace.normalizedCharacters, limitCharacters: trace.limitCharacters };
}
