import {expect,it} from 'vitest';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {createLiveServer} from '../src/live-server';
import {LiveBridge} from '../src/live-bridge';
import {vi} from 'vitest';
import {parseLiveRequest} from '../../../src/polish/live-protocol';

it('actual MCP SDK in-memory/Zod rejects unsafe batches before forwarding and preserves complete ordinary payloads',async()=>{
 const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
 const calls:any[]=[];const reply={ok:true,value:{complete:true,operation:{rows:[{before:['x'.repeat(5000)],after:['y'.repeat(5000)]}]},scope:'in-memory transport and fake bridge only, not Foundry production'}};
 const bridge={request:vi.fn(async(method:string,args:any)=>{calls.push({method,args});return reply;})};
 const server=createLiveServer(bridge as unknown as LiveBridge);await server.connect(serverTransport);
 const client=new Client({name:'private-offline-batch-test',version:'1'});
 try{
  await client.connect(clientTransport);const tools=(await client.listTools()).tools;
  for(const name of ['live_validate_correction_batch','live_save_correction_batch','live_get_correction_operation']){const t=tools.find(t=>t.name===name)!;expect(t).toBeDefined();expect(t.inputSchema.additionalProperties).toBe(false);expect(t.annotations?.readOnlyHint).toBe(name!=='live_save_correction_batch');}
  const tool=tools.find(t=>t.name==='live_validate_correction_batch')!;expect((tool.inputSchema.properties as any).changes).toMatchObject({minItems:1,maxItems:10,items:{additionalProperties:false,properties:{labels:{items:{additionalProperties:false}}}}});
  const base={documentId:'translated',revision:'a'.repeat(64),reason:'Private ordinary batch test',changes:[{rowId:'b'.repeat(64),text:['Věta ⟦1⟧.'],labels:[{marker:'⟦1⟧',label:'Odkaz'}],reason:'Exact source-aware ordinary edit'}]};
  const unsafe=[{...base,options:[]},{...base,restoreSourceNumbers:true},{...base,verify:true},{...base,rowId:'b'.repeat(64)},{...base,sourceUuid:'Actor.other'},
   {...base,changes:[]},{...base,changes:[base.changes[0],base.changes[0]]},{...base,changes:Array.from({length:11},(_,i)=>({...base.changes[0],rowId:i.toString(16).padStart(64,'0')}))},
   {...base,changes:[{...base.changes[0],uuid:'Actor.other'}]},{...base,changes:[{...base.changes[0],labels:[{...base.changes[0]!.labels[0],target:'Actor.other'}]}]},
   {...base,changes:[{...base.changes[0],text:['ž'.repeat(60000)]}]}];
  // Each rejected Zod/server request must be refused before a queued browser poll.
  for(const args of unsafe){expect(()=>parseLiveRequest({id:'unsafe',method:'validate_correction_batch',args})).toThrow('Live.InvalidRequest');expect((await client.callTool({name:'live_validate_correction_batch',arguments:args})).isError).toBe(true);expect(calls).toHaveLength(0);}
  // Changes alone fit; full envelope exceeds the shared limit. No 120k loophole.
  const envelope={...base,reason:'r'.repeat(3000),changes:[{...base.changes[0],text:['ž'.repeat(59000)]}]};expect(new TextEncoder().encode(JSON.stringify(envelope.changes)).length).toBeLessThan(120000);expect(new TextEncoder().encode(JSON.stringify(envelope)).length).toBeGreaterThan(120000);expect((await client.callTool({name:'live_validate_correction_batch',arguments:envelope})).isError).toBe(true);
  for(const [name,method,args] of [['live_validate_correction_batch','validate_correction_batch',base],['live_save_correction_batch','save_correction_batch',{...base,planHash:'c'.repeat(64),operationId:'durable-batch'}],['live_get_correction_operation','get_correction_operation',{documentId:base.documentId,operationId:'durable-batch'}]] as const){
   const result=await client.callTool({name,arguments:args});const req={id:'ordinary',...calls.at(-1)};expect(req).toMatchObject({method,args});expect(()=>parseLiveRequest(req)).not.toThrow();expect(JSON.parse((result.content as {text:string}[])[0]!.text)).toEqual(reply);
  }
  const spaced={...base,changes:[{...base.changes[0],labels:[{marker:' ⟦1⟧ ',label:'Odkaz'}]}]};await client.callTool({name:'live_validate_correction_batch',arguments:spaced});expect(calls.at(-1).args.changes[0].labels[0].marker).toBe(' ⟦1⟧ '); // service independently rejects this unknown exact marker.
  for(const args of [{...base,operationId:'unexpected'},{...base,planHash:'c'.repeat(64)}])expect((await client.callTool({name:'live_validate_correction_batch',arguments:args})).isError).toBe(true);
  expect((await client.callTool({name:'live_save_correction_batch',arguments:base})).isError).toBe(true);expect((await client.callTool({name:'live_get_correction_operation',arguments:{documentId:base.documentId,operationId:'durable-batch',revision:base.revision}})).isError).toBe(true);
 }finally{await client.close();await server.close();}
},15000);
