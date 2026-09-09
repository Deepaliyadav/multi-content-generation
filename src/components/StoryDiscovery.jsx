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
const AUTO_MS = 5 * 60_000;

/**
 * How many genuinely new headlines justify paying for another sweep.
 *
 * An exact fingerprint of the wire is the wrong test: these feeds push hundreds
 * of items a day, so the top of the wire differs within a minute or two and
 * every cycle would re-cluster essentially the same news. What matters is
 * whether enough NEW copy has landed to change the answer.
 */
const NEW_ITEMS_TO_RESWEEP = 5;

const countdown = (at) => {
  const left = Math.max(0, at - Date.now());
  const m = Math.floor(left / 60_000);
  return m >= 1 ? `${m}m` : `${Math.ceil(left / 1000)}s`;
};

export default function StoryDiscovery({ meta, onUseStory, busy }) {
  const [open, setOpen] = useState(false);
  const [useRss, setUseRss] = useState(true);
  const [useTrending, setUseTrending] = useState(true);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState(null);
  const [error, setError] = useState(null);
  const [drafting, setDrafting] = useState(null);
  const [filed, setFiled] = useState(() => new Set());
  const [filter, setFilter] = useState('all');
  const [auto, setAuto] = useState(true);
  const [nextAt, setNextAt] = useState(null);
  const [autoNote, setAutoNote] = useState(null);
  const [, tick] = useState(0);

  // The headline links the last paid sweep actually saw. Anything outside this
  // set is new copy that sweep never considered.
  const wireSeen = useRef(null);
  const runningRef = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const d = meta?.discovery;

  async function sweep({ automatic = false } = {}) {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setError(null);
    setResult(null);
    setAutoNote(null);
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
          else if (ev.type === 'done') setResult((p) => ({ ...ev, clusters: ev.clusters?.length ? ev.clusters : p?.clusters }));
          else if (ev.type === 'fatal') throw new Error(ev.error);
        }
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      runningRef.current = false;
      setRunning(false);
      setPhase(null);
      setNextAt(Date.now() + AUTO_MS);
    }
  }

  useEffect(() => {
    if (!open || !auto) {
      setNextAt(null);
      return;
    }
    setNextAt((n) => n ?? Date.now() + AUTO_MS);

    const id = setInterval(async () => {
      // Never sweep over the top of a running job, and never spend on a tab
      // nobody is looking at.
      if (document.hidden || runningRef.current || busyRef.current) {
        setNextAt(Date.now() + AUTO_MS); // don't let the countdown sit at 0s
        return;
      }
      try {
        const w = await (await fetch('/api/wire')).json();
        if (wireSeen.current) {
          const fresh = (w.items || []).filter((i) => !wireSeen.current.has(i.link)).length;
          if (fresh < NEW_ITEMS_TO_RESWEEP) {
            setAutoNote(
              `Checked ${new Date().toLocaleTimeString()} — ${fresh || 'no'} new headline${fresh === 1 ? '' : 's'} since the last sweep, not enough to re-run.`
            );
            setNextAt(Date.now() + AUTO_MS);
            return;
          }
          setAutoNote(`${fresh} new headlines on the wire — re-sweeping.`);
        }
      } catch {
        /* if the wire check fails, fall through and sweep anyway */
      }
      await sweep({ automatic: true });
    }, AUTO_MS);

    return () => clearInterval(id);
  }, [open, auto]);

  // Keeps the countdown honest without re-rendering every second.
  useEffect(() => {
    if (!nextAt) return;
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [nextAt]);

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
          <button className={`intake-mode ${!open ? 'active' : ''}`} onClick={() => setOpen(false)}>
            <b>Write it myself</b>
            <small>Paste filed copy into the source panel below.</small>
          </button>
          <button className={`intake-mode ${open ? 'active' : ''}`} onClick={() => setOpen(true)}>
            <b>Find me a story</b>
            <small>Sweep competitor wires and trending search, then check the CMS.</small>
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
              <label className="tick" title="Re-checks the wire every 5 minutes and only re-sweeps when new copy has landed">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                Auto
                <span className="meter">
                  {auto ? (nextAt ? `next check in ${countdown(nextAt)}` : 'every 5 min') : 'off'}
                </span>
              </label>
              <span className="meter">
                {running ? phase || 'Working…' : autoNote || `Checked against ${d?.cmsLabel || 'the CMS'}`}
              </span>
            </div>

            {d?.cmsSimulated && (
              <p className="hint" style={{ marginTop: 8 }}>
                The CMS here is a local stand-in, so “Already filed” is demonstrable. The matching
                that runs against it is real. Point <code>CMS_SEARCH_URL</code> at the newsroom CMS
                to use live data.
              </p>
            )}

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
                          {!isFiled && d?.cmsSimulated && (
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
