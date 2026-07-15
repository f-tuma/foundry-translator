import { describe, expect, it } from "vitest";

import { planMarkdownTranslation } from "../src/translation/markdown";

function translate(markdown: string): string {
  const plan = planMarkdownTranslation(markdown);
  return plan.apply(plan.units.map((unit) => unit.map((segment) => segment
    .replace("The brave heroes", "Stateční hrdinové")
    .replace("The vampire", "Upír")
    .replace("The ", "Ti ")
    .replace("brave", "stateční")
    .replace(" heroes", " hrdinové")
    .replace("Old castle", "Starý hrad")
    .replace("Map of the valley", "Mapa údolí")
    .replace("stands here", "stojí zde")
    .replace("Name", "Název")
    .replace("Description", "Popis")
    .replace("Ancient place", "Starobylé místo"))));
}

describe("Markdown translation", () => {
  it("translates visible text while preserving Markdown and Foundry mechanics", () => {
    const source = [
      "# The **brave** heroes",
      "",
      "Visit [Old castle](https://example.com/castle \"Technical title\") and ![Map of the valley](/images/map.webp).",
      "@UUID[Actor.vampire]{The vampire} stands here. Roll [[/r 1d20]].",
      "",
      "| Name | Description |",
      "| :--- | ---: |",
      "| Castle | Ancient place |",
      "",
      "`const untranslated = true`",
      "",
      "```js",
      "const message = \"The brave heroes\";",
      "```",
      "",
      "[castle]: https://example.com/technical \"Do not translate\"",
    ].join("\n");

    const translated = translate(source);

    expect(translated).toContain("# Ti **stateční** hrdinové");
    expect(translated).toContain("[Starý hrad](https://example.com/castle \"Technical title\")");
    expect(translated).toContain("![Mapa údolí](/images/map.webp)");
    expect(translated).toContain("@UUID[Actor.vampire]{Upír} stojí zde.");
    expect(translated).toContain("[[/r 1d20]]");
    expect(translated).toContain("| Název | Popis |");
    expect(translated).toContain("| :--- | ---: |");
    expect(translated).toContain("`const untranslated = true`");
    expect(translated).toContain("const message = \"The brave heroes\";");
    expect(translated).toContain('[castle]: https://example.com/technical "Do not translate"');
  });

  it("preserves YAML frontmatter and indented code", () => {
    const source = [
      "---",
      "title: The brave heroes",
      "slug: technical-value",
      "---",
      "The brave heroes",
      "",
      "    The brave heroes",
    ].join("\n");

    const translated = translate(source);
    expect(translated).toContain("title: The brave heroes");
    expect(translated).toContain("Stateční hrdinové\n\n    The brave heroes");
  });

  it("rejects a translated structure with a different number of units", () => {
    const plan = planMarkdownTranslation("Text to translate.");
    expect(() => plan.apply([])).toThrow("Markdown bloků");
  });
});
