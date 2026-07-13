import { MODULE_ID, MODULE_VERSION } from "./constants";

export interface FoundryTranslateApi {
  readonly id: typeof MODULE_ID;
  readonly version: string;
  isReady(): boolean;
}

export function createApi(isReady: () => boolean): FoundryTranslateApi {
  return Object.freeze({
    id: MODULE_ID,
    version: MODULE_VERSION,
    isReady,
  });
}
