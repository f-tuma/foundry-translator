import { activateHelpTooltips, renderHelpTooltip } from "../ui/help-tooltip";
import { mcpConnection, type McpPaths } from "./mcp-guide";

const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.Mcp.${key}`);
const help = (key: string, topic: string) => renderHelpTooltip(t(key), t(topic));
export function renderMcpGuide(paths: McpPaths, actions: { save: (paths: McpPaths) => Promise<void>; project: () => void }): HTMLFormElement {
  const form = document.createElement("form"); form.className = "ft-settings ft-mcp";
  form.autocomplete = "off";
  form.innerHTML = `<header class="ft-settings__intro"><span class="ft-settings__brand-icon" aria-hidden="true"><i class="fa-solid fa-plug"></i></span><div><h2>${t("Heading")}</h2><p>${t("Intro")}</p></div></header>
    <div class="ft-mcp__transport"><strong>foundry-polish · STDIO</strong><span>${t("LocalProcess")}</span>${help("TransportHelp", "Connection")}</div>
    <section class="ft-mcp__section"><h3>${t("Workflow")}</h3><ol class="ft-mcp__steps">
      <li><strong>${t("ExportStep")}</strong><span>${t("ExportText")}</span><button type="button" class="ft-button ft-button--secondary" data-mcp-project>${t("OpenProject")}</button></li>
      <li><strong>${t("InstallStep")}</strong><span>${t("InstallText")}</span><details><summary>${t("InstallCommands")}</summary><pre>npm ci\nnpm --prefix apps/polish-mcp ci\nnpm --prefix apps/polish-mcp run build</pre></details></li>
      <li><strong>${t("ConnectStep")}</strong><span>${t("ConnectText")}</span></li>
      <li><strong>${t("ReviewStep")}</strong><span>${t("ReviewText")}</span></li>
      <li><strong>${t("ImportStep")}</strong><span>${t("ImportText")}</span></li>
    </ol></section>
    <section class="ft-mcp__section"><div class="ft-heading-with-help"><h3>${t("Connection")}</h3>${help("PathsHelp", "Connection")}</div>
      <div class="ft-settings__fields">
        <div class="ft-field"><label for="ft-mcp-repository">${t("RepositoryPath")}</label><input id="ft-mcp-repository" name="repositoryPath" required maxlength="2000" spellcheck="false" placeholder="/home/user/foundry-translator"></div>
        <div class="ft-field"><div class="ft-field__label"><label for="ft-mcp-workspace">${t("WorkspacePath")}</label>${help("WorkspaceHelp", "WorkspacePath")}</div><input id="ft-mcp-workspace" name="workspacePath" maxlength="2000" spellcheck="false"></div>
        <div class="ft-field"><label for="ft-mcp-node">${t("NodeCommand")}</label><input id="ft-mcp-node" name="nodeCommand" required maxlength="2000" spellcheck="false" placeholder="node"></div>
      </div>
      <p class="ft-mcp__path"><strong>${t("ServerPath")}</strong><code data-mcp-server></code></p>
      <p class="ft-mcp__path"><strong>${t("InputPath")}</strong><code data-mcp-input></code></p>
      <div class="ft-field"><label for="ft-mcp-format">${t("Client")}</label><select id="ft-mcp-format"><option value="toml">Codex · config.toml</option><option value="json">${t("JsonClient")}</option></select></div>
      <div class="ft-field"><label for="ft-mcp-config">${t("Configuration")}</label><textarea id="ft-mcp-config" data-mcp-config readonly rows="6" spellcheck="false"></textarea></div>
      <div class="ft-mcp__actions"><button type="button" class="ft-button ft-button--secondary" data-mcp-copy-config>${t("CopyConfiguration")}</button><button type="submit" class="ft-button ft-button--secondary">${t("SavePaths")}</button></div>
    </section>
    <section class="ft-mcp__section"><div class="ft-heading-with-help"><h3>${t("AgentTask")}</h3>${help("AgentHelp", "AgentTask")}</div><textarea data-mcp-prompt readonly rows="5" aria-label="${t("AgentTask")}" spellcheck="false"></textarea><button type="button" class="ft-button ft-button--secondary" data-mcp-copy-prompt>${t("CopyTask")}</button></section>
    <p class="ft-mcp__status" role="status" aria-live="polite" data-mcp-status></p>
    <footer class="ft-settings__actions"><a href="https://github.com/f-tuma/foundry-translator/tree/main/apps/polish-mcp#readme" target="_blank" rel="noreferrer">${t("Guide")}</a><span>${t("NoLiveWrites")}</span></footer>`;
  const input = (name: keyof McpPaths) => form.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  for (const name of ["repositoryPath", "workspacePath", "nodeCommand"] as const) input(name).value = paths[name];
  const values = (): McpPaths => ({ repositoryPath: input("repositoryPath").value.trim(), workspacePath: input("workspacePath").value.trim(), nodeCommand: input("nodeCommand").value.trim() });
  const config = form.querySelector<HTMLTextAreaElement>("[data-mcp-config]")!, prompt = form.querySelector<HTMLTextAreaElement>("[data-mcp-prompt]")!;
  const status = form.querySelector<HTMLElement>("[data-mcp-status]")!, copyConfig = form.querySelector<HTMLButtonElement>("[data-mcp-copy-config]")!;
  const format = form.querySelector<HTMLSelectElement>("#ft-mcp-format")!;
  const update = () => {
    input("workspacePath").placeholder = input("repositoryPath").value.trim() ? `${input("repositoryPath").value.trim().replace(/[\\/]+$/u, "")}/.polish-workspace` : t("WorkspaceDefault");
    try {
      const connection = mcpConnection(values());
      config.value = format.value === "json" ? connection.json : connection.toml; copyConfig.disabled = false;
      form.querySelector("[data-mcp-server]")!.textContent = connection.script;
      form.querySelector("[data-mcp-input]")!.textContent = connection.inputPath;
    } catch {
      config.value = t("FillPaths"); copyConfig.disabled = true;
      form.querySelector("[data-mcp-server]")!.textContent = t("NotConfigured");
      form.querySelector("[data-mcp-input]")!.textContent = t("NotConfigured");
    }
  };
  const copy = async (area: HTMLTextAreaElement) => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(area.value); status.textContent = t("Copied");
    } catch { area.focus(); area.select(); status.textContent = t("CopyManually"); }
  };
  prompt.value = t("Prompt");
  form.addEventListener("input", update); format.addEventListener("change", update);
  copyConfig.addEventListener("click", () => { if (!copyConfig.disabled) void copy(config); });
  form.querySelector("[data-mcp-copy-prompt]")!.addEventListener("click", () => void copy(prompt));
  form.querySelector("[data-mcp-project]")!.addEventListener("click", actions.project);
  form.addEventListener("submit", event => {
    event.preventDefault();
    void (async () => {
      try { const paths = values(); mcpConnection(paths); await actions.save(paths); status.textContent = t("Saved"); }
      catch (error) { status.textContent = t(error instanceof Error && error.message === "Mcp.InvalidPaths" ? "InvalidPaths" : "SaveFailed"); }
    })();
  });
  update(); activateHelpTooltips(form); return form;
}
