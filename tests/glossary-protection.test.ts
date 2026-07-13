import { describe, expect, it } from "vitest";

import {
  GlossaryConflictError,
  GlossaryIntegrityError,
  protectGlossaryTerms,
  restoreGlossaryTerms,
} from "../src/glossary/protection";
import type { GlossaryEntry } from "../src/glossary/types";

function entry(
  source: string,
  replacement = source,
  aliases: string[] = [],
): GlossaryEntry {
  return { source, replacement, aliases, category: "term" };
}

describe("glossary protection", () => {
  it("protects and restores every occurrence with a unique token", () => {
    const protection = protectGlossaryTerms(
      "Strahd entered Castle Ravenloft. Strahd smiled.",
      [entry("Strahd"), entry("Castle Ravenloft")],
      { nonce: "TEST" },
    );

    expect(protection.text).toBe(
      "__FTG_TEST_0000__ entered __FTG_TEST_0001__. __FTG_TEST_0002__ smiled.",
    );
    expect(restoreGlossaryTerms("Do __FTG_TEST_0000__ vstoupil __FTG_TEST_0001__. __FTG_TEST_0002__ se usmál.", protection)).toBe(
      "Do Strahd vstoupil Castle Ravenloft. Strahd se usmál.",
    );
  });

  it("prefers the longest overlapping name", () => {
    const protection = protectGlossaryTerms(
      "Castle Ravenloft overlooks Ravenloft.",
      [entry("Ravenloft"), entry("Castle Ravenloft")],
      { nonce: "LONG" },
    );

    expect(protection.tokens.map(({ source }) => source)).toEqual([
      "Castle Ravenloft",
      "Ravenloft",
    ]);
  });

  it("honors Unicode word boundaries and exact letter case", () => {
    const protection = protectGlossaryTerms(
      "Ann potkala Annu a ann. Éowyn potkala Préowyn.",
      [entry("Ann"), entry("Éowyn")],
      { nonce: "BOUNDARY" },
    );

    expect(protection.tokens.map(({ source }) => source)).toEqual(["Ann", "Éowyn"]);
    expect(protection.text).toContain("Annu");
    expect(protection.text).toContain("ann");
    expect(protection.text).toContain("Préowyn");
  });

  it("protects aliases but restores the configured canonical replacement", () => {
    const protection = protectGlossaryTerms(
      "The Count returned.",
      [entry("Strahd von Zarovich", "Strahd von Zarovich", ["The Count"])],
      { nonce: "ALIAS" },
    );

    expect(restoreGlossaryTerms(protection.text, protection)).toBe(
      "Strahd von Zarovich returned.",
    );
  });

  it("accepts ASCII case changes made to otherwise exact glossary tokens", () => {
    const protection = protectGlossaryTerms(
      "Meet Strahd at Castle Ravenloft.",
      [entry("Strahd"), entry("Castle Ravenloft")],
      { nonce: "CHROME" },
    );

    expect(
      restoreGlossaryTerms(
        "Potkejte __ftg_chrome_0000__ na __FtG_ChRoMe_0001__.",
        protection,
      ),
    ).toBe("Potkejte Strahd na Castle Ravenloft.");
  });

  it("refuses missing, duplicated, and unknown tokens", () => {
    const protection = protectGlossaryTerms("Strahd waits.", [entry("Strahd")], {
      nonce: "SAFE",
    });
    const [token] = protection.tokens;
    expect(token).toBeDefined();

    expect(() => restoreGlossaryTerms("Hrabě čeká.", protection)).toThrow(
      GlossaryIntegrityError,
    );
    expect(() =>
      restoreGlossaryTerms(`${token?.token} ${token?.token}`, protection),
    ).toThrow(GlossaryIntegrityError);
    expect(() => restoreGlossaryTerms("__FTG_SAFE_9999__ čeká.", protection)).toThrow(
      GlossaryIntegrityError,
    );
    expect(() => restoreGlossaryTerms("__ftg_safe_9999__ čeká.", protection)).toThrow(
      GlossaryIntegrityError,
    );
  });

  it("rejects conflicting alias replacements", () => {
    expect(() =>
      protectGlossaryTerms("The Count", [
        entry("Strahd", "Strahd", ["The Count"]),
        entry("Vasili", "Vasili", ["The Count"]),
      ]),
    ).toThrow(GlossaryConflictError);
  });
});
