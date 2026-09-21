import { describe, expect, it } from "vitest";
import { prepareInflectionProse } from "../src/providers/inflection-prose";

const name = { token: "__FTG_T_0000__", endToken: "__FTG_T_0000END__", source: "Old Carinth", replacement: "Starý Carinth" };
const pair = name.token + name.replacement + name.endToken;

describe("APEX continuous prose transport", () => {
  it("shows continuous English prose and restores only approved Czech forms", () => {
    const xml = prepareInflectionProse([`From ${pair}.`], [name])!;
    expect(xml.text).toBe('<items><item id="i0">From Old Carinth.</item></items>');
    expect(xml.restore(xml.text.replace("From Old Carinth", "Ze starého carinthu")))
      .toEqual([`Ze ${name.token}Starého Carinthu${name.endToken}.`]);
    for (const phrase of ["Ze Staré Prahy", "Ze Starého Carinthu a Starého Carinthu", "Z města"]) {
      expect(xml.restore(xml.text.replace("From Old Carinth", phrase))).toBeNull();
    }
  });

  it("reattaches opaque link syntax to the checked name without crossing segments", () => {
    const source = `__FTN_T_0000__To__FTN_T_0001____FTS_T_0000__${pair}__FTS_T_0001____FTN_T_0002__`;
    const xml = prepareInflectionProse([source], [name])!;
    const output = xml.text.replace(">To<", ">Do<").replace("Old Carinth", "Starého Carinthu");
    expect(xml.restore(output)).toEqual([source.replace("To", "Do").replace("Starý Carinth", "Starého Carinthu")]);
    expect(xml.restore(output.replace("Starého Carinthu", "").replace(">Do<", ">Do Starého Carinthu<"))).toBeNull();
    expect(xml.text).not.toContain("<keep");
  });

  it("allows word order changes and repeated names only with exact occurrence counts", () => {
    const other = { ...name, token: "__FTG_T_0001__", endToken: "__FTG_T_0001END__", source: "Silver Tower", replacement: "Stříbrná Věž" };
    const second = { ...name, token: "__FTG_T_0002__", endToken: "__FTG_T_0002END__" };
    const xml = prepareInflectionProse([pair + " and " + other.token + other.replacement + other.endToken + " near " + second.token + second.replacement + second.endToken], [name, other, second])!;
    expect(xml.restore('<items><item id="i0">Stříbrná Věž u Starého Carinthu a Starý Carinth</item></items>'))
      .toEqual([`${other.token}Stříbrná Věž${other.endToken} u ${name.token}Starého Carinthu${name.endToken} a ${second.token}Starý Carinth${second.endToken}`]);
  });

  it("rejects overlapping names, unknown markup and injected entities", () => {
    const other = { ...name, token: "__FTG_T_0001__", endToken: "__FTG_T_0001END__", source: "Carinth", replacement: "Carinth" };
    const xml = prepareInflectionProse([pair + " and " + other.token + other.replacement + other.endToken], [name, other])!;
    expect(xml.restore('<items><item id="i0">Starý Carinth</item></items>')).toBeNull();
    const simple = prepareInflectionProse([pair], [name])!;
    for (const output of [
      simple.text.replace("Old Carinth", "<script>evil</script>Starý Carinth"),
      simple.text.replace('id="i0"', 'id="i0" onclick="evil"'),
      simple.text.replace("Old Carinth", "&unknown;Starý Carinth"),
      "Extra" + simple.text.replace("Old Carinth", "Starý Carinth"),
    ]) expect(simple.restore(output)).toBeNull();
  });

  it("round trips punctuation, quoted names and literal XML characters", () => {
    const quoted = { ...name, source: '"Old" Carinth', replacement: '"Starý" Carinth' };
    const xml = prepareInflectionProse([`< ${quoted.token}${quoted.replacement}${quoted.endToken} & >`], [quoted])!;
    expect(xml.restore(xml.text.replace('"Old" Carinth', '"Starého" Carinthu')))
      .toEqual([`< ${quoted.token}"Starého" Carinthu${quoted.endToken} & >`]);
  });
});
