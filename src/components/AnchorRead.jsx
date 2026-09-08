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
export default function AnchorRead({ voice, text, label = 'anchor script', fileBase = 'script' }) {
  const [state, setState] = useState('idle'); // idle | loading | ready
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [chosenVoice, setChosenVoice] = useState(() => loadStoredVoice() || voice?.voiceId || null);
  const audioRef = useRef(null);
  const urlRef = useRef(null);

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
    setState('idle');
    setPlaying(false);
    setError(null);
  }, [text, chosenVoice]);

  useEffect(() => () => urlRef.current && URL.revokeObjectURL(urlRef.current), []);

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
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setState('idle');
      throw new Error(j.error || `Voice failed (${res.status})`);
    }
    const url = URL.createObjectURL(await res.blob());
    urlRef.current = url;
    const audio = new Audio(url);
    audio.onplay = () => setPlaying(true);
    audio.onpause = () => setPlaying(false);
    audio.onended = () => setPlaying(false);
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

        {voice?.ready && <VoicePicker selectedId={chosenVoice} onSelect={setChosenVoice} />}

        <span className="meter">
          {voice?.ready
            ? `${words} words · ~${estimate}s read`
            : voice?.hint || 'Voice is not configured.'}
        </span>
      </div>
    </div>
  );
}
