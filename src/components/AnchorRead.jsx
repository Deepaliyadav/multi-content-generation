import { useEffect, useRef, useState } from 'react';

/**
 * Read the anchor copy aloud.
 *
 * A TV script is written for the ear, and reading it on screen tells you
 * nothing about whether a line is a mouthful or whether it fits the slot.
 * Hearing it does. This is a read-through for the desk — the audio stays in the
 * browser and is never uploaded or published.
 */
export default function AnchorRead({ voice, text, label = 'anchor script' }) {
  const [state, setState] = useState('idle'); // idle | loading | ready
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  const urlRef = useRef(null);

  const chars = text.trim().length;
  // ~150 words a minute is the usual read rate for broadcast copy.
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const estimate = Math.round((words / 150) * 60);

  // A different script is a different recording — drop the old audio rather
  // than leave a stale take attached to edited copy.
  useEffect(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    audioRef.current = null;
    setState('idle');
    setPlaying(false);
    setError(null);
  }, [text]);

  useEffect(() => () => urlRef.current && URL.revokeObjectURL(urlRef.current), []);

  async function play() {
    if (audioRef.current) {
      playing ? audioRef.current.pause() : audioRef.current.play();
      return;
    }
    setState('loading');
    setError(null);
    try {
      const res = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
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
      audio.play();
    } catch (e) {
      setError(String(e.message || e));
      setState('idle');
    }
  }

  if (!chars) return null;

  return (
    <div className="anchor-read">
      {error && <div className="publish-error">{error}</div>}
      <div className="btn-row" style={{ marginTop: 0 }}>
        <button
          className="btn btn-sm"
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
        <span className="meter">
          {voice?.ready
            ? `${words} words · ~${estimate}s read`
            : voice?.hint || 'Voice is not configured.'}
        </span>
      </div>
    </div>
  );
}
