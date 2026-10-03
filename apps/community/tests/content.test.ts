import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseImport,
  unitsForDocument,
  rebuildDocument,
  publicRelease,
  hash,
} from "../src/server/content";
import { parseCommunityRelease } from "../../../src/bundles/community-format";
import { readEditorialFile } from "../../../src/review/community";
import type { TranslationBundle } from "../../../src/bundles/format";
import type { Unit } from "../src/shared";

function fixture(): TranslationBundle {
  return {
    format: "foundry-translate-bundle",
    version: 3,
    moduleVersion: "0.28.0",
    createdAt: "2026-09-24",
    systemId: "crucible",
    systemVersion: "1",
    targetLanguage: "cs",
    glossary: [
      {
        source: "Scout",
        replacement: "Zvěd",
        category: "character",
        aliases: [],
        notes: "Private discussion",
      },
    ],
    documents: [
      {
        kind: "JournalEntry",
        sourceUuid: "JournalEntry.guide",
        sourceName: "Private Original",
        sourceFingerprint: "a".repeat(64),
        partial: false,
        processedPageIds: ["page"],
        fallbackTextSegments: 0,
        providerId: "openai-compatible",
        sourceLanguage: "en",
        translatedAt: "2026-09-24",
        engineRevision: 1,
        patches: [
          {
            path: ["name"],
            format: "text",
            source: "Private Original",
            translation: "Příručka",
          },
          {
            path: ["pages", 0, "text", "content"],
            format: "html",
            source:
              "<p>The scout waits. @UUID[Actor.scout]{Scout}</p><p>The forest is quiet.</p>",
            translation:
              "<p>Zvěd čeká. @UUID[Actor.scout]{Zvěd}</p><p>Les je tichý.</p>",
          },
        ],
      },
    ],
  };
}
function setup() {
  const bundle = parseImport(JSON.stringify(fixture())).bundle;
  const units = unitsForDocument(bundle.documents[0]!).map((u) => ({
    ...u,
    revision: "test",
    approval: null,
  })) as Unit[];
  return { bundle, units };
}
function release() {
  const { bundle, units } = setup();
  return publicRelease(
    bundle,
    bundle.documents,
    units,
    "Český Ember",
    "Poznámky",
    "v1",
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("Foundry community bridge", () => {
  it("does not discard correction baselines through the community import path", () => {
    const bundle = fixture();
    const project = { format: "foundry-translate-editorial", version: 2, bundle, reviews: [], ui: [],
      baseTranslations: bundle.documents.map(doc => ({ sourceUuid: doc.sourceUuid,
        fields: doc.patches.map(p => ({ path: p.path, translationHash: hash(p.translation) })),
      })),
    };
    expect(() => parseImport(JSON.stringify(project))).toThrow("importujte v editoru Foundry");
  });
  it("keeps stable paragraph identities across edits and preserves all multi-row replacements", () => {
    const { bundle, units } = setup();
    units[1]!.value = ["Zvěd vyčkává. @UUID[Actor.scout]{Průzkumník}"];
    units[2]!.value = ["Les mlčí."];
    const rebuilt = rebuildDocument(bundle.documents[0]!, units);
    expect(rebuilt.patches[1]!.translation).toBe(
      "<p>Zvěd vyčkává. @UUID[Actor.scout]{Průzkumník}</p><p>Les mlčí.</p>",
    );
    expect(unitsForDocument(rebuilt).map((u) => u.id)).toEqual(
      units.map((u) => u.id),
    );
  });
  it.each(["@Macro[evil]", "@UUID[Actor.other]{Zvěd}", "[[/r 100d20]]"])(
    "rejects changed Foundry commands %s",
    (value) => {
      const { bundle, units } = setup();
      units[1]!.value = [value];
      expect(() => rebuildDocument(bundle.documents[0]!, units)).toThrow();
    },
  );
  it("escapes typed markup as inert text without creating executable elements", () => {
    const { bundle, units } = setup();
    units[2]!.value = ["<script>alert(1)</script>"];
    const rebuilt = rebuildDocument(bundle.documents[0]!, units);
    expect(rebuilt.patches[1]!.translation).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rebuilt.patches[1]!.translation).not.toContain("<script>");
    expect(() => parseImport(JSON.stringify({ ...bundle, documents: [rebuilt] }))).not.toThrow();
  });
  it("rejects executable markup introduced into an HTML-rendered tooltip attribute", () => {
    const bundle = fixture(), patch = bundle.documents[0]!.patches[1]!;
    patch.source = '<p title="Safe">Text</p>';
    patch.translation = '<p title="Bezpečné">Text</p>';
    const units = unitsForDocument(bundle.documents[0]!).map(u => ({ ...u, revision: "test", approval: null })) as Unit[];
    units.find(u => u.unit_key.endsWith('@title'))!.value = ['<script>alert(1)</script>'];
    expect(() => rebuildDocument(bundle.documents[0]!, units)).toThrow("HTML structure");
  });
  it("imports entity prose and different inline separator fragments without changing paragraph identity", () => {
    const bundle = fixture(), patch = bundle.documents[0]!.patches[1]!;
    patch.source = '<p>A &amp; B: <strong>one</strong>, <strong>two</strong>.</p>';
    patch.translation = '<p>A a B: <strong>jedna</strong> <strong>dva</strong>.</p>';
    const parsed = parseImport(JSON.stringify(bundle)).bundle;
    const units = unitsForDocument(parsed.documents[0]!).map(u => ({ ...u, revision: "test", approval: null })) as Unit[];
    expect(units[1]!.source).toHaveLength(5);
    expect(units[1]!.value).toHaveLength(4);
    units[1]!.value = ['A a B: ', 'první', 'druhé', '.'];
    const rebuilt = rebuildDocument(parsed.documents[0]!, units);
    expect(rebuilt.patches[1]!.translation).toBe('<p>A a B: <strong>první</strong> <strong>druhé</strong>.</p>');
    expect(unitsForDocument(rebuilt).map(u => u.id)).toEqual(units.map(u => u.id));
  });
  it("exports translations and hashes without original prose, notes or account IDs", () => {
    const payload = release(),
      json = JSON.stringify(payload);
    expect(json).not.toContain("Private Original");
    expect(json).not.toContain("Private discussion");
    expect(json).not.toContain("The scout waits");
    expect(payload.bundle.documents[0]!.patches[0]!.sourceHash).toBe(
      hash("Private Original"),
    );
    expect(parseCommunityRelease(json)).toEqual(payload);
  });
  it("rejects malformed proofs and strips unknown public fields", () => {
    const payload = release();
    const patch = payload.bundle.documents[0]!.patches[0]!;
    patch.reviews = [
      {
        unitId: "text",
        translationHash: "invalid",
        at: "2026-09-24",
        userName: "Reviewer",
      },
    ];
    expect(() => parseCommunityRelease(JSON.stringify(payload))).toThrow();
    patch.reviews = [];
    expect(
      JSON.stringify(
        parseCommunityRelease(
          JSON.stringify({ ...payload, secret: "private" }),
        ),
      ),
    ).not.toContain("private");
  });
  it("rehydrates public releases only against matching installed originals", async () => {
    const { bundle, units } = setup();
    units[0]!.approval = { at: "2026-09-24T12:00:00Z", userName: "Weblate" };
    const payload = publicRelease(
      bundle,
      bundle.documents,
      units,
      "Ember",
      "",
      "v1",
    );
    const data = {
      name: "Private Original",
      pages: [
        {
          _id: "page",
          type: "text",
          text: { content: bundle.documents[0]!.patches[1]!.source },
        },
      ],
    };
    vi.stubGlobal("game", { system: { id: "crucible" } });
    vi.stubGlobal(
      "fromUuid",
      vi.fn().mockResolvedValue({
        uuid: "JournalEntry.guide",
        documentName: "JournalEntry",
        toObject: () => data,
      }),
    );
    const result = await readEditorialFile(JSON.stringify(payload));
    expect(result.bundle.documents[0]!.patches[0]!.source).toBe(
      "Private Original",
    );
    expect(result.reviews[0]!.rows[0]!.proof?.userName).toBe("Weblate");
    data.name = "Changed original";
    await expect(readEditorialFile(JSON.stringify(payload))).rejects.toThrow(
      "SourceChanged",
    );
  });
  it("refuses missing originals and altered commands even with valid source hashes", async () => {
    vi.stubGlobal("fromUuid", vi.fn().mockResolvedValue(null));
    await expect(readEditorialFile(JSON.stringify(release()))).rejects.toThrow(
      "SourceMissing",
    );
    vi.stubGlobal("game", { system: { id: "crucible" } });
    vi.stubGlobal(
      "fromUuid",
      vi.fn().mockResolvedValue({
        documentName: "JournalEntry",
        toObject: () => ({ name: "Private Original", pages: [] }),
      }),
    );
    const payload = release();
    payload.bundle.documents[0]!.patches[0]!.translation = "@Macro[evil]";
    await expect(readEditorialFile(JSON.stringify(payload))).rejects.toThrow(
      "commands",
    );
  });
  it("rejects unsupported language and input that changes the HTML structure", () => {
    const b = fixture();
    b.targetLanguage = "de";
    expect(() => parseImport(JSON.stringify(b))).toThrow("český");
    b.targetLanguage = "cs";
    b.documents[0]!.patches[1]!.translation = "<script>evil()</script>";
    expect(() => parseImport(JSON.stringify(b))).toThrow();
  });
});

it("roundtrips reordered references and corrected labels through import, review, public release and Foundry import", async () => {
  const b = fixture(),
    doc = b.documents[0]!;
  const source =
    "<p>Meet @UUID[Actor.a]{A} <strong>before</strong> @UUID[Actor.b]{B}.</p>";
  doc.patches[1]!.source = source;
  doc.patches[1]!.translation =
    "<p>Potkej @UUID[Actor.a]{Áčko} <strong>před</strong> @UUID[Actor.b]{Béčko}.</p>";
  const original = {
    name: doc.patches[0]!.source,
    pages: [
      { _id: "page", type: "text", text: { content: source, format: 1 } },
    ],
  };
  // This fixture uses both structural text parts and a real source fingerprint.
  const { journalSourceHash } =
    await import("../../../src/translation/journal");
  doc.sourceFingerprint = await journalSourceHash(original as any);
  const parsed = parseImport(JSON.stringify(b)).bundle;
  const units = unitsForDocument(parsed.documents[0]!).map((u) => ({
    ...u,
    revision: "r1",
    approval: null,
  })) as Unit[];
  const row = units.find((u) => u.value.length === 3)!;
  row.value = [
    "@UUID[Actor.b]{Béčka} potkáš ",
    "před",
    " @UUID[Actor.a]{Áčkem}.",
  ];
  const rebuilt = rebuildDocument(parsed.documents[0]!, units);
  expect(rebuilt.patches[1]!.translation).toContain(
    "@UUID[Actor.b]{Béčka} potkáš <strong>před</strong> @UUID[Actor.a]{Áčkem}",
  );
  const published = publicRelease(
    parsed,
    parsed.documents,
    units,
    "Opravy odkazů",
    "",
    "links",
  );
  vi.stubGlobal("game", { system: { id: "crucible" } });
  vi.stubGlobal(
    "fromUuid",
    vi
      .fn()
      .mockResolvedValue({
        documentName: "JournalEntry",
        toObject: () => original,
      }),
  );
  const imported = await readEditorialFile(JSON.stringify(published));
  expect(imported.bundle.documents[0]!.patches[1]!.translation).toBe(
    rebuilt.patches[1]!.translation,
  );
  row.value[2] = " @UUID[Actor.changed].";
  expect(() => rebuildDocument(parsed.documents[0]!, units)).toThrow();
});


it("guards embedded prose at the community engine boundary using authoritative current units", () => {
  const bundle = fixture();
  bundle.documents[0]!.patches[1]!.source = '<p>@Embed[Actor.scout readaloud="Scout waits 2 hours." caption="Scout 3" count=4]</p>';
  bundle.documents[0]!.patches[1]!.translation = '<p>@Embed[Actor.scout readaloud="Zvěd čeká 2 hodiny." caption="Zvěd 3" count=4]</p>';
  const template = bundle.documents[0]!;
  const before = unitsForDocument(template).map(u => ({ ...u, revision: "r", approval: null })) as Unit[];
  const units = structuredClone(before);
  units[1]!.value = [units[1]!.value[0]!.replace("čeká", "hlídá")];
  expect(rebuildDocument(template, units, before).patches[1]!.translation).toContain("hlídá 2 hodiny");
  expect(() => rebuildDocument(template, units, [])).toThrow("Původní oddíl");
  units[1]!.value = ['@Embed[Actor.scout readaloud="Zvěd čeká 3 hodiny." caption="Zvěd 2" count=4]'];
  expect(() => rebuildDocument(template, units, before)).toThrow("Čísla");
  units[1]!.value = ['@Embed[Actor.scout readaloud="Zvěd čeká 2 hodiny. <script>evil</script>" caption="Zvěd 3" count=4]'];
  expect(() => rebuildDocument(template, units, before)).toThrow();
});
