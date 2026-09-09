import { useEffect, useRef, useState } from 'react';

/**
 * The wire strip.
 *
 * Raw competitor headlines as they land — the desk's peripheral vision, not a
 * control. It stays deliberately small and quiet: one line, muted, no accent
 * colour, so it never competes with the fact ledger or the stale flags.
 *
 * Polls the cheap /api/wire endpoint, which costs no model call.
 */
const POLL_MS = 60_000;

export default function WireTicker({ onWire }) {
  const [wire, setWire] = useState(null);
  const [paused, setPaused] = useState(false);
  const trackRef = useRef(null);
  const [duration, setDuration] = useState(120);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch('/api/wire');
        if (!r.ok) return;
        const data = await r.json();
        if (!alive) return;
        setWire(data);
        onWire?.(data);
      } catch {
        /* the strip is ambient — a failed poll just leaves the last copy up */
      }
    };
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [onWire]);

  // Scroll at a constant speed regardless of how much copy is on the wire,
  // so a busy news hour does not turn into a blur.
  useEffect(() => {
    if (!trackRef.current) return;
    const px = trackRef.current.scrollWidth / 2;
    setDuration(Math.max(40, Math.round(px / 60)));
  }, [wire]);

  const items = wire?.items || [];
  if (!items.length) return null;

  const run = items.map((it, i) => (
    <a key={i} className="wire-item" href={it.link} target="_blank" rel="noreferrer">
      <span className="wire-src">{it.source.replace(/\s*Hindi$/i, '')}</span>
      <span className="wire-hed">{it.title}</span>
    </a>
  ));

  return (
    <div
      className="wire"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="wire-label">On the wire</span>
      <div className="wire-window">
        <div
          ref={trackRef}
          className={`wire-track ${paused ? 'paused' : ''}`}
          style={{ animationDuration: `${duration}s` }}
        >
          {run}
          {/* duplicated so the loop has no seam */}
          {run}
        </div>
      </div>
      <span className="wire-count" title={`${items.length} headlines · refreshed every minute`}>
        {items.length}
      </span>
    </div>
  );
}
