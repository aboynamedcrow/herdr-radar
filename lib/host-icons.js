'use strict';

// The daemon supplies its host once. Keep workspace labels unchanged for
// prefix trimming and decorate only the final header text.
function hostHeader(hostname, icons = {}) {
  const host = hostname.replace(/\.local$/, '');
  const icon = Object.prototype.hasOwnProperty.call(icons, host) ? icons[host] : '';
  if (typeof icon !== 'string' || !icon) return (text) => text;
  // Herdr measures and clips this single token in display columns for each
  // client. No byte or UTF-16 cut here can split the icon.
  return (text) => (text === null || text === undefined ? text : `${icon} ${text}`);
}

module.exports = { hostHeader };
