import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { MODULE_ID, MODULE_VERSION } from "../src/constants";
import { createLiveHandler } from "../src/polish/live-service";
import { loadReview, reviewCatalog, readReviewHistory, updateReview, saveReviewRows } from "../src/review/service";
import { journalSourceHash, type JournalData } from "../src/translation/journal";
import { translatedOutputHash } from "../src/translation/output-hash";
import { TRANSLATIONS_PACK_ID } from "../src/translation/compendium-translation-repository";
import { GlossaryCompendiumRepository } from "../src/glossary/compendium-repository";
import type { GlossaryEntry } from "../src/glossary/types";
import { parseLiveRequest } from "../src/polish/live-protocol";
import { activeTranslations } from "../src/translation/active-translations";
import { planReviewText, maskReviewParts } from "../src/review/text-plan";

import {syntheticGlossary778,synthetic99,synthetic99Repaired} from './fixtures/correction-batch-fixtures';
const generated778: GlossaryEntry[]=syntheticGlossary778;
let source:JournalData, copy:JournalData, writes:any[], locked:boolean, connected:boolean, throwAfterUpdate:boolean;
let glossary:GlossaryEntry[], glossaryReads:number, onGlossaryRead:((n:number)=>void)|undefined;
let handle:ReturnType<typeof createLiveHandler>, sourceDoc:any, copyDoc:any, uuidReads:string[];
const root=`Compendium.${TRANSLATIONS_PACK_ID}.JournalEntry.copy`;
const dotted=(data:any,patch:any)=>{for(const [key,value] of Object.entries(patch)){const path=key.split('.');let obj=data;for(const p of path.slice(0,-1))obj=obj[p]??={};obj[path.at(-1)!]=structuredClone(value);}};
const call=(method:string,args:any={})=>handle({id:crypto.randomUUID(),method,args});
const view=async()=>loadReview((await reviewCatalog('cs')).find(x=>x.uuid===root)!);
const rows=async()=> (await view()).rows.filter(r=>r.group==='pages:one'&&r.label==='text.content');
async function setText(original:string,current:string){source.pages[0]!.text!.content=original;copy.pages[0]!.text!.content=current;(copy.flags![MODULE_ID]!.translation as any).sourceHash=await journalSourceHash(source);}
async function proposal(indices=[0,1]){
  const selected=(await rows()).filter((_,i)=>indices.includes(i));
  const contexts:any=(await call('get_context_batch',{documentId:root,rowIds:selected.map(r=>r.id)})).value;
  expect(contexts.omittedRowIds).toEqual([]);
  const args={documentId:root,revision:contexts.revision,reason:'Dávková jazyková oprava.',changes:selected.map(r=>({rowId:r.id,text:r.translation.map((p,i)=>i===0?p+' upraveno.':p),labels:[],reason:'Přesnější jazykové vyjádření.'}))};
  const preview:any=await call('validate_correction_batch',args);expect(preview.ok,JSON.stringify(preview)).toBe(true);
  return {args,preview:preview.value,save:{...preview.value.normalizedPayload,planHash:preview.value.planHash,operationId:crypto.randomUUID()}};
}
beforeEach(async()=>{
  vi.stubGlobal('document',parseHTML('<html><body></body></html>').document);
  source={name:'Guide',pages:[{_id:'one',name:'Arrival',type:'text',text:{format:1,content:'<p>First sentence.</p><p>Second sentence.</p><p>Keep &amp; <strong>words</strong> @UUID[Item.missing]{Missing}.</p>'}},
    {_id:'two',name:'Later',type:'text',text:{format:1,content:'<p>Later.</p>'}}]};
  copy=structuredClone(source);copy._id='copy';copy.name='Průvodce';copy.pages[0]!.text!.content='<p>První věta.</p><p>Druhá věta.</p><p>Zachovej &amp; <strong>slova</strong> @UUID[Item.missing]{Chybí}.</p>';
  copy.flags={[MODULE_ID]:{translation:{schemaVersion:1,engineRevision:12,sourceUuid:'JournalEntry.source',sourceHash:await journalSourceHash(source),providerId:'openai-compatible',sourceLanguage:'en',targetLanguage:'cs',translatedAt:'2026-10-07',translatedTextPages:2,skippedTextPages:0,partial:false}}};
  (copy.flags![MODULE_ID]!.translation as any).outputHash=await translatedOutputHash(copy);
  writes=[];locked=false;connected=true;throwAfterUpdate=false;uuidReads=[];glossary=structuredClone(generated778);glossaryReads=0;onGlossaryRead=undefined;
  sourceDoc={id:'source',uuid:'JournalEntry.source',documentName:'JournalEntry',toObject:()=>structuredClone(source)};
  copyDoc={id:'copy',uuid:root,get name(){return copy.name;},get flags(){return copy.flags;},toObject:()=>structuredClone(copy),update:async(patch:any)=>{
    writes.push(structuredClone(patch));const {pages,...other}=patch;dotted(copy,other);for(const p of pages??[])dotted(copy.pages.find(x=>x._id===p._id),p);
    if(throwAfterUpdate){throwAfterUpdate=false;throw new Error('Synthetic lost response after modeled persistence');}
  },updateEmbeddedDocuments:vi.fn(async()=>{throw new Error('Unexpected embedded persistence');})};
  const pack={get locked(){return locked;},getDocument:async()=>copyDoc,getIndex:async()=>new Map([['copy',{_id:'copy',name:copy.name,flags:copy.flags}]])};
  vi.stubGlobal('game',{user:{id:'gm',isGM:true,name:'Reviewer'},world:{id:'offline-fixture'},system:{id:'crucible'},modules:new Map([['ember',{active:true,version:'0.6.2'}],[MODULE_ID,{active:true,version:MODULE_VERSION}]]),
    settings:{get:(_n:string,key:string)=>key==='targetLanguage'?'cs':undefined},i18n:{localize:(x:string)=>x},packs:new Map([[TRANSLATIONS_PACK_ID,pack]])});
  vi.stubGlobal('fromUuid',async(uuid:string)=>{uuidReads.push(uuid);return uuid==='JournalEntry.source'?sourceDoc:null;});vi.stubGlobal('Hooks',{callAll:vi.fn()});
  vi.spyOn(GlossaryCompendiumRepository.prototype,'loadExisting').mockImplementation(async()=>{onGlossaryRead?.(++glossaryReads);return structuredClone(glossary);});
  handle=createLiveHandler('cs',()=>connected);
});
afterEach(()=>{for(const r of activeTranslations.list())activeTranslations.finish(r.id);activeTranslations.clearFinished();vi.unstubAllGlobals();vi.restoreAllMocks();});

