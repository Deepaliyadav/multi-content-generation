export default function Masthead({ meta, metrics }) {
  const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <h1 className="wordmark">
          Living Story Sync<span>.</span>
        </h1>
        <div className="rule-v" />
        <p className="tagline">
          One source story in. Thirteen formats out. Every one of them watched for the moment the
          story changes underneath it.
        </p>

        <div className="metrics">
          {metrics.genMs != null && (
            <div className="metric" title="Wall-clock time to generate every format">
              <b>{metrics.genCount} formats</b>
              <small>in {fmt(metrics.genMs)}</small>
            </div>
          )}
          {metrics.scanMs != null && (
            <div className={`metric ${metrics.staleCount ? 'alert' : ''}`} title="Time to re-check every published format against the updated fact ledger">
              <b>
                {metrics.staleCount} of {metrics.scanTotal} stale
              </b>
              <small>in {fmt(metrics.scanMs)}</small>
              {metrics.totalLines != null && (
                <small>· {metrics.staleLines}/{metrics.totalLines} lines</small>
              )}
            </div>
          )}
          {meta && (
            <span className="backend-chip">
              <i>●</i> {meta.backendLabel}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
