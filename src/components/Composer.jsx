import { useState } from 'react';

/**
 * Setup: the story on the left, the controls that act on it in a rail to the
 * right. The format slate and the Generate button are decisions *about* the
 * copy, so they sit beside it rather than below — you can pick formats without
 * scrolling past the body you just pasted.
 * Everything is on by default — the desk drops what it doesn't need rather
 * than picking from nothing.
 */
export default function Composer({
  meta,
  story,
  setStory,
  language,
  setLanguage,
  onGenerate,
  onLoadSample,
  busy,
  formats,
  selected,
  onToggleFormat,
  onSelectAll,
  onSelectNone,
}) {
  const [loaded, setLoaded] = useState(null);

  const loadSample = (s) => {
    onLoadSample(s);
    setLoaded(s.id);
  };

  const words = story.body.trim() ? story.body.trim().split(/\s+/).length : 0;
  const ready =
    story.headline.trim().length > 5 && story.body.trim().length > 120 && selected.size > 0;

  return (
    <div className="setup-grid">
      <section className="panel">
        <div className="panel-head">
          <span className="panel-num">01</span>
          <h2>Source story</h2>
          <span className="count">step 1 of 3 · paste the copy</span>
        </div>

        <div className="panel-body">
          <p className="panel-sub">
            Paste the filed copy, or load a sample to see the desk in action. Facts are extracted
            from this before a single word is written.
          </p>

          <div className="composer-grid">
            <div>
              <label className="field">
                <span>Headline</span>
                <input
                  className="input"
                  value={story.headline}
                  placeholder="Five dead as stairwell collapses at Noida industrial unit"
                  onChange={(e) => setStory({ ...story, headline: e.target.value })}
                />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Body</span>
                <textarea
                  className="textarea"
                  value={story.body}
                  placeholder="Paste the filed copy here…"
                  onChange={(e) => setStory({ ...story, body: e.target.value })}
                />
                <div className="wordcount">{words} words</div>
              </label>
            </div>

            <div>
              <label className="field">
                <span>Translation language</span>
                <select
                  className="select"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {(meta?.languages || []).map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
                <p className="hint">Used for the Translation output.</p>
              </label>

              <div className="field">
                <span>Load a sample story</span>
                <div className="sample-list">
                  {(meta?.samples || []).map((s) => (
                    <button
                      key={s.id}
                      className={`sample ${loaded === s.id ? 'on' : ''}`}
                      onClick={() => loadSample(s)}
                    >
                      <b>{s.name}</b>
                      <small>{s.tag}</small>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="control-rail">
      <section className="panel">
        <div className="panel-head">
          <span className="panel-num">02</span>
          <h2>Target formats</h2>
          <span className="count">
            {selected.size} of {formats.length} selected
          </span>
        </div>
        <div className="panel-body">
          <p className="panel-sub">
            All formats are selected by default. Click to drop any you don't need — dropped formats
            are never generated, so the run gets shorter too.
          </p>

          <div className="chip-grid">
            {formats.map((f, i) => {
              const on = selected.has(f.id);
              return (
                <button
                  key={f.id}
                  className={`chip-toggle ${on ? 'on' : ''}`}
                  aria-pressed={on}
                  title={f.blurb}
                  onClick={() => onToggleFormat(f.id)}
                >
                  <span className="box" />
                  <span className="chip-num">{String(i + 1).padStart(2, '0')}</span>
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="btn-row">
            <button className="btn btn-sm" onClick={onSelectAll}>
              Select all
            </button>
            <button className="btn btn-sm" onClick={onSelectNone}>
              Clear
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-body">
        <button className="btn btn-primary btn-generate" disabled={!ready || busy} onClick={onGenerate}>
          {busy ? 'Working…' : 'Generate rundown'}
        </button>
        <span className="gen-hint">
          {!story.headline.trim() || !story.body.trim()
            ? 'Paste a headline and body, or load a sample.'
            : !ready && !selected.size
            ? 'Pick at least one format.'
            : !ready
            ? 'The body needs to be a little longer before the ledger is worth extracting.'
            : `Facts are extracted first, then ${selected.size} formats are written against them.`}
        </span>
        </div>
      </section>
      </aside>
    </div>
  );
}
