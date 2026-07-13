import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import { planHtmlTranslation } from "../src/translation/html";

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
});
