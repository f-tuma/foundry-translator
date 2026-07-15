import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import type { TranslationProvider } from "../src/providers/types";
import {
  actorSourceHash,
  canReuseActorTranslation,
  readActorTranslationFlag,
  translateActorData,
  type ActorData,
} from "../src/translation/actor";

const provider: TranslationProvider = {
  async translate({ texts }) {
    return texts.map((text) => ({
      translatedText: text
        .replaceAll("A guarded scholar.", "Ostražitý učenec.")
        .replaceAll("Secret history.", "Tajná historie.")
        .replaceAll("A precise attack.", "Přesný útok."),
    }));
  },
  async testConnection() {},
};

describe("Actor translation", () => {
  it("translates only selected HTML fields and preserves mechanics and embedded IDs", async () => {
    const { document } = parseHTML("<html><body></body></html>");
    const source: ActorData = {
      _id: "actor-id",
      _stats: { modifiedTime: 1 },
      name: "Vinarith",
      type: "adversary",
      system: {
        details: {
          biography: {
            public: "<p>A guarded scholar.</p>",
            private: "<p>Secret history.</p>",
          },
        },
        defenses: { armor: 14 },
        identifier: "mechanical-vinarith",
      },
      items: [{
        _id: "item-id",
        _stats: { modifiedTime: 1 },
        name: "Precise Strike",
        system: {
          description: "<p>A precise attack.</p>",
          actionCost: 2,
        },
      }],
      flags: { ember: { keep: true } },
    };
    const original = structuredClone(source);

    const result = await translateActorData({
      source,
      sourceUuid: "Actor.actor-id",
      glossary: [],
      provider,
      settings: {
        providerId: "chrome-local",
        sourceLanguage: "en",
        targetLanguage: "cs",
      },
      systemHtmlFieldPaths: [
        ["details", "biography", "public"],
        ["details", "biography", "private"],
      ],
      itemHtmlFieldPaths: [[ ["description"] ]],
      ownerDocument: document,
      nonceFactory: () => "ACTOR",
    });

    expect(source).toEqual(original);
    expect(result.data._id).toBeUndefined();
    expect(result.data.name).toBe("Vinarith [CS]");
    expect(result.data.system).toMatchObject({
      details: { biography: {
        public: "<p>Ostražitý učenec.</p>",
        private: "<p>Tajná historie.</p>",
      } },
      defenses: { armor: 14 },
      identifier: "mechanical-vinarith",
    });
    expect(result.data.items?.[0]).toMatchObject({
      _id: "item-id",
      name: "Precise Strike",
      system: { description: "<p>Přesný útok.</p>", actionCost: 2 },
    });
    expect(result.data.items?.[0]?._stats).toBeUndefined();
    expect(result.translatedHtmlFields).toBe(3);
    const flag = readActorTranslationFlag(result.data.flags);
    expect(flag).toMatchObject({
      sourceUuid: "Actor.actor-id",
      translatedHtmlFields: 3,
      fallbackTextSegments: 0,
    });
    expect(flag && canReuseActorTranslation(flag, flag.sourceHash)).toBe(true);
  });

  it("hashes embedded Item content and mechanical source changes", async () => {
    const source: ActorData = {
      name: "Actor",
      type: "adversary",
      system: { armor: 10 },
      items: [{ _id: "item", system: { description: "Before" } }],
    };
    const changed = structuredClone(source);
    if (changed.items?.[0]?.system) changed.items[0].system.description = "After";
    await expect(actorSourceHash(source)).resolves.not.toBe(await actorSourceHash(changed));
  });

  it("batches Actor and embedded Item HTML fields for an LLM provider", async () => {
    const { document } = parseHTML("<html><body></body></html>");
    const requestSizes: number[] = [];
    const progress: number[] = [];
    const source: ActorData = {
      name: "Scholar",
      type: "adversary",
      system: {
        public: "<p>Public biography.</p>",
        private: "<p>Private biography.</p>",
      },
      items: [{
        name: "Precise Strike",
        system: { description: "<p>Precise attack.</p>" },
      }],
    };

    const result = await translateActorData({
      source,
      sourceUuid: "Actor.scholar",
      glossary: [],
      provider: {
        async translate({ texts }) {
          requestSizes.push(texts.length);
          return texts.map((text) => ({ translatedText: `Přeloženo: ${text}` }));
        },
        async testConnection() {},
      },
      settings: {
        providerId: "openai-compatible",
        sourceLanguage: "en",
        targetLanguage: "cs",
      },
      systemHtmlFieldPaths: [["public"], ["private"]],
      itemHtmlFieldPaths: [[ ["description"] ]],
      ownerDocument: document,
      nonceFactory: () => "ACTORBATCH",
      onProgress: ({ completedFields }) => progress.push(completedFields),
    });

    expect(requestSizes).toEqual([3]);
    expect(progress).toEqual([1, 2, 3]);
    expect(result.data.system).toMatchObject({
      public: "<p>Přeloženo: Public biography.</p>",
      private: "<p>Přeloženo: Private biography.</p>",
    });
    expect(result.data.items?.[0]?.system).toMatchObject({
      description: "<p>Přeloženo: Precise attack.</p>",
    });
  });
});
