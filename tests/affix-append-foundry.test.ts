import {afterEach,expect,it,vi} from 'vitest';
import {fixture} from './affix-production-fixture';
import {activeTranslations} from '../src/translation/active-translations';
import {MODULE_ID} from '../src/constants';
import {DISPLAY_TEXT_PACK} from '../src/translation/display-text';
import {GlossaryCompendiumRepository} from '../src/glossary/compendium-repository';
import {createFoundryAffixAppendBackend,affixAppendScope} from '../src/review/affix-append-foundry';
import {probeAffixAppendParentSave,readAffixAppendParentCapability} from '../src/review/affix-append-parent-probe';
import {prepareAffixAppend,validateAffixAppend,applyAffixAppend,getAffixAppendOperation,undoAffixAppend} from '../src/review/affix-text-append-service';
import {createLiveHandler} from '../src/polish/live-service';
import {parseLiveRequest} from '../src/polish/live-protocol';
import {sha256} from '../src/translation/hash';
import {translatedOutputHash} from '../src/translation/output-hash';
import type {JournalData,JournalPageData} from '../src/translation/journal';
class Page {static schema={};data:JournalPageData;constructor(data:JournalPageData,_options:unknown){this.data={title:{show:true,level:1},sort:0,flags:{},ownership:{default:-1},...structuredClone(data)}}toObject(){return structuredClone(this.data)}}
afterEach(()=>vi.restoreAllMocks());
async function setup(kind:'Focusing'|'Disguise'|'Luminous'='Focusing'){
 const f=await fixture(kind,'Compendium.crucible.affixes');
 const records=new Map<string,JournalData>([[f.get()._id,f.get()]]),calls:{method:string;data:unknown;options:unknown}[]=[],id=f.env.target.id;
 const doc=(key:string)=>{const data=records.get(key);return data?{id:key,uuid:`Compendium.${DISPLAY_TEXT_PACK}.JournalEntry.${key}`,documentName:'JournalEntry',pack:DISPLAY_TEXT_PACK,get flags(){return records.get(key)!.flags},toObject:()=>structuredClone(records.get(key)!)}:undefined};
 const index=new Map([[id,{_id:id,flags:f.get().flags}]]);
 const pack={locked:false,getIndex:vi.fn(async()=>index),getDocument:vi.fn(async(key:string)=>doc(key))};
 const gameMock={version:'14.400',world:{id:'test-world'},user:{id:'gm',name:'GM',isGM:true},system:{id:'crucible',version:'0.11-test'},packs:new Map([[DISPLAY_TEXT_PACK,pack]]),modules:new Map([[MODULE_ID,{active:true,version:'0.34-test'}]]),settings:{get:()=> 'cs'}};
 vi.stubGlobal('game',gameMock);vi.stubGlobal('fromUuid',vi.fn(async(uuid:string)=>uuid===f.env.source.uuid?f.env.source:undefined));
 vi.spyOn(GlossaryCompendiumRepository.prototype,'loadExisting').mockResolvedValue([]);
 const api={createDocuments:vi.fn(async(data:JournalData[],options:unknown)=>{calls.push({method:'create',data:structuredClone(data),options});data.forEach(d=>records.set(d._id!,structuredClone(d)));return data.map(d=>doc(d._id!)!)as any}),updateDocuments:vi.fn(async(data:JournalData[],options:unknown)=>{calls.push({method:'update',data:structuredClone(data),options});data.forEach(d=>records.set(d._id!,structuredClone(d)));}),deleteDocuments:vi.fn(async(ids:string[],options:unknown)=>{calls.push({method:'delete',data:ids,options});ids.forEach(x=>records.delete(x));})};
 vi.stubGlobal('foundry',{documents:{JournalEntry:{implementation:api},JournalEntryPage:{implementation:Page}}});
 const scope=affixAppendScope('cs','pair-test'),backend=createFoundryAffixAppendBackend('cs','pair-test',()=>{});
 const probe=()=>probeAffixAppendParentSave(scope,api,Page,async key=>doc(key)as any,()=>{expect(affixAppendScope('cs','pair-test')).toEqual(scope)},'parent-test');
 return {f,records,calls,api,pack,index,gameMock,scope,backend,doc,probe,id};
}
it.each(['Disguise','Focusing','Luminous']as const)('production adapter preserves complete source and legacy bytes through native page defaults, one parent append, readback and guarded inverse: %s',async kind=>{
 const x=await setup(kind),before=structuredClone(x.records.get(x.id)!),source=structuredClone(x.f.data);
 const plan=await prepareAffixAppend(x.backend,x.f.env.target.uuid,undefined as any);
 const edits=plan.rows.map(r=>({rowId:r.rowId,text:r.edit.text.map(t=>'CZ '+t)}));
 await validateAffixAppend(x.backend,{documentId:plan.documentId,revision:plan.revision,planHash:plan.planHash,edits,reason:'Supported full source read'});
 await expect(applyAffixAppend(x.backend,{documentId:plan.documentId,revision:plan.revision,planHash:plan.planHash,edits,reason:'Supported full source read',operationId:'append-prod'})).rejects.toThrow('ParentSaveBehaviorUnproven');expect(x.calls).toHaveLength(0);
 const witness=await x.probe();expect(witness.capabilityGranted).toBe(true);expect(witness.databaseTransactionalGuarantee).toBe(false);expect(witness.compareAndSwapGuaranteed).toBe(false);expect(x.records.size).toBe(1);expect(x.calls.filter(c=>c.method==='update')).toHaveLength(2);
 x.calls.length=0;
 const req={documentId:plan.documentId,revision:plan.revision,planHash:plan.planHash,edits,reason:'Supported full source read',operationId:'append-prod'};
 expect((await applyAffixAppend(x.backend,req)).saved).toBe(true);expect(x.calls).toHaveLength(1);expect(x.calls[0]).toMatchObject({method:'update',options:{pack:DISPLAY_TEXT_PACK,diff:false,recursive:false}});
 expect((x.calls[0]!.data as JournalData[])).toHaveLength(1);expect(x.records.get(x.id)!.pages.slice(0,2)).toEqual(before.pages);
 expect(x.records.get(x.id)!.pages.slice(2).every(p=>(p.title as any)?.show===true)).toBe(true);expect(x.f.data).toEqual(source);
 const actual=await getAffixAppendOperation(x.backend,plan.documentId,'append-prod');expect(actual.currentRaw).toEqual(x.records.get(x.id));expect(actual.sourceRaw).toEqual(source);expect(actual.willVerify).toBe(false);
 expect((await applyAffixAppend(x.backend,req)).alreadyApplied).toBe(true);expect(x.calls).toHaveLength(1);
 const revision=await sha256(JSON.stringify([await translatedOutputHash({document:x.records.get(x.id)!}),plan.sourceHash,plan.glossaryHash,plan.scope.systemId,plan.scope.emberActive,plan.scope.emberVersion]));
 await expect(undoAffixAppend(x.backend,plan.documentId,'append-prod','undo-prod','a'.repeat(64))).rejects.toThrow('Revision');expect(x.calls).toHaveLength(1);
 await undoAffixAppend(x.backend,plan.documentId,'append-prod','undo-prod',revision);expect(x.calls).toHaveLength(2);expect(x.records.get(x.id)!.pages).toEqual(before.pages);expect(x.records.get(x.id)!.flags![MODULE_ID]!.displayTranslation).toEqual(before.flags![MODULE_ID]!.displayTranslation);expect(x.f.data).toEqual(source);
 const undone=await getAffixAppendOperation(x.backend,plan.documentId,'append-prod');expect(undone.undoneRowsCompatible).toBe(true);expect(undone.affectedRowsCompatible).toBe(false);
 expect((await undoAffixAppend(x.backend,plan.documentId,'append-prod','undo-prod',revision)).alreadyUndone).toBe(true);expect(x.calls).toHaveLength(2);
 await expect(undoAffixAppend(x.backend,plan.documentId,'append-prod','wrong-undo',revision)).rejects.toThrow('UndoReceipt');
});
it('failed inverse parent page removal keeps capability null and deletes only own isolated test',async()=>{const x=await setup(),normal=x.api.updateDocuments.getMockImplementation()!;x.api.updateDocuments.mockImplementation(async(data,options)=>{const prior=x.records.get(data[0]!._id!)!;await normal(data,options);if(data[0]!.pages.length===2&&prior.pages.length===4)x.records.set(data[0]!._id!,{...data[0]!,pages:prior.pages})});const result=await x.probe();expect(result.success).toBe(false);expect(result.error).toContain('ProbeInverseReadback');expect(result.cleaned).toBe(true);expect(readAffixAppendParentCapability(x.scope,x.api,Page)).toBeNull();expect(x.records.size).toBe(1);expect(x.calls.every(c=>c.method!=='delete'||!(c.data as string[]).includes(x.id))).toBe(true)});
it.each(['source','registry','scope','target','page-schema']as const)('fresh production load rejects intervening %s before mutation',async change=>{const x=await setup();vi.spyOn(GlossaryCompendiumRepository.prototype,'loadExisting').mockImplementation(async()=>{if(change==='source')x.f.data.system.tier.value=8;if(change==='registry')x.index.set('duplicate',{_id:'duplicate',flags:x.f.get().flags});if(change==='scope')x.gameMock.user.id='another';if(change==='target')x.records.get(x.id)!.name='Changed';if(change==='page-schema')vi.stubGlobal('foundry',{documents:{JournalEntry:{implementation:x.api},JournalEntryPage:{implementation:class extends Page{}}}});return []});await expect(x.backend.load(x.f.env.target.uuid)).rejects.toThrow();expect(x.calls).toHaveLength(0)});
it('rejects out-of-scope original identity rather than broadening eligibility',async()=>{const x=await setup();x.records.get(x.id)!.flags![MODULE_ID]!.displayTranslation={...(x.records.get(x.id)!.flags![MODULE_ID]!.displayTranslation as any),sourceUuid:'Compendium.crucible.affixes.ActiveEffect.unreviewed000000'};await expect(x.backend.load(x.f.env.target.uuid)).rejects.toThrow('OutsideScope12');expect(x.calls).toHaveLength(0)});
it('capability is bound to exact pairing, installed API function and versions',async()=>{const x=await setup();await x.probe();expect(readAffixAppendParentCapability(x.scope,x.api,Page)).not.toBeNull();expect(readAffixAppendParentCapability({...x.scope,clientId:'another'},x.api,Page)).toBeNull();expect(readAffixAppendParentCapability({...x.scope,moduleVersion:'new'},x.api,Page)).toBeNull();expect(readAffixAppendParentCapability(x.scope,{...x.api,updateDocuments:async()=>{}},Page)).toBeNull()});
it('probe has no target input, capability proof bypass or source UUID argument',()=>{for(const extras of [{documentId:'real'},{evidenceHash:'a'.repeat(64)},{atomic:true},{sourceUuid:'Item.real'},{confirmIsolatedTestJournal:false}])expect(()=>parseLiveRequest({id:'probe',method:'probe_affix_text_append_parent_save',args:{operationId:'test',confirmIsolatedTestJournal:true,...extras}})).toThrow();expect(parseLiveRequest({id:'probe',method:'probe_affix_text_append_parent_save',args:{operationId:'test',confirmIsolatedTestJournal:true}}).request.method).toBe('probe_affix_text_append_parent_save')});

