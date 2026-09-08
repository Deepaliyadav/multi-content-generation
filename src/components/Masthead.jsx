const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export default function Masthead({ metrics }) {
  const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const dateline = DATE_FMT.format(new Date()).toUpperCase();

  return (
    <header className="masthead">
      <div className="masthead-inner">
        <div className="masthead-left">
          <div className="dateline">
            <span className="dot" />
            DESK COPY · ADAPTATION UNIT · {dateline}
          </div>
          <h1 className="wordmark">
            Rundown<span>.</span>
          </h1>
        </div>

        <p className="tagline">
          One story in. Every platform out.
          <br />
          Each one watched for the moment the story moves.
        </p>

        <div className="metrics">
          {metrics.genMs != null && (
            <div className="metric" title="Wall-clock time to generate every format">
              <b>{metrics.genCount} formats</b>
              <small>in {fmt(metrics.genMs)}</small>
            </div>
          )}
          {metrics.scanMs != null && (
            <div
              className={`metric ${metrics.staleCount ? 'alert' : ''}`}
              title="Time to re-check every published format against the updated fact ledger"
            >
              <b>
                {metrics.staleCount} of {metrics.scanTotal} stale
              </b>
              <small>in {fmt(metrics.scanMs)}</small>
              {metrics.totalLines != null && (
                <small>
                  {' '}
                  · {metrics.staleLines}/{metrics.totalLines} lines
                </small>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
