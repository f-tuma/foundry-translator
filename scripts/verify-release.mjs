import { readFile } from "node:fs/promises";
import process from "node:process";

const repository = "f-tuma/foundry-translator";
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const moduleJson = JSON.parse(await readFile("public/module.json", "utf8"));
const tag = process.argv[2] ?? `v${packageJson.version}`;
const expectedTag = `v${packageJson.version}`;
const expectedManifest = `https://github.com/${repository}/releases/latest/download/module.json`;
const expectedDownload = `https://github.com/${repository}/releases/download/${expectedTag}/foundry-translate.zip`;
const expectedScript = `foundry-translate-${packageJson.version}.js`;
const constantsSource = await readFile("src/constants.ts", "utf8");
const sourceVersion = constantsSource.match(/MODULE_VERSION = "([^"]+)"/)?.[1];

const failures = [];

if (moduleJson.version !== packageJson.version) {
  failures.push(`module.json version ${moduleJson.version} does not match package.json ${packageJson.version}`);
}

if (sourceVersion !== packageJson.version) {
  failures.push(`source API version ${sourceVersion ?? "missing"} does not match package.json ${packageJson.version}`);
}

if (tag !== expectedTag) {
  failures.push(`release tag ${tag} does not match package version ${expectedTag}`);
}

if (moduleJson.manifest !== expectedManifest) {
  failures.push(`manifest URL must be ${expectedManifest}`);
}

if (moduleJson.download !== expectedDownload) {
  failures.push(`download URL must be ${expectedDownload}`);
}

if (moduleJson.esmodules?.length !== 1 || moduleJson.esmodules[0] !== expectedScript) {
  failures.push(`ES module path must be ${expectedScript}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`Release validation failed: ${failure}`);
  process.exit(1);
}

console.log(`Release metadata verified for ${expectedTag}.`);
