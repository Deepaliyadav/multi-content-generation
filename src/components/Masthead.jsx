import ThemeToggle from './ThemeToggle.jsx';

/**
 * The desk header: who you are, where you are, and how the room is lit.
 *
 * The step indicator is not decoration — this app is a three-stage pipeline
 * (find a story, write the source, read the rundown) and without a marker the
 * only way to tell which stage you are in is to read the whole page.
 */
const STEPS = [
  ['compose', 'Source'],
  ['working', 'Writing'],
  ['review', 'Rundown'],
];

export default function Masthead({ metrics, stage }) {
  const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

  return (
    <header className="masthead">
      <div className="masthead-inner">
        <div className="mast-brand">
          <h1 className="wordmark">
            <img src="/more-logo.png" alt="More" />
          </h1>
          <span className="mast-tag">One story. Every platform.</span>
        </div>

        <div className="mast-right">
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
            </div>
          )}

          <nav className="steps" aria-label="Progress">
            {STEPS.map(([id, label], i) => (
              <span key={id} className="step-wrap">
                {i > 0 && <span className="step-sep">/</span>}
                <span className={`step ${stage === id ? 'on' : ''}`}>
                  <i />
                  {label}
                </span>
              </span>
            ))}
          </nav>

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
