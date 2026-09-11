import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeTool, withPath } from './fake-tool.mjs';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lock-security-')));
for (const key of Object.keys(process.env)) if (key.startsWith('AGENT_LOCK_')) delete process.env[key];
process.env.HOME = path.join(tmp, 'home');
process.env.AGENT_LOCK_HOME = path.join(tmp, 'state');
process.env.CLAUDE_CONFIG_DIR = path.join(process.env.HOME, '.claude');
process.env.CODEX_HOME = path.join(process.env.HOME, '.codex');
delete process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
fs.mkdirSync(process.env.HOME);
const CLI = fileURLToPath(new URL('../agent-lock.mjs', import.meta.url));
const { inventoryCheckout, inventoryHome, LIMITS } = await import('../lib/inventory.mjs');
const { compare, seal, sealedEntry, snapshotDir, snapshotText } = await import('../lib/manifest.mjs');
const { parseConfig, semanticDiff } = await import('../lib/semantic.mjs');
const { parseToml } = await import('../lib/toml.mjs');
const { isInside, shellQuote } = await import('../lib/paths.mjs');
const { runnable } = await import('../lib/spawn.mjs');
const { bundle } = await import('../lib/bundle.mjs');
const { visible } = await import('../lib/ui.mjs');
const { assertCheckerIsolation, agentCheck } = await import('../lib/check.mjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(tmp, 'repo-'));
  fs.mkdirSync(path.join(root, '.git'));
  return root;
}
function write(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
const cli = (root, args, env = {}) =>
  spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    input: '',
    timeout: 10_000,
  });
const changed = (root) => {
  const inv = inventoryCheckout(root);
  return compare(sealedEntry(inv), inv);
};

test('TOML prototype paths fail closed and leave other objects untouched', () => {
  for (const text of [
    '[__proto__]\nauditCanary = true',
    'constructor.prototype.auditCanary = true',
    'x = { __proto__.auditCanary = true }',
  ])
    assert.throws(() => parseToml(text), /prototype/);
  assert.equal({}.auditCanary, undefined);
});

test('JSONC preserves command strings containing comma-brace sequences', () => {
  const command = 'printf ",}"; printf ",]"';
  const source = `${JSON.stringify({ apiKeyHelper: command }).slice(0, -1)}, /* comment */ }`;
  assert.equal(parseConfig('claude-settings', source).apiKeyHelper, command);
  assert.ok(
    semanticDiff('claude-settings', { apiKeyHelper: 'echo ,}' }, { apiKeyHelper: 'echo }' }).some(
      (x) => x.hot
    )
  );
});

test('command argument and notification order and duplicates are security-relevant', () => {
  for (const kind of ['claude-mcp', 'codex-config']) {
    const key = kind === 'claude-mcp' ? 'mcpServers' : 'mcp_servers';
    const before = { [key]: { tool: { command: 'node', args: ['safe.js', 'other.js'] } } };
    for (const args of [
      ['other.js', 'safe.js'],
      ['safe.js', 'other.js', 'other.js'],
    ])
      assert.ok(
        semanticDiff(kind, before, { [key]: { tool: { command: 'node', args } } }).some((x) => x.hot)
      );
  }
  assert.ok(
    semanticDiff('codex-config', { notify: ['safe', 'other'] }, { notify: ['other', 'safe'] }).some(
      (x) => x.hot
    )
  );
});

test('permission grants and removal of restrictions always require approval', () => {
  for (const [before, afterConfig] of [
    [{}, { permissions: { allow: ['Bash(curl:*)'] } }],
    [{ permissions: { deny: ['Read(.env)'] } }, {}],
  ])
    assert.ok(semanticDiff('claude-settings', before, afterConfig).some((x) => x.hot));
  assert.equal(
    semanticDiff(
      'claude-settings',
      { permissions: { allow: ['Read(a)', 'Read(b)'] } },
      { permissions: { allow: ['Read(b)', 'Read(a)'] } }
    ).length,
    0
  );
});

test('new config keys and dotted JSON keys cannot bypass change detection', () => {
  assert.ok(semanticDiff('claude-settings', {}, { futureExecutionOption: 'echo canary' }).some((x) => x.hot));
  assert.ok(
    semanticDiff('claude-settings', { 'env.PATH': '/first' }, { env: { PATH: '/first' } }).some((x) => x.hot)
  );
});

