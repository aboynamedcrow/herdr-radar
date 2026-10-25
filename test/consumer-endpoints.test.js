'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '..');

// Serve fake control replies only. No daemon or Herdr process runs.
test('two fake server controls keep watchdog status and stop separate', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-controls-'));
  const servers = [];
  const clients = new Set();
  t.after(async () => {
    for (const socket of clients) socket.destroy();
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const node = (code, env) => exec(process.execPath, ['-e', code], { cwd: root, env, timeout: 5000 });
  const environments = [];
  for (const [index, name] of ['first', 'second'].entries()) {
    const env = {
      ...process.env,
      HERDR_RADAR_STATE: '',
      HERDR_PLUGIN_STATE_DIR: path.join(temp, 'state'),
      HERDR_SOCKET_PATH: path.join(temp, `${name}.sock`),
    };
    delete env.HERDR_RADAR_STATE;
    environments.push(env);
    const endpoint = execFileSync(process.execPath, ['-e', "console.log(require('./lib/control').endpoint())"], {
      cwd: root,
      env,
      encoding: 'utf8',
    }).trim();
    let stopped = false;
    const server = net.createServer((socket) => {
      clients.add(socket);
      socket.on('close', () => clients.delete(socket));
      socket.on('error', () => {});
      socket.once('data', (data) => {
        const { cmd } = JSON.parse(data);
        if (stopped) return socket.end();
        if (cmd === 'stop') {
          stopped = true;
          socket.end('{"ok":true,"stopped":true}\n');
        } else {
          socket.end(JSON.stringify({ ok: true, pid: 100 + index, fire_age_ms: 10, frame_running_ms: 0 }) + '\n');
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(endpoint, resolve);
    });
    servers.push(server);
  }
  const status = async (env) =>
    JSON.parse(
      (await node("require('./lib/state').daemonStatus().then(x=>console.log(JSON.stringify(x)))", env)).stdout,
    );
  assert.equal((await status(environments[0])).pid, 100);
  assert.equal((await status(environments[1])).pid, 101);
  const stopped = await node(
    "require('./lib/herdr').source=()=> 'test'; require('./lib/stop').stopAnimator().then(x=>console.log(x))",
    environments[0],
  );
  assert.equal(stopped.stdout.trim(), 'true');
  assert.equal((await status(environments[0])).state, 'none');
  assert.equal((await status(environments[1])).pid, 101);
});