it('previews complete parts and commits two rows, protection and exact per-row reasons in one real modeled parent update',async()=>{
  expect(generated778).toHaveLength(778);const original=JSON.stringify(source),flag=structuredClone(copy.flags![MODULE_ID]!.translation),p=await proposal();expect(writes).toHaveLength(0);
  const result:any=await call('save_correction_batch',p.save);expect(result.ok,JSON.stringify(result)).toBe(true);expect(result.value).toMatchObject({saved:true,complete:true,sourceCompatible:true,affectedRowsCompatible:true,willVerify:false});
  expect(writes).toHaveLength(1);expect(copyDoc.updateEmbeddedDocuments).not.toHaveBeenCalled();expect(writes[0].pages).toHaveLength(1);
  const h=readReviewHistory(copy.flags);expect(h).toHaveLength(1);expect(h[0]!.rows.map(r=>r.after)).toEqual(p.preview.rows.map((r:any)=>r.after));expect(h[0]!.correctionBatch?.rows.map(r=>r.reason)).toEqual(p.save.changes.map((r:any)=>r.reason));
  expect(result.value.operation).toEqual(h[0]);expect(result.value.rows).toHaveLength(2);expect(result.value.rows.every((r:any)=>r.currentVerified===false)).toBe(true);
  expect(copy.flags![MODULE_ID]!.translation).toEqual(flag);expect(JSON.stringify(source)).toBe(original);expect(copy.pages[0]!.text!.content).toContain('Zachovej &amp; <strong>slova</strong>');
});
it('reconciles a response lost after persistence with exact idempotent lookup before stale revision',async()=>{
  const p=await proposal();throwAfterUpdate=true;const lost:any=await call('save_correction_batch',p.save);expect(lost.ok).toBe(false);expect(writes).toHaveLength(1);expect(readReviewHistory(copy.flags)).toHaveLength(1);
  const retry:any=await call('save_correction_batch',p.save);expect(retry.ok,JSON.stringify(retry)).toBe(true);expect(retry.value.alreadyApplied).toBe(true);expect(retry.value).not.toHaveProperty('saved');expect(writes).toHaveLength(1);
});
it('serializes simultaneous identical calls to one update and returns an actual complete operation',async()=>{
  const p=await proposal(),rs:any[]=await Promise.all([call('save_correction_batch',p.save),call('save_correction_batch',p.save)]);expect(rs.every(r=>r.ok)).toBe(true);expect(writes).toHaveLength(1);expect(rs.map(r=>r.value.saved??r.value.alreadyApplied)).toEqual([true,true]);
  const read:any=await call('get_correction_operation',{documentId:root,operationId:p.save.operationId});expect(read.value.operation).toEqual(readReviewHistory(copy.flags)[0]);expect(read.value.rows).toHaveLength(2);
});
it.each(['text','reason','order','labels','revision','planHash'])('refuses changed %s with an existing operation ID',async(key)=>{
  const p=await proposal();expect((await call('save_correction_batch',p.save)).ok).toBe(true);const a=structuredClone(p.save);
  if(key==='text')a.changes[0]!.text[0]+=' jinak';if(key==='reason')a.changes[0]!.reason+=' jinak';if(key==='order')a.changes.reverse();if(key==='labels')a.changes[0]!.labels=[{marker:'⟦777⟧',label:'x'}];if(key==='revision')a.revision='a'.repeat(64);if(key==='planHash')a.planHash='b'.repeat(64);
  expect(await call('save_correction_batch',a)).toMatchObject({ok:false,error:{code:'Live.OperationConflict'}});expect(writes).toHaveLength(1);
});
it('preserves unrelated later prose through exact retry and one atomic whole-batch undo',async()=>{
  const p=await proposal();expect((await call('save_correction_batch',p.save)).ok).toBe(true);let v=await view();const other=v.rows.find(r=>r.group==='pages:two'&&r.label==='text.content')!;
  await updateReview(v,other.id,{type:'save',parts:['Pozdější nezávislá oprava.']});const retry:any=await call('save_correction_batch',p.save);expect(retry.value.alreadyApplied).toBe(true);const n=writes.length;
  expect(await call('undo_correction',{documentId:root,operationId:p.save.operationId})).toMatchObject({ok:true,value:{undone:true}});expect(writes).toHaveLength(n+1);
  expect(copy.pages[0]!.text!.content).toContain('<p>První věta.</p><p>Druhá věta.</p>');expect(copy.pages[1]!.text!.content).toContain('Pozdější nezávislá oprava.');
  expect(await call('undo_correction',{documentId:root,operationId:p.save.operationId})).toMatchObject({ok:true,value:{alreadyUndone:true}});expect(writes).toHaveLength(n+1);
  expect(await call('save_correction_batch',p.save)).toMatchObject({ok:false,error:{code:'Live.OperationConflict'}});
});
it('reports later actual human verification on retry and refuses changed affected prose/undo',async()=>{
  const p=await proposal();expect((await call('save_correction_batch',p.save)).ok).toBe(true);let v=await view();await updateReview(v,p.save.changes[0]!.rowId,{type:'verify'});
  const retry:any=await call('save_correction_batch',p.save);expect(retry.value.rows[0].currentVerified).toBe(true);v=await view();await updateReview(v,p.save.changes[0]!.rowId,{type:'save',parts:['Jiná ruční oprava.']});const n=writes.length;
  expect(await call('save_correction_batch',p.save)).toMatchObject({ok:false,error:{code:'Live.OperationConflict'}});expect((await call('undo_correction',{documentId:root,operationId:p.save.operationId})).ok).toBe(false);expect(writes).toHaveLength(n);
});
it('refuses a bad final row or selected no-op without partial text/history writes',async()=>{
  const p=await proposal();for(const changes of [[p.args.changes[0]!,{...p.args.changes[1]!,rowId:'f'.repeat(64)}],[{...p.args.changes[0]!,text:(await rows())[0]!.translation},p.args.changes[1]!]]){
    expect((await call('validate_correction_batch',{...p.args,changes})).ok).toBe(false);expect((await call('save_correction_batch',{...p.save,changes})).ok).toBe(false);expect(writes).toHaveLength(0);expect(readReviewHistory(copy.flags)).toHaveLength(0);
  }
});
it('preserves missing unchanged UUIDs and formatted entity parts without resolving arbitrary targets',async()=>{
  const rr=(await rows())[2]!,c:any=(await call('get_context',{documentId:root,rowId:rr.id})).value;const args={documentId:root,revision:c.revision,reason:'Oprava formátovaných částí.',changes:[{rowId:rr.id,text:['Ponech & ', 'slova', ' ⟦1⟧.'],labels:[{marker:'⟦1⟧',label:'Chybějící'}],reason:'Zpřesnění formulace a popisku.'}]};
  const pre:any=await call('validate_correction_batch',args);expect(pre.ok,JSON.stringify(pre)).toBe(true);const saved:any=await call('save_correction_batch',{...args,planHash:pre.value.planHash,operationId:'formatted'});expect(saved.ok,JSON.stringify(saved)).toBe(true);
  expect(copy.pages[0]!.text!.content).toContain('@UUID[Item.missing]{Chybějící}');expect(uuidReads).not.toContain('Item.missing');expect(saved.value.rows[0].source).toEqual(rr.source);
});
it('rejects per-part exchanged quantities despite unchanged whole-row numbers',async()=>{
  await setText('<p>2 <strong>3</strong>.</p>','<p>2 <strong>3</strong>.</p>');const row=(await rows())[0]!,c:any=(await call('get_context',{documentId:root,rowId:row.id})).value;
  expect(await call('validate_correction_batch',{documentId:root,revision:c.revision,reason:'Pokus o výměnu částí.',changes:[{rowId:row.id,text:['3 ','2','.'],labels:[],reason:'Výměna hodnot mezi částmi.'}]})).toMatchObject({ok:false,error:{code:'Live.NumbersChanged'}});expect(writes).toHaveLength(0);
});
it('uses the entire global glossary, including a fixed term beyond 60 selected matches',async()=>{
  // Explicit derived adversarial glossary; the untouched generated778 fixture is all INFLECT.
  glossary[777]={...glossary[777]!,source:'Exact sentinel',replacement:'StriktníTerm',aliases:[],mode:'fixed',enabled:true};await setText('<p>A sentinel waits.</p>','<p>StriktníTerm čeká.</p>');
  const row=(await rows())[0]!,c:any=(await call('get_context',{documentId:root,rowId:row.id})).value;
  expect((await call('validate_correction_batch',{documentId:root,revision:c.revision,reason:'Test celé terminologie.',changes:[{rowId:row.id,text:['Někdo čeká.'],reason:'Odebrání pevného termínu.'}]})).ok).toBe(false);expect(glossary).toHaveLength(778);expect(writes).toHaveLength(0);
});
it.each(['copy','source','sourceMetadata','glossary','registry','lock','GM','disconnect','module','run'])('rejects fresh %s conflict after preview before any write',async(kind)=>{
  const p=await proposal();
  if(kind==='copy')copy.name+=' jinak';if(kind==='source')source.pages[0]!.text!.content+='<p>Changed.</p>';if(kind==='sourceMetadata')(source as any).customMechanicalMetadata={changed:true};
  if(kind==='glossary')glossary[0]!.notes='Změněná definice.';if(kind==='registry'){const pack=game.packs.get(TRANSLATIONS_PACK_ID)!;const index=await pack.getIndex();const flags=structuredClone(copy.flags!);(flags[MODULE_ID]!.translation as any).sourceUuid='JournalEntry.other';vi.spyOn(pack,'getIndex').mockResolvedValue(new Map([...index.entries(),['new',{_id:'new',name:'New',flags}]]));}
  if(kind==='lock')locked=true;if(kind==='GM')(game.user as any).isGM=false;if(kind==='disconnect')connected=false;if(kind==='module')(game.modules.get(MODULE_ID) as any).version='next';if(kind==='run')activeTranslations.start('Other','cs');
  expect((await call('save_correction_batch',p.save)).ok).toBe(false);expect(writes).toHaveLength(0);
});
it.each(['copy','source','glossary','lock','disconnect'])('rejects %s mutation during final awaited checks',async(kind)=>{
  const p=await proposal(),start=glossaryReads;onGlossaryRead=n=>{if(n!==start+4)return;if(kind==='copy')copy.name+=' late';if(kind==='source')(source as any).customMetadata='late';if(kind==='glossary')glossary[0]!.notes='late';if(kind==='lock')locked=true;if(kind==='disconnect')connected=false;};
  expect((await call('save_correction_batch',p.save)).ok).toBe(false);expect(writes).toHaveLength(0);
});
it('rejects damaged batch history before idempotence, full readback or undo',async()=>{
  const p=await proposal();expect((await call('save_correction_batch',p.save)).ok).toBe(true);const history=(copy.flags![MODULE_ID] as any).reviewHistory;history[p.save.operationId].rows.pop();const n=writes.length;
  expect((await call('save_correction_batch',p.save)).ok).toBe(false);expect((await call('get_correction_operation',{documentId:root,operationId:p.save.operationId})).ok).toBe(false);expect((await call('undo_correction',{documentId:root,operationId:p.save.operationId})).ok).toBe(false);expect(writes).toHaveLength(n);
});
it('exposes actual affected incompatibility in complete operation readback rather than a synthetic absent receipt',async()=>{
  const p=await proposal();expect((await call('save_correction_batch',p.save)).ok).toBe(true);let v=await view();await updateReview(v,p.save.changes[0]!.rowId,{type:'save',parts:['Pozdější změna.']});const r:any=await call('get_correction_operation',{documentId:root,operationId:p.save.operationId});
  expect(r.ok,JSON.stringify(r)).toBe(true);expect(r.value.affectedRowsCompatible).toBe(false);expect(r.value.operation.rows).toHaveLength(2);expect(r.value.rows[0].translation).toEqual(['Pozdější změna.']);
});
it.each(['options','restoreSourceNumbers','restoreSourceReferences','verify','source','fieldId','otherDoc'])('strictly rejects forbidden %s at browser protocol',async(key)=>{
  const p=await proposal();const args:any={...p.save,[key]:key==='otherDoc'?'JournalEntry.original':true};expect(()=>parseLiveRequest({id:'invalid',method:'save_correction_batch',args})).toThrow('Live.InvalidRequest');expect((await call('save_correction_batch',args)).ok).toBe(false);expect(writes).toHaveLength(0);
});
it('rejects empty/duplicate/11-row, nested unknown keys, oversize multibyte request, changed syntax and warnings',async()=>{
  const p=await proposal();const variants:any[]=[{...p.args,changes:[]},{...p.args,changes:[p.args.changes[0],p.args.changes[0]]},
    {...p.args,changes:Array.from({length:11},(_,i)=>({...p.args.changes[0],rowId:i.toString(16).padStart(64,'0')}))},
    {...p.args,changes:[{...p.args.changes[0],after:['forged']}]},{...p.args,changes:[{...p.args.changes[0],text:['ž'.repeat(60000)]}]},
    {...p.args,changes:[{...p.args.changes[0],text:['New @Macro[delete]']}]},{...p.args,changes:[{...p.args.changes[0],text:['x'.repeat(500)]}]}];
  for(const args of variants){expect((await call('validate_correction_batch',args)).ok,JSON.stringify(args).slice(0,300)).toBe(false);expect(writes).toHaveLength(0);}
});
it('returns complete >1500-char persisted row arrays while list_history remains explicitly excerpted',async()=>{
  const text='Věta. '.repeat(300);await setText('<p>'+text+'</p>','<p>'+text+'</p>');const p=await proposal([0]);const saved:any=await call('save_correction_batch',p.save);expect(saved.ok,JSON.stringify(saved)).toBe(true);
  expect(saved.value.operation.rows[0].before[0].length).toBeGreaterThan(1500);const listed:any=await call('list_history',{documentId:root});expect(listed.value.items[0].rows[0].before[0]).toHaveLength(1500);
});
it('refuses original damaged synthetic99 field and preserves all 99 units in an explicitly derived repaired-field batch fixture',async()=>{
  const captured=structuredClone(synthetic99);
  const derived=structuredClone(synthetic99Repaired);
  const pack=game.packs.get(TRANSLATIONS_PACK_ID)!,index=await pack.getIndex(),entries=[...index.entries()];
  for(const [id,sourceUuid] of [['syntheticChainCopy','JournalEntry.syntheticChain'],['syntheticGuideCopy','JournalEntry.syntheticGuide']]){const flags=structuredClone(copy.flags!);(flags[MODULE_ID]!.translation as any).sourceUuid=sourceUuid;entries.push([id!,{_id:id!,name:'Fictional mapping fixture',flags}]);}
  vi.spyOn(pack,'getIndex').mockResolvedValue(new Map(entries));
  await setText(captured.raw.source,captured.raw.current);let rr=await rows();expect(rr).toHaveLength(99);expect(rr.every(r=>r.blocked==='StructureChanged')).toBe(true);
  let c:any=(await call('get_context',{documentId:root,rowId:rr[0]!.id})).value;expect((await call('validate_correction_batch',{documentId:root,revision:c.revision,reason:'No structural bypass allowed.',changes:[{rowId:rr[0]!.id,text:maskReviewParts(rr[0]!.translation).text.map(t=>t+' '),reason:'Blocked ordinary correction.'}]})).ok).toBe(false);expect(writes).toHaveLength(0);
  await setText(captured.raw.source,derived.expectedRawAfter);rr=await rows();expect(rr).toHaveLength(99);expect(rr.every(r=>!r.blocked)).toBe(true);const picked=rr.find(r=>r.translation.length===1&&!r.translation[0]!.includes('@')&&!r.translation[0]!.includes('[[')&&r.translation[0]!.length>30)!;
  c=(await call('get_context',{documentId:root,rowId:picked.id})).value;const a={documentId:root,revision:c.revision,reason:'Derived fixture structural preservation.',changes:[{rowId:picked.id,text:[picked.translation[0]+' '],labels:[],reason:'Whitespace-only test edit in private derived fixture.'}]};const pre:any=await call('validate_correction_batch',a);expect(pre.ok,JSON.stringify(pre)).toBe(true);
  const result:any=await call('save_correction_batch',{...a,planHash:pre.value.planHash,operationId:'synthetic99-batch'});expect(result.ok,JSON.stringify(result)).toBe(true);expect(writes).toHaveLength(1);const final=await rows();expect(final).toHaveLength(99);
  for(const row of rr)expect(final.find(x=>x.id===row.id)!.translation).toEqual(row.id===picked.id?[picked.translation[0]+' ']:row.translation);
  const beforePlan=planReviewText(derived.expectedRawAfter,'html'),expected=beforePlan.replace(picked.unitId,[picked.translation[0]+' ']);expect(copy.pages[0]!.text!.content).toBe(expected);expect(source.pages[0]!.text!.content).toBe(captured.raw.source);
});

