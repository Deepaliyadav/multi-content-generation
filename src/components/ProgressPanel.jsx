/** Shows what is actually happening, format by format — never a bare spinner. */
export default function ProgressPanel({ formats, status, times, phase }) {
  const done = formats.filter((f) => status[f.id] === 'done').length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{phase}</h2>
        <span className="count">
          {done} of {formats.length} written
        </span>
      </div>
      <div className="progress-list">
        {formats.map((f) => {
          const st = status[f.id] || 'queued';
          return (
            <div key={f.id} className={`prow ${st}`}>
              <span className="prow-dot" />
              <span>
                {st === 'running' ? `${f.verb}…` : f.label}
                {st === 'error' && ' — failed'}
              </span>
              <span className="prow-time">
                {st === 'done' && times[f.id]
                  ? `${(times[f.id] / 1000).toFixed(1)}s`
                  : st === 'running'
                  ? 'processing…'
                  : ''}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
