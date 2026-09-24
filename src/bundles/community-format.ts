import { parseTranslationBundle, type BundleDocument, type BundlePatch, type TranslationBundle } from "./format";

/** Public transport: no original prose, private notes, drafts or account IDs. */
export const COMMUNITY_FORMAT = "foundry-translate-community";
export interface CommunityProof { unitId: string; translationHash: string; at: string; userName: string }
export interface CommunityPatch extends Omit<BundlePatch, "source"> { sourceHash: string; reviews: CommunityProof[] }
export interface CommunityDocument extends Omit<BundleDocument, "sourceName" | "patches"> { patches: CommunityPatch[] }
export interface CommunityRelease {
  format: typeof COMMUNITY_FORMAT; version: 1;
  release: { id: string; title: string; notes: string; at: string };
  bundle: Omit<TranslationBundle, "documents"> & { documents: CommunityDocument[] };
}
export function parseCommunityRelease(json: string): CommunityRelease {
  if (new TextEncoder().encode(json).length > 50 * 1024 * 1024) throw new Error("Review.CommunityInvalid");
  const input = JSON.parse(json);
  const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
  const text = (v: unknown, limit: number) => typeof v === "string" && v.length > 0 && v.length <= limit;
  const date = (v: unknown) => text(v, 40) && Number.isFinite(Date.parse(v as string));
  if (input?.format !== COMMUNITY_FORMAT || input.version !== 1 || !text(input.release?.id, 100) || !text(input.release?.title, 200) || typeof input.release?.notes !== "string" || input.release.notes.length > 8000 || !date(input.release?.at) || !Array.isArray(input.bundle?.documents)) throw new Error("Review.CommunityInvalid");
  const normalized = parseTranslationBundle(JSON.stringify({ ...input.bundle, documents: input.bundle.documents.map((doc: CommunityDocument) => ({ ...doc, sourceName: "Community translation", patches: doc.patches?.map(patch => ({ ...patch, source: "" })) })) }));
  const documents: CommunityDocument[] = normalized.documents.map(({ sourceName: _, patches, ...doc }, i) => ({ ...doc, patches: patches.map(({ source: _, ...patch }, j) => {
    const incoming = input.bundle.documents[i].patches[j];
    if (!hash(incoming.sourceHash) || !Array.isArray(incoming.reviews) || incoming.reviews.length > 100000) throw new Error("Review.CommunityInvalid");
    const seen = new Set<string>();
    const reviews = incoming.reviews.map((r: CommunityProof) => {
      if (!r || !text(r.unitId, 2000) || seen.has(r.unitId) || !hash(r.translationHash) || !date(r.at) || !text(r.userName, 500)) throw new Error("Review.CommunityInvalid");
      seen.add(r.unitId); return { unitId: r.unitId, translationHash: r.translationHash, at: r.at, userName: r.userName };
    });
    return { ...patch, sourceHash: incoming.sourceHash, reviews };
  }) }));
  return { format: COMMUNITY_FORMAT, version: 1, release: { id: input.release.id, title: input.release.title, notes: input.release.notes, at: input.release.at },
    bundle: { ...normalized, glossary: normalized.glossary.map(({ notes: _, ...entry }) => entry), documents } };
}
