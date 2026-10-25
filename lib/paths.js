'use strict';

// Where this plugin's files live: Herdr's config file, Herdr's state
// directory, and the plugin's own state directory inside it.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');

const identity = require('./identity');

// Herdr injects the plugin id into every command it runs; the fallback covers
// a bare shell run of the same scripts.
function pluginId() {
  return process.env.HERDR_PLUGIN_ID ?? identity.PLUGIN_ID;
}

// Resolve socket aliases before selecting the server's runtime directory.
function canonical(file) {
  const absolute = path.resolve(file);
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    const parent = path.dirname(absolute);
    return parent === absolute ? absolute : path.join(canonical(parent), path.basename(absolute));
  }
}

function socketFile() {
  return process.env.HERDR_SOCKET_PATH ?? path.join(path.dirname(herdrConfigPath()), 'herdr.sock');
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

// Pane IDs, locks and controls belong to one server. The explicit override
// remains exact for callers that already allocate their own state directory.
const stateBase = process.env.HERDR_PLUGIN_STATE_DIR ?? path.join(herdrStateDir(), 'plugins', pluginId());
const stateRoot = identity.env('STATE') ?? path.join(stateBase, 's', digest(canonical(socketFile())));

// Which Herdr session this process talks to, as a path-safe suffix.
//
// Herdr gives every session the same HERDR_PLUGIN_STATE_DIR, but a named
// session runs its own server on its own socket. The daemon keys its lock and
// its control endpoint off the state directory, so with one directory the
// second session's `state-start` finds the first session's daemon healthy and
// exits — and that daemon reports through the FIRST session's socket. The
// second session then shows a sidebar with no labels at all, because the rows
// are built from tokens only the daemon writes (#25).
//
// Named sockets live at <config>/herdr/sessions/<name>/herdr.sock, the default
// session's sits one level up. An empty suffix for the default session keeps
// every existing path exactly where it is, so nothing has to migrate.
function sessionSuffix() {
  const socket = process.env.HERDR_SOCKET_PATH;
  if (!socket) return '';
  // Normalise first: `<config>/herdr/sessions/../herdr.sock` names the default
  // session's socket, and reading its segments raw would call the session `..`
  // and build a directory out of it.
  const dir = path.dirname(path.normalize(socket));
  if (path.basename(path.dirname(dir)) !== 'sessions') return '';
  const name = path.basename(dir);
  if (name === '.' || name === '..') return '';
  // Keep it to characters every filesystem and the Windows pipe namespace
  // accept; a session name is user-chosen.
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return safe ? `-${safe}` : '';
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Callers degrade to "no data" rather than failing a render.
  }
  return dir;
}

// Herdr's shared config file. A client's grouped/priority choice can differ
// from its base setting. Do not use this file to infer the client choice.
// `XDG_CONFIG_HOME` wins everywhere, Windows included — Herdr honours it there
// too (its socket lands next to the config it actually read, which is how this
// was caught). Assuming `%APPDATA%` on win32 meant writing theme and sidebar
// blocks into a file Herdr never reads: the managed blocks looked correct on
// disk, the sidebar kept rendering yesterday's colours, and a desktop that had
// gone dark hours earlier never took. Falling back to `%APPDATA%` only when the
// variable is unset keeps the old machines working.
function herdrConfigPath() {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, 'herdr', 'config.toml');
  const base =
    process.platform === 'win32'
      ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
      : path.join(os.homedir(), '.config');
  return path.join(base, 'herdr', 'config.toml');
}

// Herdr's own state directory — where it caches downloaded detection
// manifests. NOT the config directory (its config.rs keeps state_dir and
// config_dir apart), and a different XDG variable governs it.
function herdrStateDir() {
  if (process.env.XDG_STATE_HOME) return path.join(process.env.XDG_STATE_HOME, 'herdr');
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'herdr');
  }
  return path.join(os.homedir(), '.local', 'state', 'herdr');
}

// A plugin's config directory, for scripts Herdr did not start (a bare shell
// run, a key binding): Herdr only injects HERDR_PLUGIN_CONFIG_DIR into plugin
// commands, and the layout is <config root>/plugins/config/<plugin id>.
function pluginConfigDir(pluginId) {
  return path.join(path.dirname(herdrConfigPath()), 'plugins', 'config', pluginId);
}

// Keep the old fork's runtime paths. Each socket already has its own stateRoot.
// Moving a named session into another directory would orphan its old daemon.
const runtimeRoot = stateRoot;

// The tab-bar line, one file per session. With a daemon per session, one
// shared file had two writers, and a session's tab bar showed the other
// session's directory until its own line next changed.
//
// The name comes from HERDR_SESSION, not the socket, because the reader is the
// status command in config.toml — one file for every session — and the shell
// it runs in can test a variable but cannot parse a path. Herdr sets the
// variable in a named session's server, and every process it starts inherits
// it: our hooks, so the daemon, and the status command. The default session's
// server never has it (Herdr drops `default` too), so its file keeps the name
// it has always had. A session name is [A-Za-z0-9._-] (Herdr validates it),
// safe in a file name and inside cmd's and sh's quotes alike.
function tabbarCache(session = process.env.HERDR_SESSION) {
  const named = session && session !== 'default' && /^[A-Za-z0-9._-]+$/.test(session);
  return path.join(stateRoot, named ? `tabbar-${session}.txt` : 'tabbar.txt');
}

module.exports = {
  pluginId,
  socketFile,
  canonical,
  digest,
  pluginConfigDir,
  stateRoot,
  runtimeRoot,
  sessionSuffix,
  tabbarCache,
  ensureDir,
  herdrConfigPath,
  herdrStateDir,
  logPath: path.join(stateRoot, 'tab-bar.log'),
};