it('fresh EXACT source matches require approved Czech text, not merely a matching glossary hash',async()=>{const x=await setup();vi.spyOn(GlossaryCompendiumRepository.prototype,'loadExisting').mockResolvedValue([{id:'canon',source:'Focus',replacement:'Soustředění',aliases:[],category:'general',mode:'exact',enabled:true}as any]);const plan=await prepareAffixAppend(x.backend,x.f.env.target.uuid,undefined as any),edits=plan.rows.map(r=>({rowId:r.rowId,text:r.edit.text.map(t=>'CZ '+t)}));await expect(validateAffixAppend(x.backend,{documentId:plan.documentId,revision:plan.revision,planHash:plan.planHash,edits,reason:'Full source read'})).rejects.toThrow('EXACT');expect(x.calls).toHaveLength(0)});
it('a receipt row cannot invent actual text while raw fields stay unchanged',async()=>{const x=await setup();await x.probe();const plan=await prepareAffixAppend(x.backend,x.f.env.target.uuid,undefined as any),edits=plan.rows.map(r=>({rowId:r.rowId,text:r.edit.text.map(t=>'CZ '+t)}));await applyAffixAppend(x.backend,{documentId:plan.documentId,revision:plan.revision,planHash:plan.planHash,edits,reason:'Full source read',operationId:'append'});(x.records.get(x.id)!.flags![MODULE_ID]!.reviewHistory as any).append.rows[0].after=['Fabricated'];await expect(getAffixAppendOperation(x.backend,plan.documentId,'append')).rejects.toThrow('ReceiptActualRows')});
it('lost create response is reconciled and only the marked TEST journal is removed; capability remains null',async()=>{const x=await setup(),normal=x.api.createDocuments.getMockImplementation()!;x.api.createDocuments.mockImplementation(async(data,options)=>{await normal(data,options);throw new Error('Lost create response')});const result=await x.probe();expect(result.success).toBe(false);expect(result.cleaned).toBe(true);expect(result.capabilityGranted).toBe(false);expect(x.records.size).toBe(1);expect(x.calls.filter(c=>c.method==='create')).toHaveLength(1)});
it('reference support is exact and missing original UUIDs reject before any save',async()=>{const x=await setup();x.f.data.system.actions[0].description+='<p>@UUID[Item.missing000000000]{Missing}</p>';await expect(prepareAffixAppend(x.backend,x.f.env.target.uuid,undefined as any)).rejects.toThrow('ReferenceTargetMissing');expect(x.calls).toHaveLength(0)});
it('native private scope is never probed without a GM or in another Foundry generation',async()=>{const x=await setup();await expect(probeAffixAppendParentSave({...x.scope,isGM:false},x.api,Page,async key=>x.doc(key)as any,()=>{},'test')).rejects.toThrow('ProbeScope');await expect(probeAffixAppendParentSave({...x.scope,foundryVersion:'13.999'},x.api,Page,async key=>x.doc(key)as any,()=>{},'test')).rejects.toThrow('ProbeScope');expect(x.calls).toHaveLength(0)});

