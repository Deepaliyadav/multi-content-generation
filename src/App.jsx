import { useEffect, useMemo, useState } from 'react';
import * as api from './lib/api.js';
import Masthead from './components/Masthead.jsx';
import WireTicker from './components/WireTicker.jsx';
import Composer from './components/Composer.jsx';
import StoryDiscovery from './components/StoryDiscovery.jsx';
import FactLedger from './components/FactLedger.jsx';
import ProgressPanel from './components/ProgressPanel.jsx';
import FormatRail from './components/FormatRail.jsx';
import ContentPane from './components/ContentPane.jsx';

export default function App() {
  const [meta, setMeta] = useState(null);
  const [stage, setStage] = useState('compose'); // compose | working | review
  const [brief, setBrief] = useState(null); // starter brief pulled in from discovery
  // What the last plain rewrite actually did. A rewrite against an unchanged
  // ledger legitimately returns near-identical copy, which reads as a dead
  // button unless the desk is told how much moved.
  const [rewriteNote, setRewriteNote] = useState({});

  const [story, setStory] = useState({ headline: '', body: '' });
  const [language, setLanguage] = useState('Hindi');
  const [sample, setSample] = useState(null);

  const [facts, setFacts] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [outputs, setOutputs] = useState({});
  const [status, setStatus] = useState({});
  const [times, setTimes] = useState({});
  const [errors, setErrors] = useState({});

  const [diff, setDiff] = useState(null);
  const [staleReport, setStaleReport] = useState({});
  const [patches, setPatches] = useState({});
  const [visualBefore, setVisualBefore] = useState({});

  const [metrics, setMetrics] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [active, setActive] = useState(null); // the format id in the pane
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [phase, setPhase] = useState('Extracting facts');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const [scanning, setScanning] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState({ headline: '', body: '' });

  useEffect(() => {
    api
      .getMeta()
      .then((m) => {
        setMeta(m);
        // Everything is on by default — the desk drops what it doesn't need.
        setSelected(new Set((m.formats || []).map((f) => f.id)));
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  const allFormats = meta?.formats || [];
  /** Only the formats this run actually asked for. */
  const formats = useMemo(
    () => allFormats.filter((f) => selected.has(f.id)),
    [allFormats, selected]
  );
  const staleIds = useMemo(
    () => formats.filter((f) => staleReport[f.id]?.stale).map((f) => f.id),
    [formats, staleReport]
  );

  const toggleFormat = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  /* ── generate ───────────────────────────────────────────────────────── */

  async function runGenerate() {
    const ids = allFormats.filter((f) => selected.has(f.id)).map((f) => f.id);
    setError(null);
    setStage('working');
    setPhase('Extracting facts');
    setExtracting(true);
    setFacts([]);
    setOutputs({});
    setStatus({});
    setTimes({});
    setErrors({});
    setDiff(null);
    setScanning(false);
    setStaleReport({});
    setPatches({});
    setVisualBefore({});
    setMetrics({});
    setActive(ids[0] ?? null);

    try {
      const { facts: got } = await api.extractFacts(story);
      setFacts(got);
      setExtracting(false);
      setPhase('Writing the formats');
      setStatus(Object.fromEntries(ids.map((id) => [id, 'queued'])));

      const t0 = performance.now();
      await api.generate({ story, facts: got, language, only: ids }, (ev) => {
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
        if (ev.type === 'done') setMetrics((m) => ({ ...m, genMs: ev.ms, genCount: ids.length }));
        if (ev.type === 'fatal') setError(ev.error);
      });
      setMetrics((m) => ({ ...m, genMs: m.genMs ?? performance.now() - t0, genCount: ids.length }));
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
      if (firstStale) setActive(firstStale.id);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setScanning(false);
      setBusy(null);
    }
  }

  /* ── targeted regeneration ──────────────────────────────────────────── */

  async function regenerate(formatId, steer = '') {
    const st = staleReport[formatId];
    // A desk note is a request to rewrite, not to patch — so it wins over the
    // line-level patch path even when the format is also stale.
    if (steer.trim() || !st?.stale) return rewrite(formatId, steer);

    setBusy(formatId);
    setError(null);
    try {
      let next = outputs[formatId];
      let patchList = [];
      let vBefore = null;

      if (st.staleLines?.length) {
        const { svg: _drop, ...lean } = next; // re-rendered server-side; no need to upload it
        const r = await api.patch({
          formatId,
          output: lean,
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
        const { svg: _drop2, ...lean2 } = next;
        const r = await api.patchVisual({
          formatId,
          output: lean2,
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
      setRewriteNote((r) => ({ ...r, [formatId]: null }));
      setVisualBefore((v) => ({ ...v, [formatId]: vBefore }));
      setStaleReport((s) => ({ ...s, [formatId]: { ...s[formatId], stale: false, staleLines: [], staleVisual: false } }));
    } catch (e) {
      setError(`${formatId}: ${String(e.message || e)}`);
    } finally {
      setBusy(null);
    }
  }

  /** How many lines actually moved between two versions of one output. */
  function lineDelta(before, after) {
    const flat = (o) => (o?.blocks || []).flatMap((b) => b.lines || []);
    const a = flat(before);
    const b = flat(after);
    const total = Math.max(a.length, b.length);
    let changed = 0;
    for (let i = 0; i < total; i++) if ((a[i] ?? '') !== (b[i] ?? '')) changed++;
    return { changed, total };
  }

  /** A plain rewrite of one format against the current ledger. */
  async function rewrite(formatId, steer = '', langOverride) {
    if (!facts.length) return;
    setBusy(formatId);
    setError(null);
    setErrors((e) => ({ ...e, [formatId]: undefined }));
    const before = outputs[formatId];
    try {
      const lang = langOverride || language;
      await api.generate({ story, facts, language: lang, only: [formatId], steer }, (ev) => {
        if (ev.type === 'format:done') {
          setRewriteNote((r) => ({
            ...r,
            [ev.formatId]: { ...lineDelta(before, ev.output), ms: ev.output.ms, steer: steer.trim() },
          }));
          setOutputs((o) => ({ ...o, [ev.formatId]: ev.output }));
          setTimes((t) => ({ ...t, [ev.formatId]: ev.output.ms }));
          setStatus((s) => ({ ...s, [ev.formatId]: 'done' }));
          setPatches((p) => ({ ...p, [ev.formatId]: null }));
          setVisualBefore((v) => ({ ...v, [ev.formatId]: null }));
        }
        if (ev.type === 'format:error') {
          setErrors((e) => ({ ...e, [ev.formatId]: ev.error }));
          setStatus((s) => ({ ...s, [ev.formatId]: 'error' }));
        }
        if (ev.type === 'fatal') setError(ev.error);
      });
    } catch (e) {
      setError(`${formatId}: ${String(e.message || e)}`);
    } finally {
      setBusy(null);
    }
  }

  /** Switch the translation to another language, in place. */
  async function retranslate(lang) {
    setLanguage(lang);
    await rewrite('translation', '', lang);
  }

  async function regenerateAll() {
    for (const id of staleIds) await regenerate(id); // sequential: readable on a projector
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  const showRail = stage === 'working' || (stage === 'review' && ledgerOpen);
  const activeFormat = formats.find((f) => f.id === active) || formats[0] || null;

  return (
    <>
      <Masthead metrics={metrics} />
      <WireTicker />

      <div className={`frame ${showRail ? 'split' : ''}`}>
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

        <main style={{ minWidth: 0 }}>
          {meta && !meta.backendReady && (
            <div className="error-box">
              <b>No model backend available.</b> {meta.backendHint}
              <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--text-dim)' }}>
                Restart the server after setting one — the app cannot generate until then.
              </div>
            </div>
          )}
          {error && (
            <div className="error-box">
              <b>Something went wrong.</b> {error}
            </div>
          )}

          {stage === 'compose' && (
            <StoryDiscovery
              meta={meta}
              busy={busy}
              onUseStory={(b, cluster) => {
                setStory({ headline: b.headline, body: b.body });
                setSample(null);
                setBrief({ ...b, from: cluster.headline, origin: cluster.origin });
              }}
            />
          )}

          {stage === 'compose' && brief && (
            <div className="banner" style={{ marginBottom: 14 }}>
              <span className="banner-mark">⚑</span>
              <div>
                <h3>Unverified starter brief — rewrite before you file</h3>
                <p>
                  Drafted from {brief.sourcedFrom?.length ? brief.sourcedFrom.join(', ') : 'a trending-topic search'} and
                  attributed to them throughout. Nothing here has been confirmed by this desk, and the
                  last paragraph lists what still needs checking. Edit it into your own copy below —
                  the thirteen formats are only ever as good as this source.
                </p>
              </div>
            </div>
          )}

          {stage === 'compose' && (
            <Composer
              meta={meta}
              story={story}
              setStory={setStory}
              language={language}
              setLanguage={setLanguage}
              busy={busy || (meta && !meta.backendReady)}
              formats={allFormats}
              selected={selected}
              onToggleFormat={toggleFormat}
              onSelectAll={() => setSelected(new Set(allFormats.map((f) => f.id)))}
              onSelectNone={() => setSelected(new Set())}
              onLoadSample={(s) => {
                setStory({ headline: s.headline, body: s.body });
                setSample(s);
                setBrief(null);
              }}
              onGenerate={runGenerate}
            />
          )}

          {stage === 'working' && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <span className="panel-num">03</span>
                  <h2>{phase}</h2>
                  <span className="count">
                    <span className="spinner" /> working
                  </span>
                </div>
                <div className="panel-body">
                  <p className="panel-sub" style={{ margin: 0 }}>
                    {extracting
                      ? 'Facts are extracted before a single word is generated — every format is written against that ledger, and nothing outside it may appear.'
                      : 'Each format is written to its own contract: character ceilings, slide counts and part structures are checked in code, not just requested in the prompt.'}
                  </p>
                  <div className="ticker-track" style={{ marginTop: 14 }}>
                    <div className="ticker-bar" />
                  </div>
                </div>
              </section>
              {!extracting && (
                <ProgressPanel formats={formats} status={status} times={times} phase={phase} />
              )}
            </>
          )}

          {sourceOpen && (
            <section className="panel" style={{ borderColor: 'var(--gold)' }}>
              <div className="panel-head">
                <span className="panel-num">↻</span>
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
                    <div className="btn-row" style={{ marginTop: 0 }}>
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
                <button className="btn btn-ink" disabled={busy === 'source'} onClick={applySourceEdit}>
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
                        <button className="btn btn-sm btn-primary" style={{ padding: '7px 14px', fontSize: 13 }} disabled={!!busy} onClick={regenerateAll}>
                          {busy && busy !== 'source' ? <><span className="spinner" /> Patching…</> : `Patch all ${staleIds.length} stale formats`}
                        </button>
                        <span className="meter">Patched one at a time so you can watch each before / after.</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="output-head">
                <div className="output-title">{story.headline || 'Rundown'}</div>
                <div className="toolbar-actions">
                  <button className="btn btn-sm" onClick={() => setLedgerOpen((v) => !v)}>
                    {ledgerOpen ? 'Hide' : 'Show'} fact ledger · {facts.length}
                  </button>
                  <button className="btn btn-sm" onClick={() => setStage('compose')}>
                    ← New story
                  </button>
                </div>
              </div>

              <div className="output-grid">
                <FormatRail
                  formats={formats}
                  active={activeFormat?.id}
                  onSelect={setActive}
                  outputs={outputs}
                  status={status}
                  errors={errors}
                  staleReport={staleReport}
                />
                <ContentPane
                  key={activeFormat?.id}
                  format={activeFormat}
                  output={activeFormat ? outputs[activeFormat.id] : null}
                  error={activeFormat ? errors[activeFormat.id] : null}
                  status={activeFormat ? status[activeFormat.id] : null}
                  stale={activeFormat ? staleReport[activeFormat.id] : null}
                  patches={activeFormat ? patches[activeFormat.id] : null}
                  visualBefore={activeFormat ? visualBefore[activeFormat.id] : null}
                  language={language}
                  story={story}
                  publish={meta?.publish?.instagram}
                  languages={meta?.languages || []}
                  onLanguage={retranslate}
                  voice={meta?.voice}
                  busy={busy === activeFormat?.id}
                  onSave={(blocks) =>
                    setOutputs((o) => ({ ...o, [activeFormat.id]: { ...o[activeFormat.id], blocks } }))
                  }
                  onRegenerate={(steer) => regenerate(activeFormat.id, steer)}
                  rewriteNote={rewriteNote[activeFormat.id]}
                />
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
