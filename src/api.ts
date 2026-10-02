import { MODULE_ID, MODULE_VERSION } from "./constants";
import { resolveTranslationReference, type TranslationReferencePair } from "./translation/document-identity";
import { openTranslationReference } from "./translation/translated-link-navigation";
import { openAdventureReader } from "./reader/reader-app";

export interface FoundryTranslateApi {
  readonly id: typeof MODULE_ID;
  readonly version: string;
  isReady(): boolean;
  resolveReference(uuid: string, language: string): Promise<TranslationReferencePair>;
  openReference: typeof openTranslationReference;
  openReader: typeof openAdventureReader;
}

export function createApi(isReady: () => boolean): FoundryTranslateApi {
  return Object.freeze({
    id: MODULE_ID,
    version: MODULE_VERSION,
    isReady,
    resolveReference: resolveTranslationReference,
    openReference: openTranslationReference,
    openReader: openAdventureReader,
  });
}
