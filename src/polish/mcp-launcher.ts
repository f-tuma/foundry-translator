export interface McpRuntime { url: string; sha256: string }
/** Only the release-pinned executable is downloaded; no shell or npm lifecycle scripts. */
export function mcpLauncher(runtime: McpRuntime): string {
  if (!/^https:\/\/github\.com\/f-tuma\/foundry-translator\/releases\/download\/v\d+\.\d+\.\d+\/foundry-polish\.cjs$/u.test(runtime.url) || !/^[a-f0-9]{64}$/u.test(runtime.sha256)) throw new Error("Mcp.InvalidRuntime");
  return `
const fs = require('node:fs/promises'), constants = require('node:fs').constants;
const path = require('node:path'), crypto = require('node:crypto'), os = require('node:os');
const {spawn} = require('node:child_process');
const url = ${JSON.stringify(runtime.url)}, digest = ${JSON.stringify(runtime.sha256)};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
(async () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node.js 22.12+ required');
  const dir = process.env.FOUNDRY_MCP_CACHE_DIR || path.join(os.homedir(), '.cache', 'foundry-translation-mcp');
  await fs.mkdir(dir, {recursive:true, mode:0o700});
  const stat = await fs.lstat(dir);
  const privateFile = stat => process.platform === 'win32' || ((stat.mode & 0o077) === 0 && stat.uid === process.getuid());
  if (!stat.isDirectory() || stat.isSymbolicLink() || !privateFile(stat)) throw new Error('MCP cache must be a private directory');
  const file = path.join(dir, digest + '.cjs');
  let ready = false;
  try {
    const cached = await fs.lstat(file);
    if (!cached.isFile() || cached.isSymbolicLink()) throw new Error('Unsafe MCP cache file');
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try { const stat = await handle.stat(); if (!stat.isFile() || !privateFile(stat) || stat.size > 8000000) throw new Error('Unsafe MCP cache file');
      ready = hash(await handle.readFile()) === digest;
    } finally { await handle.close(); }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!ready) {
    const response = await fetch(url, {signal:AbortSignal.timeout(45000)});
    if (!response.ok) throw new Error('MCP download failed: HTTP ' + response.status);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 8000000) throw new Error('MCP download too large'); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    if (hash(bytes) !== digest) throw new Error('MCP executable checksum mismatch');
    const temporary = file + '.' + crypto.randomUUID() + '.tmp';
    try { await fs.writeFile(temporary, bytes, {flag:'wx', mode:0o600}); await fs.rename(temporary, file); }
    finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  const child = spawn(process.execPath, [file, ...process.argv.slice(1)], {stdio:'inherit'});
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('error', () => { console.error('Could not start Foundry MCP'); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code === null ? (signal === 'SIGINT' ? 130 : 143) : code; });
})().catch(error => { console.error(error.message || 'MCP startup failed'); process.exitCode = 1; });
`.trim();
}
