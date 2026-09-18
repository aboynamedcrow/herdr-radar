'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-consumer-'));
process.env.HERDR_PLUGIN_CONFIG_DIR = directory;
fs.writeFileSync(path.join(directory, 'config.toml'), 'external_config = true\nprefer_pane_labels = true\n');
const config = require('../../lib/config');
const managed = require('../../lib/managed-config');
const herdr = require('../../lib/herdr');
const state = require('../../lib/state');

test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('consumer ownership suppresses setup and every config writer', () => {
  assert.equal(config.externalConfig, true);
  assert.deepEqual(require('../../lib/setup').ensure({ force: true }), []);
  for (const result of [
    managed.apply(),
    managed.remove(),
    managed.setSidebarRows(true),
    managed.applyAppearance('dark'),
  ]) {
    assert.equal(result.changed, false);
  }
  assert.deepEqual(fs.readdirSync(directory), ['config.toml']);
});

test('pane labels win over agent terminal titles', async () => {
  herdr.agentsAsync = async () => [
    { pane_id: 'w1:p1', agent: 'claude', agent_status: 'idle', terminal_title: 'Other task', cwd: '/repo' },
  ];
  herdr.panesAsync = async () => [{ pane_id: 'w1:p1', label: 'Reviewer 1 · IC-42' }];
  const entries = await state.snapshot();
  assert.equal(entries[0].title, 'Reviewer 1 · IC-42');
});
