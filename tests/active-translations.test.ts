import { describe, expect, it } from "vitest";

import {
  ActiveTranslationRegistry,
  estimateRemainingMs,
  formatRunLog,
} from "../src/translation/active-translations";

describe("Active translation registry", () => {
  it("tracks a run from scan through completion and notifies subscribers", () => {
    const registry = new ActiveTranslationRegistry(() => 1000);
    let notifications = 0;
    registry.subscribe(() => {
      notifications += 1;
    });

    const id = registry.start("Gamemaster's Guide", "cs");
    registry.update(id, {
      state: "translating",
      plan: { totalDocuments: 45, totalUnits: 312 },
    });
    registry.update(id, { completedUnits: 57, currentDocument: "Guide", currentUnit: "Overview" });
    registry.finish(id);

    const [run] = registry.list();
    expect(run).toMatchObject({
      rootName: "Gamemaster's Guide",
      targetLanguage: "cs",
      state: "done",
      completedUnits: 57,
      plan: { totalDocuments: 45, totalUnits: 312 },
    });
    expect(notifications).toBe(4);
  });

  it("keeps the error message and ignores updates after finishing", () => {
    const registry = new ActiveTranslationRegistry(() => 1000);
    const id = registry.start("Guide", "cs");
    registry.finish(id, "Provider failed");
    registry.update(id, { completedUnits: 99 });

    const [run] = registry.list();
    expect(run?.state).toBe("error");
    expect(run?.error).toBe("Provider failed");
    expect(run?.completedUnits).toBe(0);
  });

  it("prunes finished runs after the retention window on the next start", () => {
    let now = 0;
    const registry = new ActiveTranslationRegistry(() => now);
    const first = registry.start("Old", "cs");
    registry.finish(first);
    now = 11 * 60 * 1000;
    registry.start("New", "cs");

    expect(registry.list().map(({ rootName }) => rootName)).toEqual(["New"]);
  });

  it("collects issues and renders a copyable log", () => {
    const registry = new ActiveTranslationRegistry(() => 0);
    const id = registry.start("Guide", "cs");
    registry.update(id, { plan: { totalDocuments: 2, totalUnits: 10 }, completedUnits: 10, completedDocuments: 2 });
    registry.addIssue(id, {
      type: "fallback",
      documentName: "Guide",
      reason: "unchanged",
      attempts: 3,
      occurrences: 2,
      sourcePreview: "Shard of Fear",
      detail: "Output identical to source.",
    });
    registry.addIssue(id, {
      type: "unresolved",
      sourceUuid: "Actor.missing",
      parentUuid: "JournalEntry.guide",
      detail: "Odkaz Actor.missing se nepodařilo najít.",
    });
    registry.finish(id);

    const log = formatRunLog(registry.get(id)!, "0.11.0");
    expect(log).toContain("Foundry Translate 0.11.0");
    expect(log).toContain("Document: Guide -> cs");
    expect(log).toContain("Issues: 2");
    expect(log).toContain("1. [fallback] Guide reason=unchanged attempts=3 occurrences=2");
    expect(log).toContain("   source: Shard of Fear");
    expect(log).toContain("2. [unresolved] Actor.missing in=JournalEntry.guide");
  });

  it("estimates the remaining time from completed units", () => {
    const run = {
      id: 1,
      rootName: "Guide",
      targetLanguage: "cs",
      startedAt: 0,
      state: "translating" as const,
      plan: { totalDocuments: 2, totalUnits: 100 },
      completedUnits: 25,
      completedDocuments: 1,
      issues: [],
    };
    // 25 units in 50s -> 75 remaining units take 150s.
    expect(estimateRemainingMs(run, 50_000)).toBe(150_000);
    expect(estimateRemainingMs({ ...run, completedUnits: 0 }, 50_000)).toBeNull();
    expect(estimateRemainingMs({ ...run, finishedAt: 1 }, 50_000)).toBeNull();
  });
});
