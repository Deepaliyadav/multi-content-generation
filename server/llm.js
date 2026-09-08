/**
 * LLM adapter with two interchangeable backends.
 *
 *  1. "sdk" - the Anthropic Messages API via @anthropic-ai/sdk. Used when
 *     ANTHROPIC_API_KEY (or an ant-auth profile) is available. Fast, cheap,
 *     supports effort control. This is the preferred path.
 *  2. "cli" - the local Claude Code binary in headless mode. Uses the machine's
 *     existing Claude Code login, so the app runs with zero configuration.
 *
 * Both backends expose the same `complete()` surface so the rest of the server
 * never knows which one is live.
 */
import { spawn } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.LSS_MODEL || 'claude-opus-5';
const CLI_PATH = process.env.CLAUDE_CODE_EXECPATH || 'claude';

let _client = null;
function client() {
  if (!_client) _client = new Anthropic();
  return _client;
}

export const backend =
  process.env.LSS_BACKEND ||
  (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'sdk' : 'cli');

export const backendLabel =
  backend === 'sdk'
    ? `Anthropic API · ${MODEL}`
    : `Claude Code (local login) · ${MODEL}`;

/** Single completion. Returns raw assistant text. */
export async function complete({ system, user, maxTokens = 8000, effort = 'medium' }) {
  return backend === 'sdk'
    ? completeSdk({ system, user, maxTokens, effort })
    : completeCli({ system, user });
}

async function completeSdk({ system, user, maxTokens, effort }) {
  // Stream so large max_tokens never trips the HTTP timeout.
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Model declined this request.');
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function completeCli({ system, user }) {
  return new Promise((resolve, reject) => {
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
    child.on('error', (e) => reject(new Error(`Claude CLI not runnable: ${e.message}`)));
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
  let raw = await complete({ system: sys, user, maxTokens, effort });
  try {
    return extractJson(raw);
  } catch (e) {
    const repaired = await complete({
      system: sys,
      user: `${user}\n\nYour previous reply could not be parsed as JSON (${e.message}). Return ONLY the corrected raw JSON value.`,
      maxTokens,
      effort,
    });
    return extractJson(repaired);
  }
}