it('registered browser handler executes its own dedicated bounded prepare/preview/probe/save/get path with no catalog-wide SourceChanged override',async()=>{const x=await setup();const preliminary=await prepareAffixAppend(x.backend,x.f.env.target.uuid,undefined as any),handle=createLiveHandler('cs',()=>true);
 const call=(method:string,args:unknown)=>handle({id:'browser-test',method,args});
 const prepared=await call('prepare_affix_text_append',{documentId:preliminary.documentId,revision:preliminary.revision});expect(prepared.ok).toBe(true);const plan=prepared.value as typeof preliminary;
 const edits=plan.rows.map(r=>({rowId:r.rowId,text:r.edit.text.map(t=>'CZ '+t)})),request={documentId:plan.documentId,revision:plan.revision,planHash:plan.planHash,edits,reason:'Complete paired source read'};
 expect((await call('validate_affix_text_append',request)).ok).toBe(true);expect(x.calls).toHaveLength(0);
 const proof=await call('probe_affix_text_append_parent_save',{operationId:'handler-parent-test',confirmIsolatedTestJournal:true});expect(proof.ok).toBe(true);expect((proof.value as any).capabilityGranted).toBe(true);expect((proof.value as any).databaseTransactionalGuarantee).toBe(false);
 x.calls.length=0;const saved=await call('apply_affix_text_append',{...request,operationId:'handler-append'});expect(saved.ok).toBe(true);expect(x.calls).toHaveLength(1);
 const actual=await call('get_affix_text_append_operation',{documentId:plan.documentId,operationId:'handler-append'});expect(actual.ok).toBe(true);expect((actual.value as any).currentRaw).toEqual(x.records.get(x.id));expect((actual.value as any).willVerify).toBe(false);
 expect((await call('apply_affix_text_append',{...request,operationId:'handler-append'})).ok).toBe(true);expect(x.calls).toHaveLength(1);
});

