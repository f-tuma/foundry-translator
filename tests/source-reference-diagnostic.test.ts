import { saveReviewRows, readReviewHistory, reviewHistory, undoReview } from "../src/review/service";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadReview, reviewCatalog, updateReview, type ReviewSnapshot } from "../src/review/service";
import { journalSourceHash, type JournalData } from "../src/translation/journal";
import { hasManualOutputEdits, translatedOutputHash } from "../src/translation/output-hash";
import { MODULE_ID } from "../src/constants";
import { TRANSLATIONS_PACK_ID } from "../src/translation/compendium-translation-repository";
import { DISPLAY_TEXT_PACK, DISPLAY_TEXT_REVISION, displaySourceHash } from "../src/translation/display-text";
import { activeTranslations } from "../src/translation/active-translations";
import { actorSourceHash, type ActorData } from "../src/translation/actor";
import { itemSourceHash, type ItemData } from "../src/translation/item";
import { ACTOR_TRANSLATIONS_PACK_ID } from "../src/translation/compendium-actor-translation-repository";
import { ITEM_TRANSLATIONS_PACK_ID } from "../src/translation/compendium-item-translation-repository";
import { createLiveHandler } from "../src/polish/live-service";
import { GlossaryCompendiumRepository } from "../src/glossary/compendium-repository";
import { prepareReferenceRebuild, materializeReferenceRebuild } from "../src/review/reference-rebuild";

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


import { parseLiveRequest } from "../src/polish/live-protocol";
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
it('actual paired service returns bounded metadata only and preserves owner documents',async()=>{
 const f=await prepared(),before=[JSON.stringify(source),JSON.stringify(copy)];const result=await f.call();
 expect(result).toMatchObject({ok:true,value:{predicate:'source-child-metadata-reported',root:{uuidMatches:true},embedded:{uuidMatches:true},target:{uuidMatches:true},parentSerialized:{expectedChildIdPresent:true},consistency:'repeat-observations-not-atomic'}});
 sanitized(result);expect(writes).toEqual([]);expect([JSON.stringify(source),JSON.stringify(copy)]).toEqual(before);
 expect(new Set(reads)).toEqual(new Set(['JournalEntry.source','Actor.root','Actor.root.Item.child']));
});
const unsafe=[{uuid:'Actor.arbitrary'},{sourceUuid:'Actor.arbitrary'},{path:['items','other']},{offset:0},{limit:1},{labels:[]},{text:['replacement']},{reason:'read request'},{operationId:'write'},{query:'x'},{restoreSourceReferences:true},{referenceIndex:1001},{referenceIndex:-1},{referenceIndex:0.5},{referenceIndex:'0'}];
for(const addition of unsafe)it('strict service rejects '+Object.keys(addition).join(','),async()=>{const f=await prepared();const r=await f.call(addition);expect(r).toMatchObject({ok:false,error:{code:'Live.InvalidRequest'}});sanitized(r);expect(reads).toEqual([]);});
for(const key of ['documentId','rowId','referenceIndex','revision'])it('requires '+key,async()=>{const f=await prepared();const args={...f.args} as any;delete args[key];expect(await f.handler({id:'missing',method:'get_reference_diagnostic',args})).toMatchObject({ok:false,error:{code:'Live.InvalidRequest'}});expect(reads).toEqual([]);});
it('strict envelope rejects unknown and inherited caller fields',async()=>{const f=await prepared();for(const request of [{id:'x',method:'get_reference_diagnostic',args:f.args,uuid:'Actor.other'},{id:'x',method:'get_reference_diagnostic',args:Object.assign(Object.create({uuid:'Actor.other'}),f.args)}]){expect(await f.handler(request)).toMatchObject({ok:false,error:{code:'Live.InvalidRequest'}});}expect(reads).toEqual([]);});
it('rejects stale revision before referenced target reads',async()=>{const f=await prepared();expect(await f.call({revision:'f'.repeat(64)})).toMatchObject({ok:false,error:{code:'Review.Conflict'}});expect(reads).not.toContain('Actor.root');});
for(const race of ['source','translation','parent','child','catalog','glossary','world','user','gm','system','ember','language','disconnect'])it('rejects final '+race+' race',async()=>{
 const f=await prepared();let hit=false;hook=(uuid,n)=>{if(uuid==='Actor.root.Item.child'&&n===2&&!hit){hit=true;
 if(race==='source')source.pages[0]!.text!.content='<p>Changed source.</p>';
 if(race==='translation')copy.pages[0]!.text!.content='<p>Změna překladu.</p>';
 if(race==='parent')rootBody.items.push({_id:'changed',name:'other'});
 if(race==='child')childBody.system.script='changed';
 if(race==='catalog')(copy.flags![MODULE_ID]!.translation as any).targetLanguage='de';
 if(race==='glossary')vi.mocked(GlossaryCompendiumRepository.prototype.loadExisting).mockResolvedValue([{id:'changed'}] as any);
 if(race==='world')game.world!.id='other';if(race==='user')game.user!.id='other';if(race==='gm')game.user!.isGM=false;
 if(race==='system')(game as any).system={id:'other'};if(race==='ember')(game as any).modules=new Map([['ember',{active:true,version:'changed'}]]);
 if(race==='language')game.settings.get=(()=> 'de') as any;if(race==='disconnect')paired=false;
 }};
 const result=await f.call();expect(hit).toBe(true);expect(result.ok).toBe(false);sanitized(result);expect(writes).toEqual([]);
});
for(const state of ['root-missing','root-throw','root-uuid','root-kind','child-missing','child-throw','child-uuid','child-kind','child-serializer'])it('reports sanitized '+state+' without fallback',async()=>{const f=await prepared();
 if(state==='root-missing')referenceRoot=null;
 if(state==='root-throw')hook=uuid=>{if(uuid==='Actor.root')throw Error('SENSITIVE-SECRET')};
 if(state==='root-uuid')referenceRoot={...referenceRoot,uuid:'Actor.wrong'};
 if(state==='root-kind')referenceRoot.documentName='Item';
 if(state==='child-missing')referenceChild=null;
 if(state==='child-throw')hook=uuid=>{if(uuid==='Actor.root.Item.child')throw Error('SENSITIVE-SECRET')};
 if(state==='child-uuid')referenceChild={...referenceChild,uuid:'Actor.wrong.Item.other'};
 if(state==='child-kind')referenceChild.documentName='Actor';
 if(state==='child-serializer')referenceChild.toObject=()=>{throw Error('SENSITIVE-SECRET')};
 const r=await f.call();expect(r.ok).toBe(true);sanitized(r);expect(writes).toEqual([]);
});
it('GM and pairing checks reject before catalog/target access',async()=>{let f=await prepared();paired=false;expect(await f.call()).toMatchObject({ok:false,error:{code:'Live.Disconnected'}});expect(reads).toEqual([]);f=await prepared();game.user!.isGM=false;expect(await f.call()).toMatchObject({ok:false,error:{code:'Live.ScopeChanged'}});expect(reads).toEqual([]);});
it('catalog selection and row binding remain required',async()=>{const f=await prepared();for(const change of [{documentId:'JournalEntry.source'},{rowId:'0'.repeat(64)}]){const r=await f.call(change);expect(r.ok).toBe(false);sanitized(r);}expect(reads).not.toContain('Actor.root');});
it('get_reference_context retains its original behavior and paging',async()=>{const f=await prepared('Item.path');referenceRoot={uuid:'Item.path',documentName:'Item',toObject:()=>({name:'Path',system:{description:'<p>Prose.</p>'}})};const r=await f.handler({id:'original',method:'get_reference_context',args:{documentId:f.args.documentId,rowId:f.args.rowId,referenceIndex:0,offset:0,limit:1}});expect(r).toMatchObject({ok:true,value:{sourceUuid:'Item.path',fields:[{text:'Path'}]}});});

