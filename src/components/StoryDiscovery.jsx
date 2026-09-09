import { useEffect, useRef, useState } from 'react';

/**
 * Intake lane 2: let the agent find the story.
 *
 * Sweeps competitor wires and trending search, clusters what it finds into
 * distinct stories, and checks each against the CMS. Anything we already have is
 * marked Already filed; the rest is recommended.
 *
 * Choosing one does NOT publish a competitor's copy — it drafts an attributed,
 * explicitly unverified starter brief that lands in the source panel for the
 * journalist to rewrite.
 */
/** "just now" / "4 min ago" / "1 hr 20 min ago" — how stale the list is. */
const ago = (iso) => {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs} hr ${rem} min ago` : `${hrs} hr ago`;
};

const countdown = (at) => {
  const left = Math.max(0, at - Date.now());
  const m = Math.floor(left / 60_000);
  return m >= 1 ? `${m}m` : `${Math.ceil(left / 1000)}s`;
};

export default function StoryDiscovery({ meta, onUseStory, onWriteMyself, busy }) {
  // Discovery leads: most sessions start by asking what is worth filing, not by
  // pasting copy that already exists. Writing it yourself is one click away.
  const [open, setOpen] = useState(true);
  const [useRss, setUseRss] = useState(true);
  const [useTrending, setUseTrending] = useState(true);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState(null);
  const [error, setError] = useState(null);
  const [drafting, setDrafting] = useState(null);
  const [filed, setFiled] = useState(() => new Set());
  const [filter, setFilter] = useState('all');
  const [sweeper, setSweeper] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [, tick] = useState(0);

  // The headline links the last paid sweep actually saw. Anything outside this
  // set is new copy that sweep never considered.
  const wireSeen = useRef(null);
  const runningRef = useRef(false);

  const d = meta?.discovery;

  async function sweep({ automatic = false } = {}) {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setError(null);
    setResult(null);
    setPhase(automatic ? 'Auto-refresh — new copy on the wire…' : 'Starting…');
    try {
      // Cheap and cached; pins the copy this sweep is answering for.
      try {
        const w = await (await fetch('/api/wire')).json();
        wireSeen.current = new Set((w.items || []).map((i) => i.link));
      } catch {
        /* the freshness check is an optimisation, not a requirement */
      }
      const r = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useRss, useTrending }),
      });
      if (!r.ok || !r.body) {
        let msg = `Sweep failed (${r.status})`;
        try {
          msg = (await r.json()).error || msg;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(msg);
      }

      // NDJSON: the sweep is far too slow to arrive as one response, so it
      // reports as it goes and the list fills in underneath the reader.
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === 'phase') setPhase(ev.phase);
          else if (ev.type === 'sources')
            setResult((p) => ({ ...(p || {}), sources: ev.sources, swept: ev.swept }));
          else if (ev.type === 'preliminary' || ev.type === 'checked')
            // Lanes land at different times, so merge by origin instead of
            // replacing — otherwise trending wipes the wire list and back again.
            setResult((p) => {
              const kept = (p?.clusters || []).filter((c) => c.origin !== ev.origin);
              return { ...(p || {}), clusters: [...kept, ...ev.clusters] };
            });
          else if (ev.type === 'done') {
            setResult((p) => ({ ...ev, clusters: ev.clusters?.length ? ev.clusters : p?.clusters }));
            setFetchedAt(new Date().toISOString());
          }
          else if (ev.type === 'fatal') throw new Error(ev.error);
        }
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      runningRef.current = false;
      setRunning(false);
      setPhase(null);
    }
  }

  // Relative times have to move on their own: the poll is every 20 seconds, so
  // without this the countdown and the "ago" labels sit stale between polls and
  // look frozen until something else re-renders the panel.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // The schedule lives on the server, so it keeps running while this panel is
  // closed, while the board is showing, and while the tab is in the background.
  // Here we only read it.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const last = await (await fetch('/api/discover/last')).json();
        if (!alive) return;
        setSweeper(last.sweeper || null);
        if (last?.clusters?.length) {
          setResult((prev) =>
            prev?.finishedAt === last.finishedAt ? prev : last
          );
          setFetchedAt(last.finishedAt || null);
          if (Array.isArray(last.wireLinks)) wireSeen.current = new Set(last.wireLinks);
        }
      } catch {
        /* the panel keeps whatever it last had */
      }
    };
    pull();
    const id = setInterval(pull, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function useStory(cluster, i) {
    setDrafting(i);
    setError(null);
    try {
      const r = await fetch('/api/discover/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cluster }),
      });
      const brief = await r.json();
      if (!r.ok) throw new Error(brief.error || 'Could not draft the brief');
      onUseStory(brief, cluster);
      setOpen(false);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setDrafting(null);
    }
  }

  async function markFiled(cluster, i) {
    try {
      await fetch('/api/cms/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline: cluster.headline, summary: cluster.summary, section: cluster.beat }),
      });
      setFiled((s) => new Set(s).add(i));
    } catch {
      /* non-critical demo affordance */
    }
  }

  const clusters = result?.clusters || [];
  const shown = clusters.filter((c) =>
    filter === 'all'
      ? true
      : filter === 'recommend'
      ? c.status === 'recommend' || c.status === 'checking'
      : c.status === 'already_filed'
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-num">00</span>
        <h2>Story intake</h2>
        <span className="count">where the story comes from</span>
      </div>

      <div className="panel-body">
        <div className="intake-modes">
          <button className={`intake-mode ${open ? 'active' : ''}`} onClick={() => setOpen(true)}>
            <b>Find me a story</b>
            <small>Sweep competitor wires and trending search, then check the CMS.</small>
          </button>
          <button className="intake-mode" onClick={onWriteMyself}>
            <b>Write it myself</b>
            <small>Go straight to the source panel and paste filed copy.</small>
          </button>
        </div>

        {open && (
          <div className="intake-body">
            <div className="btn-row" style={{ marginBottom: 10 }}>
              <label className="tick">
                <input type="checkbox" checked={useRss} onChange={(e) => setUseRss(e.target.checked)} />
                Competitor wires
                <span className="meter">
                  {(d?.feeds || []).map((f) => f.name).join(', ') || 'none configured'}
                </span>
              </label>
              <label className="tick">
                <input
                  type="checkbox"
                  checked={useTrending && !!d?.trendsReady}
                  disabled={!d?.trendsReady}
                  onChange={(e) => setUseTrending(e.target.checked)}
                />
                Trending topics
                <span className="meter">{d?.trendsReady ? 'web search agent' : 'needs ANTHROPIC_API_KEY'}</span>
              </label>
            </div>

            <div className="btn-row">
              <button
                className="btn btn-primary"
                disabled={running || busy || (!useRss && !useTrending)}
                onClick={sweep}
              >
                {running ? (
                  <>
                    <span className="spinner" /> Sweeping…
                  </>
                ) : (
                  'Sweep for stories'
                )}
              </button>
              <label className="tick" title="The server re-checks the wire every 5 minutes and only re-sweeps when new copy has landed. It keeps running whether or not this panel is open.">
                <input
                  type="checkbox"
                  checked={!!sweeper?.auto}
                  onChange={async (e) => {
                    const on = e.target.checked;
                    setSweeper((s) => ({ ...(s || {}), auto: on }));
                    const r = await fetch('/api/discover/auto', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ on }),
                    });
                    if (r.ok) setSweeper(await r.json());
                  }}
                />
                Auto
                <span className="meter">
                  {sweeper?.auto
                    ? sweeper.running
                      ? 'sweeping now…'
                      : sweeper.nextCheckAt
                      ? `next check in ${countdown(new Date(sweeper.nextCheckAt).getTime())}`
                      : 'every 5 min'
                    : 'off'}
                </span>
              </label>
              {fetchedAt && !running && (
                <span
                  className="meter updated"
                  title={`Wire last checked ${
                    sweeper?.lastCheckAt ? ago(sweeper.lastCheckAt) : 'unknown'
                  }. Results last changed ${new Date(fetchedAt).toLocaleString()}. A check only
