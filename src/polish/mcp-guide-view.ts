import { activateHelpTooltips, renderHelpTooltip } from "../ui/help-tooltip";
import { generateMcpKey, mcpConnection, type McpPreferences } from "./mcp-guide";
import type { LiveClient } from "./live-client";
const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.Mcp.${key}`);
const cleanup = new WeakMap<HTMLFormElement, () => void>();
export function disposeMcpGuide(form: HTMLFormElement): void { cleanup.get(form)?.(); cleanup.delete(form); }
export function renderMcpGuide(preferences: McpPreferences, actions: { save: (preferences: McpPreferences) => Promise<void>; live?: LiveClient }): HTMLFormElement {
  const form = document.createElement("form"); form.className = "ft-settings ft-mcp"; form.autocomplete = "off";
  form.innerHTML = `<header class="ft-settings__intro"><span class="ft-settings__brand-icon" aria-hidden="true"><i class="fa-solid fa-plug"></i></span><div><h2>${t("Heading")}</h2><p>${t("SimpleIntro")}</p></div></header>
    <section class="ft-mcp__section"><p data-mcp-scope></p><details><summary>${t("Advanced")}</summary><div class="ft-field"><label for="ft-mcp-address">${t("ServiceAddress")}</label><input id="ft-mcp-address" type="url" required spellcheck="false" placeholder="http://127.0.0.1:3112"></div></details>
    <div class="ft-field ft-mcp__key"><div class="ft-field__label"><label for="ft-mcp-key">${t("ApiKey")}</label>${renderHelpTooltip(t("ApiKeyHelp"), t("ApiKey"))}<button type="button" class="ft-button ft-button--secondary ft-mcp__renew" data-mcp-new-key aria-label="${t("GenerateKey")}" title="${t("GenerateKey")}"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button></div><input id="ft-mcp-key" type="password" required maxlength="512" autocomplete="off" spellcheck="false"></div>
    <div class="ft-mcp__actions"><button type="submit" class="ft-button" data-mcp-connect>${t("SaveConnect")}</button><button type="button" class="ft-button ft-button--secondary" data-mcp-disconnect>${t("DisableConnection")}</button></div>
    <p role="status" aria-live="polite" data-mcp-live-status></p><p role="status" aria-live="polite" data-mcp-live-operation></p></section>
    <section class="ft-mcp__section"><h3>${t("ClientJson")}</h3><p>${t("JsonStep")}</p><button type="button" class="ft-button ft-button--secondary" data-mcp-copy-config>${t("CopyJson")}</button><details><summary>${t("ShowConfiguration")}</summary><textarea data-mcp-config readonly rows="8" spellcheck="false" aria-label="${t("ClientJson")}"></textarea></details></section>
    <p class="ft-mcp__status" role="status" aria-live="polite" data-mcp-status></p>
    <footer class="ft-settings__actions"><a href="https://github.com/f-tuma/foundry-translator/tree/main/apps/polish-mcp#readme" target="_blank" rel="noreferrer">${t("ServiceSetup")}</a>${renderHelpTooltip(t("SimpleSafety"), t("Heading"))}</footer>`;
  const address = form.querySelector<HTMLInputElement>("#ft-mcp-address")!, key = form.querySelector<HTMLInputElement>("#ft-mcp-key")!;
  address.value = preferences.address; key.value = preferences.apiKey || generateMcpKey();
  form.querySelector("[data-mcp-scope]")!.textContent = `${game.world?.title ?? game.world?.id ?? ""} · ${String(game.settings.get("foundry-translate", "targetLanguage") ?? "cs").toUpperCase()}`;
  const config = form.querySelector<HTMLTextAreaElement>("[data-mcp-config]")!, copy = form.querySelector<HTMLButtonElement>("[data-mcp-copy-config]")!, status = form.querySelector<HTMLElement>("[data-mcp-status]")!;
  const values = (enabled: boolean): McpPreferences => ({ address: address.value.trim(), apiKey: key.value.trim(), enabled,
    worldId: game.world?.id ?? "", userId: game.user?.id ?? "", language: String(game.settings.get("foundry-translate", "targetLanguage") ?? "cs") });
  const update = () => { try {
    const current = values(false), saved = preferences.apiKey === current.apiKey && preferences.address === current.address && preferences.worldId === current.worldId && preferences.userId === current.userId && preferences.language === current.language;
    config.value = saved ? mcpConnection(current, window.location.origin).json : ""; copy.disabled = !saved;
  } catch { config.value = ""; copy.disabled = true; } };
  form.querySelector<HTMLButtonElement>("[data-mcp-new-key]")!.addEventListener("click", () => { key.value = generateMcpKey(); update(); status.textContent = t("NewKeyPending"); });
  form.addEventListener("input", update);
  copy.addEventListener("click", () => { void (async () => { try { if (!navigator.clipboard) throw new Error("Unavailable"); await navigator.clipboard.writeText(config.value); status.textContent = t("Copied"); }
    catch { const details = config.closest("details")!; details.open = true; config.focus(); config.select(); status.textContent = t("CopyManually"); } })(); });
  const connect = form.querySelector<HTMLButtonElement>("[data-mcp-connect]")!, disconnect = form.querySelector<HTMLButtonElement>("[data-mcp-disconnect]")!;
  if (actions.live) cleanup.set(form, actions.live.subscribe(state => {
    connect.disabled = state.status === "connecting";
    const active = ["connected", "connecting", "error"].includes(state.status);
    disconnect.disabled = !active && !preferences.enabled;
    form.querySelector("[data-mcp-live-status]")!.textContent = state.message ? game.i18n.localize(`FOUNDRY_TRANSLATE.${state.message}`) : t(`LiveStatus.${state.status}`);
    form.querySelector("[data-mcp-live-operation]")!.textContent = state.lastOperation.startsWith("Live.") ? game.i18n.localize(`FOUNDRY_TRANSLATE.${state.lastOperation}`) : state.lastOperation;
  }));
  const failure = (error: unknown) => { status.textContent = error instanceof Error && /^(Live|Review)\./u.test(error.message) ? game.i18n.localize(`FOUNDRY_TRANSLATE.${error.message}`) : t("SaveFailed"); };
  form.addEventListener("submit", event => { event.preventDefault(); void (async () => {
    try { const saved = values(true); const connection = mcpConnection(saved, window.location.origin); saved.address = connection.address;
      connect.disabled = true;
      await actions.save(saved); preferences = saved; update(); status.textContent = t("Remembered");
      await actions.live?.enable(saved);
    } catch (error) { if (!(error instanceof Error && error.message === "Live.NetworkError")) failure(error); }
    finally { connect.disabled = actions.live?.state.status === "connecting"; }
  })(); });
  disconnect.addEventListener("click", () => { void (async () => { try {
    const saved = { ...preferences, enabled: false }; await actions.live?.disconnect(); await actions.save(saved); preferences = saved; disconnect.disabled = true; status.textContent = t("Disabled");
  } catch (error) { failure(error); } })(); });
  update(); activateHelpTooltips(form); return form;
}