test('project directory expansions preserve spaces in referenced paths', () => {
  const root = path.join(fixture(), 'folder with spaces');
  fs.mkdirSync(root);
  write(
    root,
    '.claude/settings.json',
    JSON.stringify({ apiKeyHelper: 'node "$CLAUDE_PROJECT_DIR"/check.js' })
  );
  write(root, 'check.js', 'console.log("canary")');
  assert.ok(inventoryCheckout(root).files.some((f) => f.rel === 'check.js' && f.kind === 'script'));
});

test('plugin scripts remain watched when only a project enables the plugin', () => {
  const plugin = path.join(tmp, 'installed plugin');
  write(
    plugin,
    'hooks/hooks.json',
    JSON.stringify({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal plugin expansion under test
      hooks: { SessionStart: [{ hooks: [{ command: 'node "${CLAUDE_PLUGIN_ROOT}/run.js"' }] }] },
    })
  );
  write(plugin, 'run.js', 'console.log("before")');
  const catalog = path.join(process.env.CLAUDE_CONFIG_DIR, 'plugins/installed_plugins.json');
  write(
    process.env.HOME,
    path.relative(process.env.HOME, catalog),
    JSON.stringify({ plugins: { 'fixture@local': [{ installPath: plugin }] } })
  );
  const inv = inventoryHome();
  assert.ok(inv.files.some((f) => f.abs === path.join(plugin, 'run.js') && f.kind === 'script'));
  seal(inv);
  write(plugin, 'run.js', 'console.log("after")');
  const next = inventoryHome();
  assert.ok(compare(sealedEntry(next), next).hot);
  fs.rmSync(catalog);
});

test('deleting security configuration is hot', () => {
  const root = fixture();
  write(root, '.claude/settings.json', '{"permissions":{"deny":["Bash"]}}');
  seal(inventoryCheckout(root));
  fs.rmSync(path.join(root, '.claude/settings.json'));
  assert.ok(changed(root).hot);
  assert.equal(cli(root, ['verify']).status, 1);
});

test('changing an existing dangerous dotenv value is hot and values stay private', () => {
  const root = fixture();
  write(root, '.env', 'ANTHROPIC_BASE_URL=https://first.invalid\nTOKEN=fixture-private-alpha\n');
  seal(inventoryCheckout(root));
  write(root, '.env', 'ANTHROPIC_BASE_URL=https://second.invalid\nTOKEN=fixture-private-beta\n');
  const inv = inventoryCheckout(root);
  const cmp = compare(sealedEntry(inv), inv);
  assert.ok(cmp.hot);
  const sent = bundle(inv, cmp).text;
  assert.ok(!sent.includes('fixture-private-') && !sent.includes('second.invalid'));
  assert.equal(inv.files[0].text, null);
  seal(inv);
  assert.ok(!snapshotText(inv, '.env').includes('fixture-private-'));
});

test('dotenv files referenced as scripts or placed in config subfolders stay private', () => {
  const root = fixture();
  write(root, '.claude/settings.json', '{"apiKeyHelper":"cat .env.production"}');
  write(root, '.env.production', 'TOKEN=fixture-private-alpha');
  write(root, '.codex/nested/.env.local', 'TOKEN=fixture-private-beta');
  const inv = inventoryCheckout(root);
  assert.equal(inv.files.filter((f) => f.secret).length, 2);
  assert.ok(!JSON.stringify(inv.flags).includes('fixture-private-'));
  assert.ok(!bundle(inv).text.includes('fixture-private-'));
  seal(inv);
  for (const f of inv.files.filter((f) => f.secret))
    assert.ok(!snapshotText(inv, f.rel).includes('fixture-private-'));
});

test('snapshot labels cannot escape their private directory', () => {
  const root = fixture();
  const inv = inventoryCheckout(root);
  const rel = '../../outside-canary';
  inv.files.push({ rel, kind: 'doc', text: 'benign canary', sha256: 'fixture', size: 13, symlink: null });
  seal(inv);
  assert.equal(snapshotText(inv, rel), 'benign canary');
  assert.equal(fs.existsSync(path.resolve(snapshotDir(root), rel)), false);
});

test('inventory limits refuse instead of silently omitting executable config', () => {
  const root = fixture();
  for (let i = 0; i < 4; i++) write(root, `.claude/${i}.md`, 'note');
  const old = LIMITS.files;
  try {
    LIMITS.files = 2;
    assert.throws(() => inventoryCheckout(root), /file limit/);
  } finally {
    LIMITS.files = old;
  }
  write(root, `.codex/${'nested/'.repeat(LIMITS.depth + 1)}hooks.json`, '{}');
  assert.throws(() => inventoryCheckout(root), /depth limit/);
});

