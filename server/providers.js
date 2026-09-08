/**
 * Text-generation providers.
 *
 * Every provider exposes the same call shape so the pipeline never knows which
 * one is live:  complete({ system, user, maxTokens, effort }) -> string
 *
 * Anthropic goes through the official SDK. OpenAI and Gemini go through their
 * documented REST endpoints with global fetch — no extra dependencies, and no
 * guessing at SDK method names.
 *
 * NOTE: the prompts and the JSON contracts in this app were written and tuned
 * against Claude. Other providers will run, but format fidelity across all 13
 * outputs should be re-checked per provider with `npm run verify`.
 */
import './env.js';
import Anthropic from '@anthropic-ai/sdk';

/* ── Anthropic (SDK) ──────────────────────────────────────────────────── */

let _anthropic = null;
const anthropicClient = () => (_anthropic ??= new Anthropic());

async function anthropicComplete({ system, user, maxTokens, effort, model }) {
  // Streaming so a large max_tokens never trips the HTTP timeout.
  const stream = anthropicClient().messages.stream({
    model,
    max_tokens: maxTokens,
    output_config: { effort },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Model declined this request.');
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

/* ── OpenAI (REST: /v1/chat/completions) ──────────────────────────────── */

async function openaiComplete({ system, user, maxTokens, model, json }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...(process.env.OPENAI_ORG_ID ? { 'OpenAI-Organization': process.env.OPENAI_ORG_ID } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: maxTokens,
      // Our JSON prompts always contain the word "json", which this mode requires.
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const data = await readJson(res, 'OpenAI');
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error(`OpenAI returned no text: ${brief(data)}`);
  return text;
}

/* ── Gemini (REST: generativelanguage generateContent) ────────────────── */

/**
 * Gemini 3.x models think by default, and thinking tokens are charged against
 * maxOutputTokens. A budget sized for the answer alone gets eaten by thoughts
 * and the reply comes back truncated with finishReason MAX_TOKENS — which is
 * how a 700-token format like the push alert would silently fail. So the cap we
 * send is the answer budget plus headroom for reasoning; it is a ceiling, not a
 * target, so being generous costs nothing.
 */
const GEMINI_THINKING_HEADROOM = 8192;

async function geminiComplete({ system, user, maxTokens, model, json }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: maxTokens + GEMINI_THINKING_HEADROOM,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  const data = await readJson(res, 'Gemini');
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text).filter(Boolean).join('');
  if (!text) {
    const why = cand?.finishReason || data.promptFeedback?.blockReason || brief(data);
    throw new Error(`Gemini returned no text (${why})`);
  }
  if (cand?.finishReason === 'MAX_TOKENS')
    throw new Error(
      `Gemini hit its output cap (thinking used ${data.usageMetadata?.thoughtsTokenCount ?? '?'} tokens). Raise the headroom or use a lighter model via GEMINI_MODEL.`
    );
  return text;
}

/* ── shared helpers ───────────────────────────────────────────────────── */

async function readJson(res, label) {
  const body = await res.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`${label} returned non-JSON (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error?.status || brief(data);
    throw new Error(`${label} HTTP ${res.status}: ${msg}`);
  }
  return data;
}

const brief = (o) => JSON.stringify(o).slice(0, 200);

/* ── registry ─────────────────────────────────────────────────────────── */

/** First model variable that is set, else the provider's default. */
export function modelFor(id) {
  const p = TEXT_PROVIDERS[id];
  if (!p) return process.env.LSS_MODEL || 'claude-opus-5';
  for (const v of p.modelEnv) if (process.env[v]) return process.env[v];
  return p.defaultModel;
}

export const TEXT_PROVIDERS = {
  anthropic: {
    label: 'Anthropic API',
    envKey: 'ANTHROPIC_API_KEY',
    // Each provider names its own model variable. A single shared LSS_MODEL
    // would happily send "claude-opus-5" to OpenAI the moment you switched.
    modelEnv: ['ANTHROPIC_MODEL', 'LSS_MODEL'],
    defaultModel: 'claude-opus-5',
    ready: () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    complete: anthropicComplete,
    concurrency: 13,
  },
  openai: {
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    modelEnv: ['OPENAI_MODEL'],
    defaultModel: 'gpt-4o',
    ready: () => !!process.env.OPENAI_API_KEY,
    complete: openaiComplete,
    concurrency: 8,
  },
  gemini: {
    label: 'Gemini',
    envKey: 'GEMINI_API_KEY',
    modelEnv: ['GEMINI_MODEL', 'GOOGLE_MODEL'],
    // gemini-2.5-pro is closed to new keys; the API itself points here.
    defaultModel: 'gemini-3.1-pro-preview',
    ready: () => !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    complete: geminiComplete,
    concurrency: 8,
  },
};
