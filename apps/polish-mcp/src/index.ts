import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { parseArgs } from "node:util";
import { PolishWorkspace } from "./workspace";
import { createServer } from "./server";
import { LiveBridge, allowedOrigin } from "./live-bridge";
import { createLiveServer } from "./live-server";
import { LIVE_PORT } from "../../../src/polish/live-protocol";

async function main() {
  const { values } = parseArgs({ options: { workspace: { type: "string" }, help: { type: "boolean" }, live: { type: "boolean" }, origin: { type: "string" }, port: { type: "string" } } });
  if (values.help) {
    console.error("Foundry translation polish MCP\nExport mode: node dist/index.cjs --workspace /absolute/path\nLive mode: node dist/index.cjs --live --origin https://foundry.example.cz [--port 3112]\nLive mode binds only 127.0.0.1, requires a one-time pairing code and a connected GM tab. Use live_connection to obtain the address/code. No model API required.");
    return;
  }
  if (values.live) {
    if (!values.origin || values.workspace) throw new Error("Live mode requires --origin and cannot use --workspace.");
    const bridge = await new LiveBridge(allowedOrigin(values.origin), values.port === undefined ? LIVE_PORT : Number(values.port)).start();
    const server = createLiveServer(bridge);
    for (const event of ["SIGINT", "SIGTERM"] as const) process.once(event, () => { void bridge.close().finally(() => process.exit(0)); });
    process.stdin.once("end", () => { void bridge.close(); });
    await server.connect(new StdioServerTransport()); return;
  }
  if (values.origin || values.port) throw new Error("--origin and --port require --live.");
  if (!values.workspace) throw new Error("Provide --workspace with a dedicated export and corrections directory.");
  const server = createServer(await PolishWorkspace.create(values.workspace));
  await server.connect(new StdioServerTransport());
}
main().catch(error => { console.error(error instanceof Error ? error.message : "MCP startup failed"); process.exitCode = 1; });
