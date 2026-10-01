import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
const metadata = JSON.parse(await readFile('dist/metafile.json', 'utf8'));
const packages = new Set();
for (const input of Object.keys(metadata.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let directory = dirname(resolve(input));
  while (directory !== dirname(directory)) {
    try { const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')); if (pkg.name) { packages.add(directory); break; } directory = dirname(directory); }
    catch (error) { if (error.code !== 'ENOENT') throw error; directory = dirname(directory); }
  }
}
const notices = [];
for (const directory of [...packages].sort()) {
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const files = (await readdir(directory)).filter(name => /^(license|copying|notice)([.\-_]|$)/iu.test(name)).sort();
  if (!files.length) throw new Error(`Missing license notice for bundled dependency ${pkg.name}`);
  const text = await Promise.all(files.map(name => readFile(join(directory, name), 'utf8')));
  notices.push(`${pkg.name} ${pkg.version} (${pkg.license ?? 'see notice'})\n${text.join('\n')}`);
}
const notice = `Third-party license notices\n\n${notices.join('\n\n--------------------\n\n')}`;
if (notice.includes('*/')) throw new Error('License notice cannot be embedded in a comment');
const bundle = await readFile('dist/index.cjs', 'utf8');
await writeFile('dist/index.cjs', `${bundle}\n/*\n${notice}\n*/\n`);
await writeFile('dist/LICENSES.txt', notice + '\n');
