import { describe, expect, it } from "vitest";
import { ActiveTranslationRegistry, estimateRemainingMs } from "../src/translation/active-translations";
import { traverseDependencyGraph } from "../src/translation/dependency-graph";

describe("cooperative translation pause", () => {
  it("waits at a saved boundary and resumes without counting paused time in ETA", async () => {
    let now = 0;
    const registry = new ActiveTranslationRegistry(() => now);
    const id = registry.start("Guide", "cs");
    registry.update(id, { state: "translating", completedUnits: 2, plan: { totalDocuments: 1, totalUnits: 4 } });
    now = 1000;
    registry.requestPause(id);
    expect(registry.get(id)?.pausedAt).toBeUndefined(); // current batch still runs
    let continued = false;
    const work = registry.waitUntilResumed(id).then(() => { continued = true; });
    await Promise.resolve();
    expect(registry.get(id)?.pausedAt).toBe(1000);
    expect(continued).toBe(false);
    expect(estimateRemainingMs(registry.get(id)!, now)).toBeNull();
    now = 61_000;
    registry.resume(id);
    await work;
    expect(continued).toBe(true);
    expect(registry.get(id)?.pauseRequested).toBeUndefined();
    expect(estimateRemainingMs(registry.get(id)!, now)).toBe(1000);
  });

  it("wakes a paused job when cancelled and ignores pause after finish", async () => {
    const registry = new ActiveTranslationRegistry();
    const id = registry.start("Guide", "cs");
    registry.requestPause(id);
    const work = registry.waitUntilResumed(id);
    registry.requestCancel(id);
    await work;
    expect(registry.isCancelRequested(id)).toBe(true);
    registry.finishCancelled(id);
    registry.requestPause(id);
    expect(registry.get(id)?.pauseRequested).toBeUndefined();
    expect(registry.get(id)?.state).toBe("cancelled");
  });

  it("can withdraw a pause before the batch completes", async () => {
    const registry = new ActiveTranslationRegistry();
    const id = registry.start("Guide", "cs");
    registry.requestPause(id);
    registry.resume(id);
    await registry.waitUntilResumed(id);
    expect(registry.get(id)?.pausedAt).toBeUndefined();
  });

  it("propagates a stop from a dependency instead of starting later documents", async () => {
    const stopped = new Error("stop");
    const visited: string[] = [];
    await expect(traverseDependencyGraph({
      root: "root", key: value => value,
      dependencies: value => value === "root" ? ["first", "later"] : [],
      process: value => { visited.push(value); throw stopped; },
      shouldAbort: error => error === stopped,
    })).rejects.toBe(stopped);
    expect(visited).toEqual(["first"]);
  });
});
