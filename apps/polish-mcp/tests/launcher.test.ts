import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { mcpLauncher } from '../../../src/polish/mcp-launcher';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const url = 'https://github.com/f-tuma/foundry-translator/releases/download/v0.32.0/foundry-polish.cjs';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ft-launcher-test-')); roots.push(root);
  const payload = Buffer.from(`console.log(JSON.stringify({args:process.argv.slice(2),keyConfigured:process.env.FOUNDRY_MCP_API_KEY?.length===64}));`);
  const sha256 = createHash('sha256').update(payload).digest('hex');
  const preload = join(root, 'fetch.cjs'), source = join(root, 'payload.cjs'), marker = join(root, 'download.txt'), cache = join(root, 'cache');
  await writeFile(source, payload);
  await writeFile(preload, `globalThis.fetch = async url => {const fs=require('node:fs');fs.writeFileSync(process.env.FOUNDRY_TEST_MARKER,url);return new Response(fs.readFileSync(process.env.FOUNDRY_TEST_PAYLOAD));};`);
  const script = mcpLauncher({url,sha256});
  const run = (args: string[] = []) => new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', preload, '-e', script, '--', ...args], { env: { ...process.env, FOUNDRY_MCP_CACHE_DIR: cache, FOUNDRY_TEST_PAYLOAD: source, FOUNDRY_TEST_MARKER: marker, FOUNDRY_MCP_API_KEY: 'a'.repeat(64) } });
    let out = '', err = ''; child.stdout.on('data', bytes => { out += bytes; }); child.stderr.on('data', bytes => { err += bytes; }); child.once('error', reject); child.once('exit', code => resolve({ code, out, err })); child.stdin.end();
  });
  return { run, cache, source, marker, sha256, payload, preload };
}
it('downloads and verifies the pinned asset, passes literal arguments without a shell and reuses verified cache', async () => {
  const {run,cache,source,marker,sha256,payload} = await fixture();
  const result = await run(['--world', 'a "quoted" world; $(echo BAD)']); expect(result.code).toBe(0); expect(result.err).toBe('');
  expect(JSON.parse(result.out)).toEqual({args:['--world','a "quoted" world; $(echo BAD)'], keyConfigured:true});
  expect(await readFile(marker,'utf8')).toBe(url); expect(await readFile(join(cache,sha256+'.cjs'))).toEqual(payload);
  await rm(source); await rm(marker); expect((await run()).code).toBe(0); expect(await readdir(cache)).toEqual([sha256+'.cjs']);
});
it('refuses a download with a different checksum and never executes or caches it', async () => {
  const {run,cache,source} = await fixture(); await writeFile(source, `console.log('CORRUPT WAS EXECUTED')`);
  const result = await run(); expect(result.code).toBe(1); expect(result.out).toBe(''); expect(result.err).toContain('checksum mismatch'); expect(await readdir(cache)).toEqual([]);
});
it('repairs a corrupt regular cache file only with a verified download', async () => {
  const {run,cache,sha256,payload} = await fixture(); await mkdir(cache, {mode:0o700}); await writeFile(join(cache,sha256+'.cjs'), 'invalid', {mode:0o600});
  expect((await run()).code).toBe(0); expect(await readFile(join(cache,sha256+'.cjs'))).toEqual(payload);
});
it('refuses a cache symlink instead of following it', async () => {
  const {run,cache,source,sha256} = await fixture(); await mkdir(cache,{mode:0o700}); await symlink(source,join(cache,sha256+'.cjs'));
  const result = await run(); expect(result.code).toBe(1); expect(result.out).toBe(''); expect(result.err).toContain('Unsafe MCP cache file');
});
it('only accepts an immutable project release URL and SHA-256', () => {
  expect(() => mcpLauncher({url:'https://evil.example/a.cjs',sha256:'a'.repeat(64)})).toThrow();
  expect(() => mcpLauncher({url,sha256:'not-a-hash'})).toThrow();
});
