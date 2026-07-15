import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { collectWorldContextSource } from "../src/settings/world-context";

function journal(name: string, pageName: string, content: string) {
  return {
    name,
    toObject: () => ({
      pages: [{ name: pageName, text: { content } }],
    }),
  };
}

describe("world context source", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("combines keyword-selected overview material with random cross-world samples", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", {
      world: { title: "Ember Test", description: "An official open-world fantasy description." },
      system: { id: "crucible", title: "Crucible", version: "0.10.1" },
      journal: { contents: [
        journal("Chamber of One Dungeon", "Room One", "A".repeat(5_000)),
        journal("Gamemaster's Guide", "World Setting and History", "THE_BROAD_WORLD_LORE describes cultures factions history geography religion and recurring conflicts."),
        journal("A Random Side Quest", "Market Trouble", "THE_RANDOM_ADVENTURE_SAMPLE follows travelers through a busy market during a local festival."),
      ] },
      actors: { contents: [{ name: "Ember Hero" }, { name: "Ordani Sage" }] },
      items: { contents: [{ name: "Fulgurite Blade" }] },
      scenes: { contents: [{ name: "All-Fable Keep" }] },
    });

    const source = collectWorldContextSource({
      maxCharacters: 5_000,
      random: () => 0.25,
    });

    expect(source).toContain("intentionally incomplete world sample");
    expect(source).toContain("World: Ember Test");
    expect(source).toContain("Active system: Crucible 0.10.1");
    expect(source).toContain("Official world description: An official open-world fantasy description.");
    expect(source).toContain("[keyword] Gamemaster's Guide / World Setting and History");
    expect(source).toContain("THE_BROAD_WORLD_LORE");
    expect(source).toContain("[random] A Random Side Quest / Market Trouble");
    expect(source).toContain("THE_RANDOM_ADVENTURE_SAMPLE");
    expect(source).toContain("Ember Hero");
    expect(source).toContain("Fulgurite Blade");
    expect(source).toContain("All-Fable Keep");
    expect(source.length).toBeLessThanOrEqual(5_000);
  });

  it("never lets a large first Journal consume the complete context budget", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", {
      world: { title: "Large World" },
      system: { id: "crucible" },
      journal: { contents: [
        journal("First Adventure", "Huge Page", "X".repeat(50_000)),
        journal("World Lore", "Factions Overview", "IMPORTANT_LATE_LORE describes several factions cultures regions histories and ancient conflicts."),
      ] },
      actors: { contents: [] },
      items: { contents: [] },
      scenes: { contents: [] },
    });

    const source = collectWorldContextSource({ random: () => 0.5 });

    expect(source).toContain("IMPORTANT_LATE_LORE");
    expect(source).toContain("[keyword] World Lore / Factions Overview");
    expect(source.length).toBeLessThanOrEqual(12_000);
    expect(source).not.toContain("X".repeat(901));
  });

  it("filters unfinished and reference-only pages before keyword selection", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", {
      world: { title: "Filtered World" },
      system: { id: "crucible" },
      journal: { contents: [
        journal("World Guide", "Empty Overview", "Under Construction. This page is currently being developed and no further information is available."),
        journal("Setting Guide", "Embedded Map", "@Embed[JournalEntry.somewhere.JournalEntryPage.map inline]"),
        journal("History", "Useful Timeline", "A useful historical timeline describes ancient cultures, regions, factions, migrations, and wars."),
      ] },
      actors: { contents: [] },
      items: { contents: [] },
      scenes: { contents: [] },
    });

    const source = collectWorldContextSource({ random: () => 0.5 });

    expect(source).toContain("[keyword] History / Useful Timeline");
    expect(source).not.toContain("Under Construction");
    expect(source).not.toContain("@Embed[");
  });
});
