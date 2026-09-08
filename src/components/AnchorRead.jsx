import { useEffect, useRef, useState } from 'react';
import VoicePicker, { loadStoredVoice } from './VoicePicker.jsx';

/**
 * Read the script aloud.
 *
 * A broadcast script is written for the ear, and reading it on screen tells you
 * nothing about whether a line is a mouthful or whether it fits the slot.
 * Hearing it does — so this sits at the top of the pane, above the copy, where
 * it is the first thing offered rather than something found after scrolling.
 *
 * The audio is a read-through for the desk: it stays in the browser, and the
 * download is a local save, not a publish.
 */
export default function AnchorRead({ voice, text, label = 'anchor script', fileBase = 'script', onProgress }) {
  const [state, setState] = useState('idle'); // idle | loading | ready
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [chosenVoice, setChosenVoice] = useState(() => loadStoredVoice() || voice?.voiceId || null);
  const audioRef = useRef(null);
  const urlRef = useRef(null);
  const alignRef = useRef(null);
  const rafRef = useRef(0);

  const chars = text.trim().length;
  // ~150 words a minute is the usual read rate for broadcast copy.
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const estimate = Math.round((words / 150) * 60);

  // New copy or a new voice is a new recording — drop the old take rather than
  // leave it attached to text it no longer matches.
  useEffect(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    audioRef.current = null;
    alignRef.current = null;
    stopFollowing(true);
    setState('idle');
    setPlaying(false);
    setError(null);
  }, [text, chosenVoice]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  /**
   * Walk the character alignment on each frame and report which character is
   * being spoken. `timeupdate` fires about four times a second — far too coarse
   * for words to light up in time with the voice — so this rides the frame loop
   * while audio is playing and stops the moment it is not.
   */
  function follow() {
    const audio = audioRef.current;
    const align = alignRef.current;
    if (!audio || !align || !onProgress) return;
    const t = audio.currentTime;
    const { starts, scale } = align;
    // Linear from the last position: playback is monotonic, so this is O(1)
    // per frame in practice rather than a search over the whole script.
    let i = align.cursor || 0;
    if (t < (starts[i] ?? 0)) i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= t) i += 1;
    align.cursor = i;
    onProgress(Math.round(i * scale));
    rafRef.current = requestAnimationFrame(follow);
  }

  function startFollowing() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(follow);
  }

  function stopFollowing(clear) {
    cancelAnimationFrame(rafRef.current);
    if (clear && onProgress) onProgress(null);
  }

  /** Render once, then reuse — both Play and Download go through this. */
  async function ensureAudio() {
    if (urlRef.current) return urlRef.current;
    setState('loading');
    setError(null);
    const res = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId: chosenVoice }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState('idle');
      throw new Error(j.error || `Voice failed (${res.status})`);
    }

    const blob = await (await fetch(j.audio)).blob();
    const url = URL.createObjectURL(blob);
    urlRef.current = url;

    // ElevenLabs aligns against the text it was given, so indexes normally map
    // one-to-one onto our script. If the model normalised the text (numerals
    // read as words), the lengths diverge — scale rather than highlight the
    // wrong word.
    const chars = j.alignment?.characters || [];
    alignRef.current = chars.length
      ? { starts: j.alignment.starts, scale: chars.length === text.length ? 1 : text.length / chars.length, cursor: 0 }
      : null;

    const audio = new Audio(url);
    audio.onplay = () => { setPlaying(true); startFollowing(); };
    audio.onpause = () => { setPlaying(false); stopFollowing(false); };
    audio.onended = () => { setPlaying(false); stopFollowing(true); };
    audioRef.current = audio;
    setState('ready');
    return url;
  }

  async function play() {
    if (audioRef.current) {
      playing ? audioRef.current.pause() : audioRef.current.play();
      return;
    }
    try {
      await ensureAudio();
      audioRef.current.play();
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  async function download() {
    try {
      const url = await ensureAudio();
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileBase}-${(chosenVoice || 'voice').slice(0, 8)}.mp3`;
      a.click();
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  if (!chars) return null;

  return (
    <div className="anchor-read">
      {error && <div className="publish-error">{error}</div>}
      <div className="anchor-row">
        {voice?.ready && <VoicePicker selectedId={chosenVoice} onSelect={setChosenVoice} />}

        <button
          className="btn-regen anchor-play"
          disabled={!voice?.ready || state === 'loading'}
          title={voice?.hint || undefined}
          onClick={play}
        >
          {state === 'loading' ? (
            <><span className="spinner" /> Voicing…</>
          ) : playing ? (
            '❚❚ Pause'
          ) : state === 'ready' ? (
            '▶ Play again'
          ) : (
            `▶ Hear the ${label}`
          )}
        </button>

        {state === 'ready' && (
          <button
            className="btn btn-sm"
            onClick={() => {
              audioRef.current.currentTime = 0;
              audioRef.current.play();
            }}
          >
            ↺ Restart
          </button>
        )}

        <button
          className="btn btn-sm"
          disabled={!voice?.ready || state === 'loading'}
          title="Save the read as an mp3"
          onClick={download}
        >
          ↓ Download mp3
        </button>

        <span className="meter">
          {voice?.ready
            ? `${words} words · ~${estimate}s read`
            : voice?.hint || 'Voice is not configured.'}
        </span>
      </div>
    </div>
  );
}