it('accepts exactly ten rows across parent name and two pages, with one update and exact complete undo',async()=>{
  await setText(Array.from({length:6},()=>'<p>First sentence.</p>').join(''),Array.from({length:6},()=>'<p>První věta.</p>').join(''));
  source.pages[1]!.text!.content='<p>Later.</p><p>Later.</p><p>Later.</p>';copy.pages[1]!.text!.content='<p>Později.</p><p>Později.</p><p>Později.</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash=await journalSourceHash(source);const v=await view(),selected=v.rows.filter(r=>r.label==='name'&&r.group==='document'||r.label==='text.content');expect(selected).toHaveLength(10);
  const c:any=await call('get_context_batch',{documentId:root,rowIds:selected.map(r=>r.id)});expect(c.value.omittedRowIds).toEqual([]);const before=copy.pages.map(p=>p.text!.content),name=copy.name;
  const args={documentId:root,revision:c.value.revision,reason:'Ten-row cross-field correction.',changes:selected.map(r=>({rowId:r.id,text:r.translation.map(p=>p+' upraveno.'),labels:[],reason:'Private ten-row field preservation test.'}))};const pre:any=await call('validate_correction_batch',args);expect(pre.ok,JSON.stringify(pre)).toBe(true);
  const saved:any=await call('save_correction_batch',{...args,planHash:pre.value.planHash,operationId:'ten-fields'});expect(saved.ok,JSON.stringify(saved)).toBe(true);expect(writes).toHaveLength(1);expect(writes[0].pages).toHaveLength(2);expect(saved.value.operation.rows).toHaveLength(10);expect(saved.value.operation.correctionBatch.fields).toHaveLength(3);
  const undo:any=await call('undo_correction',{documentId:root,operationId:'ten-fields'});expect(undo.ok,JSON.stringify(undo)).toBe(true);expect(undo.value.undoneRowsCompatible).toBe(true);expect(undo.value.complete).toBe(true);expect(writes).toHaveLength(2);expect(copy.name).toBe(name);expect(copy.pages.map(p=>p.text!.content)).toEqual(before);
});
it('refuses oversized complete preview/receipt before persistence, and oversized later readback without claiming absent commit',async()=>{
  const {batchEnvironment}=await import('../src/polish/correction-batch');const text='Věta. '.repeat(8000);await setText('<p>'+text+'</p><p>'+text+'</p>','<p>'+text+'</p><p>'+text+'</p>');let env=await batchEnvironment((await view()).entry),rr=await rows();
  const args={documentId:root,revision:env.revision,reason:'Oversize complete-response refusal.',changes:rr.map(r=>({rowId:r.id,text:[r.translation[0]+' '],reason:'Whitespace change with intact full field.'}))};expect(new TextEncoder().encode(JSON.stringify(args)).length).toBeLessThan(120000);
  expect(await call('validate_correction_batch',args)).toMatchObject({ok:false,error:{code:'Live.BatchTooLarge'}});expect(await call('save_correction_batch',{...args,planHash:'a'.repeat(64),operationId:'too-big'})).toMatchObject({ok:false,error:{code:'Live.BatchTooLarge'}});expect(writes).toHaveLength(0);
  await setText('<p>First sentence.</p><p>Second sentence.</p>','<p>První věta.</p><p>Druhá věta.</p>');const p=await proposal();expect((await call('save_correction_batch',p.save)).ok).toBe(true);copy.pages[0]!.text!.content='<p>'+text.repeat(8)+'</p><p>Druhá věta upraveno.</p>';
  expect(await call('get_correction_operation',{documentId:root,operationId:p.save.operationId})).toMatchObject({ok:false,error:{code:'Live.BatchTooLarge'}});expect(readReviewHistory(copy.flags)).toHaveLength(1);expect(writes).toHaveLength(1);
});
it.each(['changedParts','forgedReceipt','badRequestHash','badLabel','repairMode'])('service itself refuses %s independently of protocol',async(kind)=>{
  const {batchRequestHash}=await import('../src/polish/correction-batch');const p=await proposal(),receipt=structuredClone(p.preview.bindings),changes=p.preview.rows.map((r:any)=>({rowId:r.rowId,parts:r.after}));
  const options:any={id:'direct-test',label:'MCP batch: '+receipt.payload.reason,agentRequestHash:await batchRequestHash(receipt.payloadHash,receipt.planHash),ordinaryBatch:receipt};
  if(kind==='changedParts')changes[0]!.parts=['Forged text.'];if(kind==='forgedReceipt')receipt.rows[0]!.reason='Forged receipt reason';if(kind==='badRequestHash')options.agentRequestHash='bad';if(kind==='badLabel')options.label='Pretend another operation';if(kind==='repairMode')options.repairReferences=true;
  await expect(saveReviewRows(await view(),changes,options)).rejects.toThrow();expect(writes).toHaveLength(0);expect(readReviewHistory(copy.flags)).toHaveLength(0);
});
it('keeps repeated undo a qualified historical fact when later affected prose changes',async()=>{
  const p=await proposal();expect((await call('save_correction_batch',p.save)).ok).toBe(true);expect((await call('undo_correction',{documentId:root,operationId:p.save.operationId})).ok).toBe(true);
  copy.pages[0]!.text!.content=copy.pages[0]!.text!.content!.replace('První věta.','Pozdější lidská úprava.');const repeat:any=await call('undo_correction',{documentId:root,operationId:p.save.operationId});expect(repeat.value.alreadyUndone).toBe(true);expect(repeat.value.undoneRowsCompatible).toBe(false);expect(writes).toHaveLength(2);
  (copy.flags![MODULE_ID] as any).reviewHistory[p.save.operationId].correctionBatch.rows.pop();expect((await call('undo_correction',{documentId:root,operationId:p.save.operationId})).ok).toBe(false);expect(writes).toHaveLength(2);
});
it.each(['glossary','catalog','source'])('exact retry after changed %s refuses success while complete historical read stays explicit',async(kind)=>{
 const p=await proposal();expect((await call('save_correction_batch',p.save)).ok).toBe(true);
 if(kind==='glossary')glossary[0]!.notes='Later glossary change';if(kind==='source')(source as any).mechanicalMetadata='later';if(kind==='catalog'){const pack=game.packs.get(TRANSLATIONS_PACK_ID)!,index=await pack.getIndex(),flags=structuredClone(copy.flags!);(flags[MODULE_ID]!.translation as any).sourceUuid='JournalEntry.other';vi.spyOn(pack,'getIndex').mockResolvedValue(new Map([...index.entries(),['new',{_id:'new',name:'New',flags}]]));}
 expect((await call('save_correction_batch',p.save)).ok).toBe(false);expect(writes).toHaveLength(1);const read:any=await call('get_correction_operation',{documentId:root,operationId:p.save.operationId});expect(read.ok,JSON.stringify(read)).toBe(true);expect(read.value[kind==='glossary'?'glossaryCompatible':kind==='catalog'?'catalogCompatible':'sourceCompatible']).toBe(false);expect(read.value.operation.rows).toHaveLength(2);
});
it.each(['world','user','language','system','ember','moduleActive'])('refuses paired %s scope changes before persistence',async(kind)=>{
 const p=await proposal();if(kind==='world')(game.world as any).id='other';if(kind==='user')(game.user as any).id='other';if(kind==='language')game.settings.get=()=> 'en';if(kind==='system')(game.system as any).id='dnd5e';if(kind==='ember')(game.modules.get('ember') as any).active=false;if(kind==='moduleActive')(game.modules.get(MODULE_ID) as any).active=false;
 expect((await call('save_correction_batch',p.save)).ok).toBe(false);expect(writes).toHaveLength(0);
});
it('rejects extra protocol envelope metadata and retains exact masked marker spelling',async()=>{
 const p=await proposal();expect(()=>parseLiveRequest({id:'ordinary',method:'save_correction_batch',args:p.save,verified:true})).toThrow('Live.InvalidRequest');
 const rr=(await rows())[2]!,c:any=(await call('get_context',{documentId:root,rowId:rr.id})).value;
 expect((await call('validate_correction_batch',{documentId:root,revision:c.revision,reason:'Exact marker preservation test.',changes:[{rowId:rr.id,text:maskReviewParts(rr.translation).text,labels:[{marker:' ⟦1⟧ ',label:'Chybějící'}],reason:'No silent marker normalization.'}]})).ok).toBe(false);expect(writes).toHaveLength(0);
});
it('refuses an ambiguous duplicated stored operation ID before replay, complete read or undo',async()=>{
 const p=await proposal();expect((await call('save_correction_batch',p.save)).ok).toBe(true);const h=(copy.flags![MODULE_ID] as any).reviewHistory;h.alias=structuredClone(h[p.save.operationId]);
 for(const method of ['save_correction_batch','get_correction_operation','undo_correction'])expect(await call(method,method==='save_correction_batch'?p.save:{documentId:root,operationId:p.save.operationId})).toMatchObject({ok:false,error:{code:'Live.OperationConflict'}});expect(writes).toHaveLength(1);
});
