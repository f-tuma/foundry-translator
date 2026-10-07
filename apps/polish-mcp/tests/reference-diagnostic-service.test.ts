import '../../../tests/setup';
import { saveReviewRows, readReviewHistory, reviewHistory, undoReview } from "../../../src/review/service";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadReview, reviewCatalog, updateReview, type ReviewSnapshot } from "../../../src/review/service";
import { journalSourceHash, type JournalData } from "../../../src/translation/journal";
import { hasManualOutputEdits, translatedOutputHash } from "../../../src/translation/output-hash";
import { MODULE_ID } from "../../../src/constants";
import { TRANSLATIONS_PACK_ID } from "../../../src/translation/compendium-translation-repository";
import { DISPLAY_TEXT_PACK, DISPLAY_TEXT_REVISION, displaySourceHash } from "../../../src/translation/display-text";
import { activeTranslations } from "../../../src/translation/active-translations";
import { actorSourceHash, type ActorData } from "../../../src/translation/actor";
import { itemSourceHash, type ItemData } from "../../../src/translation/item";
import { ACTOR_TRANSLATIONS_PACK_ID } from "../../../src/translation/compendium-actor-translation-repository";
import { ITEM_TRANSLATIONS_PACK_ID } from "../../../src/translation/compendium-item-translation-repository";
import { createLiveHandler } from "../../../src/polish/live-service";
import { GlossaryCompendiumRepository } from "../../../src/glossary/compendium-repository";
import { prepareReferenceRebuild, materializeReferenceRebuild } from "../../../src/review/reference-rebuild";

let source: JournalData, copy: JournalData, locked = false;
let writes: { kind: string; patch: any }[];
let sourceDocument: any, copyDocument: any;
let packId: string;
function dotted(data: any, patch: any): void {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split('.'); let obj = data;
    for (const part of parts.slice(0, -1)) obj = obj[part] ??= {};
    obj[parts.at(-1)!] = structuredClone(value);
  }
}
function install(): void {
  copyDocument = {
    id: "copy", uuid: `Compendium.${packId}.JournalEntry.copy`, get name() { return copy.name; },
    get flags() { return copy.flags; }, toObject: () => structuredClone(copy),
    update: async (patch: any) => {
      writes.push({ kind: "root", patch });
      const { pages, items, ...root } = patch; dotted(copy, root);
      for (const [collection, updates] of [[copy.pages, pages], [copy.items, items]] as any[]) {
        for (const update of updates ?? []) dotted(collection.find((entry: any) => entry._id === update._id), update);
      }
    },
    updateEmbeddedDocuments: async (kind: string, patches: any[]) => {
      writes.push({ kind, patch: patches });
      for (const patch of patches) dotted((kind === "Item" ? copy.items as any[] : copy.pages).find(page => page._id === patch._id), patch);
    },
  };
  sourceDocument = { id: "source", uuid: "JournalEntry.source", documentName: "JournalEntry", toObject: () => structuredClone(source) };
  const pack = { collection: packId, get locked() { return locked; }, getDocument: async () => copyDocument,
    getIndex: async () => new Map([["copy", { _id: "copy", name: copy.name, flags: copy.flags }]]) };
  vi.stubGlobal("game", { user: { isGM: true, id: "gm", name: "Reviewer" }, world: { id: "test-world", title: "Test world" }, settings: { get: () => undefined }, i18n: { localize: (key: string) => key }, packs: new Map([[packId, pack]]) });
  vi.stubGlobal("fromUuid", async () => sourceDocument);
  vi.stubGlobal("Hooks", { callAll: vi.fn() });
}
async function snapshot(): Promise<ReviewSnapshot> { return loadReview((await reviewCatalog("cs")).find(item => item.pack === packId && item.id === "copy")!); }
function textRow(s: ReviewSnapshot) { return s.rows.find(row => row.label === "text.content")!; }

