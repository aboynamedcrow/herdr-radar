'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const control = require('../lib/control');
const state = require('../lib/state');
const herdr = require('../lib/herdr');
const { stopAnimator } = require('../lib/stop');

for (const reply of [null, { ok: true }]) {
  test(`stop terminates a hung frame after ${reply ? 'an acknowledged stop' : 'a stop request times out'}`, async (t) => {
    let alive = true;
    const events = [];
    t.mock.method(herdr, 'source', () => 'test');
    t.mock.method(control, 'request', async (message, timeout) => {
      assert.equal(message.cmd, 'stop');
      assert.equal(timeout, 10000);
      return reply;
    });
    t.mock.method(state, 'STOP', () => '/fake/animator.stop');
    t.mock.method(fs, 'writeFileSync', (file) => events.push(file));
    t.mock.method(state, 'waitForExit', async (timeout) => {
      events.push(timeout);
      return false;
    });
    t.mock.method(state, 'daemonStatus', async () => ({ state: alive ? 'stalled' : 'none', pid: alive ? 42 : null }));
    t.mock.method(state, 'terminate', async (pid) => {
      assert.equal(pid, 42);
      alive = false;
      events.push('terminated');
      return true;
    });
    t.mock.method(state, 'clearAll', async () => events.push('cleared'));
    assert.equal(await stopAnimator(), true);
    assert(events.includes(reply ? 3000 : 8000));
    assert(events.includes('terminated'));
    if (!reply) assert(events.indexOf('terminated') < events.indexOf('cleared'));
  });
}

test('terminate escalates when SIGTERM does not free the endpoint', async (t) => {
  const signals = [];
  t.mock.method(process, 'kill', (pid, signal) => signals.push([pid, signal]));
  let waits = 0;
  // terminate closes over waitForExit, so replace its endpoint probe and clock.
  t.mock.method(control, 'request', async () => {
    waits += 1;
    return waits === 1 ? { ok: true, pid: 42 } : null;
  });
  let now = 0;
  t.mock.method(Date, 'now', () => (now += 3000));
  assert.equal(await state.terminate(42), process.platform !== 'win32');
  assert.deepEqual(
    signals,
    process.platform === 'win32'
      ? [[42, 'SIGTERM']]
      : [
          [42, 'SIGTERM'],
          [42, 'SIGKILL'],
        ],
  );
});