for(const race of ['world','user','gm','system','ember','language','disconnect','owner-source','owner-copy','parent','child'])it('rechecks after last await '+race,async()=>{
 const f=await prepared();let hit=false;hook=(uuid,n)=>{if(uuid==='JournalEntry.source'&&n===4){hit=true;
 if(race==='world')game.world!.id='last-world';if(race==='user')game.user!.id='last-user';if(race==='gm')game.user!.isGM=false;
 if(race==='system')(game as any).system={id:'last-system'};if(race==='ember')(game as any).modules=new Map([['ember',{active:true,version:'last-version'}]]);
 if(race==='language')game.settings.get=(()=> 'de') as any;if(race==='disconnect')paired=false;
 if(race==='owner-source')source.name='Changed owner';if(race==='owner-copy')copy.name='Změna';
 if(race==='parent')rootBody.items.push({_id:'last-child'});if(race==='child')childBody.name='Last change';
 }};const result=await f.call();expect(hit).toBe(true);expect(result.ok).toBe(false);sanitized(result);expect(writes).toEqual([]);
});
it('missing target becoming available rejects repeated observation',async()=>{const f=await prepared();referenceChild=null;hook=(uuid,n)=>{if(uuid==='Actor.root.Item.child'&&n===2)referenceChild={uuid,documentName:'Item',toObject:()=>({name:'SENSITIVE'})};};const r=await f.call();expect(r).toMatchObject({ok:false,error:{code:'Review.Conflict'}});sanitized(r);});
it('oversized internal target serialization rejects, never misreports a resolver failure',async()=>{const f=await prepared();childBody={name:'S'.repeat(2000001)};const r=await f.call();expect(r).toMatchObject({ok:false,error:{code:'Live.ContextTooLarge'}});sanitized(r);});
it('accessor arguments reject without calling getters',async()=>{const f=await prepared();let called=false;const args={...f.args};Object.defineProperty(args,'rowId',{enumerable:true,get(){called=true;throw Error('SENSITIVE')}});const r=await f.handler({id:'accessor',method:'get_reference_diagnostic',args});expect(r).toMatchObject({ok:false,error:{code:'Live.InvalidRequest'}});expect(called).toBe(false);expect(reads).toEqual([]);});
it('translated source roots cannot authorize serialization or fallback',async()=>{const f=await prepared();referenceRoot.flags={'foundry-translate':{actorTranslation:{schemaVersion:1,sourceUuid:'Actor.other',sourceHash:'h',providerId:'openai-compatible',sourceLanguage:'en',targetLanguage:'cs',translatedAt:'now',translatedHtmlFields:1}}};let serialized=false;referenceRoot.toObject=()=>{serialized=true;return rootBody;};const r=await f.call();expect(r).toMatchObject({ok:true,value:{predicate:'translated-root-forbidden'}});expect(serialized).toBe(false);sanitized(r);});
it('unsupported deeper suffix performs no target probes',async()=>{const f=await prepared('Actor.root.Item.child.ActiveEffect.deep');const r=await f.call();expect(r).toMatchObject({ok:true,value:{predicate:'unsupported-suffix'}});expect(reads.every(id=>id==='JournalEntry.source')).toBe(true);sanitized(r);});

it('parent embedded method appearing after initial probe rejects stale cues',async()=>{const f=await prepared();referenceRoot.getEmbeddedDocument=undefined;hook=(uuid,n)=>{if(uuid==='Actor.root.Item.child'&&n===2)referenceRoot.getEmbeddedDocument=()=>referenceChild;};expect(await f.call()).toMatchObject({ok:false,error:{code:'Review.Conflict'}});});
