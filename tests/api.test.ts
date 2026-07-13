import { describe, expect, it } from "vitest";

import { createApi } from "../src/api";
import { MODULE_ID, MODULE_VERSION } from "../src/constants";

describe("Foundry Translate public API", () => {
  it("reports immutable module identity and readiness", () => {
    let ready = false;
    const api = createApi(() => ready);

    expect(api.id).toBe(MODULE_ID);
    expect(api.version).toBe(MODULE_VERSION);
    expect(api.isReady()).toBe(false);

    ready = true;
    expect(api.isReady()).toBe(true);
    expect(Object.isFrozen(api)).toBe(true);
  });
});
