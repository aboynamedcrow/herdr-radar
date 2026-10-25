'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const herdr = require('../lib/herdr');
const state = require('../lib/state');
const config = require('../lib/config');

// Capture only the metadata transport. The real group writer builds the rows.
async function rowsFor(order, tree, stale = new Set()) {
  const saved = [herdr.reportMetadataAsync, config.groupGap];
  const rows = new Map();
  herdr.reportMetadataAsync = async (pane, source, tokens) => {
    rows.set(pane.split(':')[0], tokens);
    return true;
  };
  config.groupGap = true;
  try {
    await state.writeGroups(
      'test',
      order.map((workspace) => ({ workspace, pane: `${workspace}:p1` })),
      new Map([
        ['dot', 'dot'],
        ['other', 'Other repo'],
        ['task', 'Sidebar task'],
        ['sibling', 'Second task'],
      ]),
      stale,
      tree,
    );
    return rows;
  } finally {
    [herdr.reportMetadataAsync, config.groupGap] = saved;
  }
}

test('a separated worktree repeats its parent header in native workspace order', async () => {
  const tree = { parentOf: new Map([['task', 'dot']]) };
  const rows = await rowsFor(['dot', 'other', 'task'], tree);
  assert.equal(rows.get('task').group_parent, 'dot');
  assert.match(rows.get('task').group, /^└─ .*Sidebar task$/);
  assert.equal(rows.get('other').gap, '\u200b');
  assert.equal(tree.parentOf.get('task'), 'dot');
});

test('adjacent worktrees share one header and one trailing gap', async () => {
  const tree = {
    parentOf: new Map([
      ['task', 'dot'],
      ['sibling', 'dot'],
    ]),
  };
  const rows = await rowsFor(['dot', 'task', 'sibling', 'other'], tree);
  assert.equal(rows.get('task').group_parent, null);
  assert.equal(rows.get('sibling').group_parent, null);
  assert.match(rows.get('task').group, /├─ /);
  assert.match(rows.get('sibling').group, /└─ /);
  assert.equal(rows.get('dot').gap, null);
  assert.equal(rows.get('task').gap, null);
  assert.equal(rows.get('sibling').gap, '\u200b');
});

test('each separated family block closes its own branch', async () => {
  const tree = {
    parentOf: new Map([
      ['task', 'dot'],
      ['sibling', 'dot'],
    ]),
  };
  const rows = await rowsFor(['dot', 'task', 'other', 'sibling'], tree, new Set(['sibling']));
  assert.match(rows.get('task').group, /└─ /);
  assert.equal(rows.get('sibling').group_parent, 'dot');
  assert.equal(rows.get('sibling').group, null);
  assert.match(rows.get('sibling').group_stale, /^└─ .*Second task$/);
});

test('a worktree with no parent agent retains its repository header', async () => {
  const rows = await rowsFor(['task'], { orphanRepo: new Map([['task', 'dot']]) });
  assert.equal(rows.get('task').group_parent, 'dot');
  assert.match(rows.get('task').group, /^└─ .*Sidebar task$/);
});
