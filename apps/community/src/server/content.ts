import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { parseEditorialProject } from "../../../../src/review/project-format";
import {
  parseTranslationBundle,
  assertPortableText,
  type BundleDocument,
  type TranslationBundle,
} from "../../../../src/bundles/format";
import { planReviewText } from "../../../../src/review/text-plan";
import {
  COMMUNITY_FORMAT,
  parseCommunityRelease,
  type CommunityRelease,
} from "../../../../src/bundles/community-format";
import type { Unit } from "../shared";
class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// A server-only inert DOM: never attach or execute uploaded markup in the UI.
Object.assign(globalThis, {
  document: parseHTML("<html><body></body></html>").document,
});
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function parseImport(json: string) {
  const raw = JSON.parse(json);
  const project =
    raw.format === "foundry-translate-editorial"
      ? parseEditorialProject(json)
      : null;
  const bundle = project?.bundle ?? parseTranslationBundle(json);
  if (bundle.targetLanguage !== "cs")
    throw new Problem(400, "Tato redakce přijímá český překlad.");
  if (bundle.systemId !== "crucible" && bundle.systemId !== "ember")
    throw new Problem(400, "Export nepatří k systému Ember / Crucible.");
  for (const doc of bundle.documents)
    for (const patch of doc.patches)
      assertPortableText(patch.source, patch.translation, patch.format);
  return {
    bundle,
    skippedUi: project?.ui.length ?? 0,
    importedReviews:
      project?.reviews.reduce((n, d) => n + d.rows.length, 0) ?? 0,
  };
}
export function unitsForDocument(
  doc: BundleDocument,
): Omit<Unit, "revision" | "approval">[] {
  const rows: Omit<Unit, "revision" | "approval">[] = [],
    documentId = hash(doc.sourceUuid);
  doc.patches.forEach((patch, fieldIndex) => {
    const source = planReviewText(patch.source, patch.format),
      target = planReviewText(patch.translation, patch.format);
    const pageIndex =
      patch.path[0] === "pages" && typeof patch.path[1] === "number"
        ? patch.path[1]
        : null;
    const pageTitle =
      pageIndex !== null
        ? doc.patches.find((p) => same(p.path, ["pages", pageIndex, "name"]))
            ?.translation
        : null;
    const label =
      pageTitle ||
      (pageIndex !== null
        ? `Oddíl ${pageIndex + 1}`
        : patch.path[0] === "name"
          ? "Název dokumentu"
          : patch.path[0] === "prototypeToken"
            ? "Název tokenu"
            : "Text dokumentu");
    for (const unit of target.units) {
      const original = source.units.find((p) => p.id === unit.id);
      if (!original || original.parts.length !== unit.parts.length)
        throw new Problem(400, "Originál a překlad mají odlišné oddíly.");
      rows.push({
        id: hash(JSON.stringify([doc.sourceUuid, patch.path, unit.id])),
        document_id: documentId,
        kind: "document",
        field_index: fieldIndex,
        unit_key: unit.id,
        label,
        position: rows.length,
        source: original.parts,
        value: unit.parts,
      });
    }
  });
  return rows;
}
export function rebuildDocument(
  template: BundleDocument,
  units: Unit[],
): BundleDocument {
  return {
    ...template,
    patches: template.patches.map((patch, i) => {
      const plan = planReviewText(patch.translation, patch.format);
      let translation = patch.translation;
      for (const unit of units.filter((u) => u.field_index === i))
        translation = plan.replace(unit.unit_key, unit.value);
      assertPortableText(patch.source, translation, patch.format);
      return { ...patch, translation };
    }),
  };
}
export function publicRelease(
  meta: Omit<TranslationBundle, "documents">,
  documents: BundleDocument[],
  units: Unit[],
  title: string,
  notes: string,
  id: string,
): CommunityRelease {
  const bundle: TranslationBundle = {
    ...meta,
    documents: documents.map((doc) =>
      rebuildDocument(
        doc,
        units.filter((u) => u.document_id === hash(doc.sourceUuid)),
      ),
    ),
  };
  bundle.glossary = bundle.glossary.map((entry, i) => ({
    ...entry,
    replacement:
      units.find((u) => u.kind === "glossary" && u.field_index === i)
        ?.value[0] ?? entry.replacement,
  }));
  parseTranslationBundle(JSON.stringify(bundle));
  const payload: CommunityRelease = {
    format: COMMUNITY_FORMAT,
    version: 1,
    release: { id, title, notes, at: new Date().toISOString() },
    bundle: {
      ...bundle,
      documents: bundle.documents.map(({ sourceName: _, patches, ...doc }) => ({
        ...doc,
        patches: patches.map(({ source, ...patch }, i) => ({
          ...patch,
          sourceHash: hash(source),
          reviews: units
            .filter(
              (u) =>
                u.document_id === hash(doc.sourceUuid) &&
                u.field_index === i &&
                u.approval,
            )
            .map((u) => ({
              unitId: u.unit_key,
              translationHash: hash(JSON.stringify(u.value)),
              at: u.approval!.at,
              userName: u.approval!.userName,
            })),
        })),
      })),
    },
  };
  return parseCommunityRelease(JSON.stringify(payload));
}
