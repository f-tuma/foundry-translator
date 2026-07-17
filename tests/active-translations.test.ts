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
    });
    registry.addIssue(id, {
      type: "unsupported",
      sourceUuid: "Scene.somewhere",
      parentUuid: "JournalEntry.guide",
      documentType: "Scene",
    });
    registry.finish(id);

    const log = formatRunLog(registry.get(id)!, "0.11.0");
    expect(log).toContain("Foundry Translate 0.11.0");
    expect(log).toContain("Document: Guide -> cs");
    expect(log).toContain("Issues: 3");
    expect(log).toContain("1. [fallback] Guide reason=unchanged attempts=3 occurrences=2");
    expect(log).toContain("   source: Shard of Fear");
    expect(log).toContain("2. [unresolved] Actor.missing in=JournalEntry.guide");
    expect(log).toContain("   detail: The reference could not be resolved");
    expect(log).toContain("3. [unsupported:Scene] Scene.somewhere in=JournalEntry.guide");
    expect(log).toContain("Recursive translation of Scene documents is not supported yet");
  });

  it("handles a cancel request and a cancelled finish", () => {
    const registry = new ActiveTranslationRegistry(() => 7);
    const id = registry.start("Guide", "cs");

    expect(registry.isCancelRequested(id)).toBe(false);
    registry.requestCancel(id);
    expect(registry.isCancelRequested(id)).toBe(true);
    registry.finishCancelled(id);

    const [run] = registry.list();
    expect(run?.state).toBe("cancelled");
    expect(run?.finishedAt).toBe(7);
    registry.requestCancel(id);
    expect(run?.state).toBe("cancelled");
  });

  it("removes only finished runs and can clear their history", () => {
    const registry = new ActiveTranslationRegistry(() => 7);
    const running = registry.start("Running", "cs", "JournalEntry.running");
    const done = registry.start("Done", "cs");
    const failed = registry.start("Failed", "cs");
    registry.finish(done);
    registry.finish(failed, "Provider failed");

    expect(registry.get(running)?.sourceUuid).toBe("JournalEntry.running");
    expect(registry.removeFinished(running)).toBe(false);
    expect(registry.removeFinished(done)).toBe(true);
    expect(registry.list().map(({ rootName }) => rootName)).toEqual(["Running", "Failed"]);
    expect(registry.clearFinished()).toBe(1);
    expect(registry.list().map(({ rootName }) => rootName)).toEqual(["Running"]);
  });

  it("counts issues beyond the cap instead of storing them", () => {
    const registry = new ActiveTranslationRegistry(() => 0);
    const id = registry.start("Guide", "cs");
    for (let index = 0; index < 505; index += 1) {
      registry.addIssue(id, { type: "unresolved", sourceUuid: `Actor.${index}` });
    }
    expect(registry.get(id)?.issues).toHaveLength(500);
    expect(registry.get(id)?.droppedIssues).toBe(5);
    const log = formatRunLog(registry.get(id)!, "x");
    expect(log).toContain("Issues: 500 (+5 more were not recorded)");
    expect(log).toContain("Issue summary (recorded): unresolved=500");
    expect(log).toContain("Issue details: first 50 of 500 recorded issues");
    expect(log).toContain("50. [unresolved] Actor.49");
    expect(log).not.toContain("51. [unresolved]");
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

  it("tracks the live root translation document once a checkpoint is stored", () => {
    const registry = new ActiveTranslationRegistry(() => 1_000);
    const id = registry.start("Guide", "cs");
    registry.update(id, {
      translatedDocumentUuid:
        "Compendium.world.foundry-translate-translations.JournalEntry.translated",
    });

    expect(registry.get(id)?.translatedDocumentUuid).toBe(
      "Compendium.world.foundry-translate-translations.JournalEntry.translated",
    );
  });

  it("aggregates LLM request telemetry and includes it in the copied log", () => {
    let now = 1_000;
    const registry = new ActiveTranslationRegistry(() => now);
    const id = registry.start("Guide", "cs");
    let notifications = 0;
    registry.subscribe(() => notifications += 1);
    registry.recordProviderMetrics(id, { phase: "started", model: "gemma" });
    expect(notifications).toBe(1);
    registry.recordProviderMetrics(id, {
      phase: "progress",
      model: "gemma",
      durationMs: 500,
      streamedCharacters: 24,
    });
    expect(notifications).toBe(1);
    registry.recordProviderMetrics(id, {
      phase: "diagnostic",
      model: "gemma",
      batchFallbacks: 1,
      sequentialFallbackTexts: 16,
      responseRetries: 2,
      nativeFallbacks: 1,
    });
    expect(registry.get(id)).toMatchObject({
      providerRequestActive: true,
      providerRequestCount: 1,
      providerStreamedCharacters: 24,
      providerBatchFallbacks: 1,
      providerSequentialFallbackTexts: 16,
      providerResponseRetries: 2,
      providerNativeFallbacks: 1,
    });
    expect(registry.get(id)?.providerOutputTokens).toBeUndefined();
    now = 2_500;
    registry.recordProviderMetrics(id, {
      phase: "completed",
      model: "gemma",
      durationMs: 1_500,
      inputTokens: 120,
      outputTokens: 60,
      reasoningTokens: 10,
      finishReason: "stop",
    });

    expect(registry.get(id)).toMatchObject({
      providerModel: "gemma",
      providerRequestCount: 1,
      providerRequestActive: false,
      providerInputTokens: 120,
      providerOutputTokens: 60,
      providerReasoningTokens: 10,
      providerGenerationMs: 1_500,
    });
    expect(formatRunLog(registry.get(id)!, "test"))
      .toContain("Provider: gemma; 1 requests; 120 input tokens; 60 output tokens; 10 reasoning tokens; 1500 ms");
    expect(formatRunLog(registry.get(id)!, "test"))
      .toContain("Provider fallbacks: 1 malformed batches; 16 texts sent sequentially; 2 response retries; 1 native API fallbacks");
  });

  it("keeps the original dependency failure detail in the copied log", () => {
    const registry = new ActiveTranslationRegistry(() => 0);
    const id = registry.start("Guide", "cs");
    registry.addIssue(id, {
      type: "failed",
      sourceUuid: "JournalEntry.players",
      parentUuid: "JournalEntry.gm",
      detail: "Překlad stránky 9/33 „Magic and Spellcraft“ selhal. Provider timed out.",
    });

    registry.finish(id);
    const log = formatRunLog(registry.get(id)!, "test");
    expect(log).toContain("State: done-with-issues");
    expect(log).toContain(
      "detail: Překlad stránky 9/33 „Magic and Spellcraft“ selhal. Provider timed out.",
    );
  });

});