beforeEach(async () => {
  vi.stubGlobal("document", parseHTML("<html><body></body></html>").document);
  source = { name: "Guide", pages: [{ _id: "one", name: "Arrival", type: "text", text: { content: '<p>Three-toed feet.</p><p>Second paragraph.</p>', format: 1 } },
    { _id: "two", name: "Later", type: "text", text: { content: '<p>Later.</p>', format: 1 } }] };
  copy = structuredClone(source); copy._id = "copy"; copy.name = "Průvodce";
  copy.pages[0]!.text!.content = '<p>Třínohé končetiny.</p><p>Druhý odstavec.</p>';
  copy.flags = { [MODULE_ID]: { translation: { schemaVersion: 1, engineRevision: 12, sourceUuid: "JournalEntry.source", sourceHash: await journalSourceHash(source),
    providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-09-22", translatedTextPages: 2, skippedTextPages: 0, partial: false } } };
  (copy.flags[MODULE_ID]!.translation as any).outputHash = await translatedOutputHash(copy);
  writes = []; locked = false; packId = TRANSLATIONS_PACK_ID; install();
});
afterEach(() => {
  for (const run of activeTranslations.list()) activeTranslations.finish(run.id);
  activeTranslations.clearFinished(); vi.unstubAllGlobals();
  vi.restoreAllMocks();
});


import { parseLiveRequest } from "../../../src/polish/live-protocol";
let referenceRoot: any, referenceChild: any, rootBody: any, childBody: any;
const reads: string[]=[];
let hook: ((uuid: string, count: number) => void) | undefined;
let counts: Map<string, number>;
let paired=true;
async function prepared(target='Actor.root.Item.child') {
  source.pages[0]!.text!.content = `<p>Read @UUID[${target}]{Link}.</p>`;
  copy.pages[0]!.text!.content = `<p>Přečti @UUID[${target}]{Odkaz}.</p>`;
  (copy.flags![MODULE_ID]!.translation as any).sourceHash=await journalSourceHash(source);
  rootBody={items:[{_id:'child',name:'SENSITIVE-NAME'}],flags:{private:'SENSITIVE-SECRET'}};
  childBody={name:'SENSITIVE-NAME',system:{script:'SENSITIVE-SCRIPT'}};
  referenceChild={uuid:'Actor.root.Item.child',documentName:'Item',toObject:()=>structuredClone(childBody)};
  referenceRoot={uuid:'Actor.root',documentName:'Actor',flags:{},toObject:()=>structuredClone(rootBody),getEmbeddedDocument:()=>referenceChild};
  counts=new Map(); reads.length=0; hook=undefined; paired=true;
  vi.stubGlobal('fromUuid',async(uuid:string)=>{
    reads.push(uuid); const n=(counts.get(uuid)??0)+1;counts.set(uuid,n);hook?.(uuid,n);
    if(uuid==='JournalEntry.source')return sourceDocument;
    if(uuid==='Actor.root'||uuid===referenceRoot?.uuid)return referenceRoot;
    if(uuid==='Actor.root.Item.child'||uuid===referenceChild?.uuid)return referenceChild;
    return null;
  });
  vi.spyOn(GlossaryCompendiumRepository.prototype,'loadExisting').mockResolvedValue([]);
  const handler=createLiveHandler('cs',()=>paired),s=await snapshot(),row=textRow(s);
  const context=await handler({id:'context',method:'get_context',args:{documentId:s.entry.uuid,rowId:row.id}});
  expect(context.ok).toBe(true);
  const args={documentId:s.entry.uuid,rowId:row.id,referenceIndex:0,revision:(context.value as any).revision};
  const call=(changes:Record<string,unknown>={})=>handler({id:'diagnostic',method:'get_reference_diagnostic',args:{...args,...changes}});
  reads.length=0;counts.clear();return{handler,args,call};
}
function sanitized(result:any){const encoded=JSON.stringify(result);expect(encoded.length).toBeLessThan(4000);expect(encoded).not.toMatch(/SENSITIVE|Actor\.|JournalEntry\.|Compendium\.|sourceUuid|documentId|rowId|flags|script|name/);}

import { Client } from '@modelcontextprotocol/client';
import { createLiveServer } from '../src/live-server';
class MemoryTransport {
 peer!:MemoryTransport;onmessage?:(message:any)=>void;onclose?:()=>void;
 async start(){}async send(message:any){const data=structuredClone(message);queueMicrotask(()=>this.peer.onmessage?.(data));}async close(){this.onclose?.();}
}
it('actual registered SDK route invokes actual paired service safely and propagates stale/unpaired rejection',async()=>{
 const f=await prepared(),a=new MemoryTransport(),b=new MemoryTransport();a.peer=b;b.peer=a;
 const server=createLiveServer({request:(method:string,args:Record<string,unknown>)=>f.handler({id:'sdk',method,args})} as any);
 const client=new Client({name:'private-service-route',version:'1'});await server.connect(a as any);await client.connect(b as any);
 try{const read=async(args:Record<string,unknown>)=>JSON.parse(((await client.callTool({name:'live_get_reference_diagnostic',arguments:args})).content as any)[0].text);
 const safe=await read(f.args);expect(safe.ok).toBe(true);sanitized(safe);
 expect(await read({...f.args,revision:'f'.repeat(64)})).toMatchObject({ok:false,error:{code:'Review.Conflict'}});
 paired=false;expect(await read(f.args)).toMatchObject({ok:false,error:{code:'Live.Disconnected'}});
 expect(writes).toEqual([]);
 }finally{await client.close();await server.close();}
});
