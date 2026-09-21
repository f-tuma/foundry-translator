import { describe, expect, it } from "vitest";
import { prepareStructuredProse } from "../src/providers/structured-items";

const name = { token: "__FTG_T_0000__", endToken: "__FTG_T_0000END__", source: "Old Carinth", replacement: "Starý Carinth" };
const pair = name.token + name.replacement + name.endToken;

describe("structured contextual units", () => {
  it("constrains keys and restores a link around an inflected phrase", () => {
    const batch = prepareStructuredProse([`Travel to __FTS_T_0000__${pair}__FTS_T_0001__.`], [name])!;
    expect(JSON.parse(batch.text)).toEqual({ i0: "Travel to Old Carinth." });
    expect(batch.schema).toEqual({ type: "object", properties: { i0: { type: "string" } }, required: ["i0"], additionalProperties: false });
    expect(batch.restore(JSON.stringify({ i0: "Vydejte se do Starého Carinthu." })))
      .toEqual([`Vydejte se do __FTS_T_0000__${name.token}Starého Carinthu${name.endToken}__FTS_T_0001__.`]);
  });

  it("keeps successful items when another item violates the glossary", () => {
    const batch = prepareStructuredProse([`From ${pair}.`, "The gate is closed."], [name])!;
    expect(batch.restore(JSON.stringify({ i0: "Z Prahy.", i1: "Brána je zavřená." })))
      .toEqual(["", "Brána je zavřená."]);
    for (const output of ['{}', '{"i0":"x","i1":"y","extra":"z"}', '{"i0":"x","i1":2}', '[]', 'x']) {
      expect(batch.restore(output)).toBeNull();
    }
  });

  it("retains fixed names, rolls and segment boundaries and rejects moved syntax", () => {
    const batch = prepareStructuredProse(["From __FTG_FIXED_0000__. Roll __FTS_T_0000__."], [])!;
    const source = JSON.parse(batch.text) as Record<string, string>;
    const output = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, value.replace("From", "Z").replace("Roll", "Hoďte")]));
    expect(batch.restore(JSON.stringify(output)))
      .toEqual(["Z __FTG_FIXED_0000__. Hoďte __FTS_T_0000__."]);
    expect(batch.restore(JSON.stringify({ ...output, i0: output.i0!.replace(/<keep[^>]*>/u, "") }))).toEqual([""]);
  });
  it("checks repeated names in their sentences and preserves whitespace when regrouping", () => {
    const second = { ...name, token: "__FTG_T_0001__", endToken: "__FTG_T_0001END__" };
    const source = `From ${pair}.  Return to ${second.token}${second.replacement}${second.endToken}.`;
    const batch = prepareStructuredProse([source], [name, second])!;
    expect(Object.keys(JSON.parse(batch.text))).toEqual(["i0", "i1"]);
    expect(batch.restore(JSON.stringify({ i0: "Ze Starého Carinthu.", i1: "Vraťte se do Starého Carinthu." })))
      .toEqual([`Ze ${name.token}Starého Carinthu${name.endToken}.  Vraťte se do ${second.token}Starého Carinthu${second.endToken}.`]);
    expect(batch.restore(JSON.stringify({ i0: "Ze Starého Carinthu.", i1: "Vraťte se tam." }))).toEqual([""]);
  });

  it("does not cut glossary abbreviations or split a sentence across HTML segments", () => {
    const abbreviated = { ...name, source: "Dr. Amber", replacement: "Dr. Jantar" };
    const pair = abbreviated.token + abbreviated.replacement + abbreviated.endToken;
    const batch = prepareStructuredProse([`Speak with ${pair}.`, `__FTN_T_0000__Return to __FTN_T_0001__${pair}__FTN_T_0002__.`], [abbreviated]);
    // A malformed segment wrapper is rejected before sending it to the server.
    expect(batch).toBeNull();
    expect(Object.keys(JSON.parse(prepareStructuredProse([`Speak with ${pair}.`], [abbreviated])!.text))).toEqual(["i0"]);
  });

});
