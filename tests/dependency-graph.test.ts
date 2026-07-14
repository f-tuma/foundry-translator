import { describe, expect, it, vi } from "vitest";

import { traverseDependencyGraph } from "../src/translation/dependency-graph";

describe("dependency graph traversal", () => {
  it("processes dependencies before parents and deduplicates shared nodes", async () => {
    const graph = new Map([
      ["A", ["B", "C"]],
      ["B", ["D"]],
      ["C", ["D"]],
      ["D", []],
    ]);
    const processed: string[] = [];

    const result = await traverseDependencyGraph({
      root: "A",
      key: (node) => node,
      dependencies: (node) => graph.get(node) ?? [],
      process: (node) => { processed.push(node); },
    });

    expect(processed).toEqual(["D", "B", "C", "A"]);
    expect(result.failures).toHaveLength(0);
  });

  it("breaks cycles and still processes every node once", async () => {
    const cycle = vi.fn();
    const processed: string[] = [];

    await traverseDependencyGraph({
      root: "A",
      key: (node) => node,
      dependencies: (node) => node === "A" ? ["B"] : ["A"],
      process: (node) => { processed.push(node); },
      onCycle: cycle,
    });

    expect(processed).toEqual(["B", "A"]);
    expect(cycle).toHaveBeenCalledWith("B", "A");
  });

  it("records an isolated dependency failure without failing the root", async () => {
    const processed: string[] = [];
    const result = await traverseDependencyGraph({
      root: "A",
      key: (node) => node,
      dependencies: (node) => node === "A" ? ["B", "C"] : [],
      process: (node) => {
        if (node === "B") throw new Error("broken dependency");
        processed.push(node);
      },
    });

    expect(processed).toEqual(["C", "A"]);
    expect(result.failures).toHaveLength(1);
    expect(result.states.get("B")).toBe("failed");
  });
});
