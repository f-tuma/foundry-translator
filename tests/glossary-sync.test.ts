import { describe, expect, it } from "vitest";

import { planGlossarySync } from "../src/glossary/sync";
import type { GlossaryEntry } from "../src/glossary/types";

function entry(overrides: Partial<GlossaryEntry> = {}): GlossaryEntry {
  return {
    source: "Strahd",
    replacement: "Strahd",
    category: "character",
    aliases: [],
    sourceUuid: "Actor.strahd",
    ...overrides,
  };
}

describe("glossary synchronization planning", () => {
  it("creates new terms and leaves identical terms unchanged", () => {
    const plan = planGlossarySync(
      [entry({ id: "existing" })],
      [entry(), entry({ source: "Barovia", replacement: "Barovia", sourceUuid: "Scene.barovia", category: "location" })],
    );

    expect(plan.unchanged).toHaveLength(1);
    expect(plan.create.map(({ source }) => source)).toEqual(["Barovia"]);
    expect(plan.update).toHaveLength(0);
  });

  it("detects a renamed world document by UUID", () => {
    const plan = planGlossarySync(
      [entry({ id: "existing", source: "Old Strahd", replacement: "Old Strahd" })],
      [entry({ source: "Strahd von Zarovich", replacement: "Strahd von Zarovich" })],
    );

    expect(plan.update).toEqual([
      entry({ id: "existing", source: "Strahd von Zarovich", replacement: "Strahd von Zarovich" }),
    ]);
  });

  it("does not overwrite a manually customized replacement", () => {
    const plan = planGlossarySync(
      [entry({ id: "existing", source: "Old Strahd", replacement: "Hrabě Strahd" })],
      [entry({ source: "Strahd von Zarovich", replacement: "Strahd von Zarovich" })],
    );

    expect(plan.update[0]?.replacement).toBe("Hrabě Strahd");
  });

  it("matches an existing manual term by name without stealing its metadata", () => {
    const manual: GlossaryEntry = {
      id: "manual",
      source: "Strahd",
      replacement: "Strahd",
      category: "term",
      aliases: ["The Count"],
    };
    const plan = planGlossarySync([manual], [entry()]);

    expect(plan.update[0]).toEqual({
      ...manual,
      category: "character",
      sourceUuid: "Actor.strahd",
    });
  });
});
