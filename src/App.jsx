import { useEffect, useMemo, useState } from 'react';
import * as api from './lib/api.js';
import Masthead from './components/Masthead.jsx';
import Composer from './components/Composer.jsx';
import FactLedger from './components/FactLedger.jsx';
import ProgressPanel from './components/ProgressPanel.jsx';
import OutputCard from './components/OutputCard.jsx';

export default function App() {
  const [meta, setMeta] = useState(null);
  const [stage, setStage] = useState('compose'); // compose | working | review

  const [story, setStory] = useState({ headline: '', body: '' });
  const [language, setLanguage] = useState('Hindi');
  const [sample, setSample] = useState(null);

  const [facts, setFacts] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [outputs, setOutputs] = useState({});
  const [status, setStatus] = useState({});
  const [times, setTimes] = useState({});
  const [errors, setErrors] = useState({});
  const [published, setPublished] = useState({});

  const [diff, setDiff] = useState(null);
  const [staleReport, setStaleReport] = useState({});
  const [patches, setPatches] = useState({});
  const [visualBefore, setVisualBefore] = useState({});

  const [metrics, setMetrics] = useState({});
  const [tab, setTab] = useState('article');
  const [phase, setPhase] = useState('Extracting facts');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const [scanning, setScanning] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState({ headline: '', body: '' });

  useEffect(() => {
    api.getMeta().then(setMeta).catch((e) => setError(String(e.message || e)));
  }, []);

  const formats = meta?.formats || [];
  const groups = meta?.groups || [];
  const changedLabels = useMemo(() => (diff?.changed || []).map((c) => c.label), [diff]);
  const staleIds = useMemo(
    () => formats.filter((f) => staleReport[f.id]?.stale).map((f) => f.id),
    [formats, staleReport]
  );

  /* ── generate ───────────────────────────────────────────────────────── */

  async function runGenerate() {
    setError(null);
    setStage('working');
    setPhase('Extracting facts');
    setExtracting(true);
    setFacts([]);
    setOutputs({});
    setStatus({});
    setTimes({});
    setErrors({});
    setPublished({});
    setDiff(null);
    setScanning(false);
    setStaleReport({});
    setPatches({});
    setVisualBefore({});
    setMetrics({});

    try {
      const { facts: got } = await api.extractFacts(story);
      setFacts(got);
      setExtracting(false);
      setPhase('Writing the formats');
      setStatus(Object.fromEntries(formats.map((f) => [f.id, 'queued'])));

      const t0 = performance.now();
      await api.generate({ story, facts: got, language }, (ev) => {
        if (ev.type === 'format:start') setStatus((s) => ({ ...s, [ev.formatId]: 'running' }));
        if (ev.type === 'format:done') {
          setOutputs((o) => ({ ...o, [ev.formatId]: ev.output }));
          setTimes((t) => ({ ...t, [ev.formatId]: ev.output.ms }));
          setStatus((s) => ({ ...s, [ev.formatId]: 'done' }));
        }
        if (ev.type === 'format:error') {
          setErrors((e) => ({ ...e, [ev.formatId]: ev.error }));
          setStatus((s) => ({ ...s, [ev.formatId]: 'error' }));
        }
        if (ev.type === 'done')
          setMetrics((m) => ({ ...m, genMs: ev.ms, genCount: formats.length }));
        if (ev.type === 'fatal') setError(ev.error);
      });
      setMetrics((m) => ({ ...m, genMs: m.genMs ?? performance.now() - t0, genCount: formats.length }));
      setStage('review');
    } catch (e) {
      setExtracting(false);
      setError(String(e.message || e));
      setStage(facts.length ? 'review' : 'compose');
    }
  }

  /* ── edit propagation ───────────────────────────────────────────────── */

  function openSource() {
    setSourceDraft({ ...story });
    setSourceOpen(true);
  }

  async function applySourceEdit() {
    setError(null);
    setBusy('source');
    setPhase('Re-reading the source');
    const t0 = performance.now();
    try {
      const { facts: newFacts, diff: d } = await api.rediff(sourceDraft, facts);
      setStory(sourceDraft);
      setFacts(newFacts);
      setDiff(d);
      setSourceOpen(false);

      if (!d.changed.length && !d.removed.length) {
        setStaleReport({});
        setMetrics((m) => ({ ...m, scanMs: performance.now() - t0, staleCount: 0, scanTotal: formats.length }));
        setBusy(null);
        return;
      }

      // The ledger correction lands first; the verdict banner stays in a
      // "still checking" state until the scan actually returns, so the UI never
      // claims nothing was affected while it is still looking.
      setScanning(true);
      setPhase('Checking published formats against the updated facts');
      const payload = formats
        .filter((f) => outputs[f.id])
        .map((f) => ({
          formatId: f.id,
          blocks: outputs[f.id].blocks,
          visual: outputs[f.id].visual,
          factsUsed: outputs[f.id].factsUsed,
        }));
      const { report, staleCount, staleLines, totalLines } = await api.scan(payload, d.changed);
      setStaleReport(report);
      setPatches({});
      setVisualBefore({});
      setMetrics((m) => ({
        ...m,
        scanMs: performance.now() - t0,
        staleCount,
        scanTotal: payload.length,
        staleLines,
        totalLines,
      }));
      const firstStale = formats.find((f) => report[f.id]?.stale);
      if (firstStale) setTab(firstStale.group);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setScanning(false);
      setBusy(null);
    }
  }

  /* ── targeted regeneration ──────────────────────────────────────────── */

  async function regenerate(formatId) {
    const st = staleReport[formatId];
    if (!st) return;
    setBusy(formatId);
    setError(null);
    try {
      let next = outputs[formatId];
      let patchList = [];
      let vBefore = null;

      if (st.staleLines?.length) {
        const r = await api.patch({
          formatId,
          output: next,
          keys: st.staleLines.map((l) => l.key),
          changes: diff.changed,
          facts,
          story,
          language,
        });
        next = r.output;
        patchList = r.patches;
      }
      if (st.staleVisual) {
        const r = await api.patchVisual({
          formatId,
          output: next,
          changes: diff.changed,
          facts,
          story,
          language,
        });
        next = r.output;
        vBefore = r.visualBefore;
      }

      setOutputs((o) => ({ ...o, [formatId]: { ...next, formatId } }));
      setPatches((p) => ({ ...p, [formatId]: patchList }));
      setVisualBefore((v) => ({ ...v, [formatId]: vBefore }));
      setStaleReport((s) => ({ ...s, [formatId]: { ...s[formatId], stale: false, staleLines: [], staleVisual: false } }));
    } catch (e) {
      setError(`${formatId}: ${String(e.message || e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function regenerateAll() {
    for (const id of staleIds) await regenerate(id); // sequential: readable on a projector
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  const visibleFormats = formats.filter((f) => f.group === tab);
  const showRail = stage !== 'compose';

  return (
    <>
      <Masthead meta={meta} metrics={metrics} />

      <div className={`frame ${showRail ? '' : 'solo'}`}>
        {showRail && (
          <aside className="rail">
            <FactLedger
              facts={facts}
              diff={diff}
              extracting={extracting}
              canEdit={stage === 'review' && !sourceOpen}
              onEditSource={openSource}
            />
          </aside>
        )}

        <main>
          {error && <div className="error-box"><b>Something went wrong.</b> {error}</div>}

          {stage === 'compose' && (
            <Composer
              meta={meta}
              story={story}
              setStory={setStory}
              language={language}
              setLanguage={setLanguage}
              busy={busy}
              onLoadSample={(s) => {
                setStory({ headline: s.headline, body: s.body });
                setSample(s);
              }}
              onGenerate={runGenerate}
            />
          )}

          {stage === 'working' && (
            <>
              <section className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-head">
                  <h2>{phase}</h2>
                  <span className="count">
                    <span className="spinner" /> &nbsp;working
                  </span>
                </div>
                <div className="panel-body">
                  <p className="hint" style={{ fontSize: 14 }}>
                    {extracting
                      ? 'Facts are extracted before a single word is generated — every format is written against that ledger, and nothing outside it may appear.'
                      : 'Each format is written to its own contract: character ceilings, slide counts and part structures are checked in code, not just requested in the prompt.'}
                  </p>
                </div>
              </section>
              {!extracting && (
                <ProgressPanel formats={formats} status={status} times={times} phase={phase} />
              )}
            </>
          )}

          {sourceOpen && (
            <section className="panel" style={{ marginBottom: 16, borderColor: 'var(--ink)' }}>
              <div className="panel-head">
                <h2>Edit source story</h2>
                <span className="count">the story is developing</span>
              </div>
              <div className="panel-body">
                <label className="field">
                  <span>Headline</span>
                  <input
                    className="input"
                    value={sourceDraft.headline}
                    onChange={(e) => setSourceDraft({ ...sourceDraft, headline: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Body</span>
                  <textarea
                    className="textarea"
                    style={{ minHeight: 240 }}
                    value={sourceDraft.body}
                    onChange={(e) => setSourceDraft({ ...sourceDraft, body: e.target.value })}
                  />
                </label>
                {!!sample?.updates?.length && (
                  <>
                    <span className="eyebrow" style={{ display: 'block', marginBottom: 7 }}>
                      Or apply a developing update
                    </span>
                    <div className="btn-row">
                      {sample.updates.map((u) => (
                        <button
                          key={u.label}
                          className="btn btn-sm"
                          title={u.note}
                          onClick={() => setSourceDraft({ headline: u.headline, body: u.body })}
                        >
                          ⟲ {u.label}
                        </button>
                      ))}
                    </div>
                    <p className="hint">
                      {sample.updates.map((u) => u.note).join(' ')} Either way the ledger is
                      re-extracted and diffed — nothing is hard-coded.
                    </p>
                  </>
                )}
              </div>
              <div className="card-foot">
                <button className="btn btn-primary" disabled={busy === 'source'} onClick={applySourceEdit}>
                  {busy === 'source' ? <><span className="spinner" /> Re-checking…</> : 'Update source & re-check formats'}
                </button>
                <button className="btn" onClick={() => setSourceOpen(false)}>Cancel</button>
                <span className="meter spacer">
                  The ledger is rebuilt and diffed, then every generated format is checked against what changed.
                </span>
              </div>
            </section>
          )}

          {stage === 'review' && (
            <>
              {diff && (
                <div className={`banner ${staleIds.length || scanning ? '' : 'clean'}`}>
                  <span className="banner-mark">
                    {scanning ? <span className="spinner" /> : staleIds.length ? '⚠' : '✓'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <h3>
                      {scanning
                        ? `Checking all ${formats.length} formats against the corrected ledger…`
                        : staleIds.length
                        ? `${staleIds.length} of ${metrics.scanTotal ?? formats.length} formats are now stale`
                        : 'No published format was affected by that edit'}
                    </h3>
                    <p>
                      {diff.changed.length
                        ? `Changed: ${diff.changed.map((c) => `${c.label} ${c.oldValue} → ${c.newValue}`).join(' · ')}.`
                        : 'The edit did not change any fact in the ledger.'}
                      {!scanning && staleIds.length
                        ? ` ${metrics.staleLines} of ${metrics.totalLines} published lines carry an outdated value — only those lines get rewritten. The other ${metrics.totalLines - metrics.staleLines} are left byte-for-byte.`
                        : ''}
                      {scanning ? ' Matching every published line against the facts that moved…' : ''}
                    </p>
                    {!scanning && !!staleIds.length && (
                      <div className="btn-row">
                        <button className="btn btn-sm btn-ink" disabled={!!busy} onClick={regenerateAll}>
                          {busy && busy !== 'source' ? <><span className="spinner" /> Patching…</> : `Patch all ${staleIds.length} stale formats`}
                        </button>
                        <span className="meter">
                          Patched one at a time so you can watch each before / after.
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <nav className="tabs">
                {groups.map((g) => {
                  const inGroup = formats.filter((f) => f.group === g.id);
                  const staleHere = inGroup.filter((f) => staleReport[f.id]?.stale).length;
                  return (
                    <button
                      key={g.id}
                      className={`tab ${tab === g.id ? 'active' : ''}`}
                      onClick={() => setTab(g.id)}
                    >
                      {g.label}
                      <span className="n">{inGroup.length}</span>
                      {!!staleHere && <span className="stale-dot" title={`${staleHere} stale`} />}
                    </button>
                  );
                })}
              </nav>

              <div className="cards">
                {visibleFormats.map((f) => (
                  <OutputCard
                    key={f.id}
                    index={formats.findIndex((x) => x.id === f.id) + 1}
                    format={f}
                    output={outputs[f.id]}
                    error={errors[f.id]}
                    state={published[f.id] ? 'published' : 'review'}
                    stale={staleReport[f.id]}
                    patches={patches[f.id]}
                    visualBefore={visualBefore[f.id]}
                    changedLabels={changedLabels}
                    busy={busy === f.id}
                    onApprove={() => setPublished((p) => ({ ...p, [f.id]: true }))}
                    onSave={(blocks) =>
                      setOutputs((o) => ({ ...o, [f.id]: { ...o[f.id], blocks } }))
                    }
                    onRegenerate={() => regenerate(f.id)}
                  />
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
