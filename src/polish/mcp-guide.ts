export const POLISH_MCP_SETTING = "polishMcpPaths";
export interface McpPaths { nodeCommand: string; repositoryPath: string; workspacePath: string }
export const DEFAULT_MCP_PATHS: McpPaths = { nodeCommand: "node", repositoryPath: "", workspacePath: "" };

export function readMcpPaths(value: unknown): McpPaths {
  const stored = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: keyof McpPaths) => typeof stored[key] === "string" ? stored[key] as string : DEFAULT_MCP_PATHS[key];
  return { nodeCommand: text("nodeCommand"), repositoryPath: text("repositoryPath"), workspacePath: text("workspacePath") };
}
const absolute = (path: string) => path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path) || /^\\\\[^\\]+\\[^\\]+/u.test(path);

/** This is client configuration data, never a shell command or an executable URL. */
export function mcpConnection(paths: McpPaths) {
  const nodeCommand = paths.nodeCommand.trim(), repositoryPath = paths.repositoryPath.trim();
  const workspacePath = paths.workspacePath.trim() || `${repositoryPath.replace(/[\\/]+$/u, "")}/.polish-workspace`;
  if (!nodeCommand || !absolute(repositoryPath) || !absolute(workspacePath) ||
    [nodeCommand, repositoryPath, workspacePath].some(path => path.length > 2000 || /[\u0000-\u001f\u007f]/u.test(path)))
    throw new Error("Mcp.InvalidPaths");
  const script = `${repositoryPath.replace(/[\\/]+$/u, "")}/apps/polish-mcp/dist/index.cjs`;
  const args = [script, "--workspace", workspacePath];
  return {
    script, workspacePath, inputPath: `${workspacePath.replace(/[\\/]+$/u, "")}/input`,
    toml: `[mcp_servers.foundry-polish]\ncommand = ${JSON.stringify(nodeCommand)}\nargs = ${JSON.stringify(args)}\n`,
    json: JSON.stringify({ mcpServers: { "foundry-polish": { command: nodeCommand, args } } }, null, 2),
  };
}
