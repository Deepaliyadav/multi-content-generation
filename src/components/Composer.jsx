import { useState } from 'react';

export default function Composer({ meta, story, setStory, language, setLanguage, onGenerate, onLoadSample, busy }) {
  const [loaded, setLoaded] = useState(null);

  const loadSample = (s) => {
    onLoadSample(s);
    setLoaded(s.id);
  };

  const ready = story.headline.trim().length > 5 && story.body.trim().length > 120;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Source story</h2>
        <span className="count">step 1 of 3 · paste the copy</span>
      </div>
      <div className="panel-body">
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
            <label className="field">
              <span>Body</span>
              <textarea
                className="textarea"
                value={story.body}
                placeholder="Paste the filed copy here…"
                onChange={(e) => setStory({ ...story, body: e.target.value })}
              />
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
                    className="sample"
                    onClick={() => loadSample(s)}
                    style={loaded === s.id ? { borderLeftColor: 'var(--accent)' } : undefined}
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

      <div className="card-foot">
        <button className="btn btn-primary" disabled={!ready || busy} onClick={onGenerate}>
          {busy ? 'Working…' : 'Generate formats'}
        </button>
        <span className="meter spacer">
          {ready
            ? 'Facts are extracted first, then 13 formats are written against them.'
            : 'Paste a headline and body, or load a sample.'}
        </span>
      </div>
    </section>
  );
}
