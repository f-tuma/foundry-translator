import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OpenAiCompatibleProvider,
  OpenAiCompatibleTranslationError,
} from "../src/providers/openai-compatible";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("OpenAiCompatibleProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes an LM Studio root URL and sends context, glossary, model, and token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: "Vítej v __FTG_TEST_0001__." } }],
    }));
    const provider = new OpenAiCompatibleProvider({
      baseUrl: "http://localhost:1234/",
      model: "gemma-test",
      apiKey: "local-secret",
      worldContext: "Temné gotické fantasy.",
      fetchImplementation: fetchMock,
    });

    await provider.translate({
      texts: ["Welcome to __FTG_TEST_0001__."],
      sourceLanguage: "en",
      targetLanguage: "cs",
      glossary: [{ source: "Castle Ravenloft", replacement: "Hrad Ravenloft" }],
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:1234/v1/chat/completions");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer local-secret");
    const payload = JSON.parse(String(init?.body));
    expect(payload.model).toBe("gemma-test");
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0].role).toBe("user");
    expect(payload.messages[0].content).toContain("Temné gotické fantasy");
    expect(payload.messages[0].content).toContain("Castle Ravenloft => Hrad Ravenloft");
    expect(payload.messages[0].content).toContain("__FTG_TEST_0001__");
  });

  it("checks the exact model ID and performs a real translation", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "google/gemma" }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "Test." } }] }));
    const provider = new OpenAiCompatibleProvider({
      baseUrl: "http://localhost:1234/v1",
      model: "google/gemma",
      fetchImplementation: fetchMock,
    });

    await provider.testConnection("cs");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:1234/v1/models",
      "http://localhost:1234/v1/chat/completions",
    ]);
  });

  it("reports available models when the selected model is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: [{ id: "gemma-a" }, { id: "qwen-b" }] }),
    );
    const provider = new OpenAiCompatibleProvider({
      baseUrl: "http://localhost:1234",
      model: "missing",
      fetchImplementation: fetchMock,
    });

    await expect(provider.testConnection("cs")).rejects.toThrow("gemma-a, qwen-b");
  });

  it("uses Foundry timeout-aware fetch and does not leak a token on network failure", async () => {
    const fetchWithTimeout = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("foundry", { utils: { fetchWithTimeout } });
    const provider = new OpenAiCompatibleProvider({
      baseUrl: "http://localhost:1234",
      model: "gemma",
      apiKey: "never-leak-this",
    });

    const promise = provider.testConnection("cs");
    await expect(promise).rejects.toBeInstanceOf(OpenAiCompatibleTranslationError);
    await expect(promise).rejects.not.toThrow("never-leak-this");
    expect(fetchWithTimeout.mock.calls[0]?.[2]).toEqual({ timeoutMs: 120_000 });
  });

  it("generates an editable context profile with a single user message", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: "Gotická fantasy s tragickým tónem." } }],
    }));
    const provider = new OpenAiCompatibleProvider({
      baseUrl: "http://localhost:1234",
      model: "gemma",
      fetchImplementation: fetchMock,
    });

    await expect(provider.generateWorldContext("Journal: Barovia", "cs"))
      .resolves.toBe("Gotická fantasy s tragickým tónem.");
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0].content).toContain("Journal: Barovia");
  });
});
