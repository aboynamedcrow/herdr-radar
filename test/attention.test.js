'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const herdr = require('../lib/herdr');
const ipc = require('../lib/ipc');
const activity = require('../lib/activity');
const state = require('../lib/state');
const view = require('../lib/view');
const { Frame } = require('../lib/frame');

test('a blocked row uses its attention token without a screen read and clears it on release', async (t) => {
  const reason = 'word: Choose the synthetic option.';
  const agents = [
    {
      pane_id: 'w1:p1',
      terminal_id: 'synthetic-terminal',
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      agent: 'attention',
      agent_status: 'blocked',
      terminal_title_stripped: 'Synthetic task',
      tokens: { attention: reason },
    },
    {
      pane_id: 'w1:p2',
      terminal_id: 'other-terminal',
      workspace_id: 'w1',
      tab_id: 'w1:t2',
      agent: 'codex',
      agent_status: 'blocked',
      terminal_title_stripped: 'Other task',
      tokens: {},
    },
  ];
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
  const sent = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.push({ pane, tokens });
    return true;
  });
  const frame = new Frame('synthetic');
  t.mock.method(frame.workspaceOrder, 'sync', async () => {});
  t.mock.method(frame, 'spaceJobs', () => {});
  t.mock.method(frame, 'groupJobs', async () => {});
  await frame.render(10000);
  const written = (pane) => Object.assign({}, ...sent.filter((w) => w.pane === pane).map((w) => w.tokens));
  assert(written('w1:p1').title_blocked.includes(reason));
  assert(!written('w1:p2').title_blocked.includes(reason));
  sent.length = 0;
  agents[0].tokens = {};
  await frame.render(11000);
  assert(written('w1:p1').title_blocked.includes('Synthetic task'));
  assert(!written('w1:p1').title_blocked.includes(reason));
  sent.length = 0;
  agents[0].agent_status = 'working';
  agents[0].tokens = { attention: reason };
  await frame.render(12000);
  assert.equal(written('w1:p1').title_blocked, null);
  assert(!written('w1:p1').title_working.includes(reason));
});
