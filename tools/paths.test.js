'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function paths(env) {
  const clean = { ...process.env };
  for (const name of ['HERDR_SOCKET_PATH', 'HERDR_RADAR_STATE', 'HERDR_PLUGIN_STATE_DIR']) delete clean[name];
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        `
    const p = require('./lib/paths');
    const state = require('./lib/state');
    console.log(JSON.stringify({state: p.stateRoot, control: require('./lib/control').endpoint(),
      pid: state.LOCK(), config: p.herdrConfigPath(), running: state.animatorRunning(),
      mode: require('./lib/view').mode()}));
  `,
      ],
      { cwd: root, env: { ...clean, ...env }, encoding: 'utf8' },
    ),
  );
}

test('each server owns its PID, cache and control endpoint', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-paths-'));
  try {
    const env = { HERDR_PLUGIN_STATE_DIR: temp };
    const first = paths({ ...env, HERDR_SOCKET_PATH: '/srv/herdr.sock' });
    fs.writeFileSync(first.pid, String(process.pid));
    const other = paths({ ...env, HERDR_SOCKET_PATH: '/srv/sessions/agents/herdr.sock' });
    assert.notEqual(first.state, other.state);
    assert.notEqual(first.control, other.control);
    assert.equal(other.running, false);
    assert.equal(paths({ ...env, HERDR_SOCKET_PATH: '/srv/herdr.sock' }).running, true);
    assert.equal(first.config, other.config);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('default and explicit endpoints agree across symlinked config paths', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-alias-'));
  try {
    fs.mkdirSync(path.join(temp, 'real', 'herdr'), { recursive: true });
    fs.symlinkSync(path.join(temp, 'real'), path.join(temp, 'alias'));
    const env = { XDG_CONFIG_HOME: path.join(temp, 'alias'), HERDR_PLUGIN_STATE_DIR: path.join(temp, 'state') };
    assert.equal(
      paths(env).state,
      paths({ ...env, HERDR_SOCKET_PATH: path.join(temp, 'real/herdr/herdr.sock') }).state,
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('explicit state override remains exact and long paths have short control sockets', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-override-'));
  try {
    const state = path.join(temp, 'x'.repeat(90));
    const result = paths({ HERDR_RADAR_STATE: state });
    assert.equal(result.state, state);
    assert(Buffer.byteLength(result.control) < 104);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('default_view off preserves native sorting on a new endpoint', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-default-'));
  try {
    fs.writeFileSync(path.join(temp, 'config.toml'), 'default_view = "off"\n');
    const env = { HERDR_PLUGIN_CONFIG_DIR: temp, HERDR_PLUGIN_STATE_DIR: temp };
    assert.equal(paths(env).mode, null);
    fs.writeFileSync(path.join(paths(env).state, 'agent-view.on'), 'recent');
    assert.equal(paths(env).mode, 'recent');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
