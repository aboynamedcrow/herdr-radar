'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Load config from a synthetic directory before any plugin module can read it.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-attention-'));
fs.writeFileSync(path.join(directory, 'config.toml'), '');
const previousConfigDirectory = process.env.HERDR_PLUGIN_CONFIG_DIR;
process.env.HERDR_PLUGIN_CONFIG_DIR = directory;
let config;
try {
  config = require('../lib/config');
} finally {
  if (previousConfigDirectory === undefined) delete process.env.HERDR_PLUGIN_CONFIG_DIR;
  else process.env.HERDR_PLUGIN_CONFIG_DIR = previousConfigDirectory;
}
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

const hookPath = path.join(directory, 'title-hook.cjs');
fs.writeFileSync(
  hookPath,
  `let hidden = false;
module.exports = {
  hide(value) { hidden = value; },
  title(text, pane) { return hidden && pane === 'w1:p1' ? '[hidden]' : text; }
};
`,
);
const titleHook = require(hookPath);
const herdr = require('../lib/herdr');
const ipc = require('../lib/ipc');
const activity = require('../lib/activity');
const state = require('../lib/state');
const view = require('../lib/view');
const { Frame } = require('../lib/frame');

function fixture(t, agents) {
  const settings = {
    renderHook: hookPath,
    blockedHoldUntilAnswered: true,
    idleGraceMs: 0,
    rowLabel: 'title',
    preferPaneLabels: false,
    detailRows: false,
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, config[key]]));
  Object.assign(config, settings);
  t.after(() => {
    Object.assign(config, previous);
    titleHook.hide(false);
  });
  t.mock.method(herdr, 'agentsAsync', async () => agents);
  // This failed read cannot supply any text to the frame.
  t.mock.method(ipc, 'call', async () => null);
  t.mock.method(state, 'labels', async () => ({
    tabs: new Map(),
    workspaces: new Map([['w1', 'synthetic']]),
    parents: new Map(),
    worktrees: new Map(),
  }));
  t.mock.method(activity, 'load', () => new Map());
  t.mock.method(activity, 'recover', () => null);
  t.mock.method(activity, 'save', () => {});
  t.mock.method(view, 'mode', () => null);
  const rows = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    if (!rows.has(pane)) rows.set(pane, {});
    Object.assign(rows.get(pane), tokens);
    return true;
  });
  const frame = new Frame('synthetic');
  t.mock.method(frame.workspaceOrder, 'sync', async () => {});
  t.mock.method(frame, 'spaceJobs', () => {});
  t.mock.method(frame, 'groupJobs', async () => {});
  return { frame, rows };
}

function agent(pane = 'w1:p1', title = 'Synthetic task', tokens = {}) {
  return {
    pane_id: pane,
    terminal_id: 'synthetic-terminal-' + pane,
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    agent: 'attention',
    agent_status: 'blocked',
    terminal_title_stripped: title,
    tokens,
  };
}

test('a blocked row uses its attention token and rejects a stale token during an idle hold', async (t) => {
  const reason = 'word: Choose the synthetic option.';
  const agents = [agent('w1:p1', 'Synthetic task', { attention: reason }), agent('w1:p2', 'Other task')];
  const { frame, rows } = fixture(t, agents);
  frame.lastWorkingAt.set('w1:p1', 1000);
  await frame.render(10000);
  assert(rows.get('w1:p1').title_blocked.includes(reason));
  assert(!rows.get('w1:p2').title_blocked.includes(reason));

  agents[0].tokens = {};
  await frame.render(11000);
  assert(rows.get('w1:p1').title_blocked.includes('Synthetic task'));
  assert(!rows.get('w1:p1').title_blocked.includes(reason));

  agents[0].agent_status = 'idle';
  agents[0].tokens = { attention: reason };
  await frame.render(12000);
  assert(rows.get('w1:p1').title_blocked.includes('Synthetic task'));
  assert(!rows.get('w1:p1').title_blocked.includes(reason));

  agents[0].agent_status = 'working';
  await frame.render(13000);
  assert.equal(rows.get('w1:p1').title_blocked, null);
  assert(!rows.get('w1:p1').title_working.includes(reason));
});

test('a configured title hook hides attention text for its pane through render', async (t) => {
  const reason = 'word: Approve Synthetic private project?';
  const agents = [agent(), agent('w1:p2', 'Other task')];
  const { frame, rows } = fixture(t, agents);
  titleHook.hide(true);
  await frame.render(10000);
  assert(rows.get('w1:p1').title_blocked.includes('[hidden]'));

  agents[0].tokens = { attention: reason };
  agents[1].tokens = { attention: 'word: Other synthetic project?' };
  await frame.render(11000);
  assert(rows.get('w1:p1').title_blocked.includes('[hidden]'));
  assert(!rows.get('w1:p1').title_blocked.includes(reason));
  assert(rows.get('w1:p2').title_blocked.includes('Other synthetic project'));
});