it.each(['alias','boundary','inflect']as const)('EXACT matcher respects source %s rather than generic English word substitutions',async mode=>{const x=await setup();vi.spyOn(GlossaryCompendiumRepository.prototype,'loadExisting').mockResolvedValue([{id:'lex',source:mode==='alias'?'OtherCanonicalName':mode==='boundary'?'ocus':'Focus',aliases:mode==='alias'?['Focus']:[],replacement:'Soustředění',category:'general',mode:mode==='inflect'?'inflect':'exact',enabled:true}as any]);const plan=await prepareAffixAppend(x.backend,x.f.env.target.uuid,undefined as any),edits=plan.rows.map(r=>({rowId:r.rowId,text:r.edit.text.map(t=>'CZ '+t)})),req={documentId:plan.documentId,revision:plan.revision,planHash:plan.planHash,edits,reason:'Whole explicit source read'};
 if(mode==='alias')await expect(validateAffixAppend(x.backend,req)).rejects.toThrow('EXACT');else expect((await validateAffixAppend(x.backend,req)).willVerify).toBe(false);expect(x.calls).toHaveLength(0);
});
it('exact source glossary spelling with correct boundaries is retained in full new body text',async()=>{const x=await setup();vi.spyOn(GlossaryCompendiumRepository.prototype,'loadExisting').mockResolvedValue([{id:'lex',source:'Focus',aliases:[],replacement:'Soustředění',category:'general',mode:'exact',enabled:true}as any]);const plan=await prepareAffixAppend(x.backend,x.f.env.target.uuid,undefined as any),edits=plan.rows.map(r=>({rowId:r.rowId,text:r.edit.text.map(t=>'CZ '+t.replace(/\bFocus\b/gu,'Soustředění'))}));expect((await validateAffixAppend(x.backend,{documentId:plan.documentId,revision:plan.revision,planHash:plan.planHash,edits,reason:'Whole explicit source read'})).willVerify).toBe(false);expect(x.calls).toHaveLength(0)});
it('editable source caption EXACT alias cannot be omitted even when masked body remains perfect',async()=>{const x=await setup('Luminous');x.f.data.system.actions[0].description+='<p>@ref[item.name]{Focus}</p>';vi.spyOn(GlossaryCompendiumRepository.prototype,'loadExisting').mockResolvedValue([{id:'lex',source:'OtherName',aliases:['Focus'],replacement:'Soustředění',category:'general',mode:'exact',enabled:true}as any]);const plan=await prepareAffixAppend(x.backend,x.f.env.target.uuid,undefined as any),edits=plan.rows.map(r=>({rowId:r.rowId,text:r.edit.text.map(t=>'CZ '+t),labels:r.edit.references.flat().filter(ref=>ref.editable&&ref.label==='Focus').map(ref=>({marker:ref.marker,label:'Nesprávně'}))})),req={documentId:plan.documentId,revision:plan.revision,planHash:plan.planHash,edits,reason:'Full original caption read'};
 expect(edits.some(e=>e.labels.length)).toBe(true);await expect(validateAffixAppend(x.backend,req)).rejects.toThrow('EXACT');for(const e of edits)for(const l of e.labels)l.label='Soustředění';expect((await validateAffixAppend(x.backend,req)).willVerify).toBe(false);expect(x.calls).toHaveLength(0);
});

