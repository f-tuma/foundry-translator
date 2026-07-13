export interface TranslationCache {
  get(key: string): Promise<readonly string[] | null>;
  set(key: string, translatedSegments: readonly string[]): Promise<void>;
  setMany?(entries: readonly TranslationCacheEntry[]): Promise<void>;
}

export interface TranslationCacheEntry {
  key: string;
  translatedSegments: readonly string[];
}

export class MemoryTranslationCache implements TranslationCache {
  readonly #values = new Map<string, readonly string[]>();

  async get(key: string): Promise<readonly string[] | null> {
    return this.#values.get(key) ?? null;
  }

  async set(key: string, translatedSegments: readonly string[]): Promise<void> {
    this.#values.set(key, [...translatedSegments]);
  }

  async setMany(entries: readonly TranslationCacheEntry[]): Promise<void> {
    for (const { key, translatedSegments } of entries) {
      await this.set(key, translatedSegments);
    }
  }
}
