import { MODULE_ID, MODULE_VERSION } from "../constants";
import { createLiveHandler } from "./live-service";
import { LIVE_PROTOCOL, liveBridgeAddress, type LiveClaim } from "./live-protocol";

export interface LiveClientState { status: "disconnected" | "connecting" | "connected" | "error"; address: string; message: string; lastOperation: string }
/** Secrets live only in this tab's memory. Reloading never reconnects silently. */
export class LiveClient {
  private controller: AbortController | null = null;
  private session = "";
  private listeners = new Set<(state: LiveClientState) => void>();
  state: LiveClientState = { status: "disconnected", address: "", message: "", lastOperation: "" };
  subscribe(listener: (state: LiveClientState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(state: Partial<LiveClientState>) { this.state = { ...this.state, ...state }; for (const listener of this.listeners) listener(this.state); }
  async connect(address: string, code: string) {
    if (!game.user?.isGM || !game.user.id || !game.world?.id) throw new Error("Review.GMOnly");
    const url = liveBridgeAddress(address);
    if (!/^[a-f0-9]{64}$/u.test(code.trim())) throw new Error("Live.InvalidCode");
    await this.disconnect();
    const controller = new AbortController(); this.controller = controller;
    this.update({ status: "connecting", address: url, message: "", lastOperation: "" });
    const claim: LiveClaim = { protocol: LIVE_PROTOCOL, worldId: game.world.id, worldName: game.world.title ?? game.world.id,
      userId: game.user.id, language: String(game.settings.get(MODULE_ID, "targetLanguage") ?? "cs"), systemId: game.system?.id ?? "unknown", moduleVersion: MODULE_VERSION, clientId: crypto.randomUUID() };
    try {
      const response = await fetch(`${url}/connect`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${code.trim()}` }, body: JSON.stringify(claim), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), credentials: "omit", cache: "no-store", redirect: "error" });
      if (!response.ok) throw new Error("Live.PairingFailed");
      const result = await response.json() as { protocol: number; sessionToken: string };
      if (result.protocol !== LIVE_PROTOCOL || !/^[a-f0-9]{64}$/u.test(result.sessionToken)) throw new Error("Live.PairingFailed");
      if (controller.signal.aborted) return;
      this.session = result.sessionToken; this.update({ status: "connected" });
      void this.poll(controller, createLiveHandler(claim.language, () => this.controller === controller && !controller.signal.aborted && this.state.status === "connected"));
    } catch (error) {
      if (this.controller === controller && !controller.signal.aborted) { this.session = ""; this.controller = null; controller.abort(); this.update({ status: "error", message: error instanceof Error && error.message.startsWith("Live.") ? error.message : "Live.NetworkError" }); }
      throw error;
    }
  }
  async disconnect() {
    const address = this.state.address, token = this.session;
    this.controller?.abort(); this.controller = null; this.session = "";
    this.update({ status: "disconnected", message: "" });
    if (token && address) try { await fetch(`${address}/disconnect`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000) }); } catch { /* Local access is revoked even if the process stopped. */ }
  }
  private async poll(controller: AbortController, handle: ReturnType<typeof createLiveHandler>) {
    try {
      while (!controller.signal.aborted) {
        const options: RequestInit = { headers: { Authorization: `Bearer ${this.session}` }, credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) };
        const response = await fetch(`${this.state.address}/poll`, options);
        if (!response.ok) throw new Error("Live.Disconnected");
        const request: unknown = await response.json();
        if (request === null) continue;
        const result = await handle(request);
        if (controller.signal.aborted) return;
        const reply = await fetch(`${this.state.address}/reply`, { ...options, method: "POST", headers: { ...options.headers, "Content-Type": "application/json" }, body: JSON.stringify({ id: (request as { id?: unknown })?.id, result }) });
        if (!reply.ok) throw new Error("Live.ReplyFailed");
        this.update({ lastOperation: result.ok ? "Live.OperationSucceeded" : result.error?.message ?? "Live.Failed" });
      }
    } catch (error) {
      if (!controller.signal.aborted) { await this.disconnect(); this.update({ status: "error", message: error instanceof Error && error.message.startsWith("Live.") ? error.message : "Live.NetworkError" }); }
    }
  }
}
export const liveClient = new LiveClient();
