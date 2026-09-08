import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Pick the anchor's voice.
 *
 * The roster runs to hundreds of entries, so the list is search-first: the
 * query matches the name primarily, but also accent, gender and use case,
 * because "indian", "female" and "narration" are how someone actually looks for
 * a read rather than by remembering a name.
 *
 * The choice is kept in localStorage. Picking a voice is a preference about how
 * you work, not part of the story, so it should survive switching formats and
 * reloading the page.
 */
const STORE_KEY = 'lss.voiceId';

export const loadStoredVoice = () => {
  try {
    return localStorage.getItem(STORE_KEY) || null;
  } catch {
    return null; // private window or blocked storage — the default still works
  }
};

const storeVoice = (id) => {
  try {
    id ? localStorage.setItem(STORE_KEY, id) : localStorage.removeItem(STORE_KEY);
  } catch {
    /* not worth surfacing — the session still uses the pick */
  }
};

const traits = (v) => [v.gender, v.accent, v.age, v.useCase?.replace(/_/g, ' ')].filter(Boolean);

export default function VoicePicker({ selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const previewRef = useRef(null);
  const searchRef = useRef(null);

  // Fetched on first open, not on mount: most sessions never change the voice,
  // and this is a few hundred records.
  useEffect(() => {
    if (!open || voices) return;
    fetch('/api/voices')
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `Could not load voices (${r.status})`);
        setVoices(j.voices);
      })
      .catch((e) => setError(String(e.message || e)));
  }, [open, voices]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
    else stopPreview();
  }, [open]);

  useEffect(() => () => stopPreview(), []);

  function stopPreview() {
    previewRef.current?.pause();
    previewRef.current = null;
  }

  function preview(v, e) {
    e.stopPropagation(); // the row itself selects; the play button must not
    stopPreview();
    if (!v.previewUrl) return;
    const a = new Audio(v.previewUrl);
    previewRef.current = a;
    a.play().catch(() => setError('That preview could not be played.'));
  }

  const shown = useMemo(() => {
    if (!voices) return [];
    // Every term must match, in any order — "indian news" should find an Indian
    // news voice, not just a voice with that exact phrase in its blurb.
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = (v) =>
      [v.name, ...traits(v), v.language, v.description].filter(Boolean).join(' ').toLowerCase();
    const matched = terms.length
      ? voices.filter((v) => {
          const hay = haystack(v);
          return terms.every((t) => hay.includes(t));
        })
      : voices;
    // Whatever is currently in use stays visible, so the panel always shows
    // what it is you are about to change away from.
    const current = matched.filter((v) => v.id === selectedId);
    return [...current, ...matched.filter((v) => v.id !== selectedId)];
  }, [voices, q, selectedId]);

  const selected = voices?.find((v) => v.id === selectedId);

  return (
    <div className="voice-picker">
      <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
        ♪ Voice{selected ? `: ${selected.name.split(' - ')[0]}` : ''} {open ? '▴' : '▾'}
      </button>

      {open && (
        <div className="voice-panel">
          <input
            ref={searchRef}
            className="regen-input"
            style={{ fontSize: 13, padding: '9px 12px' }}
            value={q}
            placeholder="Search by name, accent, gender…"
            onChange={(e) => setQ(e.target.value)}
          />

          {error && <div className="publish-error">{error}</div>}
          {!voices && !error && (
            <div className="meter" style={{ padding: '10px 2px' }}>
              <span className="spinner" /> Loading voices…
            </div>
          )}

          {voices && (
            <>
              <div className="voice-count">
                {shown.length} of {voices.length} voices
              </div>
              <div className="voice-list">
                {shown.slice(0, 80).map((v) => (
                  <button
                    key={v.id}
                    className={`voice-row ${v.id === selectedId ? 'on' : ''}`}
                    onClick={() => {
                      onSelect(v.id);
                      storeVoice(v.id);
                      stopPreview();
                      setOpen(false);
                    }}
                  >
                    <span className="voice-name">{v.name}</span>
                    {!!traits(v).length && <span className="voice-traits">{traits(v).join(' · ')}</span>}
                    {v.previewUrl && (
                      <span
                        className="voice-preview"
                        role="button"
                        tabIndex={-1}
                        title="Hear a sample"
                        onClick={(e) => preview(v, e)}
                      >
                        ▶
                      </span>
                    )}
                  </button>
                ))}
                {shown.length > 80 && (
                  <div className="voice-count">
                    …and {shown.length - 80} more. Narrow the search to see them.
                  </div>
                )}
                {!shown.length && <div className="voice-count">No voice matches “{q}”.</div>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
