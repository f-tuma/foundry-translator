import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import {
  MAX_HTML_UNIT_CHARACTERS,
  planHtmlTranslation,
} from "../src/translation/html";

describe("HTML translation planning", () => {
  it("groups inline text for context while preserving markup and attributes", () => {
    const { document } = parseHTML("<html><body></body></html>");
    const plan = planHtmlTranslation(
      '<p class="lead">Enter <strong data-id="keep">Castle Ravenloft</strong> now.</p>',
      document,
    );

    expect(plan.units).toEqual([["Enter ", "Castle Ravenloft", " now."]]);
    expect(plan.apply([["Vstupte ", "Castle Ravenloft", " nyní."]])).toBe(
      '<p class="lead">Vstupte <strong data-id="keep">Castle Ravenloft</strong> nyní.</p>',
    );
  });

  it("keeps code and preformatted content untouched", () => {
    const { document } = parseHTML("<html><body></body></html>");
    const plan = planHtmlTranslation(
      "<p>Translate me.</p><pre>const Strahd = true;</pre><code>Ravenloft</code>",
      document,
    );

    expect(plan.units).toEqual([["Translate me."]]);
    expect(plan.apply([["Přelož mě."]])).toBe(
      "<p>Přelož mě.</p><pre>const Strahd = true;</pre><code>Ravenloft</code>",
    );
  });

  it("rejects a translated structure with a different number of segments", () => {
    const { document } = parseHTML("<html><body></body></html>");
    const plan = planHtmlTranslation("<p>Hello <em>world</em>.</p>", document);

    expect(() => plan.apply([["Ahoj světe."]])).toThrow(/Struktura/);
  });

  it("splits very long text at safe boundaries and joins it into the original node", () => {
    const { document } = parseHTML("<html><body></body></html>");
    const source = "A long sentence for the translator. ".repeat(260);
    const plan = planHtmlTranslation(`<p>${source}</p>`, document);

    expect(plan.units.length).toBeGreaterThan(2);
    expect(plan.units.every((unit) => unit.join("").length <= MAX_HTML_UNIT_CHARACTERS)).toBe(true);
    const translated = plan.units.map((unit) =>
      unit.map((segment) => segment.replaceAll("long sentence", "dlouhá věta")),
    );
    expect(plan.apply(translated)).toBe(
      `<p>${source.replaceAll("long sentence", "dlouhá věta")}</p>`,
    );
  });
});
