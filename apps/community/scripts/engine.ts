import { readFileSync } from "node:fs";
import { parseTranslationBundle } from "../../../src/bundles/format";
import {
  parseImport,
  unitsForDocument,
  rebuildDocument,
  publicRelease,
  hash,
} from "../src/server/content";
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  let result: unknown;
  if (input.action === "normalize") {
    const parsed = parseImport(input.json);
    result = {
      ...parsed,
      documents: parsed.bundle.documents.map((doc) => ({
        id: hash(doc.sourceUuid),
        template: doc,
        rows: unitsForDocument(doc),
      })),
    };
  } else if (input.action === "glossary")
    result = parseTranslationBundle(
      JSON.stringify({ ...input.meta, glossary: input.entries, documents: [] }),
    ).glossary;
  else if (input.action === "validate")
    result = rebuildDocument(input.template, input.units);
  else if (input.action === "release")
    result = publicRelease(
      input.meta,
      input.documents,
      input.units,
      input.title,
      input.notes,
      input.id,
    );
  else throw new Error("Unknown content operation");
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error:
        error instanceof Error ? error.message : "Content validation failed",
    }),
  );
  process.exitCode = 1;
}
