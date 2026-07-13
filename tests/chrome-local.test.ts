import { describe, expect, it, vi } from "vitest";

import {
  ChromeLocalProvider,
  ChromeLocalTranslationError,
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

  it("reports language-pack download progress", async () => {
    const progress = vi.fn();
    const provider = new ChromeLocalProvider({
      apis: { Translator: createTranslatorFactory() },
      onDownloadProgress: progress,
    });

    await provider.testConnection("cs");

    expect(progress).toHaveBeenCalledWith(0.42);
  });

  it("does not require language detection when the source is selected", async () => {
    const Translator = createTranslatorFactory();
    const provider = new ChromeLocalProvider({ apis: { Translator } });

    await expect(
      provider.translate({ texts: ["Castle"], sourceLanguage: "en", targetLanguage: "cs" }),
    ).resolves.toEqual([{ translatedText: "cs:Castle" }]);
  });

  it("rejects an unavailable language pair before creating a translator", async () => {
    const Translator = createTranslatorFactory();
    vi.mocked(Translator.availability).mockResolvedValue("unavailable");
    const provider = new ChromeLocalProvider({ apis: { Translator } });

    await expect(provider.testConnection("cs")).rejects.toBeInstanceOf(
      ChromeLocalTranslationError,
    );
    expect(Translator.create).not.toHaveBeenCalled();
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
