import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChromeLocalProvider,
  ChromeLocalTranslationError,
  preservesProtectionTokens,
  type ChromeDownloadProgressEvent,
  type ChromeLanguageDetectorFactory,
  type ChromeTranslatorFactory,
} from "../src/providers/chrome-local";

function createTranslatorFactory(
  translate: (text: string) => string = (text) => `cs:${text}`,
): ChromeTranslatorFactory {
  return {
    availability: vi.fn().mockResolvedValue("downloadable"),
    create: vi.fn().mockImplementation(async (options) => {
      options.monitor?.({
        addEventListener: (
          _type: "downloadprogress",
          listener: (event: ChromeDownloadProgressEvent) => void,
        ) => listener({ loaded: 0.42 }),
      });
      return {
        translate: vi.fn().mockImplementation(async (text: string) => translate(text)),
      };
    }),
  };
}

function createDetectorFactory(language = "en"): ChromeLanguageDetectorFactory {
  return {
    availability: vi.fn().mockResolvedValue("available"),
    create: vi.fn().mockResolvedValue({
      detect: vi.fn().mockResolvedValue([
        { detectedLanguage: language, confidence: 0.99 },
      ]),
    }),
  };
}

describe("ChromeLocalProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects the source language and translates locally", async () => {
    const Translator = createTranslatorFactory();
    const LanguageDetector = createDetectorFactory();
    const provider = new ChromeLocalProvider({
      apis: { Translator, LanguageDetector },
    });

    const result = await provider.translate({
      texts: ["Castle", "Count"],
      sourceLanguage: "auto",
      targetLanguage: "cs",
    });

    expect(result).toEqual([
      { translatedText: "cs:Castle", detectedSourceLanguage: "en" },
      { translatedText: "cs:Count", detectedSourceLanguage: "en" },
    ]);
    expect(Translator.create).toHaveBeenCalledOnce();
    expect(Translator.create).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLanguage: "en", targetLanguage: "cs" }),
    );
  });

  it("reports language-pack download progress and readiness", async () => {
    const progress = vi.fn();
    const statuses = vi.fn();
    const provider = new ChromeLocalProvider({
      apis: { Translator: createTranslatorFactory() },
      onDownloadProgress: progress,
      onStatus: statuses,
    });

    await provider.testConnection("cs");

    expect(progress).toHaveBeenCalledWith(0.42);
    expect(statuses.mock.calls.map(([status]) => status.phase)).toEqual([
      "download",
      "ready",
    ]);
  });

  it("starts model creation before checking availability", async () => {
    const Translator = createTranslatorFactory();
    const provider = new ChromeLocalProvider({ apis: { Translator } });

    const connectionTest = provider.testConnection("cs");

    expect(Translator.create).toHaveBeenCalledOnce();
    await connectionTest;
    expect(Translator.availability).toHaveBeenCalledOnce();
    expect(vi.mocked(Translator.create).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(Translator.availability).mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("reports when Chrome needs to start downloading a language pack", async () => {
    let finishCreation: ((session: { translate(text: string): Promise<string> }) => void) | undefined;
    const Translator = createTranslatorFactory();
    vi.mocked(Translator.create).mockReturnValue(
      new Promise((resolve) => {
        finishCreation = resolve;
      }),
    );
    const statuses = vi.fn();
    const provider = new ChromeLocalProvider({
      apis: { Translator },
      onStatus: statuses,
    });

    const connectionTest = provider.testConnection("cs");
    await vi.waitFor(() => {
      expect(statuses).toHaveBeenCalledWith({
        phase: "availability",
        component: "translator",
        availability: "downloadable",
      });
    });
    finishCreation?.({ translate: async (text) => `cs:${text}` });
    await connectionTest;

    expect(statuses).toHaveBeenLastCalledWith({
      phase: "ready",
      component: "translator",
    });
  });

  it("does not require language detection when the source is selected", async () => {
    const Translator = createTranslatorFactory();
    const provider = new ChromeLocalProvider({ apis: { Translator } });

    await expect(
      provider.translate({ texts: ["Castle"], sourceLanguage: "en", targetLanguage: "cs" }),
    ).resolves.toEqual([{ translatedText: "cs:Castle" }]);
  });

  it("retries sporadic empty translations from a long-running Chrome session", async () => {
    let calls = 0;
    const Translator = createTranslatorFactory((text) => {
      calls += 1;
      return calls === 1 ? "" : `cs:${text}`;
    });
    const provider = new ChromeLocalProvider({ apis: { Translator } });

    await expect(
      provider.translate({ texts: ["Castle"], sourceLanguage: "en", targetLanguage: "cs" }),
    ).resolves.toEqual([{ translatedText: "cs:Castle" }]);
    expect(calls).toBe(2);
  });

  it("fails after three consecutive empty Chrome translations", async () => {
    let calls = 0;
    const Translator = createTranslatorFactory(() => {
      calls += 1;
      return "";
    });
    const provider = new ChromeLocalProvider({ apis: { Translator } });

    await expect(
      provider.translate({ texts: ["Castle"], sourceLanguage: "en", targetLanguage: "cs" }),
    ).rejects.toThrow("po 3 pokusech");
    expect(calls).toBe(3);
  });

  it("translates a protected logical block with full context when every token survives", async () => {
    const translatedInputs: string[] = [];
    const Translator = createTranslatorFactory((text) => {
      translatedInputs.push(text);
      return text.replace("Hello", "Ahoj").replace("world", "světe");
    });
    const provider = new ChromeLocalProvider({ apis: { Translator } });
    const first = "__FTN_BOUNDARY_0000__";
    const second = "__FTN_BOUNDARY_0001__";
    const third = "__FTN_BOUNDARY_0002__";

    const glossary = "__FTG_GLOSSARY0_0000__";
    const syntax = "__FTS_SYNTAX0_0000__";
    await expect(provider.translate({
      texts: [`${first}Hello ${glossary} ${syntax} ${second}world${third}`],
      sourceLanguage: "en",
      targetLanguage: "cs",
    })).resolves.toEqual([{
      translatedText: `${first}Ahoj ${glossary} ${syntax} ${second}světe${third}`,
    }]);
    expect(translatedInputs).toEqual([
      `${first}Hello ${glossary} ${syntax} ${second}world${third}`,
    ]);
  });

  it("falls back to isolated fragments when Chrome corrupts a protection token", async () => {
    const translatedInputs: string[] = [];
    const token = "__FTG_GLOSSARY0_0000__";
    const Translator = createTranslatorFactory((text) => {
      translatedInputs.push(text);
      if (text.includes(token)) return text.replace(token, "BROKEN");
      return text.replace("The", "Ten").replace("stands.", "stojí.");
    });
    const provider = new ChromeLocalProvider({ apis: { Translator } });

    await expect(provider.translate({
      texts: [`The ${token} stands.`],
      sourceLanguage: "en",
      targetLanguage: "cs",
    })).resolves.toEqual([{ translatedText: `Ten ${token} stojí.` }]);
    expect(translatedInputs.slice(0, 3)).toEqual(Array(3).fill(`The ${token} stands.`));
    expect(translatedInputs.slice(3)).toEqual(["The", "stands."]);
  });

  it("preserves whitespace around protection tokens when Chrome trims it", async () => {
    const Translator = createTranslatorFactory((text) =>
      text.replace("The", "To").replace("stands.", "stojí."));
    const provider = new ChromeLocalProvider({ apis: { Translator } });
    const token = "__FTG_SPACING_0000__";

    await expect(provider.translate({
      texts: [`The ${token} stands.`],
      sourceLanguage: "en",
      targetLanguage: "cs",
    })).resolves.toEqual([{ translatedText: `To ${token} stojí.` }]);
  });

  it("requires protection tokens to remain byte-exact and ordered", () => {
    const a = "__FTN_TEST_0000__";
    const b = "__FTN_TEST_0001__";
    expect(preservesProtectionTokens(`${a}Hello${b}`, `${a}Ahoj${b}`)).toBe(true);
    expect(preservesProtectionTokens(`${a}Hello${b}`, `${b}Ahoj${a}`)).toBe(false);
    expect(preservesProtectionTokens(`${a}Hello${b}`, `${a}Ahoj`)).toBe(false);
  });

  it("prepares the selected language pair immediately from a user action", async () => {
    const Translator = createTranslatorFactory();
    const provider = new ChromeLocalProvider({ apis: { Translator } });

    const preparation = provider.prepare({
      texts: ["Castle Ravenloft"],
      sourceLanguage: "en",
      targetLanguage: "cs",
    });

    expect(Translator.create).toHaveBeenCalledOnce();
    await preparation;
  });

  it("reports when Chrome rejects creation of a language pair", async () => {
    const Translator = createTranslatorFactory();
    vi.mocked(Translator.create).mockRejectedValue(
      new DOMException("Language pair unavailable", "NotSupportedError"),
    );
    const provider = new ChromeLocalProvider({ apis: { Translator } });

    await expect(provider.testConnection("cs")).rejects.toBeInstanceOf(
      ChromeLocalTranslationError,
    );
    expect(Translator.create).toHaveBeenCalledOnce();
  });

  it("times out instead of waiting indefinitely for a model download", async () => {
    vi.useFakeTimers();
    const Translator = createTranslatorFactory();
    vi.mocked(Translator.create).mockReturnValue(new Promise(() => undefined));
    const provider = new ChromeLocalProvider({
      apis: { Translator },
      modelTimeoutMs: 100,
    });

    const expectation = expect(provider.testConnection("cs")).rejects.toThrow(
      "do 5 minut",
    );
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
  });

  it("explains when the browser does not expose the Translator API", async () => {
    const provider = new ChromeLocalProvider({ apis: {} });

    await expect(provider.testConnection("cs")).rejects.toThrow(
      "desktopový Chrome 138",
    );
  });

  it("rejects raw HTML until document markup protection is implemented", async () => {
    const provider = new ChromeLocalProvider({
      apis: { Translator: createTranslatorFactory() },
    });

    await expect(
      provider.translate({
        texts: ["<p>Castle</p>"],
        sourceLanguage: "en",
        targetLanguage: "cs",
        format: "html",
      }),
    ).rejects.toThrow("HTML");
  });
});
