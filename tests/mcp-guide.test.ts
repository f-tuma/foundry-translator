import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_MCP_PREFERENCES, generateMcpKey, mcpConnection, readMcpPreferences } from "../src/polish/mcp-guide";
import { disposeMcpGuide, renderMcpGuide } from "../src/polish/mcp-guide-view";
import type { LiveClient } from "../src/polish/live-client";
const origin = 'https://ember.example.cz';
const saved = { ...DEFAULT_MCP_PREFERENCES, apiKey: 'a'.repeat(64), worldId: 'ember', userId: 'gm', language: 'cs', enabled: true };
afterEach(() => vi.unstubAllGlobals());
it('creates a client-launched, pinned STDIO bridge with private credentials and exact world scope', () => {
  const entry = JSON.parse(mcpConnection(saved, origin).json).mcpServers['foundry-polish'];
  expect(entry.command).toBe('node'); expect(entry.args.slice(2)).toEqual(['--', '--live', '--origin', origin, '--port', '3112', '--world', 'ember', '--user', 'gm', '--language', 'cs']);
  expect(entry.args[1]).toContain('checksum mismatch'); expect(entry.args[1]).toContain('/foundry-polish.cjs');
  expect(entry.args).not.toContain(saved.apiKey); expect(entry.env).toEqual({ FOUNDRY_MCP_API_KEY: saved.apiKey });
  expect(entry).not.toHaveProperty('url'); expect(entry.args).not.toContain('--workspace');
});
it('migrates old path settings without enabling access or retaining a pairing code', () => {
  expect(readMcpPreferences(null)).toEqual(DEFAULT_MCP_PREFERENCES);
  expect(readMcpPreferences({ repositoryPath: '/repo', mode: 'live', code: 'secret', enabled: 'yes' })).toEqual(DEFAULT_MCP_PREFERENCES);
  expect(readMcpPreferences({ apiKey: 42 })).toEqual(DEFAULT_MCP_PREFERENCES);
});
it.each([
  { apiKey: '' }, { apiKey: 'secret\nvalue' }, { address: 'https://evil.example' }, { address: 'http://localhost:3112' },
  { address: 'http://127.0.0.1:80' }, { address: 'http://127.0.0.1:3112/mcp' }, { worldId: '' }, { userId: '' }, { language: '../cs' },
])('rejects invalid access configuration: %j', changed => { expect(() => mcpConnection({ ...saved, ...changed }, origin)).toThrow(); });
it('generates unique 256-bit keys and rejects an origin with credentials or a path', () => {
  const key = generateMcpKey(); expect(key).toMatch(/^[a-f0-9]{64}$/u); expect(generateMcpKey()).not.toBe(key);
  expect(() => mcpConnection(saved, 'https://user:secret@example.cz')).toThrow();
  expect(() => mcpConnection(saved, 'https://example.cz/game')).toThrow();
});
function fixture(initial = DEFAULT_MCP_PREFERENCES, clipboard = true) {
  const { document, Event, window } = parseHTML('<html><body></body></html>');
  vi.stubGlobal('document', document); vi.stubGlobal('window', { ...window, location: { origin } });
  vi.stubGlobal('game', { world: { id: 'ember', title: 'Ember' }, user: { id: 'gm', isGM: true }, settings: { get: () => 'cs' }, i18n: { localize: (key: string) => key }, tooltip: { activate: vi.fn(), deactivate: vi.fn(), clearPending: vi.fn() } });
  const write = vi.fn().mockResolvedValue(undefined); vi.stubGlobal('navigator', clipboard ? { clipboard: { writeText: write } } : {});
  const save = vi.fn().mockResolvedValue(undefined), unsubscribe = vi.fn();
  const live = { state: { status: 'disconnected' }, enable: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn(() => unsubscribe) };
  const form = renderMcpGuide(initial, { save, live: live as unknown as LiveClient }); document.body.append(form);
  return { form, Event, save, live, write, unsubscribe, config: form.querySelector<HTMLTextAreaElement>('[data-mcp-config]')!, copy: form.querySelector<HTMLButtonElement>('[data-mcp-copy-config]')! };
}
it('saves scoped access before copying configuration and has no export/import or path menu', async () => {
  const { form, Event, save, live, copy, config, write } = fixture();
  expect(copy.disabled).toBe(true); expect(form.querySelector('[data-mcp-project]')).toBeNull(); expect(form.querySelector('[name="repositoryPath"]')).toBeNull();
  expect(form.querySelector<HTMLInputElement>('#ft-mcp-key')!.value).toMatch(/^[a-f0-9]{64}$/u);
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(live.enable).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0]).toMatchObject({ worldId: 'ember', userId: 'gm', language: 'cs', enabled: true });
  expect(copy.disabled).toBe(false); copy.click(); await vi.waitFor(() => expect(write).toHaveBeenCalledWith(config.value));
});
it('keeps configuration available when the client has not started, without claiming connection', async () => {
  const { form, Event, live, copy } = fixture(); live.enable.mockRejectedValueOnce(new Error('Live.NetworkError'));
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(form.textContent).toContain('Mcp.Remembered')); expect(copy.disabled).toBe(false);
});
it('never enables on save failure; regenerating a key requires another save', async () => {
  const { form, Event, live, save, copy } = fixture(); save.mockRejectedValueOnce(new Error('storage failure'));
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(form.textContent).toContain('Mcp.SaveFailed')); expect(live.enable).not.toHaveBeenCalled(); expect(copy.disabled).toBe(true);
  form.dispatchEvent(new Event('submit', { cancelable: true })); await vi.waitFor(() => expect(copy.disabled).toBe(false));
  form.querySelector<HTMLButtonElement>('[data-mcp-new-key]')!.click(); expect(copy.disabled).toBe(true);
});
it('stops local access even if saving the disabled preference fails', async () => {
  const { form, save, live } = fixture(saved); save.mockRejectedValueOnce(new Error('storage failure'));
  form.querySelector<HTMLButtonElement>('[data-mcp-disconnect]')!.click();
  await vi.waitFor(() => expect(form.textContent).toContain('Mcp.SaveFailed')); expect(live.disconnect).toHaveBeenCalledOnce();
});
it('offers explicit manual copy and cleans up subscriptions when closed', async () => {
  const { form, config, copy, unsubscribe } = fixture(saved, false); const select = vi.fn(); config.select = select;
  copy.click(); await vi.waitFor(() => expect(select).toHaveBeenCalledOnce()); expect(config.closest('details')!.open).toBe(true);
  disposeMcpGuide(form); expect(unsubscribe).toHaveBeenCalledOnce();
});
it('reports saved access rather than a storage failure when a real client cannot reach the bridge', async () => {
  const { LiveClient } = await import('../src/polish/live-client');
  const {form,Event,live,copy} = fixture(); const actual = new LiveClient();
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  live.enable.mockImplementation(preferences => actual.enable(preferences));
  try {
    form.dispatchEvent(new Event('submit',{cancelable:true}));
    await vi.waitFor(() => expect(actual.state.status).toBe('error'));
    expect(form.textContent).toContain('Mcp.Remembered'); expect(form.textContent).not.toContain('Mcp.SaveFailed'); expect(copy.disabled).toBe(false);
  } finally { await actual.disconnect(); }
});
