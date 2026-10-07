import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { createLiveServer } from '../src/live-server';
// Memory-only SDK transport; no server socket, network, browser or production calls.
class MemoryTransport {
  peer!: MemoryTransport; onmessage?: (message:any)=>void; onclose?: ()=>void;
  async start() {} async send(message:any) { const payload=structuredClone(message);queueMicrotask(()=>this.peer.onmessage?.(payload)); }
  async close(){this.onclose?.();}
}
async function fixture(run: (method:string,args:Record<string,unknown>)=>unknown) {
 const a=new MemoryTransport(),b=new MemoryTransport();a.peer=b;b.peer=a;
 const server=createLiveServer({request:run} as any),client=new Client({name:'private-diagnostic',version:'1'});
 await server.connect(a as any);await client.connect(b as any);return{server,client};
}
const args={documentId:'translated',rowId:'a'.repeat(64),referenceIndex:0,revision:'b'.repeat(64)};
it('actual SDK registered diagnostic is read-only and strictly rejects forbidden arguments before bridge',async()=>{
 const calls:any[]=[];const f=await fixture((method,params)=>{calls.push({method,params});return{ok:true,value:{predicate:'root-unresolved'}};});
 try{const tools=await f.client.listTools(),tool=tools.tools.find(t=>t.name==='live_get_reference_diagnostic')!;
 expect(tool).toBeDefined();expect(tool.annotations?.readOnlyHint).toBe(true);expect(tool.inputSchema.additionalProperties).toBe(false);
 expect(Object.keys(tool.inputSchema.properties as object).sort()).toEqual(['documentId','referenceIndex','revision','rowId']);
 expect(tool.inputSchema.required?.slice().sort()).toEqual(['documentId','referenceIndex','revision','rowId']);
 const bad=[{uuid:'Actor.arbitrary'},{sourceUuid:'Actor.arbitrary'},{path:['items','other']},{offset:0},{limit:2},{labels:[]},{text:['replacement']},{operationId:'write'},{restoreSourceNumbers:true},{referenceIndex:-1},{referenceIndex:1001},{referenceIndex:0.5},{referenceIndex:'0'},{revision:'invalid'}];
 for(const extra of bad)expect((await f.client.callTool({name:'live_get_reference_diagnostic',arguments:{...args,...extra}})).isError).toBe(true);
 for(const key of Object.keys(args)){const values={...args}as any;delete values[key];expect((await f.client.callTool({name:'live_get_reference_diagnostic',arguments:values})).isError).toBe(true);}
 expect(calls).toEqual([]);
 const result=await f.client.callTool({name:'live_get_reference_diagnostic',arguments:args});expect(JSON.parse((result.content as any)[0].text)).toEqual({ok:true,value:{predicate:'root-unresolved'}});
 expect(calls).toEqual([{method:'get_reference_diagnostic',params:args}]);
 }finally{await f.client.close();await f.server.close();}
});
it('diagnostic SDK bridge errors never expose UUID, prose or raw error detail',async()=>{const f=await fixture(()=>{throw Error('Actor.private SENSITIVE-SECRET');});try{const result=await f.client.callTool({name:'live_get_reference_diagnostic',arguments:args});expect(result.isError).toBe(true);expect(JSON.stringify(result)).not.toMatch(/Actor.private|SENSITIVE/);}finally{await f.client.close();await f.server.close();}});
