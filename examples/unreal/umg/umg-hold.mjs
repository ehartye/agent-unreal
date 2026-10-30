// Calls from node into an open editor: editor Python through a request file the stage script runs (pyCall), and the hold loop, which keeps one editor open after the
// scripted steps and answers request files one at a time (a call to a toolset, a toolset description, a Python snippet, a read of the stage report). The hold loop is
// for exploring a session by hand (--hold); the scripted probe does not need it. Every request is run once: nothing is sent again, a timeout is reported as a timeout.
//   <dir>/req-<name>.json    {"call": {"toolset": "...", "tool": "...", "arguments": {...}}} | {"describe": "<toolset>"} | {"py": "<code>"} | {"stage": true} | {"list": true}
//   <dir>/res-<name>.json    the answer ({ ok, ms, ... }); <dir>/end.flag ends the loop
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run Python in the editor: write request.py in the rpc folder (the stage script runs it on the game thread) and wait for result.json. Never sent twice. */
export async function pyCall(rpcDir, code, { timeoutMs = 120000, pollMs = 300 } = {}) {
  const request = join(rpcDir, 'request.py'), result = join(rpcDir, 'result.json');
  mkdirSync(rpcDir, { recursive: true });
  rmSync(result, { force: true });
  writeFileSync(`${request}.tmp`, code);
  renameSync(`${request}.tmp`, request);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(result)) {
      try { return JSON.parse(readFileSync(result, 'utf8')); } catch { /* the file is still being written */ }
    }
    await sleep(pollMs);
  }
  return { ok: false, timedOut: true, error: `no result after ${Math.round(timeoutMs / 1000)} s (read the state back before sending anything again)` };
}

/** One request object -> its answer. `ctx` holds { client, py, stage }. */
export async function answerRequest(req, ctx) {
  const started = Date.now();
  const done = (fields) => ({ ...fields, ms: Date.now() - started });
  if (req && req.call) {
    const out = await ctx.client.inner(req.call.toolset, req.call.tool, req.call.arguments ?? {}, { timeoutMs: req.timeoutMs ?? 120000 });
    return done({ ok: out.ok, timedOut: out.timedOut, error: out.ok ? undefined : out.error, text: out.decoded ? String(out.decoded.text || '').slice(0, 60000) : undefined });
  }
  if (req && req.describe) {
    const out = await ctx.client.describeToolset(req.describe);
    return done({ ok: out.ok, error: out.ok ? undefined : out.error, text: out.decoded ? String(out.decoded.text || '') : undefined });
  }
  if (req && typeof req.py === 'string') return done(await ctx.py(req.py, { timeoutMs: req.timeoutMs }));
  if (req && req.stage) return done({ ok: true, stage: ctx.stage ? ctx.stage() : undefined });
  if (req && req.list) {
    const out = await ctx.client.listToolsets();
    return done({ ok: out.ok, text: out.decoded ? String(out.decoded.text || '') : undefined });
  }
  return done({ ok: false, error: 'a request needs one of call, describe, py, stage, list' });
}

/** Answer request files until end.flag appears or the limit passes. Returns the number of requests answered. */
export async function holdLoop({ dir, ctx, say = () => {}, limitMs = 1800000, pollMs = 700 }) {
  mkdirSync(dir, { recursive: true });
  say(`  hold: answering request files in ${dir} until end.flag appears (req-<name>.json -> res-<name>.json)`);
  const started = Date.now();
  let answered = 0;
  while (Date.now() - started < limitMs && !existsSync(join(dir, 'end.flag'))) {
    const names = readdirSync(dir).filter((f) => /^req-.+\.json$/.test(f)).sort();
    for (const file of names) {
      const path = join(dir, file);
      let req;
      try { req = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }   // still being copied in
      rmSync(path, { force: true });
      let res;
      try { res = await answerRequest(req, ctx); } catch (error) { res = { ok: false, error: String((error && error.stack) || error).slice(0, 500) }; }
      const target = join(dir, file.replace(/^req-/, 'res-'));
      writeFileSync(`${target}.tmp`, JSON.stringify(res, null, 1));
      renameSync(`${target}.tmp`, target);
      answered++;
    }
    await sleep(pollMs);
  }
  say(`  hold: ended after ${answered} requests`);
  return answered;
}
