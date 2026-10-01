import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const bytes = await readFile('apps/polish-mcp/dist/index.cjs');
await writeFile('src/polish/mcp-runtime.json', JSON.stringify({
  url: `https://github.com/f-tuma/foundry-translator/releases/download/v${version}/foundry-polish.cjs`,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}, null, 2) + '\n');
