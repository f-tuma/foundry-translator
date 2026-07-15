import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  renderTranslatorSettingsForm,
  updateProviderFields,
} from "../src/settings/translator-settings-view";

describe("translator settings view", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders and toggles the OpenAI-compatible world-context editor", () => {
    const window = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("HTMLSelectElement", class {});
    vi.stubGlobal("HTMLInputElement", window.HTMLInputElement);
    vi.stubGlobal("HTMLTextAreaElement", window.HTMLTextAreaElement);
    vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });

    const form = renderTranslatorSettingsForm({
      provider: "openai-compatible",
      apiKey: "",
      openAiBaseUrl: "http://192.168.10.183:1234",
      openAiModel: "google/gemma-4-12b-qat",
      openAiApiKey: "",
      worldContext: "Temné fantasy",
      sourceLanguage: "en",
      targetLanguage: "cs",
    });

    expect(form.querySelector<HTMLInputElement>("[name='openAiModel']")?.value)
      .toBe("google/gemma-4-12b-qat");
    expect(form.querySelector<HTMLTextAreaElement>("[name='worldContext']")?.value)
      .toBe("Temné fantasy");
    expect(form.querySelector("[data-action='generate-world-context']")).not.toBeNull();
    expect(form.querySelector<HTMLElement>(".ft-settings__local-model")?.hidden).toBe(false);

    updateProviderFields(form, "chrome-local");
    expect(form.querySelector<HTMLElement>(".ft-settings__local-model")?.hidden).toBe(true);
  });
});
