import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MCP_PATHS, mcpConnection, readMcpPaths } from "../src/polish/mcp-guide";
import { renderMcpGuide } from "../src/polish/mcp-guide-view";

afterEach(() => vi.unstubAllGlobals());
describe("MCP connection configuration", () => {
  it("generates explicit live mode with a single permitted origin and fixed loopback port", () => {
    const result = mcpConnection({ ...DEFAULT_MCP_PATHS, repositoryPath: '/repo', mode: 'live', origin: 'https://ember.example.cz', port: 3112 });
    expect(JSON.parse(result.json).mcpServers['foundry-polish'].args).toEqual(['/repo/apps/polish-mcp/dist/index.cjs', '--live', '--origin', 'https://ember.example.cz', '--port', '3112']);
    expect(() => mcpConnection({ ...DEFAULT_MCP_PATHS, repositoryPath: '/repo', mode: 'live', origin: 'https://user:secret@example.cz', port: 3112 })).toThrow();
    expect(() => mcpConnection({ ...DEFAULT_MCP_PATHS, repositoryPath: '/repo', mode: 'live', origin: 'https://example.cz', port: 80 })).toThrow();
  });
  it("generates argument arrays, preserving spaces, quotes and backslashes without shell evaluation", () => {
    const result = mcpConnection({ nodeCommand: 'C:\\Program Files\\node.exe', repositoryPath: 'C:\\My "repo"\\', workspacePath: 'C:\\Private work\\' });
    const entry = JSON.parse(result.json).mcpServers["foundry-polish"];
    expect(entry).toEqual({ command: 'C:\\Program Files\\node.exe', args: ['C:\\My "repo"/apps/polish-mcp/dist/index.cjs', '--workspace', 'C:\\Private work\\'] });
    const lines = result.toml.trim().split('\n');
    expect(JSON.parse(lines[1]!.slice('command = '.length))).toBe(entry.command);
    expect(JSON.parse(lines[2]!.slice('args = '.length))).toEqual(entry.args);
  });
  it("uses a private workspace relative to the explicit repository and never embeds machine-specific defaults", () => {
    expect(readMcpPaths(null)).toEqual(DEFAULT_MCP_PATHS);
    expect(readMcpPaths({ repositoryPath: '/repo', nodeCommand: 42 })).toEqual({ ...DEFAULT_MCP_PATHS, repositoryPath: '/repo' });
    expect(mcpConnection({ ...DEFAULT_MCP_PATHS, repositoryPath: '/repo/' }).inputPath).toBe('/repo/.polish-workspace/input');
    expect(mcpConnection({ ...DEFAULT_MCP_PATHS, repositoryPath: '\\\\host\\share\\repo' }).script).toContain('repo/apps/');
  });
  it.each([
    { repositoryPath: '' }, { repositoryPath: '~/repo' }, { repositoryPath: '../repo' },
    { repositoryPath: '/repo', workspacePath: './workspace' }, { repositoryPath: '/repo\nother' },
    { repositoryPath: '/repo', nodeCommand: '' }, { repositoryPath: '/repo', workspacePath: '/x\u0000y' },
  ])("rejects incomplete, relative or control-character paths: %j", paths => {
    expect(() => mcpConnection({ ...DEFAULT_MCP_PATHS, ...paths })).toThrow('Mcp.InvalidPaths');
  });
});
async function fixture(clipboard = true) {
  const { document, Event } = parseHTML('<html><body></body></html>');
  vi.stubGlobal('document', document);
  vi.stubGlobal('game', { i18n: { localize: (key: string) => key }, tooltip: { activate: vi.fn(), deactivate: vi.fn(), clearPending: vi.fn() } });
  const write = vi.fn().mockResolvedValue(undefined); vi.stubGlobal('navigator', clipboard ? { clipboard: { writeText: write } } : {});
  const save = vi.fn().mockResolvedValue(undefined), project = vi.fn();
  const form = renderMcpGuide(DEFAULT_MCP_PATHS, { save, project }); document.body.append(form);
  const repository = form.querySelector<HTMLInputElement>('[name="repositoryPath"]')!;
  const config = form.querySelector<HTMLTextAreaElement>('[data-mcp-config]')!;
  const button = form.querySelector<HTMLButtonElement>('[data-mcp-copy-config]')!;
  return { form, repository, config, button, write, save, project, Event };
}
it("creates copyable configuration as paths change and opens export/import only on request", async () => {
  const { form, repository, config, button, write, project, Event } = await fixture();
  expect(button.disabled).toBe(true); expect(project).not.toHaveBeenCalled();
  repository.value = '/repo'; repository.dispatchEvent(new Event('input', { bubbles: true }));
  expect(button.disabled).toBe(false); expect(config.value).toContain('[mcp_servers.foundry-polish]');
  const format = form.querySelector<HTMLSelectElement>('#ft-mcp-format')!; format.querySelector<HTMLOptionElement>('option[value="json"]')!.selected = true; format.dispatchEvent(new Event('change'));
  expect(JSON.parse(config.value).mcpServers['foundry-polish'].args[2]).toBe('/repo/.polish-workspace');
  button.click(); await vi.waitFor(() => expect(write).toHaveBeenCalledWith(config.value));
  form.querySelector<HTMLButtonElement>('[data-mcp-project]')!.click(); expect(project).toHaveBeenCalledOnce();
});
it("saves valid paths as preferences and reports errors without claiming a connection", async () => {
  const { form, repository, save, Event } = await fixture();
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(form.textContent).toContain('Mcp.InvalidPaths')); expect(save).not.toHaveBeenCalled();
  repository.value = '/repo'; form.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(form.textContent).toContain('Mcp.Saved'));
  expect(save).toHaveBeenCalledWith({ repositoryPath: '/repo', workspacePath: '', nodeCommand: 'node' });
  save.mockRejectedValueOnce(new Error('unavailable')); form.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(form.textContent).toContain('Mcp.SaveFailed'));
});
it("offers manual copy when clipboard access is unavailable and renders paths as data", async () => {
  const { form, repository, config, button, Event } = await fixture(false);
  const select = vi.fn(); config.select = select;
  repository.value = '/repo/<img src=x onerror=bad()>'; repository.dispatchEvent(new Event('input', { bubbles: true }));
  expect(form.querySelector('img')).toBeNull(); button.click();
  await vi.waitFor(() => expect(select).toHaveBeenCalledOnce()); expect(form.textContent).toContain('Mcp.CopyManually');
});
