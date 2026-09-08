/**
 * Model access for the whole app.
 *
 * Text generation runs through one of four backends, chosen at boot:
 *
 *   anthropic   Anthropic Messages API (ANTHROPIC_API_KEY)
 *   openai      OpenAI chat completions (OPENAI_API_KEY)
 *   gemini      Google Gemini generateContent (GEMINI_API_KEY)
 *   claude-cli  the local Claude Code binary, using this machine's existing
 *               login — the zero-configuration fallback, no key required
 *
 * Everything above this layer calls complete()/completeJson() and never knows
 * which backend is live.
 */
import './env.js'; // must be first: this module reads config at load time
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEXT_PROVIDERS, modelFor } from './providers.js';

/**
 * Find the Claude Code binary.
 *
 * CLAUDE_CODE_EXECPATH only exists inside a running Claude Code session, so it
 * cannot be relied on: a server started from a normal terminal sees neither it
 * nor a `claude` on PATH (the VS Code extension ships its binary inside the
 * extension directory and never symlinks it). So we search, newest first.
 */
function versionKey(dirName) {
  const m = /anthropic\.claude-code-(\d+)\.(\d+)\.(\d+)/.exec(dirName);
  if (!m) return 0;
  return Number(m[1]) * 1e8 + Number(m[2]) * 1e4 + Number(m[3]);
}

function onPath(bin) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

function resolveCliPath() {
  const explicit = process.env.LSS_CLAUDE_PATH || process.env.CLAUDE_CODE_EXECPATH;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const found = onPath('claude');
  if (found) return found;

  const home = os.homedir();
  for (const p of [
    path.join(home, '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, 'bin', 'claude'),
  ]) {
    if (fs.existsSync(p)) return p;
  }

  // Editor extensions bundle the binary; take the highest version installed.
  const candidates = [];
  for (const root of [
    path.join(home, '.vscode', 'extensions'),
    path.join(home, '.vscode-insiders', 'extensions'),
    path.join(home, '.vscode-server', 'extensions'),
    path.join(home, '.cursor', 'extensions'),
    path.join(home, '.windsurf', 'extensions'),
  ]) {
    let entries;
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const dir of entries) {
      if (!dir.startsWith('anthropic.claude-code-')) continue;
      const bin = path.join(root, dir, 'resources', 'native-binary', 'claude');
      if (fs.existsSync(bin)) candidates.push({ bin, key: versionKey(dir) });
    }
  }
  if (candidates.length) return candidates.sort((a, b) => b.key - a.key)[0].bin;

  return null;
}

const CLI_PATH = resolveCliPath();

/* ── backend selection ────────────────────────────────────────────────── */

const CLI_ID = 'claude-cli';

const API_ORDER = ['anthropic', 'openai', 'gemini'];

/** First API provider with a key, or null. */
const firstReadyApi = () => API_ORDER.find((id) => TEXT_PROVIDERS[id].ready()) || null;

const ALIASES = { cli: CLI_ID, claude: 'anthropic', google: 'gemini' };

function chooseBackend() {
  const asked = (process.env.LSS_TEXT_PROVIDER || process.env.LSS_BACKEND || '').trim().toLowerCase();
  // "sdk" historically meant "use an API key rather than the local CLI"; honour
  // that intent by picking whichever API is actually configured, rather than
  // insisting on Anthropic and then reporting no backend.
  if (asked === 'sdk' || asked === 'api') return firstReadyApi() || 'anthropic';
  if (asked) return ALIASES[asked] || asked;
  return firstReadyApi() || CLI_ID;
}

export const backend = chooseBackend();

const provider = TEXT_PROVIDERS[backend] ?? null;

export const MODEL =
  backend === CLI_ID
    ? process.env.ANTHROPIC_MODEL || process.env.LSS_MODEL || 'claude-opus-5'
    : modelFor(backend);

