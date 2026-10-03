import { afterEach, expect, it } from "vitest";
import { request } from "node:http";
import { LiveBridge, allowedOrigin } from "../src/live-bridge";
import { parseLiveRequest } from "../../../src/polish/live-protocol";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";

const origin = "https://foundry.example.cz";
const claim = { protocol: 1, worldId: "fixture", worldName: "Synthetic test world", userId: "gm", language: "cs", systemId: "crucible", moduleVersion: "test", clientId: "browser-1" };
let bridge: LiveBridge | undefined;
afterEach(async () => { await bridge?.close(); bridge = undefined; });
async function fixture() {
  bridge = await new LiveBridge(origin, 0).start(); const connection = bridge.connection();
  const call = async (path: string, token: string, body?: unknown, from = origin) => fetch(`${connection.address}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Origin: from, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const response = await call('/connect', connection.pairingCode!, claim); expect(response.status).toBe(200);
  const { sessionToken } = await response.json() as { sessionToken: string };
  return { connection, call, sessionToken };
}
it("rejects missing authentication, other origins, reused pairing codes, and DNS rebinding", async () => {
  const { connection, call, sessionToken } = await fixture();
  expect((await call('/poll', '')).status).toBe(401);
  expect((await call('/poll', sessionToken, undefined, 'https://evil.example')).status).toBe(403);
  expect((await call('/connect', connection.pairingCode!, claim)).status).toBe(401);
  const status = await new Promise<number>(resolve => { const req = request(`${connection.address}/poll`, { headers: { Host: 'evil.example', Origin: origin, Authorization: `Bearer ${sessionToken}` } }, res => { res.resume(); resolve(res.statusCode!); }); req.end(); });
  expect(status).toBe(403);
  expect(bridge!.connection()).not.toHaveProperty('pairingCode');
  expect(JSON.stringify(bridge!.connection())).not.toContain(sessionToken);
});
it("delivers one request, reports validation errors immediately, and revokes pending requests on disconnect", async () => {
  const { call, sessionToken } = await fixture();
  const result = bridge!.request('get_context', { documentId: 'translated', rowId: 'a'.repeat(64) });
  const poll = await call('/poll', sessionToken), message = await poll.json() as { id: string; method: string };
  expect(message.method).toBe('get_context');
  const reply = { ok: false, error: { code: 'Review.StructureChanged', message: 'Missing reference', fieldId: 'intro' } };
  expect((await call('/reply', sessionToken, { id: message.id, result: reply })).status).toBe(200);
  expect(await result).toEqual(reply);
  expect((await call('/reply', sessionToken, { id: message.id, result: reply })).status).toBe(409);
  const pending = bridge!.request('status', {}); const rejection = expect(pending).rejects.toThrow('may have committed');
  bridge!.disconnect(); await rejection;
  expect((await call('/poll', sessionToken)).status).toBe(401);
  expect(bridge!.connection().pairingCode).not.toBeUndefined();
});
it("fails closed on unsafe method/args and on mismatched origin formats", () => {
  expect(() => allowedOrigin('https://example.cz/path')).toThrow();
  expect(() => allowedOrigin('https://user:password@example.cz')).toThrow();
  expect(() => parseLiveRequest({ id: '1', method: 'eval', args: { code: 'delete' } })).toThrow();
  expect(() => parseLiveRequest({ id: '1', method: 'save_correction', args: { documentId: 'x', path: ['system', 'health'] } })).toThrow();
  expect(() => parseLiveRequest({ id: '1', method: 'search_passages', args: { query: 'Hero', limit: 100000 } })).toThrow();
  expect(() => parseLiveRequest({ id: '1', method: 'status', args: { labels: Array.from({ length: 31 }, () => ({ marker: '⟦1⟧', label: 'x'.repeat(2000) })) } })).toThrow();
});
it("accepts explicit source repairs only on correction requests with boolean flags", () => {
  const args = { documentId: 'copy', rowId: 'a'.repeat(64), revision: 'b'.repeat(64), reason: 'Restore from source', text: ['Oprava'], operationId: 'repair-1' };
  for (const key of ['restoreSourceNumbers', 'restoreSourceReferences']) {
    expect(parseLiveRequest({ id: '1', method: 'save_correction', args: {...args, [key]: true} }).args).toHaveProperty(key, true);
    expect(parseLiveRequest({ id: '1', method: 'validate_correction', args: {...args, [key]: false} }).args).toHaveProperty(key, false);
    expect(() => parseLiveRequest({ id: '1', method: 'save_correction', args: {...args, [key]: 'true'} })).toThrow();
    expect(() => parseLiveRequest({ id: '1', method: 'get_context', args: { documentId: 'copy', rowId: args.rowId, [key]: true} })).toThrow();
  }
});
it("exposes live tools through the actual STDIO SDK and forwards browser results without an export", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.cjs', import.meta.url)), '--live', '--origin', origin, '--port', '0'], stderr: 'pipe' });
  const client = new Client({ name: 'live-integration-test', version: '1' });
  try {
    await client.connect(transport);
    const tools = await client.listTools(); expect(tools.tools.map(t => t.name)).toContain('live_save_correction'); expect(tools.tools.map(t => t.name)).toContain('live_get_reference_context'); expect(tools.tools.map(t => t.name)).not.toContain('export_corrections');
    const result = await client.callTool({ name: 'live_connection', arguments: {} });
    const connection = JSON.parse((result.content as { text: string }[])[0]!.text);
    const connect = await fetch(`${connection.address}/connect`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${connection.pairingCode}`, 'Content-Type': 'application/json' }, body: JSON.stringify(claim) });
    const { sessionToken } = await connect.json() as { sessionToken: string };
    const pending = client.callTool({ name: 'live_status', arguments: {} });
    const request = await (await fetch(`${connection.address}/poll`, { headers: { Origin: origin, Authorization: `Bearer ${sessionToken}` } })).json() as { id: string };
    await fetch(`${connection.address}/reply`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: request.id, result: { ok: true, value: { language: 'cs', documents: 1 } } }) });
    const response = await pending; expect(JSON.parse((response.content as { text: string }[])[0]!.text)).toEqual({ ok: true, value: { language: 'cs', documents: 1 } });
    const contextPending = client.callTool({ name: 'live_get_reference_context', arguments: { documentId: 'translated', rowId: 'a'.repeat(64), referenceIndex: 0, offset: 1, limit: 2 } });
    const contextRequest = await (await fetch(`${connection.address}/poll`, { headers: { Origin: origin, Authorization: `Bearer ${sessionToken}` } })).json() as any;
    expect(contextRequest).toMatchObject({ method: 'get_reference_context', args: { documentId: 'translated', rowId: 'a'.repeat(64), referenceIndex: 0, offset: 1, limit: 2 } });
    await fetch(`${connection.address}/reply`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: contextRequest.id, result: { ok: true, value: { fields: [{ text: 'Original context' }], nextOffset: null } } }) });
    expect(JSON.parse(((await contextPending).content as { text: string }[])[0]!.text)).toMatchObject({ ok: true, value: { nextOffset: null } });
  } finally { await client.close(); }
});

