import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

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
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

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

  /**
   * The panel is positioned in viewport coordinates rather than relative to the
   * button. It lives inside the output grid, which clips its overflow, so an
   * absolutely-positioned dropdown gets cut off the moment it reaches an edge —
   * and this control has moved between the top and bottom of the pane before
   * now. Measuring at open time also lets it flip up or down on its own instead
   * of relying on a fixed direction that only suits one placement.
   */
  useLayoutEffect(() => {
    if (!open) return undefined;
    const WANT_H = 380;
    const W = 340;
    const GAP = 6;
    const EDGE = 10;

    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      const up = below < Math.min(WANT_H, above);
      const maxHeight = Math.max(160, Math.min(WANT_H, up ? above : below));
      setPos({
        top: up ? r.top - GAP - maxHeight : r.bottom + GAP,
        left: Math.min(Math.max(EDGE, r.left), window.innerWidth - W - EDGE),
        maxHeight,
      });
    };

    place();
    // `true` catches scrolling in the pane itself, not just the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Clicking anywhere else closes it — a panel this large should not need its
  // own button pressed again to get out of the way.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!panelRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
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
      <button ref={btnRef} className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
        ♪ Voice{selected ? `: ${selected.name.split(' - ')[0]}` : ''} {open ? '▴' : '▾'}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="voice-panel"
          style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { visibility: 'hidden' }}
        >
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
