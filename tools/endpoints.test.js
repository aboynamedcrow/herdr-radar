'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '..');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await pause(50);
  }
  assert.fail('fixture condition did not arrive');
}

test('startup, watchdog and stop keep two servers with identical pane IDs separate', { timeout: 40000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-servers-'));
  const clients = new Set();
  const servers = [];
  const instances = [];
  const clean = {
    ...process.env,
    HOME: temp,
    XDG_CONFIG_HOME: temp,
    XDG_STATE_HOME: temp,
    HERDR_PLUGIN_STATE_DIR: path.join(temp, 'state'),
    HERDR_PLUGIN_CONFIG_DIR: temp,
    HERDR_BIN_PATH: path.join(temp, 'herdr'),
    HERDR_WORKSPACE_ID: 'w1',
    HERDR_PANE_ID: 'w1:p1',
  };
  delete clean.HERDR_RADAR_STATE;
  fs.writeFileSync(
    path.join(temp, 'config.toml'),
    'external_config = true\ndefault_view = "off"\ndetail_rows = true\ngroup_indent = 2\n',
  );
  fs.writeFileSync(clean.HERDR_BIN_PATH, '#!/bin/sh\nprintf \'{"result":{}}\\n\'\n', { mode: 0o755 });
  const node = (code, env) => exec(process.execPath, ['-e', code], { cwd: root, env, timeout: 12000 });
  const request = async (env, cmd) =>
    JSON.parse(
      (
        await node(
          `require('./lib/control').request({cmd:${JSON.stringify(cmd)}}).then(x=>console.log(JSON.stringify(x)))`,
          env,
        )
      ).stdout,
    );
  try {
    for (const label of ['first', 'second']) {
      const socket = path.join(temp, `${label}.sock`);
      const writes = [];
      const server = net.createServer((stream) => {
        clients.add(stream);
        stream.on('close', () => clients.delete(stream));
        stream.on('error', () => {});
        let body = '';
        stream.on('data', (chunk) => {
          body += chunk;
          if (!body.includes('\n')) return;
          const req = JSON.parse(body.slice(0, body.indexOf('\n')));
          body = '';
          const pane = {
            pane_id: 'w1:p1',
            workspace_id: 'w1',
            tab_id: 'w1:t1',
            agent: 'claude',
            agent_status: 'working',
            label: `Orchestrator · ${label}`,
            title: label,
          };
          const data = {
            'agent.list': { agents: [pane] },
            'pane.list': { panes: [pane] },
            'workspace.list': { workspaces: [{ workspace_id: 'w1', label }] },
            'tab.list': { tabs: [{ tab_id: 'w1:t1', workspace_id: 'w1', label: `Crew · ${label}` }] },
          };
          if (req.method === 'pane.report_metadata') writes.push(req.params);
          const reply = JSON.stringify({ id: req.id, result: data[req.method] ?? {} }) + '\n';
          if (req.method === 'events.subscribe') stream.write(reply);
          else stream.end(reply);
        });
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socket, resolve);
      });
      servers.push(server);
      const env = { ...clean, HERDR_SOCKET_PATH: socket };
      instances.push(env);
      await exec(process.execPath, ['bin/agent-state.js'], { cwd: root, env });
      const owner = await until(async () => (await request(env, 'ping'))?.pid);
      await until(() => writes.some((w) => JSON.stringify(w.tokens).includes(label)));
      // A watchdog invocation must retain this endpoint's existing owner.
      await exec(process.execPath, ['bin/agent-state.js'], { cwd: root, env });
      assert.equal((await request(env, 'ping')).pid, owner);
    }
    const first = await request(instances[0], 'ping');
    const second = await request(instances[1], 'ping');
    assert.notEqual(first.pid, second.pid);
    assert.equal((await request(instances[0], 'stop')).stopped, true);
    await until(async () => !(await request(instances[0], 'ping')));
    assert.equal((await request(instances[1], 'ping')).pid, second.pid);
  } finally {
    for (const env of instances) {
      await request(env, 'stop').catch(() => {});
      await until(async () => !(await request(env, 'ping'))).catch(() => {});
    }
    for (const client of clients) client.destroy();
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