it.each(['prepare','apply','probe']as const)('unfinished PAUSED run blocks dedicated %s before writes',async stage=>{const x=await setup();const plan=await prepareAffixAppend(x.backend,x.f.env.target.uuid,undefined as any),edits=plan.rows.map(r=>({rowId:r.rowId,text:r.edit.text.map(t=>'CZ '+t)}));vi.spyOn(activeTranslations,'list').mockReturnValue([{id:999,state:'translating',pausedAt:Date.now(),finishedAt:undefined}as any]);expect(affixAppendScope('cs','pair-test').activeTranslations).toBe(true);
 if(stage==='prepare')await expect(prepareAffixAppend(x.backend,plan.documentId,plan.revision)).rejects.toThrow('Scope');
 if(stage==='apply')await expect(applyAffixAppend(x.backend,{documentId:plan.documentId,revision:plan.revision,planHash:plan.planHash,edits,reason:'Whole paired read',operationId:'paused'})).rejects.toThrow('Scope');
 if(stage==='probe')await expect(probeAffixAppendParentSave(affixAppendScope('cs','pair-test'),x.api,Page,async key=>x.doc(key)as any,()=>{},'paused')).rejects.toThrow('ProbeScope');
 expect(x.calls).toHaveLength(0);
});
it('same constructor identity cannot retain capability after toObject behavior or native defaults change',async()=>{const x=await setup();await x.probe();const original=Page.prototype.toObject;
 try{Page.prototype.toObject=function(){return {...original.call(this),sort:888}};expect(readAffixAppendParentCapability(x.scope,x.api,Page)).toBeNull();}
 finally{Page.prototype.toObject=original;}
 expect(readAffixAppendParentCapability(x.scope,x.api,Page)).not.toBeNull();
 const schema=Page.schema;try{Page.schema={replacement:true}as any;expect(readAffixAppendParentCapability(x.scope,x.api,Page)).toBeNull();}finally{Page.schema=schema;}
});

