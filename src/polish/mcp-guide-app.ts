import { MODULE_ID } from "../constants";
import { openReviewProject } from "../review/header-control";
import { POLISH_MCP_SETTING, readMcpPaths } from "./mcp-guide";
import { disposeMcpGuide, renderMcpGuide } from "./mcp-guide-view";
import { liveClient } from "./live-client";

export class McpGuideApplication extends foundry.applications.api.ApplicationV2 {
  private form: HTMLFormElement | null = null;
  static DEFAULT_OPTIONS = { id: "foundry-translate-mcp", classes: ["foundry-translate", "ft-mcp-window"],
    position: { width: 680, height: 820 }, window: { title: "FOUNDRY_TRANSLATE.Mcp.Title", icon: "fa-solid fa-plug", resizable: true } };
  protected async _renderHTML(): Promise<HTMLFormElement> {
    return renderMcpGuide(readMcpPaths(game.settings.get(MODULE_ID, POLISH_MCP_SETTING)), {
      save: async paths => { await game.settings.set(MODULE_ID, POLISH_MCP_SETTING, paths); }, project: openReviewProject, live: liveClient,
    });
  }
  protected _replaceHTML(result: HTMLFormElement, content: HTMLElement): void {
    if (this.form) disposeMcpGuide(this.form);
    this.form = result; content.replaceChildren(result);
  }
  async close(options?: Record<string, unknown>): Promise<FoundryApplicationV2> {
    if (this.form) disposeMcpGuide(this.form); this.form = null;
    return super.close(options);
  }
}
