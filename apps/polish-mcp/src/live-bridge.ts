import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { LIVE_PROTOCOL, type LiveClaim, type LiveRequest, type LiveResult } from "../../../src/polish/live-protocol";

const secret = () => randomBytes(32).toString("hex");
const matches = (actual: string, expected: string) => actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
export function allowedOrigin(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.origin === "null") throw new Error("Provide --origin with the exact Foundry origin, e.g. https://ember.example.cz");
  return url.origin;
}
/** A local, single-browser bridge. The assistant still speaks MCP over STDIO;
 * HTTP is only an authenticated outbound connection from the paired GM tab. */
export class LiveBridge {
  private server = createServer((req, res) => { void this.http(req, res); });
  private code = secret();
  private codeExpires = Date.now() + 5 * 60_000;
  private session: { token: string; claim: LiveClaim; seen: number } | null = null;
  private waiting: { res: ServerResponse; timer: ReturnType<typeof setTimeout> } | null = null;
  private pending: { request: LiveRequest; resolve: (result: LiveResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private delivered = false;
  private runningPort = 0;
  constructor(readonly origin: string, readonly port: number) { allowedOrigin(origin); }
  async start() {
    if (!Number.isInteger(this.port) || this.port < 0 || this.port > 65535) throw new Error("Invalid bridge port");
    this.server.requestTimeout = 30000; this.server.headersTimeout = 30000;
    await new Promise<void>((resolve, reject) => { this.server.once("error", reject); this.server.listen(this.port, "127.0.0.1", () => { this.server.off("error", reject); resolve(); }); });
    const address = this.server.address(); if (!address || typeof address === "string") throw new Error("Bridge startup failed");
    this.runningPort = address.port;
    return this;
  }
  connection(): { address: string; origin: string; connected: boolean; world?: LiveClaim; lastSeen?: string; pairingCode?: string; expiresAt?: string; instructions: string } {
    this.expire();
    if (!this.session && this.codeExpires <= Date.now()) { this.code = secret(); this.codeExpires = Date.now() + 5 * 60_000; }
    return { address: `http://127.0.0.1:${this.runningPort}`, origin: this.origin, connected: !!this.session,
      ...(this.session ? { world: this.session.claim, lastSeen: new Date(this.session.seen).toISOString() } : { pairingCode: this.code, expiresAt: new Date(this.codeExpires).toISOString() }),
      instructions: "In Foundry Translate → MCP select Live world, enter this address and pairing code, and Connect. Keep that GM tab open. Pairing grants direct translation writes with history; verification remains manual. Do not place the code in a URL or commit it." };
  }
  private expire() { if (this.session && Date.now() - this.session.seen > 60000) this.disconnect("Browser heartbeat expired. Read history before retrying a write."); }
  request(method: LiveRequest["method"], args: Record<string, unknown>): Promise<LiveResult> {
    this.expire();
    if (!this.session) return Promise.reject(new Error("Foundry is not connected. Use live_connection and pair the GM tab."));
    if (this.pending) return Promise.reject(new Error("Another Foundry request is in progress."));
    return new Promise((resolve, reject) => {
      const request = { id: randomUUID(), method, args };
      const timer = setTimeout(() => {
        if (this.pending?.request.id !== request.id) return;
        this.pending = null;
        // A timed-out write may already have committed. Never replay it implicitly.
        this.disconnect("Request timed out");
        reject(new Error(`Foundry request timed out (${request.id}). Outcome may be unknown. Reconnect, then inspect live_list_history. For a save retry use exactly the same operationId and arguments.`));
      }, 45000);
      this.pending = { request, resolve, reject, timer }; this.delivered = false; this.flush();
    });
  }
  private json(res: ServerResponse, status: number, value: unknown) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value));
  }
  private flush() {
    if (!this.waiting || !this.pending || this.delivered) return;
    const { res, timer } = this.waiting; clearTimeout(timer); this.waiting = null;
    if (res.destroyed) return;
    this.delivered = true; this.json(res, 200, this.pending.request);
  }
  disconnect(reason = "Disconnected") {
    this.session = null; this.code = secret(); this.codeExpires = Date.now() + 5 * 60_000;
    if (this.waiting) { clearTimeout(this.waiting.timer); this.json(this.waiting.res, 401, { error: "Disconnected" }); this.waiting = null; }
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error(`${reason}. A write may have committed; inspect history before retrying.`)); this.pending = null; }
  }
  async close() { this.disconnect(); this.server.closeAllConnections(); await new Promise<void>(resolve => this.server.close(() => resolve())); }
  private async body(req: IncomingMessage) {
    if (req.headers["content-type"] !== "application/json") throw new Error("Invalid content type");
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) throw new Error("Request too large"); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  }
  private async http(req: IncomingMessage, res: ServerResponse) {
    // Host validation blocks DNS rebinding. Origin validation also applies to
    // preflight and failures; cookies and ambient browser auth are never used.
    if (req.headers.host !== `127.0.0.1:${this.runningPort}` || req.headers.origin !== this.origin) { this.json(res, 403, { error: "Origin or host rejected" }); return; }
    res.setHeader("Access-Control-Allow-Origin", this.origin); res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Private-Network", "true"); res.writeHead(204); res.end(); return;
    }
    try {
      this.expire();
      if (req.method === "POST" && req.url === "/connect") {
        const token = req.headers.authorization?.replace(/^Bearer /u, "") ?? "";
        if (this.session || Date.now() > this.codeExpires || !matches(token, this.code)) { this.json(res, 401, { error: "Invalid or consumed pairing code" }); return; }
        const claim = await this.body(req) as unknown as LiveClaim;
        if (claim.protocol !== LIVE_PROTOCOL || [claim.worldId, claim.worldName, claim.userId, claim.language, claim.systemId, claim.moduleVersion, claim.clientId].some(s => typeof s !== "string" || !s || s.length > 500) || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(claim.language)) throw new Error("Invalid world claim");
        // Recheck after body parsing: concurrent connect attempts cannot both win.
        if (this.session || !matches(token, this.code)) { this.json(res, 409, { error: "Already paired" }); return; }
        this.session = { token: secret(), claim, seen: Date.now() }; this.code = secret();
        this.json(res, 200, { protocol: LIVE_PROTOCOL, sessionToken: this.session.token }); return;
      }
      const token = req.headers.authorization?.replace(/^Bearer /u, "") ?? "";
      if (!this.session || !matches(token, this.session.token)) { this.json(res, 401, { error: "Not paired" }); return; }
      this.session.seen = Date.now();
      if (req.method === "GET" && req.url === "/poll") {
        if (this.waiting) { this.json(res, 409, { error: "Another browser poll is active" }); return; }
        const timer = setTimeout(() => { if (this.waiting?.res === res) { this.waiting = null; this.json(res, 200, null); } }, 20000);
        this.waiting = { res, timer };
        res.on("close", () => { if (this.waiting?.res === res) { clearTimeout(timer); this.waiting = null; } });
        this.flush(); return;
      }
      if (req.method === "POST" && req.url === "/reply") {
        const body = await this.body(req), pending = this.pending;
        if (!pending || body.id !== pending.request.id || !body.result || typeof body.result !== "object" || typeof (body.result as LiveResult).ok !== "boolean") { this.json(res, 409, { error: "Unknown request" }); return; }
        clearTimeout(pending.timer); this.pending = null; pending.resolve(body.result as LiveResult); this.json(res, 200, { received: true }); return;
      }
      if (req.method === "POST" && req.url === "/disconnect") { this.disconnect(); this.json(res, 200, { disconnected: true }); return; }
      this.json(res, 404, { error: "Unknown bridge endpoint" });
    } catch { this.json(res, 400, { error: "Invalid bridge request" }); }
  }
}
