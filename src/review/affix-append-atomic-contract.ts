/** Optional independently reviewed server evidence. No server code was available here. */
export interface AffixAppendServerContract {
 version:1; foundryVersion:string; systemVersion:string; moduleVersion:string;
 updateFunctionHash:string; pageConstructorHash:string;
 serverEvidenceHash:string; serverEvidenceId:string;
 singleParentEmbeddedReplaceAndMetadata:true;
 databaseTransactionalGuarantee:boolean;
 exactOptions:{diff:false;recursive:false};
}
/** Not remotely configurable; ordinary API observation never populates this manifest. */
export const AFFIX_APPEND_VERIFIED_SERVER_CONTRACT:AffixAppendServerContract|null=null;
