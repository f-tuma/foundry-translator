import { describe, expect, it, vi } from "vitest";

import {
  GoogleCloudBasicProvider,
  GoogleCloudTranslationError,
} from "../src/providers/google-cloud-basic";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("GoogleCloudBasicProvider", () => {
  it("sends the API key in a header and translates a batch", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          translations: [
            { translatedText: "Hrad", detectedSourceLanguage: "en" },
            { translatedText: "Hrabě" },
          ],
        },
      }),
    );
    const provider = new GoogleCloudBasicProvider("secret-key", fetchMock);

    const result = await provider.translate({
      texts: ["Castle", "Count"],
      sourceLanguage: "auto",
      targetLanguage: "cs",
    });

    expect(result).toEqual([
      { translatedText: "Hrad", detectedSourceLanguage: "en" },
      { translatedText: "Hrabě" },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).not.toContain("secret-key");
    expect(new Headers(init?.headers).get("X-goog-api-key")).toBe("secret-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      q: ["Castle", "Count"],
      target: "cs",
      format: "text",
      model: "nmt",
    });
  });

  it("performs a real translation request for the connection test", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: { translations: [{ translatedText: "Test připojení." }] } }),
    );
    const provider = new GoogleCloudBasicProvider("key", fetchMock);

    await provider.testConnection("cs");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      q: ["Connection test."],
      source: "en",
      target: "cs",
    });
  });

  it("returns a safe provider error without including the API key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { error: { code: 403, message: "Cloud Translation API has not been used" } },
        { status: 403 },
      ),
    );
    const provider = new GoogleCloudBasicProvider("never-leak-this-key", fetchMock);

    const promise = provider.testConnection("cs");

    await expect(promise).rejects.toBeInstanceOf(GoogleCloudTranslationError);
    await expect(promise).rejects.not.toThrow("never-leak-this-key");
  });

  it("rejects batches larger than the Google v2 limit before fetching", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new GoogleCloudBasicProvider("key", fetchMock);

    await expect(
      provider.translate({
        texts: Array.from({ length: 129 }, () => "text"),
        targetLanguage: "cs",
      }),
    ).rejects.toThrow("1 až 128");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
