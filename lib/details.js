'use strict';

// Copy display values only. Agent Quota remains their collector and owner.
const tiers = ['normal', 'warning', 'danger', 'unknown'];
const ROWS = [
  ['quota_cache', 'quota_cache_ttl', 'quota_cache_state', 'quota_error'],
  ['quota_context', ...tiers.map((tier) => `quota_week_inline_${tier}`)],
  [...tiers.map((tier) => `quota_5h_${tier}`), ...tiers.map((tier) => `quota_week_${tier}`)],
];
const OWNED = ['rd_tab', ...ROWS.flat().map((name) => `rd_${name}`)];

function detailTokens(tab, values, width) {
  const prefix = width > 0 ? `\u200b${' '.repeat(width)}` : '';
  const tokens = Object.fromEntries(OWNED.map((name) => [name, null]));
  if (typeof tab === 'string' && tab.trim()) tokens.rd_tab = prefix + tab;
  for (const row of ROWS) {
    let first = true;
    for (const name of row) {
      const value = values[name];
      if (typeof value !== 'string' || !value.trim()) continue;
      tokens[`rd_${name}`] = (first ? prefix : '') + value;
      first = false;
    }
  }
  return tokens;
}

module.exports = { detailTokens, OWNED };
