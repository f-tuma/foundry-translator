import { describe, expect, it } from "vitest";
import { prepareInflectionXml } from "../src/providers/inflection-xml";

const name = { token: "__FTG_T_0000__", endToken: "__FTG_T_0000END__", source: "Old Carinth", replacement: "Starý Carinth" };
const pair = name.token + name.replacement + name.endToken;

describe("inflection XML transport", () => {
  it("shows the original name and only relevant terminology, restoring the original markers", () => {
    const unused = { ...name, token: "__FTG_OTHER_0000__", source: "Unused", replacement: "Nepoužité" };
    const xml = prepareInflectionXml([`From ${pair}.`], [name, unused])!;
    expect(xml.text).toBe('<items><item id="i0">From <name id="n0">Old Carinth</name>.</item></items>');
    expect(xml.instructions).toContain('"Old Carinth" = "Starý Carinth"');
    expect(xml.instructions).not.toContain("Unused");
    expect(xml.restore(xml.text.replace("From ", "Ze ").replace("Old Carinth", "Starého Carinthu")))
      .toEqual([`Ze ${name.token}Starého Carinthu${name.endToken}.`]);
  });

  it("round-trips segmented sentences, opaque syntax, fixed names and XML characters", () => {
    const input = `__FTN_T_0000__To__FTN_T_0001____FTS_T_0000__${pair}__FTS_T_0001____FTN_T_0002__`;
    const xml = prepareInflectionXml([input, "<name> & __FTG_FIXED_0000__"], [name])!;
    const output = xml.text.replace("Old Carinth", "Starého Carinthu").replace(">To<", ">Do<");
    expect(xml.restore(output)).toEqual([input.replace("To", "Do").replace("Starý Carinth", "Starého Carinthu"), "<name> & __FTG_FIXED_0000__"]);
    expect(xml.restore(output.replaceAll('id="', "id='").replaceAll(/(id='[a-z]\d+)"/gu, "$1'")))
      .toEqual(xml.restore(output));
  });

  it("rejects deleted, duplicate, reordered or injected tags, extra attributes, and outside text", () => {
    const xml = prepareInflectionXml([`From ${pair}.`, `To ${pair}.`], [name])!;
    for (const output of [
      xml.text.replace('<name id="n0">', ''),
      xml.text.replace('id="n0"', 'id="n1"'),
      xml.text.replace('<name id="n0">', '<name id="n0" onclick="evil">'),
      xml.text.replace('Old Carinth', '<script>evil</script>'),
      xml.text.replace('</name>', '</name><name id="n0">extra</name>'),
      xml.text.replace('id="i0"', 'id="i1"'),
      `Translation: ${xml.text}`,
      `${xml.text}<items/>`,
      xml.text.replace('Old Carinth', '&unknown;'),
      xml.text.replace('Old Carinth', '&#0;'),
      '<!DOCTYPE items>' + xml.text,
    ]) expect(xml.restore(output), output).toBeNull();
  });

  it("does not encode unsupported pairs or texts without inflection", () => {
    expect(prepareInflectionXml(["Unrelated text."], [name])).toBeNull();
    expect(prepareInflectionXml([pair.replace("Starý", "Jiný")], [name])).toBeNull();
    expect(prepareInflectionXml([pair.replace(name.endToken, "")], [name])).toBeNull();
    expect(prepareInflectionXml([`Outside__FTN_T_0000__${pair}__FTN_T_0001__`], [name])).toBeNull();
  });

  it("allows natural word order for whole names in plain prose but not across links or segments", () => {
    const other = { token: "__FTG_T_0001__", endToken: "__FTG_T_0001END__", source: "Silver Tower", replacement: "Stříbrná Věž" };
    const otherPair = other.token + other.replacement + other.endToken;
    const reorder = (xml: string) => {
      const names = [...xml.matchAll(/<name id="[^"]+">[^<]*<\/name>/gu)].map(([value]) => value);
      return xml.replace(names[0]!, "SWAP").replace(names[1]!, names[0]!).replace("SWAP", names[1]!);
    };
    const plain = prepareInflectionXml([`${pair} and ${otherPair}`], [name, other])!;
    expect(plain.restore(reorder(plain.text).replace("Old Carinth", "Starém Carinthu").replace("Silver Tower", "Stříbrné Věži")))
      .toEqual([`${other.token}Stříbrné Věži${other.endToken} and ${name.token}Starém Carinthu${name.endToken}`]);
    for (const input of [
      `${pair} and __FTS_T_0000__${otherPair}__FTS_T_0001__`,
      `__FTN_T_0000__${pair}__FTN_T_0001__${otherPair}__FTN_T_0002__`,
    ]) {
      const protectedXml = prepareInflectionXml([input], [name, other])!;
      expect(protectedXml.restore(reorder(protectedXml.text))).toBeNull();
    }
  });
});
