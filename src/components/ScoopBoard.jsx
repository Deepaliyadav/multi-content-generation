import { useEffect, useState } from 'react';

/**
 * Unclaimed — trending on social, filed by nobody.
 *
 * The desk's whitespace. Priority is platform spread, because one platform is
 * noise and four at once is a story about to break everywhere. Sits at the top
 * of the board because being first is the only advantage that expires.
 *
 * The topics are seeded sample data; the check that no publisher has filed them
 * runs live against the wires and our own feeds, and the row says so.
 */
const PRIORITY_LABEL = { high: 'Take it now', medium: 'Rising', low: 'Watch' };

export default function ScoopBoard({ onProduced }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const r = await fetch('/api/scoops');
      if (r.ok) setData(await r.json());
    } catch {
      /* the board keeps what it had */
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, []);

  async function take(topic) {
    setBusy(topic.id);
    setError(null);
    try {
      const r = await fetch(`/api/scoops/${topic.id}/produce`, { method: 'POST' });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || 'Could not produce it');
      onProduced?.(out.id);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(null);
    }
  }

  if (!data?.scoops?.length) return null;

  return (
    <section className="panel scoops">
      <div className="panel-head">
        <span className="panel-num">↑</span>
        <h2>Unclaimed</h2>
        <span className="count">
          trending on social · filed by nobody · checked against {data.checkedAgainst} live headlines
        </span>
      </div>

      <div className="panel-body">
        <p className="panel-sub">
          Ranked by how many platforms carry it. A story on four platforms that no publisher has
          touched is the one to take first — being first is the only advantage that expires.
        </p>

        {error && <div className="error-box">{error}</div>}

        <div className="scoop-list">
          {data.scoops.map((s) => (
            <article key={s.id} className={`scoop pr-${s.priority}`}>
              <div className="scoop-rank">
                <b>{s.platformCount}</b>
                <span>platforms</span>
              </div>

              <div className="scoop-body">
                <div className="scoop-top">
                  <span className={`chip pr pr-${s.priority}`}>{PRIORITY_LABEL[s.priority]}</span>
                  <span className="chip">{s.beat}</span>
                  <span className="scoop-seen">first seen {s.firstSeen}</span>
                </div>

                <h3>{s.headline}</h3>
                <p className="scoop-sum">{s.summary}</p>

                <div className="scoop-plats">
                  {s.platforms.map((p) => (
                    <span key={p} className="plat">{p}</span>
                  ))}
                  <span className="scoop-signal">{s.signal}</span>
                </div>
              </div>

              <div className="scoop-act">
                <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => take(s)}>
                  {busy === s.id ? (<><span className="spinner" /> Producing…</>) : 'Take it'}
                </button>
              </div>
            </article>
          ))}
        </div>

        {!!data.claimed?.length && (
          <p className="hint" style={{ marginTop: 12 }}>
            {data.claimed.length} dropped off — a publisher has since filed{' '}
            {data.claimed.map((c) => c.claimed.outlet).join(', ')}.
          </p>
        )}

        {data.seeded && (
          <p className="hint scoop-note">
            Topics are sample data until a social listening source is connected. The check that
            nobody has filed them is live.
          </p>
        )}
      </div>
    </section>
  );
}