/** True when LSS_MODEL is set but the active provider names its own variable. */
export const modelVarIgnored =
  !!process.env.LSS_MODEL &&
  backend !== CLI_ID &&
  !!provider &&
  !provider.modelEnv.includes('LSS_MODEL')
    ? `LSS_MODEL is set but ignored for ${backend} — set ${provider.modelEnv[0]} instead (using ${MODEL}).`
    : null;

export const backendReady =
  backend === CLI_ID ? !!CLI_PATH : !!provider && provider.ready();

/** Default fan-out: a subprocess-per-call backend gets a smaller one. */
export const backendConcurrency =
  backend === CLI_ID ? 4 : provider?.concurrency ?? 8;

export const backendHint = backendReady
  ? null
  : !provider && backend !== CLI_ID
  ? `Unknown backend "${backend}". Set LSS_TEXT_PROVIDER to one of: ${[...Object.keys(TEXT_PROVIDERS), CLI_ID].join(', ')}.`
  : provider
  ? `Backend "${backend}" is selected but ${provider.envKey} is not set. Add it to .env and restart, or unset LSS_TEXT_PROVIDER to fall back to the local Claude Code login.`
  : 'No Claude Code CLI found and no API key set. Add a key to .env (see .env.example) and restart, or point LSS_CLAUDE_PATH at your Claude Code binary.';

export const backendLabel = !backendReady
  ? 'No model backend available'
  : backend === CLI_ID
  ? `Claude Code (local login) · ${MODEL}`
  : `${provider.label} · ${MODEL}`;

export const cliPath = CLI_PATH;

/* ── the one call everything above this layer uses ────────────────────── */

export async function complete({ system, user, maxTokens = 8000, effort = 'medium', json = false }) {
  if (!backendReady) throw new Error(backendHint);
  if (backend === CLI_ID) return completeCli({ system, user });
  return provider.complete({ system, user, maxTokens, effort, model: MODEL, json });
}

function completeCli({ system, user }) {
  return new Promise((resolve, reject) => {
    if (!CLI_PATH) return reject(new Error(backendHint));
    const args = [
      '-p',
      '--model', MODEL,
      '--system-prompt', system,
      '--allowed-tools', '',
      '--setting-sources', '',
      '--exclude-dynamic-system-prompt-sections',
      '--output-format', 'json',
    ];
    const child = spawn(CLI_PATH, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Run outside the project so no CLAUDE.md / project config bloats the call.
      cwd: process.env.TMPDIR || '/tmp',
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) =>
      reject(new Error(`Claude Code CLI at ${CLI_PATH} could not be run: ${e.message}`))
    );
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Claude CLI exited ${code}: ${err.slice(0, 400)}`));
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error) return reject(new Error(String(parsed.result).slice(0, 400)));
        resolve(parsed.result ?? '');
      } catch {
        reject(new Error(`Unparseable CLI output: ${out.slice(0, 400)}`));
      }
    });
    // Prompt goes over stdin so long stories can never hit the argv size limit.
    child.stdin.end(user);
  });
}

/** Pull the first complete JSON value out of a model response. */
export function extractJson(text) {
  if (!text) throw new Error('Empty model response');
  let s = text.trim();
  // Strip ```json fences if the model added them anyway.
  const fence = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* fall through to brace scanning */
  }
  const start = s.search(/[[{]/);
  if (start === -1) throw new Error(`No JSON found in response: ${s.slice(0, 200)}`);
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error(`Truncated JSON in response: ${s.slice(0, 200)}`);
}

/** Completion that must yield JSON. Retries once with a repair instruction. */
export async function completeJson({ system, user, maxTokens = 8000, effort = 'medium' }) {
  const sys = `${system}\n\nOutput ONLY raw JSON. No markdown fences, no commentary before or after.`;
  let raw = await complete({ system: sys, user, maxTokens, effort, json: true });
  try {
    return extractJson(raw);
  } catch (e) {
    const repaired = await complete({
      system: sys,
      user: `${user}\n\nYour previous reply could not be parsed as JSON (${e.message}). Return ONLY the corrected raw JSON value.`,
      maxTokens,
      effort,
      json: true,
    });
    return extractJson(repaired);
  }
}
