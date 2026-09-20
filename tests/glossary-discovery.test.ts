import { describe, expect, it } from "vitest";

import { discoverGlossaryEntries } from "../src/glossary/discovery";

describe("glossary discovery", () => {
  it("classifies Crucible group actors as factions, including caravans", () => {
    const [caravan] = discoverGlossaryEntries({ actors: [{ name: "Strayhearth Caravan", type: "group", uuid: "Actor.caravan" }], scenes: [] });
    expect(caravan?.category).toBe("faction");
    expect(caravan?.replacement).toBe("Strayhearth Caravan");
  });
  it("discovers actors and scenes while preserving their original names", () => {
    const entries = discoverGlossaryEntries({
      actors: [{ name: "Strahd von Zarovich", uuid: "Actor.strahd" }],
      scenes: [{ name: "Castle Ravenloft", uuid: "Scene.ravenloft" }],
    });

    expect(entries).toEqual([
      {
        source: "Castle Ravenloft",
        replacement: "Castle Ravenloft",
        category: "location",
        aliases: [],
        sourceUuid: "Scene.ravenloft",
      },
      {
        source: "Strahd von Zarovich",
        replacement: "Strahd von Zarovich",
        category: "character",
        aliases: [],
        sourceUuid: "Actor.strahd",
      },
    ]);
  });

  it("ignores blank names and deduplicates names case-insensitively", () => {
    const entries = discoverGlossaryEntries({
      actors: [{ name: "  " }, { name: "Barovia", uuid: "Actor.barovia" }],
      scenes: [{ name: null }, { name: "barovia", uuid: "Scene.barovia" }],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.category).toBe("character");
    expect(entries[0]?.source).toBe("Barovia");
  });
});