test('a symlinked config directory cannot disappear from the inventory', () => {
  const root = fixture();
  write(root, 'payload/settings.json', '{"apiKeyHelper":"echo canary"}');
  fs.symlinkSync(
    path.join(root, 'payload'),
    path.join(root, '.claude'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(() => inventoryCheckout(root), /real directory/);
  assert.equal(cli(root, ['verify']).status, 3);
});

test('FIFO inputs cannot block the gate while it tries to hash them', {
  skip: process.platform === 'win32' ? 'POSIX named pipes only' : false,
}, () => {
  const root = fixture();
  spawnSync('mkfifo', [path.join(root, '.env')]);
  const r = cli(root, ['verify']);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /non-regular/);
});

test('command references with spaces and dot-prefixed sibling names stay watched', () => {
  const root = fixture();
  write(
    root,
    '.claude/settings.json',
    JSON.stringify({ apiKeyHelper: 'node "folder with spaces/check.js"' })
  );
  write(root, 'folder with spaces/check.js', 'console.log("canary")');
  write(root, '..local/check.js', 'console.log("canary")');
  assert.ok(isInside(root, path.join(root, '..local/check.js')));
  assert.ok(
    inventoryCheckout(root).files.some((f) => f.rel === 'folder with spaces/check.js' && f.kind === 'script')
  );
});

test('shell path quoting cannot execute command substitutions', {
  skip: process.platform === 'win32' ? 'POSIX shell only' : false,
}, () => {
  const marker = path.join(tmp, 'shell-canary');
  const value = `folder $(touch ${marker}) with 'quotes' and \`backticks\``;
  const r = spawnSync('/bin/sh', ['-c', `printf '%s' ${shellQuote(value)}`], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, value);
  assert.equal(fs.existsSync(marker), false);
});

test('every Windows batch launch path rejects unsafe arguments before spawning', () => {
  for (const args of [['say "hi"&echo canary'], ['line1\nline2'], ['a', 'x\ry']])
    assert.throws(() => runnable('C:\\bin\\tool.cmd', args, true), /unsafe/);
  assert.throws(() => runnable('C:\\%VAR%\\tool.cmd', [], true), /unsafe/);
});

test('terminal inspection renders screen and clipboard escapes visibly', () => {
  const text = visible('name\x1b[2J\x1b]52;c;payload\x07\r\u202E');
  for (const ch of ['\x1b', '\x07', '\r', '\u202E']) assert.ok(!text.includes(ch));
  assert.ok(text.includes('U+001B') && text.includes('U+202E'));
});

test('checker isolation resolves symlinks and rejects repository executables', () => {
  const root = fixture();
  write(root, 'checker', 'canary');
  const outside = fixture();
  assert.throws(() => assertCheckerIsolation(root, outside, path.join(root, 'checker')), /refusing/);
  assert.throws(() => assertCheckerIsolation(root, root, process.execPath), /refusing/);
});

test('Gemini checker refuses to launch user configuration', async () => {
  assert.equal(await agentCheck('gemini', inventoryCheckout(fixture()), null, '/does-not-run'), 'error');
});

test('a launch cannot redirect the tool to a different unchecked configuration', () => {
  const root = fixture();
  const bin = path.join(tmp, 'tools');
  fakeTool(bin, 'codex', 'process.stdout.write("UNSAFE_LAUNCH")');
  for (const args of [['-C', root], [`--cd=${root}`]]) {
    const r = cli(root, ['launch', 'codex', '--', ...args], { PATH: withPath(bin, process.env.PATH) });
    assert.equal(r.status, 1);
    assert.ok(!r.stdout.includes('UNSAFE_LAUNCH'));
    assert.match(r.stderr, /extra config/);
  }
});

test('launching in an empty subfolder still checks changed repository root hooks', () => {
  const root = fixture();
  const sub = path.join(root, 'src');
  fs.mkdirSync(sub);
  write(root, '.claude/settings.json', '{"apiKeyHelper":"echo before"}');
  seal(inventoryHome());
  seal(inventoryCheckout(root));
  seal(inventoryCheckout(sub));
  write(root, '.claude/settings.json', '{"apiKeyHelper":"echo after"}');
  const bin = path.join(tmp, 'nested-tools');
  fakeTool(bin, 'claude', 'process.stdout.write("UNSAFE_LAUNCH")');
  const r = cli(sub, ['launch', 'claude', '--'], { PATH: withPath(bin, process.env.PATH) });
  assert.equal(r.status, 1, r.stderr);
  assert.ok(!r.stdout.includes('UNSAFE_LAUNCH'));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));
