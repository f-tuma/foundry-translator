import { afterEach, describe, expect, it, vi } from "vitest";
import { getTranslatorSettings, saveTranslatorSettings } from "../src/settings/settings";
import { createTranslationProvider } from "../src/providers/factory";
import { OpenAiCompatibleProvider } from "../src/providers/openai-compatible";

describe("OpenAI-only active connection", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([undefined, "chrome-local", "google-cloud-basic", "invalid", "openai-compatible"])("normalizes old provider %s without reading or reusing a Google credential", async stored => {
    const values: Record<string, unknown> = { provider: stored, googleApiKey: "old-google-secret", openAiBaseUrl: "http://localhost:1234/v1", openAiModel: "hy-mt2-30b-a3b-apex", openAiApiKey: "openai-secret" };
    const get = vi.fn((_module, key: string) => values[key]);
    const set = vi.fn(async (_module, key: string, value) => { values[key] = value; });
    vi.stubGlobal("game", { settings: { get, set } });
    const settings = getTranslatorSettings();
    expect(settings.provider).toBe("openai-compatible");
    expect(settings.openAiApiKey).toBe("openai-secret");
    expect(get.mock.calls.some(([, key]) => key === "googleApiKey")).toBe(false);
    expect(createTranslationProvider({ ...settings, provider: "google-cloud-basic" })).toBeInstanceOf(OpenAiCompatibleProvider);
    await saveTranslatorSettings({ ...settings, provider: "chrome-local" });
    expect(values.provider).toBe("openai-compatible");
    expect(values.googleApiKey).toBe("old-google-secret");
  });
});
