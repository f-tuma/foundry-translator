import { describe, expect, it } from "vitest";

import { GlossaryIntegrityError } from "../src/glossary/protection";
import {
  protectFoundrySyntax,
  restoreFoundrySyntax,
} from "../src/translation/foundry-syntax";

describe("Foundry syntax protection", () => {
  it("protects a UUID and braces while leaving its visible label translatable", () => {
    const protection = protectFoundrySyntax(
      "Open @UUID[JournalEntry.abc]{the journal} now.",
      { nonce: "UUID" },
    );

    expect(protection.text).toMatch(
      /^Open __FTS_UUID_0000____FTS_UUID_0001__the journal__FTS_UUID_0002__ now\.$/u,
    );
    expect(
      restoreFoundrySyntax(
        protection.text.replace("Open", "Otevři").replace("the journal", "deník"),
        protection,
      ),
    ).toBe("Otevři @UUID[JournalEntry.abc]{deník} now.");
  });

  it("translates human Embed options but preserves its exact configuration", () => {
    const source =
      '@Embed[Actor.abc inline cite=false readaloud="The heroes enter Ordain." classes="wide"]{Example actor}';
    const protection = protectFoundrySyntax(source, { nonce: "EMBED" });

    expect(protection.text).toContain("The heroes enter Ordain.");
    expect(protection.text).toContain("Example actor");
    expect(protection.text).not.toContain("Actor.abc");
    expect(protection.text).not.toContain("classes=\"wide\"");

    const translated = protection.text
      .replace("The heroes enter Ordain.", "Hrdinové vstoupí do Ordainu.")
      .replace("Example actor", "Ukázková postava");
    expect(restoreFoundrySyntax(translated, protection)).toBe(
      '@Embed[Actor.abc inline cite=false readaloud="Hrdinové vstoupí do Ordainu." classes="wide"]{Ukázková postava}',
    );
  });

  it("handles an Embed option whose value repeats its key", () => {
    const source = '@Embed[Actor.abc label="label" readaloud="readaloud"]';
    const protection = protectFoundrySyntax(source, { nonce: "REPEATED" });
    const translated = protection.text
      .replace("label", "popisek")
      .replace("readaloud", "hlasité čtení");

    expect(restoreFoundrySyntax(translated, protection)).toBe(
      '@Embed[Actor.abc label="popisek" readaloud="hlasité čtení"]',
    );
  });

  it("keeps inline rolls byte-for-byte exact", () => {
    const source = "Roll [[/r 1d20+5]] and continue.";
    const protection = protectFoundrySyntax(source, { nonce: "ROLL" });
    expect(restoreFoundrySyntax(protection.text.replace("Roll", "Hoď"), protection)).toBe(
      "Hoď [[/r 1d20+5]] and continue.",
    );
  });

  it("rejects missing, duplicated, unknown, and reordered syntax tokens", () => {
    const protection = protectFoundrySyntax(
      "@UUID[Actor.abc]{Actor} and [[/r 1d20]]",
      { nonce: "SAFE" },
    );
    const [first, second] = protection.tokens;
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    expect(() => restoreFoundrySyntax("Actor and roll", protection)).toThrow(
      GlossaryIntegrityError,
    );
    expect(() =>
      restoreFoundrySyntax(`${first?.token}${first?.token}${second?.token}`, protection),
    ).toThrow(GlossaryIntegrityError);
    expect(() =>
      restoreFoundrySyntax(`${protection.text} __FTS_SAFE_9999__`, protection),
    ).toThrow(GlossaryIntegrityError);

    const reversed = [...protection.tokens]
      .reverse()
      .map(({ token }) => token)
      .join("");
    expect(() => restoreFoundrySyntax(reversed, protection)).toThrow(/order/u);
  });
});
