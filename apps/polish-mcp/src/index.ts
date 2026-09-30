import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { parseArgs } from "node:util";
import { PolishWorkspace } from "./workspace";
import { createServer } from "./server";

async function main() {
  const { values } = parseArgs({ options: { workspace: { type: "string" }, help: { type: "boolean" } } });
  if (values.help) {
    console.error("Foundry translation polish MCP\nnode dist/index.cjs --workspace /absolute/path\nPlace Foundry JSON exports in workspace/input. Suggestions and reports stay in that workspace. No HTTP server or model API required.");
    return;
  }
  if (!values.workspace) throw new Error("Provide --workspace with a dedicated export and corrections directory.");
  const server = createServer(await PolishWorkspace.create(values.workspace));
  await server.connect(new StdioServerTransport());
}
main().catch(error => { console.error(error instanceof Error ? error.message : "MCP startup failed"); process.exitCode = 1; });
