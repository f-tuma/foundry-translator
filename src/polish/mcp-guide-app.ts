import { MODULE_ID } from "../constants";
import { openReviewProject } from "../review/header-control";
import { POLISH_MCP_SETTING, readMcpPaths } from "./mcp-guide";
import { renderMcpGuide } from "./mcp-guide-view";

export class McpGuideApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "foundry-translate-mcp", classes: ["foundry-translate", "ft-mcp-window"],
    position: { width: 680, height: 820 }, window: { title: "FOUNDRY_TRANSLATE.Mcp.Title", icon: "fa-solid fa-plug", resizable: true } };
  protected async _renderHTML(): Promise<HTMLFormElement> {
    return renderMcpGuide(readMcpPaths(game.settings.get(MODULE_ID, POLISH_MCP_SETTING)), {
      save: async paths => { await game.settings.set(MODULE_ID, POLISH_MCP_SETTING, paths); }, project: openReviewProject,
    });
  }
  protected _replaceHTML(result: HTMLFormElement, content: HTMLElement): void { content.replaceChildren(result); }
}