it('in-place schema validation mutation invalidates observed capability even when native defaults are unchanged',async()=>{const x=await setup();await x.probe();const schema=Page.schema;try{Object.assign(Page.schema,{newValidationRule:true});expect(Page.schema).toBe(schema);expect(readAffixAppendParentCapability(x.scope,x.api,Page)).toBeNull();}finally{delete(Page.schema as any).newValidationRule;}});
it('native schema parent cycles are finite exact witnesses; changed nested rule revokes capability',async()=>{const x=await setup(),original=Page.schema;const schema:any={fields:{text:{required:true}}};schema.fields.text.parent=schema;try{Page.schema=schema;const result=await x.probe();expect(result.capabilityGranted).toBe(true);schema.fields.text.required=false;expect(readAffixAppendParentCapability(x.scope,x.api,Page)).toBeNull();}finally{Page.schema=original;}});

it('shared large native Field sources fit unchanged witness budget and nested/accessor/method mutations revoke capability',async()=>{
 const x=await setup(),original=Page.schema;
 const Field=Function('return class Field { constructor(){this.required=true} validate(){return true} /*'+ 'Native field source retained. '.repeat(250)+'*/ }')() as any;
 const schema:any={fields:Array.from({length:95},()=>new Field())};schema.fields.forEach((f:any)=>f.parent=schema);
 const getRule=function(){return true};Object.defineProperty(schema,'rule',{get:getRule,configurable:true});
 try{Page.schema=schema;expect((await x.probe()).capabilityGranted).toBe(true);expect(x.calls.filter(c=>c.method==='create')).toHaveLength(1);
  schema.fields[94].required=false;expect(readAffixAppendParentCapability(x.scope,x.api,Page)).toBeNull();schema.fields[94].required=true;
  expect(readAffixAppendParentCapability(x.scope,x.api,Page)).not.toBeNull();
  Object.defineProperty(schema,'rule',{get:()=>false,configurable:true});expect(readAffixAppendParentCapability(x.scope,x.api,Page)).toBeNull();
  Object.defineProperty(schema,'rule',{get:getRule,configurable:true});expect(readAffixAppendParentCapability(x.scope,x.api,Page)).not.toBeNull();
  Field.prototype.validate=function(){return false};expect(readAffixAppendParentCapability(x.scope,x.api,Page)).toBeNull();
 }finally{Page.schema=original;}
});
it.each(['bytes','nodes','depth','unsupported']as const)('unchanged %s witness guard rejects BEFORE read or API create',async bound=>{
 const x=await setup(),original=Page.schema,read=vi.fn(async(key:string)=>x.doc(key)as any);
 let schema:any;if(bound==='bytes')schema={rule:Function('/*'+'X'.repeat(200001)+'*/')};
 else if(bound==='nodes')schema={rules:Array.from({length:20001},()=>true)};
 else if(bound==='depth'){schema={};let s=schema;for(let i=0;i<41;i++)s=s.child={};}
 else schema={rule:Symbol('unsupported value')};
 try{Page.schema=schema;await expect(probeAffixAppendParentSave(x.scope,x.api,Page,read,()=>{},'blocked-schema')).rejects.toThrow(bound==='unsupported'?'UnsupportedSchemaWitness':'SchemaWitnessOversize');expect(read).not.toHaveBeenCalled();expect(x.calls).toHaveLength(0);expect(readAffixAppendParentCapability(x.scope,x.api,Page)).toBeNull();}
 finally{Page.schema=original;}
});
it('all isolated TEST and schema-probe IDs satisfy native sixteen-character alphanumeric ID validation',async()=>{
 const x=await setup();class NativeIdPage extends Page {constructor(data:JournalPageData,options:unknown){if(!/^[A-Za-z0-9]{16}$/u.test(data._id!))throw new Error('Native DocumentIdField');super(data,options)}}
 const result=await probeAffixAppendParentSave(x.scope,x.api,NativeIdPage,async key=>x.doc(key)as any,()=>{},'strict-id-test');expect(result.capabilityGranted).toBe(true);expect(result.cleaned).toBe(true);
 for(const c of x.calls.filter(c=>c.method==='create'||c.method==='update'))for(const d of c.data as JournalData[]){expect(d._id).toMatch(/^[A-Za-z0-9]{16}$/u);for(const p of d.pages)expect(p._id).toMatch(/^[A-Za-z0-9]{16}$/u);}
});
