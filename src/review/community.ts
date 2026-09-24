import { parseCommunityRelease } from "../bundles/community-format";
import { assertPortableText, parseTranslationBundle, type BundleDocument } from "../bundles/format";
import { portableFields, type PortableDocument } from "../bundles/fields";
import { readPath } from "../translation/system-html-fields";
import { sha256 } from "../translation/hash";
import { parseEditorialProject, PROJECT_FORMAT, type EditorialProject, type PortableReviewMetadata } from "./project-format";
import { planReviewText } from "./text-plan";

function communityProblem(key: string, detail = ""): Error {
  const translation = typeof game !== "undefined" && game.i18n?.localize ? game.i18n.localize(`FOUNDRY_TRANSLATE.Review.${key}`) : key;
  return new Error(detail ? `${translation}: ${detail}` : translation);
}

/** Rehydrate against installed, allowlisted originals before the normal preview.
 * Imported attestations remain claims, never locally performed verification. */
export async function readEditorialFile(json: string): Promise<EditorialProject> {
  if (JSON.parse(json)?.format !== "foundry-translate-community") return parseEditorialProject(json);
  const release = parseCommunityRelease(json), documents: BundleDocument[] = [], reviews: EditorialProject["reviews"] = [];
  for (const incoming of release.bundle.documents) {
    const source = await fromUuid(incoming.sourceUuid) as PortableDocument | null;
    if (!source?.toObject || source.documentName !== incoming.kind) throw communityProblem("CommunitySourceMissing", incoming.sourceUuid);
    const data = source.toObject(), allowed = portableFields(source, data), rows: PortableReviewMetadata[] = [];
    const patches: BundleDocument["patches"] = [];
    for (const patch of incoming.patches) {
      const field = allowed.find(field => JSON.stringify(field.path) === JSON.stringify(patch.path) && field.format === patch.format);
      const original = field && readPath(data, field.path);
      if (typeof original !== "string" || await sha256(original) !== patch.sourceHash) throw communityProblem("CommunitySourceChanged", `${incoming.sourceUuid} · ${patch.path.join(".")}`);
      assertPortableText(original, patch.translation, patch.format);
      patches.push({ path: [...patch.path], format: patch.format, source: original, translation: patch.translation });
      const stable = [...patch.path];
      if (typeof stable[1] === "number") {
        const embedded = (data[stable[0]!] as { _id?: string; id?: string }[])[stable[1]];
        const id = embedded?._id ?? embedded?.id;
        if (!id) throw communityProblem("CommunitySourceChanged"); stable[1] = id;
      }
      const plan = planReviewText(patch.translation, patch.format);
      for (const unit of plan.units) {
        const id = await sha256(JSON.stringify([incoming.sourceUuid, release.bundle.targetLanguage, JSON.stringify(stable), unit.id]));
        const proof = patch.reviews.find(proof => proof.unitId === unit.id && proof.translationHash);
        const valid = proof && proof.translationHash === await sha256(JSON.stringify(unit.parts));
        rows.push({ rowId: id, binding: await sha256(JSON.stringify([id, patch.format, original, unit.parts])), protected: true,
          ...(valid ? { proof: { at: proof.at, userName: proof.userName } } : {}) });
      }
    }
    documents.push({ ...incoming, sourceName: String(data.name ?? incoming.sourceUuid), patches });
    reviews.push({ sourceUuid: incoming.sourceUuid, rows });
  }
  return { format: PROJECT_FORMAT, version: 1, bundle: parseTranslationBundle(JSON.stringify({ ...release.bundle, documents })), reviews, ui: [] };
}
