'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detailTokens } = require('../lib/details');

test('details nest below the agent and preserve quota row colors', () => {
  const tokens = detailTokens(
    'Crew',
    {
      quota_cache: 'cache 90%',
      quota_cache_ttl: 'ttl≈20m',
      quota_context: 'context 20%',
      quota_week_inline_warning: '7d 70%',
    },
    4,
  );
  assert.equal(tokens.rd_tab, '\u200b    Crew');
  assert.equal(tokens.rd_quota_cache, '\u200b    cache 90%');
  assert.equal(tokens.rd_quota_cache_ttl, 'ttl≈20m');
  assert.equal(tokens.rd_quota_context, '\u200b    context 20%');
  assert.equal(tokens.rd_quota_week_inline_warning, '7d 70%');
});

test('missing first cells do not lose indentation or leave stale values', () => {
  const tokens = detailTokens('Review', { quota_week_danger: '7d 95%' }, 2);
  assert.equal(tokens.rd_quota_week_danger, '\u200b  7d 95%');
  assert.equal(tokens.rd_quota_5h_normal, null);
  assert.equal(tokens.rd_quota_cache, null);
  assert.equal(detailTokens('', {}, 0).rd_tab, null);
  assert.equal(detailTokens('Crew', {}, 0).rd_tab, 'Crew');
});

test('one frame updates detail values and a changed tab key without a pane activity change', async () => {
  const herdr = require('../lib/herdr');
  const activity = require('../lib/activity');
  const config = require('../lib/config');
  const writes = [];
  const saved = [herdr.reportMetadataAsync, activity.load, config.detailRows];
  herdr.reportMetadataAsync = async (pane, source, tokens) => {
    writes.push(tokens);
    return true;
  };
  activity.load = () => new Map();
  config.detailRows = true;
  try {
    const { Frame } = require('../lib/frame');
    const frame = new Frame('test');
    const entry = {
      pane: 'w1:p1',
      workspace: 'w1',
      tab: 'w1:t1',
      name: 'claude',
      title: 'Review',
      tokens: { quota_5h_normal: '5h 20%' },
    };
    const keys = {
      minuteKey: () => '001',
      wsKeys: new Map([['w1', '001-w1']]),
      tabKeys: new Map([['w1:p1', '001-tab']]),
    };
    const input = { tabs: new Map([['w1:t1', 'Crew']]), keys, indent: '', spinStep: 0, detailWidth: 2 };
    let jobs = [];
    frame.paneJobs(entry, 'idle', input, 1, [], jobs);
    await Promise.all(jobs);
    assert(writes.some((w) => w.rd_quota_5h_normal === '\u200b  5h 20%'));
    writes.length = 0;
    entry.tokens = { quota_5h_danger: '5h 95%' };
    keys.tabKeys.set('w1:p1', '002-tab');
    jobs = [];
    frame.paneJobs(entry, 'idle', input, 2, [], jobs);
    await Promise.all(jobs);
    assert(writes.some((w) => w.rd_quota_5h_normal === null));
    assert(writes.some((w) => w.rd_quota_5h_danger === '\u200b  5h 95%'));
    assert(writes.some((w) => w.tab_key === '002-tab'));
  } finally {
    [herdr.reportMetadataAsync, activity.load, config.detailRows] = saved;
  }
});
