/**
 * Anchor voice, via ElevenLabs.
 *
 * A TV script is written to be *read aloud*, and a page of text does not tell
 * you whether it reads well — whether a line is a mouthful, whether the runtime
 * fits the slot. Hearing it does. So this is a read-through of the anchor copy,
 * not a published asset: it never leaves the browser and is never uploaded.
 *
 * Renders are cached in memory by voice + text. Replaying the same script is
 * the common case (you listen, tweak one line, listen again), and re-billing a
 * character-metered API for identical text would be careless.
 */
import './env.js';
import { createHash } from 'node:crypto';

const API = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_MODEL = 'eleven_multilingual_v2';

// A read-through, not a broadcast asset — 128 kbps mp3 is plenty and keeps the
// round trip quick.
const OUTPUT_FORMAT = 'mp3_44100_128';

export const voiceId = () => (process.env.ELEVENLABS_VOICE_ID || '').trim();
const API_ROOT = 'https://api.elevenlabs.io/v1';
export const voiceModel = () => (process.env.ELEVENLABS_MODEL || DEFAULT_MODEL).trim();
export const voiceReady = () => !!((process.env.ELEVENLABS_API_KEY || '').trim() && voiceId());

export function voiceHint() {
  if (!(process.env.ELEVENLABS_API_KEY || '').trim()) return 'ELEVENLABS_API_KEY is not set.';
  if (!voiceId()) return 'ELEVENLABS_VOICE_ID is not set.';
  return null;
}

/** ElevenLabs accepts roughly 0.7–1.2; anything outside that is rejected. */
function speed() {
  const n = Number(process.env.ELEVENLABS_SPEED);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.2, Math.max(0.7, n));
}

/** A long script is a large bill and a slow request — cap it rather than surprise anyone. */
export const MAX_CHARS = 5000;

const cache = new Map(); // key -> { buffer, contentType }
const MAX_CACHED = 24;

/**
 * The full voice roster, trimmed to what the picker needs.
 *
 * Cached: the list runs to hundreds of entries, changes rarely, and re-fetching
 * it every time someone opens the picker would make the panel feel slow for no
 * reason. The raw records carry ~30 fields each — sending those to the browser
 * would be most of a megabyte of things nothing reads.
 */
let rosterCache = null;
const ROSTER_TTL_MS = 10 * 60 * 1000;

export async function listVoices() {
  if (!voiceReady()) throw new Error(voiceHint() || 'ElevenLabs is not configured.');
  if (rosterCache && rosterCache.expires > Date.now()) return rosterCache.voices;

  const res = await fetch(`${API_ROOT}/voices`, {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
  });
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: could not list voices.`);

  const { voices = [] } = await res.json();
  const trimmed = voices
    .map((v) => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
      // Enough to search and to tell voices apart; the full blurb is marketing
      // copy that would triple the payload.
      description: v.description ? String(v.description).replace(/\s+/g, ' ').trim().slice(0, 160) : null,
      previewUrl: v.preview_url || null,
      accent: v.labels?.accent || null,
      gender: v.labels?.gender || null,
      age: v.labels?.age || null,
      useCase: v.labels?.use_case || null,
      language: v.labels?.language || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  rosterCache = { voices: trimmed, expires: Date.now() + ROSTER_TTL_MS };
  return trimmed;
}

export async function speak(text, chosenVoice) {
  if (!voiceReady()) throw new Error(voiceHint() || 'ElevenLabs is not configured.');

  // An explicitly chosen voice wins; the env value is the default, not a lock.
  const voice = String(chosenVoice || '').trim() || voiceId();
  if (!/^[A-Za-z0-9]{16,40}$/.test(voice)) throw new Error('That voice id does not look valid.');

  const script = String(text ?? '').trim();
  if (!script) throw new Error('Nothing to read.');
  if (script.length > MAX_CHARS)
    throw new Error(`That script is ${script.length} characters; the read-through is capped at ${MAX_CHARS}.`);

  const key = createHash('sha1').update(`${voice}|${voiceModel()}|${speed()}|${script}`).digest('hex');
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  const res = await fetch(`${API}/${encodeURIComponent(voice)}?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: script,
      model_id: voiceModel(),
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: speed() },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let msg = body.slice(0, 200);
    try {
      const j = JSON.parse(body);
      msg = j.detail?.message || j.detail?.status || j.message || msg;
    } catch {
      /* non-JSON error body — raw text beats nothing */
    }
    throw new Error(`ElevenLabs HTTP ${res.status}: ${msg}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const entry = { buffer, contentType: 'audio/mpeg' };
  cache.set(key, entry);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  return { ...entry, cached: false };
}
