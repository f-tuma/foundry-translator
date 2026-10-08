/** Dedicated native backend. Only the twelve reviewed original identities may append. */
import { MODULE_ID, MODULE_VERSION } from '../constants';
import { DISPLAY_TEXT_PACK, readDisplayTextFlag, type DisplayTextFlag } from '../translation/display-text';
import { activeTranslations } from '../translation/active-translations';
import { GlossaryCompendiumRepository } from '../glossary/compendium-repository';
import { sha256 } from '../translation/hash';
import { batchObject } from '../polish/correction-batch';
import { affixAppendObservation, AffixAppendError, type AffixAppendEnvironment, type AffixAppendPlan, type AffixAppendSource, type AffixAppendTarget } from './affix-text-append';
import type { AffixAppendBackend } from './affix-text-append-service';
import type { JournalData, JournalPageData } from '../translation/journal';
import { AFFIX_APPEND_SOURCE_SCOPE12 } from './affix-append-scope12';
import { readAffixAppendParentCapability } from './affix-append-parent-probe';
export type JournalApi={createDocuments(data:JournalData[],options:{pack:string;keepId?:boolean}):Promise<FoundryJournalDocument[]>;updateDocuments(data:JournalData[],options:{pack:string;diff:false;recursive:false}):Promise<unknown>;deleteDocuments(ids:string[],options:{pack:string}):Promise<unknown>};
export type NativePageConstructor={new(data:JournalPageData,options:{parent:unknown}):{toObject():JournalPageData};schema?:unknown};
export function journalApi():JournalApi{return foundry.documents.JournalEntry.implementation as unknown as JournalApi}
export function nativePageConstructor():NativePageConstructor {const c=(foundry as unknown as {documents:{JournalEntryPage?:{implementation?:NativePageConstructor}}}).documents.JournalEntryPage?.implementation;if(!c)throw new AffixAppendError('NativePageSchemaUnavailable');return c}
export const PARENT_UPDATE_OPTIONS={diff:false,recursive:false}as const;
export function affixAppendScope(language:string,pairingId:string):AffixAppendEnvironment['scope']{
 const runtime=game as unknown as {version?:string;release?:{version?:string;generation?:number}},ember=game.modules?.get('ember');
 return {worldId:game.world?.id??'',language,systemId:game.system?.id??'',systemVersion:game.system?.version??'',foundryVersion:String(runtime.release?.version??runtime.version??''),moduleVersion:String(game.modules?.get(MODULE_ID)?.version??MODULE_VERSION),clientId:pairingId,userId:game.user?.id??'',isGM:game.user?.isGM===true,packLocked:game.packs.get(DISPLAY_TEXT_PACK)?.locked!==false,activeTranslations:activeTranslations.list().some(x=>x.finishedAt===undefined),emberActive:ember?.active===true,emberVersion:String(ember?.version??'')};
}
function plain(x:unknown):x is Record<string,unknown>{return !!x&&typeof x==='object'&&!Array.isArray(x)}
function claimsOf(index:{values():Iterable<FoundryCompendiumIndexEntry>}){
 return [...index.values()].flatMap(entry=>{const f=entry.flags?.[MODULE_ID]?.displayTranslation;if(!plain(f)||typeof f.sourceUuid!=='string'||typeof f.targetLanguage!=='string')return [];return [{sourceUuid:f.sourceUuid,language:f.targetLanguage,documentId:`Compendium.${DISPLAY_TEXT_PACK}.JournalEntry.${entry._id}`}]}).sort((a,b)=>a.documentId.localeCompare(b.documentId));
}
export function createFoundryAffixAppendBackend(language:string,pairingId:string,pairedCheck:()=>void):AffixAppendBackend{
 const bounds=new WeakMap<AffixAppendEnvironment,{proof:string;scope:string;index:unknown;indexProof:string;pageCtor:NativePageConstructor;pageProof:string}>();
 function scopeCheck(){pairedCheck();const s=affixAppendScope(language,pairingId);if(!s.isGM||s.packLocked||s.activeTranslations||s.systemId!=='crucible'||!s.worldId||String(game.settings.get(MODULE_ID,'targetLanguage')??'cs')!==language)throw new AffixAppendError('Scope');return s}
 function pageProof(ctor:NativePageConstructor,parent:unknown){return batchObject([String(ctor),new ctor({_id:'schemaProbe00001',name:'Native schema probe',type:'text',text:{format:1,content:''}},{parent}).toObject()])}
 const backend:AffixAppendBackend={
 async load(documentId){
  const scope=scopeCheck(),initialScope=JSON.stringify(scope),pack=game.packs.get(DISPLAY_TEXT_PACK)!;
  if(!/^Compendium\.world\.foundry-translate-display-text\.JournalEntry\.[A-Za-z0-9]{16}$/u.test(documentId))throw new AffixAppendError('TargetIdentity');
  const index=await pack.getIndex({fields:[`flags.${MODULE_ID}.displayTranslation`]});scopeCheck();if(JSON.stringify(affixAppendScope(language,pairingId))!==initialScope)throw new AffixAppendError('ScopeChanged');
  const claims=claimsOf(index),indexProof=batchObject(claims),id=documentId.split('.').at(-1)!;
  const target=await pack.getDocument(id);scopeCheck();if(!target?.id||target.uuid!==documentId||target.documentName!=='JournalEntry')throw new AffixAppendError('TargetIdentity');
  const flag=readDisplayTextFlag(target.flags);if(!flag||!AFFIX_APPEND_SOURCE_SCOPE12.has(flag.sourceUuid)||flag.targetLanguage!==language)throw new AffixAppendError('OutsideScope12');
  const targetProof=batchObject(target.toObject());
  const source=await fromUuid(flag.sourceUuid);scopeCheck();if(!source?.id||source.uuid!==flag.sourceUuid||source.documentName!=='ActiveEffect')throw new AffixAppendError('SourceIdentity');
  const sourceProof=batchObject(source.toObject?.()),ctor=nativePageConstructor(),pageSignature=pageProof(ctor,target);
  const glossary=await new GlossaryCompendiumRepository().loadExisting();scopeCheck();const glossaryHash=await sha256(JSON.stringify(glossary));scopeCheck();const pageSchemaProof=await sha256(pageSignature);scopeCheck();
  if(JSON.stringify(affixAppendScope(language,pairingId))!==initialScope||batchObject(claimsOf(index))!==indexProof||batchObject(target.toObject())!==targetProof||batchObject(source.toObject?.())!==sourceProof||nativePageConstructor()!==ctor||pageProof(ctor,target)!==pageSignature)throw new AffixAppendError('InterveningChange');
  const env:AffixAppendEnvironment={source:source as unknown as AffixAppendSource,target:target as unknown as AffixAppendTarget,claims,scope,glossaryHash,glossary,nativePage:f=>new ctor({_id:f.pageId,name:f.path.join(' / '),type:'text',text:{format:1,content:''}},{parent:target}).toObject(),pageSchemaProof};
  bounds.set(env,{proof:affixAppendObservation(env),scope:initialScope,index,indexProof,pageCtor:ctor,pageProof:pageSignature});backend.current(env);return env;
 },
 current(env){
  const b=bounds.get(env);if(!b)throw new AffixAppendError('UnboundEnvironment');scopeCheck();
  if(JSON.stringify(affixAppendScope(language,pairingId))!==b.scope||nativePageConstructor()!==b.pageCtor||pageProof(b.pageCtor,env.target)!==b.pageProof||batchObject(claimsOf(b.index as Parameters<typeof claimsOf>[0]))!==b.indexProof||affixAppendObservation(env)!==b.proof)throw new AffixAppendError('InterveningChange');
 },
 async references(env,plan){
  backend.current(env);
  for(const ref of plan.rows.flatMap(r=>r.edit.references.flat())){
   // These exact repair-cohort source actions use the native item.name resolver.
   // It resolves in the original native Action/item context; it is never a guessed UUID.
   if(/^@ref\[item\.name\](?:\{[^}\r\n]*\})?$/iu.test(ref.command))continue;
   const m=/^@UUID\[([^\]\r\n]+)\](?:\{[^}\r\n]*\})?$/iu.exec(ref.command);if(!m)throw new AffixAppendError('UnsupportedSourceResolver');
   const uuid=m[1]!.split('#')[0]!,kind=/(?:^|\.)(Actor|Item|JournalEntry|JournalEntryPage|ActiveEffect)\.[^.]+$/u.exec(uuid)?.[1];if(!kind||uuid.startsWith('.'))throw new AffixAppendError('UnsupportedSourceResolver');
   const target=await fromUuid(uuid);backend.current(env);if(!target||target.uuid!==uuid||target.documentName!==kind)throw new AffixAppendError('ReferenceTargetMissing');
  }
  // Re-observe registry and glossary through fresh repository reads after all awaits.
  const latest=await backend.load(plan.documentId);backend.current(env);backend.current(latest);if(affixAppendObservation(latest)!==affixAppendObservation(env))throw new AffixAppendError('FreshProofChanged');
 },
 atomicCapability(){const s=scopeCheck();return readAffixAppendParentCapability(s,journalApi(),nativePageConstructor())},
 async persist(data,env){
  backend.current(env);const latest=await backend.load(env.target.uuid);backend.current(env);backend.current(latest);
  if(affixAppendObservation(latest)!==affixAppendObservation(env)||data._id!==env.target.id)throw new AffixAppendError('FreshProofChanged');
  const capability=backend.atomicCapability();if(!capability)throw new AffixAppendError('ParentSaveBehaviorUnproven');
  // One parent call, no separate embedded document API and no registry/settings/source writes.
  backend.current(env);await journalApi().updateDocuments([data],{pack:DISPLAY_TEXT_PACK,...PARENT_UPDATE_OPTIONS});
 },
 userName:()=>game.user?.name??'GM',now:()=>new Date().toISOString()
 };
 return backend;
}
