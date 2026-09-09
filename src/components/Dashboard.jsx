import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The desk board.
 *
 * Everything the autopilot has produced, newest first, grouped by when it ran.
 * The board's job is to answer one question fast — what needs an editor right
 * now — so "awaiting review" leads and everything else recedes.
 *
 * Nothing here publishes on its own. Approving is a person's act; the machine
 * only ever fills the queue.
 */
const STATUS_LABEL = {
  generating: 'Processing…',
  awaiting_review: 'Needs review',
  approved: 'Approved',
  published: 'Published',
  failed: 'Failed',
  discarded: 'Discarded',
};

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.floor(h / 24)} d ago`;
};

const inMins = (iso) => {
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return m <= 0 ? 'due now' : m === 1 ? 'in 1 min' : `in ${m} min`;
};

/** Group by the day it ran, so a long night reads as a timeline. */
function groupByDay(rows) {
  const out = new Map();
  for (const r of rows) {
    const d = new Date(r.createdAt);
    const key = d.toDateString();
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r);
  }
  return [...out.entries()];
}

export default function Dashboard({ onOpen }) {
  const [data, setData] = useState({ rundowns: [], counts: {}, autopilot: {} });
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null);
  const esRef = useRef(null);

  const load = async () => {
    try {
      const r = await fetch('/api/rundowns');
      if (r.ok) setData(await r.json());
    } catch {
      /* the board keeps whatever it last had */
    }
  };

  useEffect(() => {
    load();
    // Live events keep the board honest while the autopilot works.
    const es = new EventSource('/api/autopilot/events');
    esRef.current = es;
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data);
        if (ev.type === 'cycle:start') setLive('Sweeping the wires…');
        else if (ev.type === 'cycle:swept') setLive(`Ranking ${ev.clusters} stories…`);
        else if (ev.type === 'cycle:picked') setLive(`Picked ${ev.picks.length} — producing…`);
        else if (ev.type === 'rundown:start') setLive(`Writing: ${ev.headline.slice(0, 48)}…`);
        else if (ev.type === 'rundown:facts') setLive(`${ev.facts} facts extracted…`);
        else if (ev.type === 'rundown:done' || ev.type === 'rundown:error') load();
        else if (ev.type === 'cycle:done' || ev.type === 'cycle:skipped') {
          setLive(null);
          load();
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    const poll = setInterval(load, 30_000);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, []);

  const setAutopilot = async (body) => {
    setBusy(true);
    try {
      await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setLive('Starting a cycle…');
    try {
      await fetch('/api/autopilot/run', { method: 'POST' });
    } finally {
      setBusy(false);
      load();
    }
  };

  const ap = data.autopilot || {};
  const counts = data.counts || {};
  const rows = useMemo(
    () => (filter === 'all' ? data.rundowns : data.rundowns.filter((r) => r.status === filter)),
    [data.rundowns, filter]
  );
  const needsReview = counts.awaiting_review || 0;

  return (
    <div className="board">
      <section className="panel">
        <div className="panel-head">
          <span className="panel-num">00</span>
          <h2>Desk board</h2>
          <span className="count">{data.rundowns.length} rundowns</span>
        </div>

        <div className="panel-body">
          <div className="board-top">
            <div className={`queue ${needsReview ? 'hot' : ''}`}>
              <b>{needsReview}</b>
              <span>{needsReview === 1 ? 'rundown needs review' : 'rundowns need review'}</span>
            </div>

            <div className="ap">
              <label className="tick">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={!!ap.on}
                  onChange={(e) => setAutopilot(e.target.checked ? { count: ap.count } : { on: false })}
                />
                Autopilot
                <span className="meter">
                  {ap.on
                    ? `${ap.count} stories every ${Math.round((ap.intervalMs || 0) / 60000)} min`
                    : 'off'}
                </span>
              </label>

              <label className="tick">
                Stories per cycle
                <select
                  className="mini-select"
                  value={ap.count || 3}
                  disabled={busy}
                  onChange={(e) => setAutopilot({ count: Number(e.target.value), on: ap.on ? undefined : false })}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>

              <button className="btn btn-sm" disabled={busy || ap.running} onClick={runNow}>
                {ap.running ? 'Cycle running…' : 'Run one now'}
              </button>
            </div>
          </div>

          <p className="sweep-line">
            {ap.lastRunAt ? (
              <>
                Last swept <b>{ago(ap.lastRunAt)}</b>
              </>
            ) : (
              'Not swept yet this session'
            )}
            {ap.on && ap.nextRunAt && !ap.capReached && <> · next {inMins(ap.nextRunAt)}</>}
          </p>

          {(live || ap.running) && (
            <div className="live">
              <span className="spinner" /> {live || 'Working…'}
            </div>
          )}

          {ap.capReached && (
            <p className="hint warn-hint">
              Hourly ceiling reached ({ap.producedLastHour}/{ap.maxPerHour}) — cycles resume next hour.
            </p>
          )}

          <div className="btn-row filters">
            {['all', 'awaiting_review', 'approved', 'published', 'failed'].map((f) => (
              <button
                key={f}
                className={`btn btn-sm ${filter === f ? 'btn-ink' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : STATUS_LABEL[f]}
                {counts[f] ? ` ${counts[f]}` : ''}
              </button>
            ))}
          </div>
        </div>
      </section>

      {!rows.length && (
        <div className="empty board-empty">
          {data.rundowns.length
            ? 'Nothing in this view.'
            : 'No rundowns yet. Turn on the autopilot, or run one cycle to see the desk work.'}
        </div>
      )}

      {groupByDay(rows).map(([day, items]) => (
        <section key={day} className="day">
          <p className="day-label">
            {day} <span>{items.length}</span>
          </p>
          <div className="cards">
            {items.map((r) => (
              <article
                key={r.id}
                className={`rd rd-${r.status}`}
                onClick={() => onOpen?.(r.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen?.(r.id)}
              >
                <div className="rd-top">
                  <span className={`chip st st-${r.status}`}>
                    {r.status === 'generating' && <span className="spinner" />}
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                  {r.beat && <span className="chip">{r.beat}</span>}
                  <span className="rd-time" title={new Date(r.createdAt).toLocaleString()}>
                    {ago(r.createdAt)}
                  </span>
                </div>

                <h3>{r.headline}</h3>
                {r.pickReason && <p className="rd-why">Why this: {r.pickReason}</p>}
                {r.error && <p className="rd-why err">{r.error}</p>}

                <div className="rd-foot">
                  <span>
                    {r.formats}/13 formats{r.status === 'generating' ? ' so far' : ''}
                  </span>
                  <span className={r.approved === r.formats && r.formats ? 'ok' : ''}>
                    {r.approved} approved
                  </span>
                  <span>{r.factCount} facts</span>
                  {r.genMs != null && <span>{(r.genMs / 1000).toFixed(0)}s</span>}
                  {!!r.sources?.length && <span>{[...new Set(r.sources)].join(', ')}</span>}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
