// Config semantics: which keys make something run without being asked (hot), flattening,
// semantic diff between two parsed configs, and command extraction from any tool's config.
import path from 'node:path';
import { isInside } from './paths.mjs';
import { parseToml } from './toml.mjs';
import { HOME } from './tools.mjs';

// Configuration schemas evolve. Every semantic config change needs review: a list of
// known dangerous keys silently approves new execution settings. Object-key order and
// permission-list order are normalized below; ordinary documents remain minor changes.
export const CONFIG_KINDS = new Set([
  'claude-settings',
  'claude-mcp',
  'claude-global',
  'claude-plugins',
  'codex-config',
  'codex-hooks',
  'gemini-settings',
  'gemini-trust',
  'vscode-tasks',
  'vscode-settings',
  'vscode-launch',
  'devcontainer',
  'cursor-mcp',
  'cursor-hooks',
  'env',
]);
export const isHotKey = (kind, _key) => CONFIG_KINDS.has(kind);

// Parse by kind. Returns null when the file is not a config we read structurally.
export function parseConfig(kind, text) {
  if (kind === 'codex-config') return parseToml(text);
  if (kind === 'env') return envKeys(text);
  if (CONFIG_KINDS.has(kind)) return JSON.parse(stripJsonComments(text));
  return null;
}

// `.env` is hashed and its key NAMES are kept. Values are never stored anywhere.
function envKeys(text) {
  const keys = Object.create(null);
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) keys[m[1]] = true;
  }
  return keys;
}

// VS Code and Cursor JSON files allow comments and trailing commas.
function stripJsonComments(text) {
  return text
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_match, str) => str || '')
    .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (_match, str, tail) => str || tail);
}

// Only permission lists are sets. Argument and notification arrays are ordered programs:
// changing [script, argument] to [argument, script] must change the fingerprint comparison.
export function flatten(value, prefix = '', acc = new Map()) {
  if (Array.isArray(value)) {
    if (
      /^permissions\.(allow|deny|ask)$/.test(prefix) &&
      value.every((v) => v === null || typeof v !== 'object')
    ) {
      for (const v of value) acc.set(`${prefix}[]=${typeof v === 'string' ? v : JSON.stringify(v)}`, 'true');
    } else {
      if (!value.length) acc.set(prefix || '(root)', '[]');
      value.forEach((v, i) => {
        flatten(v, `${prefix}[${i}]`, acc);
      });
    }
  } else if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) acc.set(prefix || '(root)', '{}');
    for (const k of keys) {
      const segment = /[.[\]\\"]/.test(k) ? JSON.stringify(k) : k;
      flatten(value[k], prefix ? `${prefix}.${segment}` : segment, acc);
    }
  } else acc.set(prefix || '(root)', JSON.stringify(value));
  return acc;
}

// Semantic diff: every changed key, each tagged hot or not.
export function semanticDiff(kind, before, after) {
  const a = flatten(before);
  const b = flatten(after);
  const changes = [];
  for (const [k, v] of b) if (!a.has(k)) changes.push({ key: k, from: null, to: v });
  for (const [k, v] of a) {
    if (!b.has(k)) changes.push({ key: k, from: v, to: null });
    else if (b.get(k) !== v) changes.push({ key: k, from: v, to: b.get(k) });
  }
  for (const c of changes) c.hot = isHotKey(kind, c.key);
  return changes.sort((x, y) => Number(y.hot) - Number(x.hot) || x.key.localeCompare(y.key));
}

const COMMAND_KEYS = new Set([
  'command',
  'apiKeyHelper',
  'awsAuthRefresh',
  'awsCredentialExport',
  'headersHelper',
  'otelHeadersHelper',
  'notify',
  // A dev container runs all six by opening the folder; initializeCommand runs on the host.
  'initializeCommand',
  'onCreateCommand',
  'updateContentCommand',
  'postCreateCommand',
  'postStartCommand',
  'postAttachCommand',
  // launch.json: the program a debug configuration starts, and the task it chains first.
  'program',
  'runtimeExecutable',
  'preLaunchTask',
  'postDebugTask',
]);

// Every string that a tool would hand to a shell, with where it came from.
export function extractCommands(parsed, where = '', acc = []) {
  if (Array.isArray(parsed)) {
    parsed.forEach((v, i) => {
      extractCommands(v, `${where}[${i}]`, acc);
    });
  } else if (parsed && typeof parsed === 'object') {
    for (const [k, v] of Object.entries(parsed)) {
      const here = where ? `${where}.${k}` : k;
      if (COMMAND_KEYS.has(k) && typeof v === 'string') {
        const args = Array.isArray(parsed.args) ? parsed.args.filter((x) => typeof x === 'string') : [];
        acc.push({ where: here, command: [v, ...args].join(' '), matcher: parsed.matcher, node: parsed });
      } else if (COMMAND_KEYS.has(k) && Array.isArray(v))
        acc.push({
          where: here,
          command: v
            .filter((x) => typeof x === 'string')
            .map(JSON.stringify)
            .join(' '),
          node: parsed,
        });
      else if (k !== 'args') extractCommands(v, here, acc);
    }
  }
  return acc;
}

const SCRIPT_EXT = /\.(sh|bash|zsh|mjs|cjs|js|ts|py|rb|pl|php)$/i;

// File paths a command string points at, resolved against the repo root.
export function referencedPaths(command, root, pluginRoot) {
  const home = HOME;
  // Tokenize before expanding directories, preserving quoted spaces and adjacent quoted /
  // unquoted pieces. This is static path discovery, never shell evaluation.
  const tokens = command.match(/(?:"[^"]*"|'[^']*'|[^\s;|&<>"'])+/g) || [];
  const found = [];
  for (let tok of tokens) {
    tok = tok
      .replace(/["']/g, '')
      .replace(/\$(?:\{CLAUDE_PROJECT_DIR\}|CLAUDE_PROJECT_DIR\b)/g, () => root)
      .replace(/\$(?:\{HOME\}|HOME\b)/g, () => home)
      .replace(/\$(?:\{CLAUDE_PLUGIN_ROOT\}|CLAUDE_PLUGIN_ROOT\b)/g, () => pluginRoot || '/__plugin_root__');
    if (tok.startsWith('-') || tok.startsWith('/__plugin_root__')) continue;
    if (!(tok.includes('/') || SCRIPT_EXT.test(tok))) continue;
    if (/^[a-z]+:\/\//i.test(tok)) continue;
    const abs = tok.startsWith('~/') ? path.join(home, tok.slice(2)) : path.resolve(root, tok);
    found.push({ token: tok, abs, inside: abs === root || isInside(root, abs) });
  }
  return found;
}
