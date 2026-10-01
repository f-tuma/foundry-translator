import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/polish/live-service', () => ({ createLiveHandler: () => async () => ({ok:true,value:{}}) }));
import { LiveClient, startRememberedMcp } from '../src/polish/live-client';
import { DEFAULT_MCP_PREFERENCES } from '../src/polish/mcp-guide';
const preferences = { ...DEFAULT_MCP_PREFERENCES, apiKey:'a'.repeat(64), enabled:true, worldId:'world',userId:'gm',language:'cs' };
let client: LiveClient;
const world = { id:'world',title:'Test' }, user = { id:'gm',isGM:true };
let currentLanguage = 'cs';
beforeEach(() => {
  vi.useFakeTimers(); currentLanguage='cs'; world.id='world'; user.id='gm'; user.isGM=true;
  vi.stubGlobal('game',{world,user,system:{id:'crucible'},settings:{get: (_module:string,key:string) => key==='targetLanguage' ? currentLanguage : preferences }});
  const stored = new Map<string,string>(); vi.stubGlobal('sessionStorage',{getItem:(key:string) => stored.get(key) ?? null,setItem:(key:string,value:string) => stored.set(key,value)});
  client = new LiveClient();
});
afterEach(async () => { await client.disconnect(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const response = (status=200) => new Response(JSON.stringify({protocol:1,sessionToken:'b'.repeat(64)}),{status,headers:{'Content-Type':'application/json'}});
function network() {
  return vi.fn(async (url:string,options:RequestInit) => {
    if (url.endsWith('/poll')) return new Promise<Response>((_resolve,reject) => { options.signal?.addEventListener('abort',() => reject(new Error('aborted')),{once:true}); });
    return response();
  });
}
it('retries a missing client, then connects without a new key and stops retrying when disabled', async () => {
  const fetch = network().mockRejectedValueOnce(new Error('offline')); vi.stubGlobal('fetch',fetch);
  await expect(client.enable(preferences)).rejects.toThrow('Live.NetworkError'); expect(client.state.status).toBe('error');
  await vi.advanceTimersByTimeAsync(5000); expect(client.state.status).toBe('connected');
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/connect'))).toHaveLength(2);
  await client.disconnect(); const count=fetch.mock.calls.length; await vi.advanceTimersByTimeAsync(20000); expect(fetch).toHaveBeenCalledTimes(count); expect(client.state.status).toBe('disconnected');
});
it('does not retry an invalid key or a revoked scope', async () => {
  const fetch = network().mockResolvedValueOnce(response(401)); vi.stubGlobal('fetch',fetch);
  await expect(client.enable(preferences)).rejects.toThrow('Live.PairingFailed'); await vi.advanceTimersByTimeAsync(20000); expect(fetch).toHaveBeenCalledTimes(1);
  await expect(client.enable({...preferences,worldId:'other'})).rejects.toThrow('Live.ScopeChanged'); expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not reconnect into a different language or GM/world after a failure', async () => {
  const fetch = network().mockRejectedValueOnce(new Error('offline')); vi.stubGlobal('fetch',fetch);
  await expect(client.enable(preferences)).rejects.toThrow(); currentLanguage='de'; await vi.advanceTimersByTimeAsync(10000); expect(fetch).toHaveBeenCalledTimes(1);
  expect(() => startRememberedMcp()).not.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
});
it('an explicit disconnect during connection prevents a late response from enabling writes', async () => {
  let finish: (response:Response) => void = () => {}; vi.stubGlobal('fetch',vi.fn(() => new Promise<Response>(resolve => { finish=resolve; })));
  const enabling=client.enable(preferences); await vi.advanceTimersByTimeAsync(0); expect(client.state.status).toBe('connecting');
  await client.disconnect(); finish(response()); await enabling; expect(client.state.status).toBe('disconnected');
  await vi.advanceTimersByTimeAsync(10000); expect(client.state.status).toBe('disconnected');
});
it('uses the same per-tab identity after reload and sends the API key only in the authorization header', async () => {
  const fetch=network();vi.stubGlobal('fetch',fetch); await client.enable(preferences); const first=fetch.mock.calls[0]!;
  expect(first[0]).toBe('http://127.0.0.1:3112/connect'); expect(first[0]).not.toContain(preferences.apiKey); expect(first[1].body).not.toContain(preferences.apiKey);
  expect(first[1].headers).toMatchObject({Authorization:`Bearer ${preferences.apiKey}`}); await client.disconnect();
  client=new LiveClient(); await client.enable(preferences); const connections=fetch.mock.calls.filter(([url]) => url.endsWith('/connect'));
  expect(JSON.parse(connections[0]![1].body as string).clientId).toBe(JSON.parse(connections[1]![1].body as string).clientId);
});

it('does not require secure-context randomUUID during module startup or a loopback connection', async () => {
  const fill=crypto.getRandomValues.bind(crypto); vi.stubGlobal('crypto',{getRandomValues:fill});
  client=new LiveClient(); const fetch=network();vi.stubGlobal('fetch',fetch); await client.enable(preferences);
  expect(client.state.status).toBe('connected'); expect(JSON.parse(fetch.mock.calls[0]![1].body as string).clientId).toMatch(/^[a-f0-9]{64}$/u);
});
