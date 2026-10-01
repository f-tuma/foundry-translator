import { activateHelpTooltips, renderHelpTooltip } from "../ui/help-tooltip";
import { mcpConnection, type McpPaths } from "./mcp-guide";
import type { LiveClient } from "./live-client";

const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.Mcp.${key}`);
const help = (key: string, topic: string) => renderHelpTooltip(t(key), t(topic));
const cleanup = new WeakMap<HTMLFormElement, () => void>();
export function disposeMcpGuide(form: HTMLFormElement): void { cleanup.get(form)?.(); cleanup.delete(form); }
export function renderMcpGuide(paths: McpPaths, actions: { save: (paths: McpPaths) => Promise<void>; project: () => void; live?: LiveClient }): HTMLFormElement {
  const form = document.createElement("form"); form.className = "ft-settings ft-mcp";
  form.autocomplete = "off";
  form.innerHTML = `<header class="ft-settings__intro"><span class="ft-settings__brand-icon" aria-hidden="true"><i class="fa-solid fa-plug"></i></span><div><h2>${t("Heading")}</h2><p>${t("Intro")}</p></div></header>
    <div class="ft-field"><label for="ft-mcp-mode">${t("Mode")}</label><select id="ft-mcp-mode"><option value="export">${t("ExportMode")}</option><option value="live">${t("LiveMode")}</option></select></div>
    <section class="ft-mcp__section" data-mcp-live hidden><h3>${t("LiveHeading")}</h3><p>${t("LiveDescription")}</p>
      <ol class="ft-mcp__steps"><li>${t("LiveSetup")}</li><li>${t("LivePairStep")}</li><li>${t("LiveKeepOpen")}</li></ol>
      <div class="ft-field"><label for="ft-mcp-origin">${t("FoundryOrigin")}</label><input id="ft-mcp-origin" readonly spellcheck="false"></div>
      <div class="ft-field"><label for="ft-mcp-port">${t("BridgePort")}</label><input id="ft-mcp-port" type="number" min="1024" max="65535" value="3112"></div>
      <div class="ft-field"><label for="ft-mcp-live-address">${t("BridgeAddress")}</label><input id="ft-mcp-live-address" readonly spellcheck="false"></div>
      <div class="ft-field"><label for="ft-mcp-pairing-code">${t("PairingCode")}</label><input id="ft-mcp-pairing-code" type="password" maxlength="64" autocomplete="off" spellcheck="false"></div>
      <div class="ft-mcp__actions"><button type="button" class="ft-button" data-mcp-connect>${t("ConnectLive")}</button><button type="button" class="ft-button ft-button--secondary" data-mcp-disconnect>${t("DisconnectLive")}</button></div>
      <p class="ft-mcp__status" role="status" aria-live="polite" data-mcp-live-status></p><p class="ft-mcp__operation" role="status" aria-live="polite" data-mcp-live-operation></p>
    </section>
    <div class="ft-mcp__transport"><strong>foundry-polish · STDIO</strong><span>${t("LocalProcess")}</span>${help("TransportHelp", "Connection")}</div>
    <section class="ft-mcp__section" data-mcp-export><h3>${t("Workflow")}</h3><ol class="ft-mcp__steps">
      <li><strong>${t("ExportStep")}</strong><span>${t("ExportText")}</span><button type="button" class="ft-button ft-button--secondary" data-mcp-project>${t("OpenProject")}</button></li>
      <li><strong>${t("InstallStep")}</strong><span>${t("InstallText")}</span></li>
      <li><strong>${t("ConnectStep")}</strong><span>${t("ConnectText")}</span></li>
      <li><strong>${t("ReviewStep")}</strong><span>${t("ReviewText")}</span></li>
      <li><strong>${t("ImportStep")}</strong><span>${t("ImportText")}</span></li>
    </ol></section>
    <section class="ft-mcp__section"><div class="ft-heading-with-help"><h3>${t("Connection")}</h3>${help("PathsHelp", "Connection")}</div><details><summary>${t("InstallCommands")}</summary><pre>npm ci\nnpm --prefix apps/polish-mcp ci\nnpm --prefix apps/polish-mcp run build</pre></details>
      <div class="ft-settings__fields">
        <div class="ft-field"><label for="ft-mcp-repository">${t("RepositoryPath")}</label><input id="ft-mcp-repository" name="repositoryPath" required maxlength="2000" spellcheck="false" placeholder="/home/user/foundry-translator"></div>
        <div class="ft-field" data-mcp-export><div class="ft-field__label"><label for="ft-mcp-workspace">${t("WorkspacePath")}</label>${help("WorkspaceHelp", "WorkspacePath")}</div><input id="ft-mcp-workspace" name="workspacePath" maxlength="2000" spellcheck="false"></div>
        <div class="ft-field"><label for="ft-mcp-node">${t("NodeCommand")}</label><input id="ft-mcp-node" name="nodeCommand" required maxlength="2000" spellcheck="false" placeholder="node"></div>
      </div>
      <p class="ft-mcp__path"><strong>${t("ServerPath")}</strong><code data-mcp-server></code></p>
      <p class="ft-mcp__path" data-mcp-export><strong>${t("InputPath")}</strong><code data-mcp-input></code></p>
      <div class="ft-field"><label for="ft-mcp-format">${t("Client")}</label><select id="ft-mcp-format"><option value="toml">Codex · config.toml</option><option value="json">${t("JsonClient")}</option></select></div>
      <div class="ft-field"><label for="ft-mcp-config">${t("Configuration")}</label><textarea id="ft-mcp-config" data-mcp-config readonly rows="6" spellcheck="false"></textarea></div>
      <div class="ft-mcp__actions"><button type="button" class="ft-button ft-button--secondary" data-mcp-copy-config>${t("CopyConfiguration")}</button><button type="submit" class="ft-button ft-button--secondary">${t("SavePaths")}</button></div>
    </section>
    <section class="ft-mcp__section"><div class="ft-heading-with-help"><h3>${t("AgentTask")}</h3>${help("AgentHelp", "AgentTask")}</div><textarea data-mcp-prompt readonly rows="5" aria-label="${t("AgentTask")}" spellcheck="false"></textarea><button type="button" class="ft-button ft-button--secondary" data-mcp-copy-prompt>${t("CopyTask")}</button></section>
    <p class="ft-mcp__status" role="status" aria-live="polite" data-mcp-status></p>
    <footer class="ft-settings__actions"><a href="https://github.com/f-tuma/foundry-translator/tree/main/apps/polish-mcp#readme" target="_blank" rel="noreferrer">${t("Guide")}</a><span data-mcp-footer></span></footer>`;
  const input = (name: keyof McpPaths) => form.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  for (const name of ["repositoryPath", "workspacePath", "nodeCommand"] as const) input(name).value = paths[name];
  const mode = form.querySelector<HTMLSelectElement>("#ft-mcp-mode")!, origin = form.querySelector<HTMLInputElement>("#ft-mcp-origin")!, port = form.querySelector<HTMLInputElement>("#ft-mcp-port")!;
  const connectedMode = actions.live?.state.status === "connected" || actions.live?.state.status === "connecting";
  mode.querySelector<HTMLOptionElement>(`option[value="${paths.mode === "live" || connectedMode ? "live" : "export"}"]`)!.selected = true;
  origin.value = globalThis.location?.origin ?? paths.origin ?? "http://localhost:30000"; port.value = String(paths.port ?? 3112);
  const address = form.querySelector<HTMLInputElement>("#ft-mcp-live-address")!, code = form.querySelector<HTMLInputElement>("#ft-mcp-pairing-code")!;
  const values = (): McpPaths => ({ repositoryPath: input("repositoryPath").value.trim(), workspacePath: input("workspacePath").value.trim(), nodeCommand: input("nodeCommand").value.trim(),
    ...(mode.value === "live" ? { mode: "live" as const, origin: origin.value, port: Number(port.value) } : {}) });
  const config = form.querySelector<HTMLTextAreaElement>("[data-mcp-config]")!, prompt = form.querySelector<HTMLTextAreaElement>("[data-mcp-prompt]")!;
  const status = form.querySelector<HTMLElement>("[data-mcp-status]")!, copyConfig = form.querySelector<HTMLButtonElement>("[data-mcp-copy-config]")!;
  const format = form.querySelector<HTMLSelectElement>("#ft-mcp-format")!;
  const update = () => {
    const live = mode.value === "live";
    form.querySelector<HTMLElement>("[data-mcp-live]")!.hidden = !live;
    for (const section of form.querySelectorAll<HTMLElement>("[data-mcp-export]")) section.hidden = live;
    address.value = `http://127.0.0.1:${port.value}`;
    prompt.value = t(live ? "LivePrompt" : "Prompt");
    form.querySelector("[data-mcp-footer]")!.textContent = t(live ? "LiveWritesNotice" : "NoLiveWrites");
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
  form.addEventListener("input", update); format.addEventListener("change", update); mode.addEventListener("change", update);
  const connect = form.querySelector<HTMLButtonElement>("[data-mcp-connect]")!, disconnect = form.querySelector<HTMLButtonElement>("[data-mcp-disconnect]")!;
  const liveStatus = form.querySelector<HTMLElement>("[data-mcp-live-status]")!, operation = form.querySelector<HTMLElement>("[data-mcp-live-operation]")!;
  if (actions.live) {
    cleanup.set(form, actions.live.subscribe(state => {
      connect.disabled = state.status === "connected" || state.status === "connecting";
      mode.disabled = connect.disabled;
      disconnect.disabled = state.status === "disconnected";
      code.disabled = connect.disabled; port.disabled = connect.disabled;
      if (connect.disabled && state.address) { port.value = new URL(state.address).port; address.value = state.address; }
      liveStatus.textContent = state.message ? game.i18n.localize(`FOUNDRY_TRANSLATE.${state.message}`) : t(`LiveStatus.${state.status}`);
      operation.textContent = state.lastOperation.startsWith("Live.") ? game.i18n.localize(`FOUNDRY_TRANSLATE.${state.lastOperation}`) : state.lastOperation;
    }));
    connect.addEventListener("click", () => { const value = code.value; code.value = ""; void actions.live!.connect(address.value, value).catch(error => {
      liveStatus.textContent = error instanceof Error && /^(Live|Review)\./u.test(error.message) ? game.i18n.localize(`FOUNDRY_TRANSLATE.${error.message}`) : t("LivePairingHint");
    }); });
    disconnect.addEventListener("click", () => { code.value = ""; void actions.live!.disconnect(); });
  } else { connect.disabled = true; disconnect.disabled = true; }
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
