import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { OpenAiCompatibleProvider } from "../src/providers/openai-compatible";
import { translateUnits, type TranslationQualityFallback } from "../src/translation/unit-translator";
import type { GlossaryEntry } from "../src/glossary/types";
import type { ProviderRequestMetrics } from "../src/providers/types";

// Opt-in: exercises the production pipeline with the user's local model.
// LM_STUDIO_MODEL=hy-mt2-7b npm test -- tests/local-inflection.integration.test.ts
describe.runIf(!!process.env.LM_STUDIO_MODEL)("local model Czech inflection", () => {
  it("uses the approved names in contextual cases and keeps titles and UUIDs intact", async () => {
    const model=process.env.LM_STUDIO_MODEL!;
    const baseUrl=process.env.LM_STUDIO_URL || "http://127.0.0.1:1234/v1";
    const glossary:GlossaryEntry[]=[
      ["Old Carinth","Starý Carinth"], ["Brackus von Tet","Brackus Z Tetu"],
      ["Delvers","Permoníci"], ["Spirit Beasts","Přízračné Šelmy"], ["Abyssal Shear","Průlom Hlubiny"],
      ["Silver Tower","Stříbrná Věž"], ["Forest Spirits","Lesní Duchové"],
      ["Deep Dwarves","Hlubinní Trpaslíci"], ["Black Fang","Černý Tesák"], ["Emerald Cat","Smaragdová Kočka"],
    ].map(([source,replacement])=>({source:source!,replacement:replacement!,category:"term",aliases:[],mode:"inflect"}));
    const cases=[
      {source:["The party travels to Old Carinth."], expected:"Starého Carinthu"},
      {source:["They return from Old Carinth."], expected:"Starého Carinthu"},
      {source:["The ruins lie in Old Carinth."], expected:"Starém Carinthu"},
      {source:["Speak with Brackus von Tet."], expected:"Brackusem Z Tetu"},
      {source:["They fight against Delvers."], expected:"Permoníkům"},
      {source:["The tracks belong to Spirit Beasts."], expected:"Přízračným Šelmám"},
      {source:["They are afraid of the Abyssal Shear."], expected:"Průlomu Hlubiny"},
      {source:["Old Carinth"], expected:"Starý Carinth"},
      {source:["Travel to @UUID[Scene.old]{Old Carinth}."], expected:"@UUID[Scene.old]{Starého Carinthu}"},
      {source:["The party returns to ","Old Carinth","."], expected:"Starého Carinthu"},
      // Extra names not used in the prompt examples, covering other Czech endings.
      {source:["They return from the Silver Tower."], expected:"Stříbrné Věže"},
      {source:["They speak with Forest Spirits."], expected:"Lesními Duchy"},
      {source:["They fight against Deep Dwarves."], expected:"Hlubinným Trpaslíkům"},
      {source:["They are afraid of Black Fang."], expected:"Černého Tesáku"},
      {source:["She plays with the Emerald Cat."], expected:"Smaragdovou Kočkou"},
    ];
    const fallbacks:TranslationQualityFallback[]=[];
    const metrics:ProviderRequestMetrics[]=[];
    const start=Date.now();
    const provider=new OpenAiCompatibleProvider({baseUrl,model,
      onMetrics:event=>{
        if(event.phase!=="progress") metrics.push(event);
        if(event.phase==="completed" || event.phase==="failed" || event.phase==="diagnostic") console.info("Model request",event);
      },
      // Node has no Foundry fetchWithTimeout; keep the same request timeout and cancellation.
      fetchImplementation:(input,init)=>fetch(input,{...init,signal:init?.signal
        ? AbortSignal.any([init.signal,AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000)}),
    });
    const result=await translateUnits({units:cases.map(c=>c.source),glossary,provider,
      settings:{providerId:"openai-compatible",sourceLanguage:"en",targetLanguage:"cs"},onQualityFallback:issue=>fallbacks.push(issue)});
    const report={model,durationMs:Date.now()-start,metrics,fallbacks,results:cases.map((c,i)=>({source:c.source.join(""),expected:c.expected,translation:result[i]!.join(""),passed:result[i]!.join("").includes(c.expected)}))};
    console.info(JSON.stringify(report,null,2));
    if(process.env.LM_STUDIO_RESULT) await writeFile(process.env.LM_STUDIO_RESULT,JSON.stringify(report,null,2));
    expect(fallbacks).toEqual([]);
    for(const row of report.results) expect(row.translation,row.source).toContain(row.expected);
  },240_000);
});
