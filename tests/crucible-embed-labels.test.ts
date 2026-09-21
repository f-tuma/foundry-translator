import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyEmbedLabel, registerCrucibleEmbedLabels } from "../src/translation/crucible-embed-labels";

afterEach(() => vi.unstubAllGlobals());

function card() {
  const { document } = parseHTML(`<document-embed uuid="Actor.hero">
    <img alt="Agraband Swift" src="portrait.webp">
    <header><h4><a data-uuid="Actor.hero"><i class="fa-user"></i>Agraband Swift</a></h4></header>
    <section><a data-uuid="Actor.other">Agraband Swift</a><a data-uuid="Actor.hero">the bard</a></section>
  </document-embed>`);
  return document.querySelector("document-embed") as unknown as HTMLElement;
}

describe("Crucible embedded document labels", () => {
  it("changes the matching name and portrait alt, preserving UUIDs, icons and explicit aliases", () => {
    const root = card();
    applyEmbedLabel(root, "Actor.hero", "Agraband Swift", "Agraband Rychlý");
    const link = root.querySelector("header a")!;
    expect(link.textContent).toBe("Agraband Rychlý");
    expect(link.querySelector("i")?.className).toBe("fa-user");
    expect(link.getAttribute("data-uuid")).toBe("Actor.hero");
    expect(root.getAttribute("uuid")).toBe("Actor.hero");
    expect(root.querySelector("img")?.getAttribute("alt")).toBe("Agraband Rychlý");
    expect(root.querySelector("section")?.textContent).toBe("Agraband Swiftthe bard");
  });

  it("treats labels as literal text, including markup", () => {
    const root = card();
    applyEmbedLabel(root, "Actor.hero", "Agraband Swift", '<img src=x onerror="alert(1)">');
    expect(root.querySelectorAll("img").length).toBe(1);
    expect(root.querySelector("header a")?.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it("updates Crucible's plain item heading without touching an embedded different item", () => {
    const { document } = parseHTML('<document-embed uuid="Item.note"><section class="crucible item-embed"><div class="action"><header class="action-header"><div class="title"><h4>A Farewell Note</h4></div></header></div></section><document-embed uuid="Item.other"><section class="crucible item-embed"><div class="action"><header class="action-header"><div class="title"><h4>A Farewell Note</h4></div></header></div></section></document-embed></document-embed>');
    const root = document.querySelector("document-embed") as unknown as HTMLElement;
    applyEmbedLabel(root, "Item.note", "A Farewell Note", "Dopis na Rozloučenou");
    expect([...root.querySelectorAll("h4")].map(node => node.textContent)).toEqual(["Dopis na Rozloučenou", "A Farewell Note"]);
  });

  it("wraps each configured document class once, forwarding configuration and preserving unlabeled cards", async () => {
    const original = vi.fn(async () => card());
    const actor = { toEmbed: original };
    const item = { toEmbed: vi.fn(async () => null) };
    vi.stubGlobal("CONFIG", { Actor: { documentClass: { prototype: actor } }, Item: { documentClass: { prototype: item } } });
    vi.stubGlobal("game", { system: { id: "crucible" } });
    registerCrucibleEmbedLabels();
    const wrapped = actor.toEmbed;
    registerCrucibleEmbedLabels();
    expect(actor.toEmbed).toBe(wrapped);
    const doc = { uuid: "Actor.hero", name: "Agraband Swift" };
    const invoke = actor.toEmbed as unknown as (this: typeof doc, config?: { label?: string }, extra?: string) => Promise<HTMLElement>;
    const options = { label: "Agraband Rychlý", inline: true };
    expect((await invoke.call(doc, options, "extra")).querySelector("header a")?.textContent).toBe("Agraband Rychlý");
    expect(original).toHaveBeenCalledWith(options, "extra");
    expect((await invoke.call(doc)).querySelector("header a")?.textContent).toBe("Agraband Swift");
  });

  it("leaves other systems untouched", () => {
    vi.stubGlobal("game", { system: { id: "dnd5e" } });
    expect(() => registerCrucibleEmbedLabels()).not.toThrow();
  });
});
