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
  t.mock.method(herdr, 'agentsAsync', async () => agents.map((entry) => ({ ...entry, tokens: { ...entry.tokens } })));
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
    const entry = agents.find((entry) => entry.pane_id === pane);
    for (const [key, value] of Object.entries(tokens)) {
      if (value === null) delete entry.tokens[key];
      else entry.tokens[key] = value;
    }
    rows.set(pane, entry.tokens);
    return true;
  });
  function replacement() {
    const frame = new Frame('synthetic');
    t.mock.method(frame.workspaceOrder, 'sync', async () => {});
    t.mock.method(frame, 'spaceJobs', () => {});
    t.mock.method(frame, 'groupJobs', async () => {});
    return frame;
  }
  return { frame: replacement(), replacement, rows };
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

test('a blocked row uses its attention token across an idle hold and clears its title', async (t) => {
  const reason = 'word: Choose the synthetic option.';
  const agents = [agent('w1:p1', 'Synthetic task', { attention: reason }), agent('w1:p2', 'Other task')];
  const { frame, rows } = fixture(t, agents);
  frame.lastWorkingAt.set('w1:p1', 1000);
  await frame.render(10000);
  assert(rows.get('w1:p1').title_blocked.includes(reason));
  assert(!rows.get('w1:p2').title_blocked.includes(reason));

  delete agents[0].tokens.attention;
  await frame.render(11000);
  assert(rows.get('w1:p1').title_blocked.includes('Synthetic task'));
  assert(!rows.get('w1:p1').title_blocked.includes(reason));

  agents[0].agent_status = 'idle';
  agents[0].tokens.attention = reason;
  await frame.render(12000);
  assert(rows.get('w1:p1').title_blocked.includes(reason));

  agents[0].agent_status = 'working';
  delete agents[0].tokens.attention;
  await frame.render(13000);
  assert.equal(rows.get('w1:p1').title_blocked, undefined);
  assert(!rows.get('w1:p1').title_working.includes(reason));
});

test('an idle token row uses blocked priority and restores its normal title when cleared', async (t) => {
  const reason = 'word: Choose the synthetic option.';
  const agents = [agent('w1:p1', 'Synthetic task', { attention: reason }), agent('w1:p2', 'Other task')];
  agents[0].agent_status = 'idle';
  agents[0].agent = 'codex';
  agents[1].agent_status = 'working';
  agents[1].agent = 'codex';
  const { frame, rows } = fixture(t, agents);
  // Exercise the real workspace priority with mocked writes.
  frame.spaceJobs = Frame.prototype.spaceJobs;
  const spaces = new Map();
  t.mock.method(herdr, 'reportWorkspaceMetadataAsync', async (_workspace, _source, tokens) => {
    for (const [key, value] of Object.entries(tokens)) {
      if (value === null) spaces.delete(key);
      else spaces.set(key, value);
    }
    return true;
  });
  await frame.render(10000);
  assert(rows.get('w1:p1').title_blocked.includes(reason));
  assert(rows.get('w1:p1').state_blocked);
  assert(spaces.get('space_blocked'));
  // The metadata mock feeds only active tokens into each later snapshot.
  await frame.render(11000);
  delete agents[0].tokens.attention;
  await frame.render(12000);
  assert.equal(rows.get('w1:p1').title_blocked, undefined);
  assert(rows.get('w1:p1').title_idle.includes('Synthetic task'));
  assert.equal(spaces.get('space_blocked'), undefined);
  assert(spaces.get('space_working_other'));
  await frame.render(13000);
  assert.equal(rows.get('w1:p1').state_blocked, undefined);
  assert.equal(rows.get('w1:p1').radar_attention_only, undefined);
});

for (const clearBeforeSnapshot of [true, false]) {
  test(`a replacement Frame clears token attention ${clearBeforeSnapshot ? 'before' : 'after'} its first snapshot`, async (t) => {
    const pane = agent('w1:p1', 'Synthetic task', { attention: 'word: Choose an option.' });
    pane.agent_status = 'idle';
    const { frame, replacement } = fixture(t, [pane]);
    await frame.render(10000);
    assert(pane.tokens.state_blocked);
    assert.equal(pane.tokens.radar_attention_only, '1');
    if (clearBeforeSnapshot) delete pane.tokens.attention;
    const next = replacement();
    await next.render(11000);
    if (!clearBeforeSnapshot) {
      assert(pane.tokens.state_blocked);
      delete pane.tokens.attention;
    }
    await next.render(12000);
    await next.render(13000);
    assert(pane.tokens.state_idle);
    assert.equal(pane.tokens.state_blocked, undefined);
    assert.equal(pane.tokens.radar_attention_only, undefined);
    assert.equal(next.blockedSince.has(pane.pane_id), false);
  });
}

test('a replacement Frame recovers a native question while attention is present', async (t) => {
  const pane = agent();
  const { frame, replacement } = fixture(t, [pane]);
  frame.lastWorkingAt.set(pane.pane_id, 1000);
  await frame.render(10000);
  pane.agent_status = 'idle';
  await frame.render(11000);
  pane.tokens.attention = 'word: Choose an option.';
  await frame.render(12000);
  assert.equal(pane.tokens.radar_attention_only, undefined);
  const next = replacement();
  await next.render(13000);
  delete pane.tokens.attention;
  await next.render(14000);
  await next.render(15000);
  assert(pane.tokens.state_blocked);
  assert.equal(next.blockedSince.has(pane.pane_id), true);
  assert(pane.tokens.title_blocked.includes('Synthetic task'));
});

test('a configured title hook hides attention text for its pane through render', async (t) => {
  const reason = 'word: Approve Synthetic private project?';
  const agents = [agent(), agent('w1:p2', 'Other task')];
  const { frame, rows } = fixture(t, agents);
  titleHook.hide(true);
  await frame.render(10000);
  assert(rows.get('w1:p1').title_blocked.includes('[hidden]'));

  agents[0].tokens = { attention: reason };
  agents[0].agent_status = 'idle';
  agents[1].tokens = { attention: 'word: Other synthetic project?' };
  await frame.render(11000);
  assert(rows.get('w1:p1').title_blocked.includes('[hidden]'));
  assert(!rows.get('w1:p1').title_blocked.includes(reason));
  assert(rows.get('w1:p2').title_blocked.includes('Other synthetic project'));
});
