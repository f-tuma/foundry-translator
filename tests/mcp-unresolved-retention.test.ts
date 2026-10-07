import {expect,it,vi} from "vitest";
import {Client,InMemoryTransport} from "../apps/polish-mcp/node_modules/@modelcontextprotocol/client";
import {createLiveServer} from "../apps/polish-mcp/src/live-server";
import {LiveBridge} from "../apps/polish-mcp/src/live-bridge";
import {parseLiveRequest} from "../src/polish/live-protocol";
it("MCP SDK in-memory schema exposes opt-in only on three rebuild methods and forwards exact boolean",async()=>{
 const [a,b]=InMemoryTransport.createLinkedPair(),calls:any[]=[];
 const bridge={request:vi.fn(async(method:string,args:any)=>{calls.push({method,args});return {ok:true,value:{synthetic:true}};})};
 const server=createLiveServer(bridge as unknown as LiveBridge);await server.connect(b);const client=new Client({name:"private-offline-retention",version:"1"});
 try {await client.connect(a);const tools=(await client.listTools()).tools;
 const bases:any={prepare_reference_rebuild:{documentId:"copy",fieldId:"field"},validate_reference_rebuild:{documentId:"copy",fieldId:"field",revision:"a".repeat(64),planHash:"b".repeat(64),edits:[{rowId:"c".repeat(64),text:["Text"]}],reason:"Reviewed exact source identity"},apply_reference_rebuild:{documentId:"copy",fieldId:"field",revision:"a".repeat(64),planHash:"b".repeat(64),edits:[{rowId:"c".repeat(64),text:["Text"]}],reason:"Reviewed exact source identity",operationId:"unique-operation"}};
 for(const [method,base] of Object.entries(bases)) {const name="live_"+method,tool=tools.find(t=>t.name===name)!;expect((tool.inputSchema.properties as any).retainUnresolvedSourceReferences.type).toBe("boolean");expect(tool.inputSchema.additionalProperties).toBe(false);
 const args={...(base as any),retainUnresolvedSourceReferences:true};expect(()=>parseLiveRequest({id:"fixture",method,args})).not.toThrow();expect((await client.callTool({name,arguments:args})).isError).not.toBe(true);expect(calls.at(-1)).toEqual({method,args});
 for(const extra of [{retainUnresolvedSourceReferences:"true"},{sourceTarget:"Actor.guessed.Item.child"},{probes:{exists:false}},{targets:[]}]) {const bad={...args,...extra};const n=calls.length;expect(()=>parseLiveRequest({id:"fixture",method,args:bad})).toThrow();expect((await client.callTool({name,arguments:bad})).isError).toBe(true);expect(calls.length).toBe(n);}}
 const bad={documentId:"copy",rowId:"c".repeat(64),revision:"a".repeat(64),text:["Text"],reason:"Reviewed source text",retainUnresolvedSourceReferences:true};expect(()=>parseLiveRequest({id:"fixture",method:"validate_correction",args:bad})).toThrow();expect((await client.callTool({name:"live_validate_correction",arguments:bad})).isError).toBe(true);
 } finally {await client.close();await server.close();}
});