it('uses a persistent API key bound to the configured world, GM and language, supports reload and keeps secrets out of tools', async () => {
  const apiKey = 'b'.repeat(64);
  bridge = await new LiveBridge(origin, 0, { apiKey, worldId: claim.worldId, userId: claim.userId, language: claim.language }).start();
  const connection = bridge.connection(); expect(connection).not.toHaveProperty('pairingCode'); expect(JSON.stringify(connection)).not.toContain(apiKey);
  const connect = (body = claim, key = apiKey) => fetch(`${connection.address}/connect`, {method:'POST',headers:{Origin:origin,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  expect((await connect(claim,'é'.repeat(64))).status).toBe(401);
  for (const field of ['worldId','userId','language'] as const) expect((await connect({...claim,[field]:field==='language'?'de':'other'})).status).toBe(403);
  const response = await connect(); expect(response.status).toBe(200); const token = (await response.json()).sessionToken;
  const reload = await connect(); expect(reload.status).toBe(200); expect((await reload.json()).sessionToken).toBe(token);
  expect((await connect({...claim,clientId:'second-tab'})).status).toBe(409);
  bridge.disconnect(); expect((await connect()).status).toBe(200);
  bridge.revoke(); expect((await connect()).status).toBe(403);
});
it('client automatically starts a persistent-key STDIO bridge; restarting the client needs no new pairing', async () => {
  const key = 'c'.repeat(64);
  const create = () => new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../dist/index.cjs',import.meta.url)),'--live','--origin',origin,'--port','0','--world',claim.worldId,'--user',claim.userId,'--language',claim.language],env:{FOUNDRY_MCP_API_KEY:key},stderr:'pipe'});
  for (let i=0;i<2;i++) {
    const client = new Client({name:'persistent-test',version:'1'});
    try {
      await client.connect(create()); const result = await client.callTool({name:'live_connection',arguments:{}});
      const connection = JSON.parse((result.content as {text:string}[])[0]!.text); expect(connection).not.toHaveProperty('pairingCode'); expect(JSON.stringify(connection)).not.toContain(key);
      const response = await fetch(`${connection.address}/connect`,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(claim)});
      expect(response.status).toBe(200);
      const revoked = await client.callTool({name:'live_disconnect',arguments:{}}); expect(revoked.isError).not.toBe(true);
      expect((await fetch(`${connection.address}/connect`,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(claim)})).status).toBe(403);
    } finally { await client.close(); }
  }
});

it('boots the actual MCP server from a verified downloaded asset through the standard client configuration', async () => {
  const {mkdtemp,readFile,writeFile,rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path'); const {createHash} = await import('node:crypto');
  const {mcpLauncher} = await import('../../../src/polish/mcp-launcher');
  const root=await mkdtemp(join(tmpdir(),'ft-actual-bootstrap-'));
  const payload=fileURLToPath(new URL('../dist/index.cjs',import.meta.url)); const bytes=await readFile(payload); const sha256=createHash('sha256').update(bytes).digest('hex');
  const preload=join(root,'download-fixture.cjs');
  await writeFile(preload,`globalThis.fetch=async()=>new Response(require('node:fs').readFileSync(process.env.FOUNDRY_TEST_PAYLOAD));`);
  const launcher=mcpLauncher({url:'https://github.com/f-tuma/foundry-translator/releases/download/v0.32.0/foundry-polish.cjs',sha256});
  const key='d'.repeat(64),client=new Client({name:'bootstrap-integration',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:['--require',preload,'-e',launcher,'--','--live','--origin',origin,'--port','0','--world',claim.worldId,'--user',claim.userId,'--language',claim.language],env:{FOUNDRY_MCP_API_KEY:key,FOUNDRY_MCP_CACHE_DIR:join(root,'cache'),FOUNDRY_TEST_PAYLOAD:payload},stderr:'pipe'});
  try {
    await client.connect(transport);const result=await client.callTool({name:'live_connection',arguments:{}});const connection=JSON.parse((result.content as {text:string}[])[0]!.text);
    expect(connection).not.toHaveProperty('pairingCode');expect((await client.listTools()).tools.map(t=>t.name)).toContain('live_save_correction');
    expect(await readFile(join(root,'cache',sha256+'.cjs'))).toEqual(bytes);
    const connect=await fetch(`${connection.address}/connect`,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(claim)});expect(connect.status).toBe(200);
    const {sessionToken}=await connect.json();const pending=client.callTool({name:'live_status',arguments:{}});
    const request=await (await fetch(`${connection.address}/poll`,{headers:{Origin:origin,Authorization:`Bearer ${sessionToken}`}})).json();
    await fetch(`${connection.address}/reply`,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${sessionToken}`,'Content-Type':'application/json'},body:JSON.stringify({id:request.id,result:{ok:true,value:{worldId:claim.worldId,language:'cs'}}})});
    expect(JSON.parse(((await pending).content as {text:string}[])[0]!.text)).toEqual({ok:true,value:{worldId:claim.worldId,language:'cs'}});
  } finally {await client.close();await rm(root,{recursive:true,force:true});}
// The SDK allows graceful shutdown of both launcher and server processes.
}, 15000);
