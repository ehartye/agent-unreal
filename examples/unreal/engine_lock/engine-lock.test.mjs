// node --test examples/unreal/engine_lock/engine-lock.test.mjs  (no Unreal; needs pwsh and Windows named mutexes)
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'with-engine-lock.ps1');
const hasPwsh = process.platform === 'win32' && spawnSync('pwsh', ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0;
const skip = hasPwsh ? false : 'needs pwsh and Windows named mutexes';

/** A mutex name no other run uses, so a test never waits on a real engine run. */
const usedNames = [];
const uniqueName = () => {
  const name = `agent-unreal-test-${randomUUID()}`;
  usedNames.push(name);
  return name;
};

// A holder that the test kills cannot remove its own holder file, so the test does.
after(() => {
  for (const name of usedNames) rmSync(join(tmpdir(), `${name}.holder`), { force: true });
});
const wrapped = (name, args, env = {}) =>
  spawnSync('pwsh', ['-NoProfile', '-File', script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ENGINE_LOCK_NAME: name, ...env },
  });

test('a command with one argument runs with that argument', { skip }, () => {
  const run = wrapped(uniqueName(), ['node', '--version']);
  assert.equal(run.status, 0);
  assert.match(run.stdout.trim(), /^v\d+\.\d+\.\d+/);
});

test('a script path given as the only argument reaches the command whole', { skip }, () => {
  const run = wrapped(uniqueName(), ['node', '-p', 'process.argv.length']);
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), '1');
});

test('an empty-string argument is kept', { skip }, () => {
  const run = wrapped(uniqueName(), ['node', '-p', 'JSON.stringify(process.argv.slice(1))', '', 'x']);
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), '["","x"]');
});

test('the wrapped command exit code is the wrapper exit code', { skip }, () => {
  assert.equal(wrapped(uniqueName(), ['node', '-e', 'process.exit(7)']).status, 7);
});

test('no command is a usage error', { skip }, () => {
  const run = wrapped(uniqueName(), []);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /usage/);
});

test('--no-lock runs the command while another call holds the lock', { skip }, async () => {
  const name = uniqueName();
  const holder = spawn('pwsh', ['-NoProfile', '-File', script, 'node', '-e', 'setTimeout(() => {}, 6000)'], {
    env: { ...process.env, ENGINE_LOCK_NAME: name },
    stdio: 'ignore',
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const started = Date.now();
    const run = wrapped(name, ['--no-lock', 'node', '--version']);
    assert.equal(run.status, 0);
    assert.ok(Date.now() - started < 4000, 'the read-only call did not wait for the holder');
  } finally {
    holder.kill();
  }
});

test('a second call names the holder while it waits, then acquires and runs', { skip }, async () => {
  const name = uniqueName();
  const holder = spawn('pwsh', ['-NoProfile', '-File', script, 'node', '-e', 'setTimeout(() => {}, 5000)'], {
    env: { ...process.env, ENGINE_LOCK_NAME: name },
    stdio: 'ignore',
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const run = wrapped(name, ['node', '--version'], { ENGINE_LOCK_HEARTBEAT_SECONDS: '1' });
    assert.equal(run.status, 0);
    assert.match(run.stderr, /waiting for engine lock .* held by: node /);
    assert.match(run.stderr, /acquired/);
    assert.match(run.stdout, /^v\d+/);
  } finally {
    holder.kill();
  }
});

test('the lock is not acquired within the timeout', { skip }, async () => {
  const name = uniqueName();
  const holder = spawn('pwsh', ['-NoProfile', '-File', script, 'node', '-e', 'setTimeout(() => {}, 8000)'], {
    env: { ...process.env, ENGINE_LOCK_NAME: name },
    stdio: 'ignore',
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const run = wrapped(name, ['node', '--version'], { ENGINE_LOCK_TIMEOUT_MIN: '0.05', ENGINE_LOCK_HEARTBEAT_SECONDS: '1' });
    assert.equal(run.status, 3);
    assert.match(run.stderr, /not acquired within/);
  } finally {
    holder.kill();
  }
});
