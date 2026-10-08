import {expect,it} from 'vitest';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {createLiveServer} from '../src/live-server';
import {vi} from 'vitest';
import {parseLiveRequest} from '../../../src/polish/live-protocol';

it('actual SDK in-memory strict MCP append methods reject authority bypass and forward exact fake-browser envelopes',async()=>{
 const [ct,st]=InMemoryTransport.createLinkedPair(),calls:any[]=[];
 const bridge={request:vi.fn(async(method:string,args:any)=>{calls.push({method,args});return {ok:true,value:{complete:true,willVerify:false,scope:'in-memory fake bridge only',payload:args}}})};
 const server=createLiveServer(bridge as any);await server.connect(st);const client=new Client({name:'offline-append-integration-test',version:'1'});
 try{await client.connect(ct);const tools=(await client.listTools()).tools;
 const documentId='Compendium.world.foundry-translate-display-text.JournalEntry.translation00001',revision='a'.repeat(64),operationId='append-test';
 const base={documentId,revision,planHash:'b'.repeat(64),edits:[{rowId:'c'.repeat(64),text:['Věta ⟦1⟧.'],labels:[{marker:'⟦1⟧',label:'Odkaz'}]}],reason:'Exact fresh full source read'};
 const requests=[['prepare_affix_text_append',{documentId,revision},true],['validate_affix_text_append',base,true],['apply_affix_text_append',{...base,operationId},false],['get_affix_text_append_operation',{documentId,operationId},true],['undo_affix_text_append',{documentId,operationId,undoId:'undo-test',revision},false],['probe_affix_text_append_parent_save',{operationId:'test-journal',confirmIsolatedTestJournal:true},false]]as const;
 for(const [method,args,readOnly]of requests){const name='live_'+method,t=tools.find(t=>t.name===name)!;expect(t).toBeDefined();expect(t.inputSchema.additionalProperties).toBe(false);expect(t.annotations?.readOnlyHint).toBe(readOnly);
 for(const extra of [{sourceUuid:'Item.other'},{evidenceHash:'d'.repeat(64)},{atomic:true},{restoreSourceNumbers:true},{verify:true}])expect((await client.callTool({name,arguments:{...args,...extra}})).isError).toBe(true);
 const result=await client.callTool({name,arguments:args}),req={id:'memory',...calls.at(-1)};expect(req).toMatchObject({method,args});expect(()=>parseLiveRequest(req)).not.toThrow();expect(JSON.parse((result.content as {text:string}[])[0]!.text)).toEqual({ok:true,value:{complete:true,willVerify:false,scope:'in-memory fake bridge only',payload:args}});

 }
 expect((await client.callTool({name:'live_probe_affix_text_append_parent_save',arguments:{operationId,confirmIsolatedTestJournal:false}})).isError).toBe(true);
 expect((await client.callTool({name:'live_validate_affix_text_append',arguments:{...base,edits:[...base.edits,...base.edits]}})).isError).toBe(true);
 expect((await client.callTool({name:'live_validate_affix_text_append',arguments:{...base,edits:[{...base.edits[0],text:['ž'.repeat(60000)]}]}})).isError).toBe(true);
 }finally{await client.close();await server.close();}
},15000);
