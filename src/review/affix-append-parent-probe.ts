/** ROOT-only reversible test on a newly created, specially marked TEST journal.
 * Observes ordinary single-parent API semantics; proves neither DB transactionality nor CAS.
 * Nothing can grant capability by passing a client attestation or evidence hash. */
import { MODULE_ID } from '../constants';
import { DISPLAY_TEXT_PACK } from '../translation/display-text';
import { sha256 } from '../translation/hash';
import { batchObject } from '../polish/correction-batch';
import { AffixAppendError, type AffixAppendEnvironment } from './affix-text-append';
import type { JournalData } from '../translation/journal';
import type { JournalApi, NativePageConstructor } from './affix-append-foundry';
import { AFFIX_APPEND_VERIFIED_SERVER_CONTRACT } from './affix-append-atomic-contract';
type Scope=AffixAppendEnvironment['scope'];
const options={diff:false,recursive:false}as const;
interface Capability {foundryVersion:string;systemVersion:string;moduleVersion:string;evidenceHash:string;databaseTransactionalGuarantee:false;kind:'observed-single-parent-api'}
let verified:{scope:string;update:JournalApi['updateDocuments'];ctor:NativePageConstructor;signature:string;pageMethod:unknown;pageSchema:unknown;cap:Capability}|null=null;
const pageMethod=(ctor:NativePageConstructor)=>(ctor as unknown as {prototype:{toObject:unknown}}).prototype.toObject;
/** Complete, bounded cycle-aware schema witness. No truncation or ignored rules.
 * DataField parent cycles are represented by traversal identity; getters are bound
 * by their source instead of being invoked. Oversized/unsupported schemas block. */
