import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { parseArgs } from "node:util";
import { PolishWorkspace } from "./workspace";
import { createServer } from "./server";
import { LiveBridge, allowedOrigin } from "./live-bridge";
import { createLiveServer } from "./live-server";
import { LIVE_PORT } from "../../../src/polish/live-protocol";

async function main() {
  const { values } = parseArgs({ options: { workspace: { type: "string" }, help: { type: "boolean" }, live: { type: "boolean" }, origin: { type: "string" }, port: { type: "string" }, world: { type: "string" }, user: { type: "string" }, language: { type: "string" } } });
  if (values.help) {
    console.error("Foundry translation polish MCP\nLive: node foundry-polish.cjs --live --origin https://foundry.example.cz --world WORLD --user GM --language cs [--port 3112]\nSet FOUNDRY_MCP_API_KEY privately in the MCP client environment. The client starts the bridge automatically, binding only 127.0.0.1. Keep the GM world open. No Docker or model API required.");
    return;
  }
  if (values.live) {
    if (!values.origin || values.workspace) throw new Error("Live mode requires --origin and cannot use --workspace.");
    const apiKey = process.env.FOUNDRY_MCP_API_KEY;
    if (apiKey !== undefined && (!/^[a-zA-Z0-9_-]{32,512}$/u.test(apiKey) || !values.world || !values.user || !values.language)) throw new Error("Configure a valid FOUNDRY_MCP_API_KEY, --world, --user and --language.");
    const bridge = await new LiveBridge(allowedOrigin(values.origin), values.port === undefined ? LIVE_PORT : Number(values.port), apiKey === undefined ? {} : { apiKey, worldId: values.world!, userId: values.user!, language: values.language! }).start();
    const server = createLiveServer(bridge);
    for (const event of ["SIGINT", "SIGTERM"] as const) process.once(event, () => { void bridge.close().finally(() => process.exit(0)); });
    process.stdin.once("end", () => { void bridge.close(); });
    process.stdin.once("close", () => { void bridge.close(); });
    await server.connect(new StdioServerTransport()); return;
  }
  if (values.origin || values.port || values.world || values.user || values.language || process.env.FOUNDRY_MCP_API_KEY !== undefined) throw new Error("--origin and --port require --live.");
  if (!values.workspace) throw new Error("Provide --workspace with a dedicated export and corrections directory.");
  const server = createServer(await PolishWorkspace.create(values.workspace));
  await server.connect(new StdioServerTransport());
}
main().catch(error => { console.error(error instanceof Error ? error.message : "MCP startup failed"); process.exitCode = 1; });
