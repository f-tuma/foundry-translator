import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { expect, it } from "vitest";
import { fixture } from "./fixture";

it("negotiates MCP over stdio and completes context → suggestion → guarded export through real tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "foundry-polish-mcp-"));
  const client = new Client({ name: "polish-protocol-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("dist/index.cjs"), "--workspace", root], stderr: "pipe" });
  let stderr = ""; transport.stderr?.on("data", chunk => { stderr += String(chunk); });
  try {
    await mkdir(join(root, "input")); await writeFile(join(root, "input", "test.json"), JSON.stringify(fixture()));
    await client.connect(transport);
    const tools = await client.listTools(); expect(tools.tools).toHaveLength(11);
    expect(tools.tools.find(t => t.name === "get_context")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find(t => t.name === "propose_correction")?.annotations?.readOnlyHint).toBe(false);
    expect((await client.listPrompts()).prompts[0]?.name).toBe("polish_translation");
    async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const content = result.content as { type: string; text: string }[];
      return JSON.parse(content[0]!.text);
    }
    expect((await call("list_exports")).files).toEqual(["test.json"]);
    await call("open_export", { filename: "test.json" });
    const search = await call("search_passages", { query: "vstoupil" });
    const context = await call("get_context", { unitId: search.items[0].id });
    const suggestion = await call("propose_correction", { unitId: context.id, revision: context.revision,
      text: ["Poutníci vstoupili do Starého Carinthu."], reason: "Shoda podmětu s přísudkem.", category: "grammar" });
    const saved = await call("list_suggestions"); expect(saved.total).toBe(1);
    const output = await call("export_corrections", { suggestionIds: [suggestion.id] });
    const project = JSON.parse(await readFile(output.importFile, "utf8"));
    expect(project.version).toBe(2); expect(project.baseTranslations).toHaveLength(1);
    expect(stderr).toBe("");
    const invalid = await client.callTool({ name: "open_export", arguments: { filename: "../no.json" } });
    expect(invalid.isError).toBe(true);
  } catch (error) { throw new Error(`${String(error)}\nServer stderr: ${stderr}`); }
  finally { await client.close(); await transport.close(); await rm(root, { recursive: true, force: true }); }
}, 20000);
