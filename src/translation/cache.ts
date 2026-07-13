export interface TranslationCache {
  get(key: string): Promise<readonly string[] | null>;
  getMany?(keys: readonly string[]): Promise<Map<string, readonly string[]>>;
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

  async getMany(keys: readonly string[]): Promise<Map<string, readonly string[]>> {
    const values = new Map<string, readonly string[]>();
    for (const key of keys) {
      const value = this.#values.get(key);
      if (value) values.set(key, value);
    }
    return values;
  }

  async setMany(entries: readonly TranslationCacheEntry[]): Promise<void> {
    for (const { key, translatedSegments } of entries) {
      await this.set(key, translatedSegments);
    }
  }
}