function schemaWitness(value:unknown):unknown{
 const seen=new Map<object,number>();let count=0;
 const visit=(v:unknown,depth:number):unknown=>{
  if(depth>40||++count>20000)throw new AffixAppendError('SchemaWitnessOversize');
  if(v===null||typeof v==='string'||typeof v==='number'||typeof v==='boolean')return v;
  if(v===undefined)return {undefined:true};if(typeof v==='function')return {function:String(v)};
  if(typeof v!=='object')throw new AffixAppendError('UnsupportedSchemaWitness');
  const prior=seen.get(v);if(prior!==undefined)return {ref:prior};const id=seen.size;seen.set(v,id);
  const own=Reflect.ownKeys(v).sort((a,b)=>String(a).localeCompare(String(b))).map(key=>{
   const d=Object.getOwnPropertyDescriptor(v,key)!;return [typeof key==='symbol'?['symbol',String(key)]:key,
    Object.hasOwn(d,'value')?visit(d.value,depth+1):{get:String(d.get),set:String(d.set)}];
  });
  const proto=Object.getPrototypeOf(v),methods=proto?['validate','cast','clean','getInitialValue','_validateType','_validateModel'].flatMap(k=>{
   const d=Object.getOwnPropertyDescriptor(proto,k);return d&&Object.hasOwn(d,'value')?[[k,visit(d.value,depth+1)]]:[];
  }):[];
  return {id,constructor:typeof proto?.constructor==='function'?String(proto.constructor):null,own,methods};
 };
 const witness=visit(value,0);if(new TextEncoder().encode(JSON.stringify(witness)).length>200000)throw new AffixAppendError('SchemaWitnessOversize');return witness;
}
const signature=(api:JournalApi,ctor:NativePageConstructor)=>batchObject([String(api.updateDocuments),String(ctor),String(pageMethod(ctor)),schemaWitness(ctor.schema),new ctor({_id:'schemaProbe00001',name:'Capability schema witness',type:'text',text:{format:1,content:''}},{parent:undefined}).toObject()]);
export function readAffixAppendParentCapability(scope:Scope,api:JournalApi,ctor:NativePageConstructor):Capability|null {
 const v=verified;try{if(!v||v.scope!==batchObject(scope)||v.update!==api.updateDocuments||v.ctor!==ctor||v.pageMethod!==pageMethod(ctor)||v.pageSchema!==ctor.schema||v.signature!==signature(api,ctor))return null;return {...v.cap};}catch{return null;}
}
export async function probeAffixAppendParentSave(scope:Scope,api:JournalApi,ctor:NativePageConstructor,
 read:(id:string)=>Promise<FoundryJournalDocument|undefined|null>,check:()=>void,operationId:string){
 verified=null;check();
 if(!scope.isGM||scope.packLocked||scope.activeTranslations||scope.systemId!=='crucible'||!/^14(?:\.|$)/u.test(scope.foundryVersion)||!/^[A-Za-z0-9-]{1,80}$/u.test(operationId))throw new AffixAppendError('ProbeScope');
 const proofSignature=signature(api,ctor),methodAtProbe=pageMethod(ctor),schemaAtProbe=ctor.schema,checkFresh=()=>{check();if(pageMethod(ctor)!==methodAtProbe||ctor.schema!==schemaAtProbe||signature(api,ctor)!==proofSignature)throw new AffixAppendError('ProbeImplementationChanged')};
 const id=(await sha256(JSON.stringify(['affix-append-isolated-test',scope,operationId]))).slice(0,16);checkFresh();
 const marker={version:1,operationId,scope:batchObject(scope),testOnly:true};
 const owns=(data:JournalData)=>batchObject(data.flags?.[MODULE_ID]?.affixAppendParentProbe)===batchObject(marker)&&data._id===id;
 const existing=await read(id);checkFresh();if(existing)throw new AffixAppendError('ProbeIdAlreadyExists');
 const page=(pageId:string,content:string)=>new ctor({_id:pageId,name:'Isolated API test',type:'text',text:{format:1,content}},{parent:undefined}).toObject();
 const seed:JournalData={_id:id,name:'[TEST ONLY] affix parent API '+operationId,pages:[page('testOldPage00001A','<p>OLD A</p>'),page('testOldPage00001B','<p>OLD B</p>')],flags:{[MODULE_ID]:{affixAppendParentProbe:marker,probeProvenance:{outputHash:'unchanged-generation-hash',providerId:'TEST',editor:'TEST'},probeHistory:{legacy:{before:['old'],after:['old']}}},unrelated:{literal:'keep'}}};
 const snapshots:Record<string,unknown>={seed};let created=false,cleaned=false,success=false,error:string|null=null;
 const bounded=()=>{if(new TextEncoder().encode(JSON.stringify(snapshots)).length>400000)throw new AffixAppendError('ProbeEvidenceOversize')};bounded();
 try{
  await api.createDocuments([seed],{pack:DISPLAY_TEXT_PACK,keepId:true});created=true;checkFresh();
  const doc=await read(id);checkFresh();if(!doc||!owns(doc.toObject() as JournalData))throw new AffixAppendError('ProbeOwnership');
  const baseline=doc.toObject() as JournalData;snapshots.baseline=structuredClone(baseline);
  const append=structuredClone(baseline);append.pages.push(new ctor({_id:'testNewPage00001A',name:'Isolated API test',type:'text',text:{format:1,content:'<p>NEW A</p>'}},{parent:doc}).toObject(),new ctor({_id:'testNewPage00001B',name:'Isolated API test',type:'text',text:{format:1,content:'<p>NEW B</p>'}},{parent:doc}).toObject());
  append.flags![MODULE_ID]!.probeAppend={sourceHash:'new-source-hash',affixSourceHash:'new-affix-hash',rows:[{beforeMissing:true,before:[],after:['NEW A']}],humanVerified:false};
  snapshots.appendPayload=structuredClone(append);snapshots.undoPayload=structuredClone(baseline);bounded();checkFresh();
  await api.updateDocuments([append],{pack:DISPLAY_TEXT_PACK,...options});checkFresh();
  const after=await read(id);checkFresh();if(!after||!owns(after.toObject() as JournalData))throw new AffixAppendError('ProbeOwnership');snapshots.appendActual=after.toObject();bounded();
  if(batchObject(after.toObject())!==batchObject(append))throw new AffixAppendError('ProbeAppendReadback');
  await api.updateDocuments([baseline],{pack:DISPLAY_TEXT_PACK,...options});checkFresh();
  const undo=await read(id);checkFresh();if(!undo||!owns(undo.toObject() as JournalData))throw new AffixAppendError('ProbeOwnership');snapshots.undoActual=undo.toObject();bounded();
  if(batchObject(undo.toObject())!==batchObject(baseline))throw new AffixAppendError('ProbeInverseReadback');success=true;
 }catch(e){error=e instanceof Error?e.message:'ProbeFailed';}
 finally{
  // Even a lost create response is reconciled, never replayed. Delete ONLY our exact marker.
  const remaining=await read(id);checkFresh();if(remaining){if(!owns(remaining.toObject() as JournalData))throw new AffixAppendError('ProbeCleanupOwnership');await api.deleteDocuments([id],{pack:DISPLAY_TEXT_PACK});}
  const absent=await read(id);checkFresh();cleaned=!absent;if(!cleaned){success=false;error='ProbeCleanupFailed';}
 }
 const report={version:1,operationId,testDocumentId:`Compendium.${DISPLAY_TEXT_PACK}.JournalEntry.${id}`,scope,created,cleaned,success,error,options,updateFunction: String(api.updateDocuments),pageConstructor:String(ctor),snapshots,serverContractVerified:AFFIX_APPEND_VERIFIED_SERVER_CONTRACT!==null,databaseTransactionalGuarantee:false,compareAndSwapGuaranteed:false,willVerify:false};
 if(new TextEncoder().encode(JSON.stringify(report)).length>500000)throw new AffixAppendError('ProbeEvidenceOversize');
 const evidenceHash=await sha256(batchObject(report));checkFresh();
 if(success&&cleaned)verified={scope:batchObject(scope),update:api.updateDocuments,ctor,signature:proofSignature,pageMethod:methodAtProbe,pageSchema:schemaAtProbe,cap:{foundryVersion:scope.foundryVersion,systemVersion:scope.systemVersion,moduleVersion:scope.moduleVersion,evidenceHash,kind:'observed-single-parent-api',databaseTransactionalGuarantee:false}};
 return {...report,evidenceHash,capabilityGranted:success&&cleaned};
}
