import { liveBridgeAddress } from "./live-protocol";
import { mcpLauncher } from "./mcp-launcher";
import runtime from "./mcp-runtime.json";
export const POLISH_MCP_SETTING = "polishMcpPaths";
export interface McpPreferences { address: string; apiKey: string; enabled: boolean; worldId: string; userId: string; language: string }
export const DEFAULT_MCP_PREFERENCES: McpPreferences = { address: "http://127.0.0.1:3112", apiKey: "", enabled: false, worldId: "", userId: "", language: "cs" };
/** Migrate only public address preferences; old pairing codes were never saved. */
export function readMcpPreferences(value: unknown): McpPreferences {
  const stored = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: "address" | "apiKey" | "worldId" | "userId" | "language") => typeof stored[key] === "string" ? stored[key] as string : DEFAULT_MCP_PREFERENCES[key];
  return { address: text("address"), apiKey: text("apiKey"), enabled: stored.enabled === true, worldId: text("worldId"), userId: text("userId"), language: text("language") };
}
export function mcpConnection(preferences: McpPreferences, origin: string) {
  const address = liveBridgeAddress(preferences.address), apiKey = preferences.apiKey.trim();
  const foundry = new URL(origin);
  if (!/^[a-zA-Z0-9_-]{32,512}$/u.test(apiKey)) throw new Error("Live.InvalidCode");
  if (!["https:", "http:"].includes(foundry.protocol) || foundry.username || foundry.password || foundry.pathname !== "/" || foundry.search || foundry.hash) throw new Error("Live.InvalidAddress");
  if ([preferences.worldId, preferences.userId, preferences.language].some(value => !value.trim() || value.length > 500) || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(preferences.language)) throw new Error("Live.ScopeChanged");
  const port = Number(new URL(address).port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Live.InvalidAddress");
  const entry = { command: "node", args: ["-e", mcpLauncher(runtime), "--", "--live", "--origin", foundry.origin, "--port", String(port), "--world", preferences.worldId, "--user", preferences.userId, "--language", preferences.language], env: { FOUNDRY_MCP_API_KEY: apiKey } };
  return { address, json: JSON.stringify({ mcpServers: { "foundry-polish": entry } }, null, 2) };
}
export function generateMcpKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
