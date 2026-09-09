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
  // Unclaimed topics have no production date — they are opportunities, not
  // work — so they get their own pinned group rather than being filed under a
  // day they were never made on.
  const scoops = rows.filter((r) => r._kind === 'scoop');
  if (scoops.length) out.set('__unclaimed__', scoops);
  for (const r of rows.filter((r) => r._kind !== 'scoop')) {
    const key = new Date(r.createdAt).toDateString();
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r);
  }
  return [...out.entries()];
}

export default function Dashboard({ onOpen }) {
  const [data, setData] = useState({ rundowns: [], counts: {}, autopilot: {} });
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState([]);
  const [live, setLive] = useState(null);
  const [scoops, setScoops] = useState({ scoops: [], checkedAgainst: 0 });
  const [taking, setTaking] = useState(null);
  const esRef = useRef(null);

  const load = async () => {
    try {
      const [r, s] = await Promise.all([fetch('/api/rundowns'), fetch('/api/scoops')]);
      if (r.ok) setData(await r.json());
      if (s.ok) setScoops(await s.json());
    } catch {
      /* the board keeps whatever it last had */
    }
  };

  /** Produce a rundown from an unclaimed topic. */
  async function take(topic) {
    setTaking(topic.id);
    try {
      const r = await fetch(`/api/scoops/${topic.id}/produce`, { method: 'POST' });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || 'Could not produce it');
      await load();
      onOpen?.(out.id);
    } catch {
      /* surfaced by the board reloading without the row */
    } finally {
      setTaking(null);
    }
  }

  useEffect(() => {
    load();
    // Live events keep the board honest while the autopilot works.
    const es = new EventSource('/api/autopilot/events');
    esRef.current = es;
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data);
        // One replaced line hid a minute of real work behind the word
        // "working". Keep the trail instead — what it read, what it found,
        // what it is writing — and mark the newest as still in progress.
        const push = (text, level) =>
          setSteps((prev) => [...prev, { text, level, at: Date.now() }].slice(-9));

        if (ev.type === 'cycle:start') {
          setSteps([]);
          setLive('Sweeping the wires…');
          push('Starting a cycle');
        } else if (ev.type === 'cycle:step') {
          setLive(ev.step);
          push(ev.step, ev.level);
        } else if (ev.type === 'cycle:swept') {
          setLive(`Ranking ${ev.clusters} stories…`);
          push(`Ranking ${ev.clusters} stories by what is worth filing`);
        } else if (ev.type === 'cycle:picked') {
          setLive(`Picked ${ev.picks.length} — producing…`);
          push(`Picked ${ev.picks.length} to file`);
        } else if (ev.type === 'rundown:start') {
          setLive(`Writing: ${ev.headline.slice(0, 48)}…`);
          push(`Writing “${ev.headline.slice(0, 52)}”`);
        } else if (ev.type === 'rundown:facts') {
          setLive(`${ev.facts} facts extracted…`);
          push(`${ev.facts} facts extracted`);
        } else if (ev.type === 'rundown:done') {
          push(`Finished ${ev.formats}/13 formats in ${(ev.ms / 1000).toFixed(0)}s`);
          load();
        } else if (ev.type === 'rundown:error') {
          push(`Failed — ${String(ev.error).slice(0, 60)}`, 'warn');
          load();
        } else if (ev.type === 'cycle:done' || ev.type === 'cycle:skipped') {
          setLive(null);
          push(ev.type === 'cycle:skipped' ? `Cycle skipped — ${ev.reason}` : 'Cycle finished');
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
  // Unclaimed topics sit in the same list as produced rundowns: they are all
  // things an editor picks up, and splitting them into a separate board meant
  // scanning two places. They lead in "All" because being first is the only
  // advantage that expires.
  const unclaimed = scoops.scoops || [];
  const rows = useMemo(() => {
    if (filter === 'unclaimed') return unclaimed.map((s) => ({ ...s, _kind: 'scoop' }));
    if (filter === 'all')
      return [
        ...unclaimed.map((s) => ({ ...s, _kind: 'scoop' })),
        ...data.rundowns.map((r) => ({ ...r, _kind: 'rundown' })),
      ];
    return data.rundowns.filter((r) => r.status === filter).map((r) => ({ ...r, _kind: 'rundown' }));
  }, [data.rundowns, unclaimed, filter]);
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

          {(live || ap.running || steps.length > 0) && (
            <div className="live">
              <div className="live-head">
                {(live || ap.running) && <span className="spinner" />}
                <b>{live || (ap.running ? 'Working…' : 'Last cycle')}</b>
              </div>
              {!!steps.length && (
                <ol className="steplog">
                  {steps.map((s, i) => {
                    const last = i === steps.length - 1;
                    const active = last && (live || ap.running);
                    return (
                      <li key={s.at + '-' + i} className={`${s.level || ''} ${active ? 'now' : 'was'}`}>
                        <span className="step-mark" aria-hidden="true">
                          {s.level === 'warn' ? '!' : active ? '·' : '✓'}
                        </span>
                        {s.text}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}

          {ap.capReached && (
            <p className="hint warn-hint">
              Hourly ceiling reached ({ap.producedLastHour}/{ap.maxPerHour}) — cycles resume next hour.
            </p>
          )}

          <div className="btn-row filters">
            {['all', 'unclaimed', 'awaiting_review', 'approved', 'published', 'failed'].map((f) => (
              <button
                key={f}
                className={`btn btn-sm ${filter === f ? 'btn-ink' : ''} ${f === 'unclaimed' ? 'is-unclaimed' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'unclaimed' ? 'Unclaimed' : STATUS_LABEL[f]}
                {f === 'unclaimed' ? (unclaimed.length ? ` ${unclaimed.length}` : '') : counts[f] ? ` ${counts[f]}` : ''}
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
          <p className={`day-label ${day === '__unclaimed__' ? 'is-unclaimed' : ''}`}>
            {day === '__unclaimed__'
              ? `Unclaimed · trending on social, filed by nobody · checked against ${scoops.checkedAgainst || 0} live headlines`
              : day}{' '}
            <span>{items.length}</span>
          </p>
          <div className="cards">
            {items.map((r) =>
              r._kind === 'scoop' ? (
                <article key={r.id} className={`rd rd-scoop pr-${r.priority}`}>
                  <div className="rd-top">
                    <span className="chip st st-unclaimed">Unclaimed</span>
                    <span className="chip">{r.beat}</span>
                    <span className="rd-time">first seen {r.firstSeen}</span>
                  </div>

                  <div className="scoop-head">
                    <div className="scoop-count" title={`Trending on ${r.platformCount} platforms`}>
                      <b>{r.platformCount}</b>
                      <span>plat</span>
                    </div>
                    <h3>{r.headline}</h3>
                  </div>

                  <p className="rd-why">{r.summary}</p>

                  <div className="plat-row">
                    {r.platforms.map((pf) => (
                      <span key={pf} className="plat">{pf}</span>
                    ))}
                  </div>

                  <div className="rd-foot">
                    <span className="scoop-signal">{r.signal}</span>
                    <button
                      className="btn btn-sm btn-primary take"
                      disabled={!!taking}
                      onClick={() => take(r)}
                    >
                      {taking === r.id ? (<><span className="spinner" /> Producing…</>) : 'Take it'}
                    </button>
                  </div>
                </article>
              ) : (
              <article
                key={r.id}
                className={`rd rd-${r.status}`}
                onClick={() => onOpen?.(r.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen?.(r.id)}
              >
                <div className="rd-top">
                  <span className={`chip st st-${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
                  {r.beat && <span className="chip">{r.beat}</span>}
                  <span className="rd-time" title={new Date(r.createdAt).toLocaleString()}>
                    {ago(r.createdAt)}
                  </span>
                </div>

                <h3>{r.headline}</h3>
                {r.pickReason && <p className="rd-why">Why this: {r.pickReason}</p>}
                {r.error && <p className="rd-why err">{r.error}</p>}

                <div className="rd-foot">
                  <span>{r.formats}/13 formats</span>
                  <span className={r.approved === r.formats && r.formats ? 'ok' : ''}>
                    {r.approved} approved
                  </span>
                  <span>{r.factCount} facts</span>
                  {r.genMs != null && <span>{(r.genMs / 1000).toFixed(0)}s</span>}
                  {!!r.sources?.length && <span>{[...new Set(r.sources)].join(', ')}</span>}
                </div>
              </article>
              )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
