/**
 * The output rail — every generated format, grouped by desk, with its state
 * carried on a single dot so a stale format is visible without opening it.
 */
export default function FormatRail({
  formats,
  groups,
  active,
  onSelect,
  outputs,
  status,
  times,
  errors,
  staleReport,
  published,
}) {
  const dotClass = (f) => {
    if (errors[f.id]) return 'error';
    if (staleReport[f.id]?.stale) return 'stale';
    if (published[f.id]) return 'published';
    if (status[f.id] === 'running') return 'running';
    return '';
  };

  const metaLine = (f) => {
    if (errors[f.id]) return 'failed';
    if (staleReport[f.id]?.stale) return 'stale — needs patching';
    if (published[f.id]) return 'published';
    const out = outputs[f.id];
    if (!out) return status[f.id] === 'running' ? 'writing…' : 'queued';
    const lines = (out.blocks || []).reduce((n, b) => n + (b.lines || []).length, 0);
    const t = times[f.id] ? ` · ${(times[f.id] / 1000).toFixed(1)}s` : '';
    return `${lines} line${lines === 1 ? '' : 's'}${t}`;
  };

  let n = 0;

  return (
    <nav className="format-rail">
      {groups.map((g) => {
        const inGroup = formats.filter((f) => f.group === g.id);
        if (!inGroup.length) return null;
        return (
          <div key={g.id}>
            <div className="rail-group">{g.label}</div>
            {inGroup.map((f) => {
              n += 1;
              const dot = dotClass(f);
              return (
                <button
                  key={f.id}
                  className={`rail-item ${active === f.id ? 'active' : ''}`}
                  onClick={() => onSelect(f.id)}
                >
                  <span className="row1">
                    <span className="rnum">{String(n).padStart(2, '0')}</span>
                    <span className="rlabel">{f.label}</span>
                    {dot && <span className={`rdot ${dot}`} />}
                  </span>
                  <span className="rmeta">{metaLine(f)}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
