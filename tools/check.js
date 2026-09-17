#!/usr/bin/env node
'use strict';

// `npm run check`: the declaration files agree with lib/identity.js, and every
// script parses. No test runner needed for a zero-dependency plugin.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const problems = require('../lib/identity').verify(root);
for (const dir of ['bin', 'lib']) {
  for (const file of fs.readdirSync(path.join(root, dir))) {
    if (!file.endsWith('.js')) continue;
    try {
      execFileSync(process.execPath, ['--check', path.join(root, dir, file)], { stdio: 'pipe' });
    } catch (error) {
      problems.push(`${dir}/${file}: ${String(error.stderr).trim().split('\n')[0]}`);
    }
  }
}
// The tab-bar block's poll interval has to stay above its timeout. Inverted, a
// slow tick is still running when the next one starts, and on Windows every tick
// is a fresh `cmd.exe`: the overlap compounds until the machine stops
// responding. That happened. It is two numbers on one generated line — exactly
// the pair that drifts — so read them back out of the text that gets written.
const tabBar = require('../lib/managed-config').block();
const timings = /interval_seconds = (\d+), timeout_seconds = (\d+)/.exec(tabBar);
if (!timings) {
  problems.push('tab-bar block: no longer states an interval and a timeout');
} else if (Number(timings[1]) <= Number(timings[2])) {
  problems.push(
    `tab-bar block: interval_seconds (${timings[1]}) must be greater than timeout_seconds ` +
      `(${timings[2]}); overlapping ticks pile up processes`,
  );
}

// Nothing we write into a terminal's config may set that terminal's primary
// font. Our font holds icons and nothing else, so claiming the primary slot
// sends every ordinary character to a font that cannot draw it and the terminal
// falls back to something the user never picked. Ghostty's `font-family` and
// kitty's `font_family` both do exactly that; only the per-codepoint
// redirections belong in the block. Reported in #4.
const claimsPrimaryFont = /^\s*(font-family|font_family)[\s=]/;
for (const terminal of require('../lib/font').TERMINALS) {
  const line = terminal.lines.find((text) => claimsPrimaryFont.test(text));
  if (line) {
    problems.push(
      `${terminal.name} block: sets the terminal's primary font (${line.trim()}); ` +
        'map our codepoints instead, our font has only icons',
    );
  }
}

// Every colour the sidebar writes has to stay readable on the panel behind it.
//
// Herdr's themes all set `sidebar_bg: Color::Reset`, so the panel is whatever
// the host terminal paints and no value here can know it. The reference panels
// below stand in for it: two real ones this was measured against. They are a
// backstop, not a target — the shipped values clear the floor with room to
// spare, and the point is that a future edit cannot quietly drop below it.
//
// This exists because a value did. `idleStale` was #585a64, which is 2.6:1 on
// a dark panel and capped at 3.06:1 against any background at all, and every
// cell wearing it also asked for the terminal's `dim` — a switch, not a value,
// answered with a third of the way to the background by one terminal and half
// by another. It rendered at 1.8:1 and 1.5:1: present, drawn, unreadable.
// Nothing checked. Reported in #5.
const PANELS = { light: '#eff1f5', dark: '#191724' };
// WCAG's large/bold threshold. Sidebar labels are short and mostly bold; the
// floor is here to catch inks that cannot be read at all, not to force body
// text ratios onto a tier whose job is to recede.
const CONTRAST_FLOOR = 3;

const channel = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Marks, not prose. A vendor's logo is a shape first: coral at 2.8:1 still
// reads as that glyph in that colour, and the Spaces list's "no agent" dot is
// a dot. The floor is about text that cannot be read, so it is scored against
// the inks that carry text and not against these. (Several of the brand values
// are below 3:1 on a light panel, which the palette's own comment claims they
// clear — true of the table as a whole against a darker light panel than the
// reference here, and worth its own look, but not this check's business.)
const palette = require('../lib/palette');
const markColours = new Set([...Object.values(palette.brand), palette.state.none]);

const managed = require('../lib/managed-config');
for (const [variant, panel] of Object.entries(PANELS)) {
  const text = managed.sidebarBlock(variant);
  // `dim` asks the terminal to fade an ink by an amount it chooses and we
  // cannot measure. Whatever fade a cell needs belongs in its colour.
  if (/dim = true/.test(text)) {
    problems.push(`sidebar block (${variant}): asks for the terminal's dim; put the fade in the colour`);
  }
  for (const colour of new Set(text.match(/#[0-9a-f]{6}/g) ?? [])) {
    if (markColours.has(colour)) continue;
    const ratio = contrast(colour, panel);
    if (ratio < CONTRAST_FLOOR) {
      problems.push(
        `sidebar block (${variant}): ${colour} is ${ratio.toFixed(2)}:1 on ${panel}, ` +
          `under the ${CONTRAST_FLOOR}:1 floor`,
      );
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('ok');
