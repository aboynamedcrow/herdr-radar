'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const state = require('../lib/state');
const herdr = require('../lib/herdr');
const activity = require('../lib/activity');
const view = require('../lib/view');
const { Frame } = require('../lib/frame');
const { hostHeader } = require('../lib/host-icons');

const icons = { 'kafka-nimbus2000': '🧹', 'kafka-megatron': '' };

test('quoted host keys preserve multi-byte emoji and raw private-use values', () => {
  const parsed = config.parseToml('[host_icons]\n"kafka-nimbus2000" = "🧹"\n"kafka-megatron" = ""\n');
  assert.deepEqual(parsed.host_icons, icons);
  assert.equal(hostHeader('kafka-nimbus2000.local', parsed.host_icons)('project'), '🧹 project');
  assert.equal(hostHeader('kafka-megatron', parsed.host_icons)('project'), ' project');
});

test('host keys match exactly after removal of one trailing .local', () => {
  for (const host of ['KAFKA-NIMBUS2000', 'kafka-nimbus2000.local.local', 'kafka-nimbus2000.local.example']) {
    assert.equal(hostHeader(host, icons)('project'), 'project');
  }
  assert.equal(hostHeader('missing', icons)(null), null);
  assert.equal(hostHeader('toString', {})('project'), 'project');
  assert.equal(hostHeader('host', { host: 7 })('project'), 'project');
});

async function rows(t, headerText, entries, labels, grouped = true) {
  const sent = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, source, tokens) => {
    sent.push([pane, tokens]);
    return true;
  });
  const tree = { parentOf: new Map([['branch', 'project']]), headerText };
  if (grouped) await state.writeGroups('test', entries, labels, new Set(['branch']), tree);
  else await state.writeEntryHeaders('test', entries, labels, new Set(['branch']), tree);
  return sent;
}

const entries = ['project', 'other', 'branch'].map((workspace) => ({ pane: `${workspace}:p1`, workspace }));
const labels = new Map([
  ['project', 'project'],
  ['other', 'other'],
  ['branch', 'task'],
]);

test('grouped headers include the host icon on repeated parent and stale rows', async (t) => {
  const sent = new Map(await rows(t, hostHeader('kafka-nimbus2000.local', icons), entries, labels));
  assert.equal(sent.get('project:p1').group, '🧹 project');
  assert.equal(sent.get('other:p1').group, '🧹 other');
  assert.equal(sent.get('branch:p1').group_parent, '🧹 project');
  assert.match(sent.get('branch:p1').group_stale, /^🧹 └─ /);
  assert.equal(sent.get('branch:p1').group, null);
});

for (const grouped of [true, false]) {
  test(`missing host entries and absent tables preserve all ${grouped ? 'grouped' : 'native'} token bytes`, async (t) => {
    const baseline = JSON.stringify(await rows(t, undefined, entries, labels, grouped));
    assert.equal(JSON.stringify(await rows(t, hostHeader('missing', icons), entries, labels, grouped)), baseline);
    assert.equal(JSON.stringify(await rows(t, hostHeader('kafka-nimbus2000'), entries, labels, grouped)), baseline);
  });
}

test('a long native header reaches Herdr as one full token with the icon first', async (t) => {
  const long = 'A long workspace name '.repeat(20);
  const sent = new Map(
    await rows(t, hostHeader('kafka-nimbus2000', icons), entries, new Map([...labels, ['branch', long]]), false),
  );
  assert.equal(sent.get('branch:p1').group_stale, `🧹 project › ${long}`);
  assert.equal(Buffer.from(sent.get('branch:p1').group_stale).toString('utf8'), `🧹 project › ${long}`);
});

test('an injected host decorates native headers after title prefix trimming', async (t) => {
  t.mock.method(activity, 'load', () => new Map());
  t.mock.method(activity, 'save', () => {});
  t.mock.method(view, 'mode', () => 'grouped');
  t.mock.method(state, 'snapshot', async () => [
    { pane: 'w:p1', workspace: 'w', tab: 'w:t1', title: 'project: Fix sockets', status: 'idle', name: 'codex' },
  ]);
  t.mock.method(state, 'labels', async () => ({
    tabs: new Map(),
    workspaces: new Map([['w', 'project']]),
    parents: new Map(),
    worktrees: new Map(),
  }));
  t.mock.method(state, 'sweepOrphans', async () => true);
  const sent = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, source, tokens) => {
    sent.push(tokens);
    return true;
  });
  const frame = new Frame('test', { hostname: 'kafka-nimbus2000.local', hostIcons: icons });
  t.mock.method(frame.workspaceOrder, 'sync', async () => {});
  t.mock.method(frame, 'spaceJobs', () => {});
  await frame.render(10000);
  assert(sent.some((tokens) => tokens.group === '🧹 project'));
  assert(sent.some((tokens) => tokens.title_idle?.endsWith('Fix sockets')));
  assert(!sent.some((tokens) => tokens.title_idle?.includes('project')));

  sent.length = 0;
  view.mode = () => null;
  frame.members = '';
  await frame.render(11000);
  assert(sent.some((tokens) => tokens.group === '🧹 project'));
});
