// A small client for Epic's MCP server over loopback (streamable HTTP at /mcp): the session handshake, tools/list and tools/call. Used by umg-session.mjs.
// initialize POST (Accept: application/json, text/event-stream; the Mcp-Session-Id response header is kept), then the notifications/initialized notification,
// then tools/call of list_toolsets, describe_toolset and call_tool. The server runs calls serially on the editor's game thread: this client never overlaps two
// calls, and a call that times out is reported as timed out and is never sent again by this module (a caller reads the state back before it resends a write).
import { takeSseEvents, decodeToolResult } from './umg-probe-checks.mjs';

export class McpClient {
  constructor({ port, host = '127.0.0.1' }) {
    this.url = `http://${host}:${port}/mcp`;
    this.nextId = 1;
    this.session = undefined;
    this.trace = [];   // every exchange, for the evidence the runner keeps
    this.argumentsAsString = false;
  }

  /** POST one JSON-RPC message; resolves with { status, message, type, text }. A notification has no id and gets no message. */
  async post(body, { timeoutMs = 120000 } = {}) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    const res = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const sid = res.headers.get('mcp-session-id');
    if (sid && !this.session) this.session = sid;
    const type = res.headers.get('content-type') || '';
    if (body.id === undefined || res.status === 202 || !res.body) { await res.body?.cancel().catch(() => {}); return { status: res.status, message: undefined, type }; }
    if (type.includes('text/event-stream')) {
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        const taken = takeSseEvents(buffer);
        buffer = taken.rest;
        const hit = taken.events.find((e) => e && e.id === body.id);
        if (hit) { reader.cancel().catch(() => {}); return { status: res.status, message: hit, type }; }
        if (done) return { status: res.status, message: undefined, type, text: 'the event stream ended without a response' };
      }
    }
    const text = await res.text();
    try { return { status: res.status, message: JSON.parse(text), type }; } catch { return { status: res.status, message: undefined, type, text: text.slice(0, 400) }; }
  }

  async rpc(method, params, opts) {
    const id = this.nextId++;
    const started = Date.now();
    const out = await this.post({ jsonrpc: '2.0', id, method, params }, opts);
    this.trace.push({ method, params, status: out.status, ms: Date.now() - started, response: out.message ?? out.text });
    return out;
  }

  /** initialize, then notifications/initialized. Throws when the server is not there yet. */
  async connect() {
    const init = await this.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'umg-probe', version: '1' } }, { timeoutMs: 20000 });
    const result = init.message && init.message.result;
    if (!result) throw new Error(`initialize: status ${init.status}, ${init.message ? JSON.stringify(init.message.error ?? init.message).slice(0, 300) : init.text || 'no message'}`);
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { timeoutMs: 20000 });
    return { protocolVersion: result.protocolVersion, serverInfo: result.serverInfo, capabilities: result.capabilities, sessionId: Boolean(this.session) };
  }

  async listTools() {
    const out = await this.rpc('tools/list', {}, { timeoutMs: 30000 });
    const tools = (out.message && out.message.result && out.message.result.tools) || [];
    const callTool = tools.find((t) => t.name === 'call_tool');
    const argType = callTool && callTool.inputSchema && callTool.inputSchema.properties && callTool.inputSchema.properties.arguments && callTool.inputSchema.properties.arguments.type;
    if (argType === 'string') this.argumentsAsString = true;
    return { names: tools.map((t) => t.name), argumentsType: argType, tools, error: out.message && out.message.error ? JSON.stringify(out.message.error).slice(0, 300) : undefined };
  }

  /** tools/call. Never throws on a tool error; a timeout or a network error comes back as { timedOut } or { error }. */
  async callTool(name, args, opts = {}) {
    try {
      const out = await this.rpc('tools/call', { name, arguments: args }, { timeoutMs: opts.timeoutMs ?? 120000 });
      if (out.message && out.message.error) return { ok: false, error: JSON.stringify(out.message.error).slice(0, 600), decoded: undefined };
      if (!out.message) return { ok: false, error: `status ${out.status}: ${out.text || 'no message'}`, decoded: undefined };
      const decoded = decodeToolResult(out.message.result);
      return { ok: !decoded.isError, error: decoded.error, decoded };
    } catch (error) {
      const timedOut = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return { ok: false, timedOut, error: timedOut ? 'timed out' : `${error.cause ? `${error.cause.code || error.cause.message}: ` : ''}${error.message}`, decoded: undefined };
    }
  }

  listToolsets() { return this.callTool('list_toolsets', {}, { timeoutMs: 60000 }); }
  describeToolset(toolsetName) { return this.callTool('describe_toolset', { toolset_name: toolsetName }, { timeoutMs: 60000 }); }
  /** call_tool with the toolset name, the tool name and its arguments (an object, or a JSON string when the server's schema asks for one). */
  inner(toolsetName, toolName, args, opts) {
    return this.callTool('call_tool', { toolset_name: toolsetName, tool_name: toolName, arguments: this.argumentsAsString ? JSON.stringify(args) : args }, opts);
  }
}

/** Connect to a server that is still starting: try every few seconds until it answers or `alive()` says the process is gone or the limit passes. */
export async function waitForServer({ port, limitMs, alive = () => true, say = () => {} }) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < limitMs && alive()) {
    const client = new McpClient({ port });
    try {
      const info = await client.connect();
      return { client, info, seconds: Math.round((Date.now() - started) / 1000) };
    } catch (error) {
      const text = `${error.cause ? `${error.cause.code || error.cause.message}: ` : ''}${error.message}`;
      if (text !== last) { say(`  waiting for the server on port ${port}: ${text.slice(0, 160)}`); last = text; }
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return { client: undefined, error: alive() ? `no answer within ${Math.round(limitMs / 1000)} s (${last})` : `the editor exited before the server answered (${last})` };
}