re-sweeps when enough new copy has landed.`}
                >
                  {sweeper?.lastCheckAt && new Date(sweeper.lastCheckAt) > new Date(fetchedAt) ? (
                    <>
                      Checked {ago(sweeper.lastCheckAt)} · stories {ago(fetchedAt)}
                    </>
                  ) : (
                    <>Updated {ago(fetchedAt)}</>
                  )}
                </span>
              )}
              {(running || sweeper?.lastSkip) && (
                <span className="meter">{running ? phase || 'Working…' : sweeper?.lastSkip}</span>
              )}
            </div>

            {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}

            {!!result?.errors?.length && (
              <div className="warn" style={{ marginTop: 10 }}>
                {result.errors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            )}

            {result?.clusters && (
              <>
                <div className="sweep-stats">
                  <span>
                    <b>{result.swept ?? 0}</b> wire items
                  </span>
                  <span>
                    <b>{result.counts?.total ?? result.clusters?.length ?? 0}</b> distinct stories
                  </span>
                  <span className="good">
                    <b>{result.counts?.recommend ?? 0}</b> to file
                  </span>
                  <span className="dim">
                    <b>{result.counts?.alreadyFiled ?? 0}</b> already filed
                  </span>
                  {result.searches != null && (
                    <span>
                      <b>{result.searches}</b> web searches
                    </span>
                  )}
                  <span className="dim">in {((result.ms || 0) / 1000).toFixed(1)}s</span>
                </div>

                <div className="btn-row" style={{ margin: '10px 0' }}>
                  {['all', 'recommend', 'filed'].map((f) => (
                    <button
                      key={f}
                      className={`btn btn-sm ${filter === f ? 'btn-ink' : ''}`}
                      onClick={() => setFilter(f)}
                    >
                      {f === 'all' ? 'All' : f === 'recommend' ? 'Recommended' : 'Already filed'}
                    </button>
                  ))}
                </div>

                <div className="sweep-list">
                  {shown.map((c, i) => {
                    const idx = clusters.indexOf(c);
                    const checking = c.status === 'checking';
                    const isFiled = c.status === 'already_filed' || filed.has(idx);
                    return (
                      <article key={idx} className={`sweep-row ${isFiled || checking ? 'is-filed' : ''}`}>
                        <div className="sweep-row-head">
                          <span className={`chip ${checking ? 'done' : isFiled ? 'done' : 'recommend'}`}>
                            {checking ? 'Checking CMS…' : isFiled ? 'Already filed' : 'Recommend filing'}
                          </span>
                          <span className="chip">{c.beat}</span>
                          <span className="chip">{c.origin === 'trending' ? 'trending' : 'wire'}</span>
                          {c.confidence && <span className="meter">{c.confidence} confidence</span>}
                        </div>

                        <h4>{c.headline}</h4>
                        <p className="sweep-sum">{c.summary}</p>

                        {c.reason && <p className="sweep-reason">{c.reason}</p>}
                        {c.match && (
                          <p className="sweep-reason">
                            ↳ CMS: <span className="dim">{c.match.headline}</span>
                          </p>
                        )}
                        {c.evidence && <p className="sweep-reason">Trending: {c.evidence}</p>}

                        {!!c.sources?.length && (
                          <p className="sweep-src">
                            {[...new Set(c.sources.map((s) => s.source))].join(' · ')} —{' '}
                            {c.sources.slice(0, 2).map((s, j) => (
                              <a key={j} href={s.link} target="_blank" rel="noreferrer">
                                source {j + 1}
                              </a>
                            ))}
                          </p>
                        )}

                        <div className="btn-row">
                          <button
                            className="btn btn-sm btn-ink"
                            disabled={drafting !== null || busy}
                            onClick={() => useStory(c, idx)}
                          >
                            {drafting === idx ? (
                              <>
                                <span className="spinner" /> Drafting brief…
                              </>
                            ) : (
                              'Use this story'
                            )}
                          </button>
                          {!isFiled && d?.cmsCanFile && (
                            <button className="btn btn-sm" onClick={() => markFiled(c, idx)}>
                              Mark as filed
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                  {!shown.length && <div className="empty">Nothing in this view.</div>}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
