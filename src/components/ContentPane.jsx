import { useEffect, useMemo, useState } from 'react';
import DiffView from './DiffView.jsx';
import FormatPreview from './FormatPreview.jsx';

/* Blocks <-> plain text, so inline editing works for every format. */
const toText = (blocks) => (blocks || []).map((b) => `## ${b.label}\n${b.lines.join('\n')}`).join('\n\n');

function fromText(text) {
  const blocks = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const m = /^##\s*(.+)$/.exec(raw.trim());
    if (m) {
      cur = { label: m[1].trim(), lines: [] };
      blocks.push(cur);
    } else if (raw.trim()) {
      if (!cur) {
        cur = { label: 'Text', lines: [] };
        blocks.push(cur);
      }
      cur.lines.push(raw.trim());
    }
  }
  return blocks.filter((b) => b.lines.length);
}

function downloadPng(svg, name) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${name}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  };
  img.src = url;
}

/**
 * The single content pane the rail drives — one format at a time, rendered the
 * way it will actually be seen, not as a wall of labelled lines.
 */
export default function ContentPane({
  index, format, output, state, stale, patches, visualBefore,
  changedLabels, onSave, onApprove, onRegenerate, busy, error, language, story, status,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);

  // A different format in the pane is a different document — never carry an
  // open edit or a "copied" flash across.
  useEffect(() => {
    setEditing(false);
    setCopied(false);
  }, [format?.id]);

  const staleKeys = useMemo(
    () => new Map((stale?.staleLines || []).map((l) => [l.key, l.changeLabels])),
    [stale]
  );
  const changedSet = useMemo(() => new Set(changedLabels || []), [changedLabels]);

  /* Returns a tooltip string when the line is stale, else '' — so renderers
     can use it both as a truthiness test and as the title attribute. */
  const flag = (bi, li) => {
    const labels = staleKeys.get(`b${bi}l${li}`);
    return labels ? `Outdated: ${labels.join(', ')}` : '';
  };

  if (!format) {
    return <div className="content-pane"><div className="empty">Pick a format from the rail.</div></div>;
  }

  if (!output) {
    const running = status === 'running';
    return (
      <div className="content-pane">
        <div className="pane-toolbar">
          <div className="toolbar-row">
            <div>
              <div className="pane-label">
                {String(index).padStart(2, '0')} · {format.label}
              </div>
              <div className="pane-title">{format.blurb}</div>
            </div>
          </div>
        </div>
        {error ? (
          <div className="error-box" style={{ marginTop: 0 }}>
            <b>This format failed.</b> {error}
            <div className="btn-row">
              <button className="btn btn-sm" disabled={busy} onClick={onRegenerate}>
                Try again
              </button>
            </div>
          </div>
        ) : running ? (
          <>
            <div className="loading-line">{format.verb || 'Writing'}…</div>
            <div className="ticker-track"><div className="ticker-bar" /></div>
          </>
        ) : (
          <div className="empty">Not generated.</div>
        )}
      </div>
    );
  }

  const isStale = !!stale?.stale;
  const meta = output.meta || {};
  // The infographic's text blocks are the graphic's own data, shown in the
  // structured-data panel instead — so it has no copy to preview.
  const showsCopy = format.id !== 'infographic';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toText(output.blocks));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the Edit view still exposes the raw text */
    }
  };

  return (
    <div className="content-pane">
      <div className="pane-toolbar">
        <div className="toolbar-row">
          <div>
            <div className="pane-label">
              {String(index).padStart(2, '0')} · {format.label}
            </div>
            <div className="pane-title">{format.blurb}</div>
          </div>

          <div className="toolbar-actions">
            {editing ? (
              <>
                <button
                  className="btn btn-sm btn-ink"
                  onClick={() => {
                    onSave(fromText(draft));
                    setEditing(false);
                  }}
                >
                  Save edit
                </button>
                <button className="btn btn-sm" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className={`btn-copy ${copied ? 'copied' : ''}`} onClick={copy}>
                  {copied ? '✓ copied' : 'Copy'}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setDraft(toText(output.blocks));
                    setEditing(true);
                  }}
                >
                  Edit
                </button>
                <button className="btn btn-sm" disabled={busy} onClick={onRegenerate}>
                  {busy ? <><span className="spinner" /> Rewriting…</> : 'Regenerate'}
                </button>
                {state !== 'published' ? (
                  <button className="btn btn-sm btn-ink" onClick={onApprove} disabled={isStale}>
                    Approve
                  </button>
                ) : (
                  <span className="state-line">
                    <span className={`state-dot ${isStale ? 'stale' : 'published'}`} />
                    {isStale ? 'Published · now stale' : 'Published'}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="chip-row">
          <span className="label">Facts used</span>
          {(output.factUsage || []).length === 0 && <span className="fact-chip">none matched</span>}
          {(output.factUsage || []).map((u) => (
            <span
              key={u.id}
              className={`fact-chip ${
                changedSet.has(u.label) ? 'changed' : u.verified ? 'verified' : 'claimed'
              }`}
              title={
                changedSet.has(u.label)
                  ? 'This fact changed in the source'
                  : u.verified
                  ? 'Found verbatim in this output'
                  : 'Reported by the model — expressed in words or another language'
              }
            >
              {u.label}
              {!u.verified && ' ~'}
            </span>
          ))}

          <span className="spacer" />
          {format.id === 'video_script' && meta.runtimeSeconds && (
            <span className="meter">~<b>{meta.runtimeSeconds}</b>s read</span>
          )}
          {format.id === 'reel' && meta.words && (
            <span className="meter">
              <b>{meta.words}</b> words · ~{Math.round((meta.words / 140) * 60)}s
            </span>
          )}
          {state !== 'published' && !editing && (
            <span className="state-line"><span className="state-dot" />In review</span>
          )}
        </div>
      </div>

      {isStale && (
        <div className="banner" style={{ marginTop: 0, marginBottom: 16 }}>
          <span className="banner-mark">⚠</span>
          <div>
            <h3>Stale — contains an outdated fact</h3>
            <p>
              {stale.changeLabels?.length
                ? `Affected: ${stale.changeLabels.join(', ')}.`
                : 'The source changed under this output.'}{' '}
              {stale.staleVisual && 'The graphic carries the outdated value and needs re-rendering. '}
              {showsCopy && stale.staleLines?.length
                ? `${stale.staleLines.length} line${stale.staleLines.length > 1 ? 's' : ''} highlighted below.`
                : ''}
              {stale.method === 'model-located' && ' Located in translated copy.'}
            </p>
            <div className="btn-row">
              <button className="btn btn-sm btn-primary" style={{ padding: '7px 14px', fontSize: 13 }} disabled={busy} onClick={onRegenerate}>
                {busy ? <><span className="spinner" /> Patching…</> : 'Patch this one'}
              </button>
            </div>
          </div>
        </div>
      )}

      <DiffView patches={patches} visualBefore={visualBefore} />

      {editing ? (
        <textarea className="textarea card-edit" value={draft} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <>
          {output.svg && (
            <div style={{ marginBottom: showsCopy && output.blocks?.length ? 20 : 0 }}>
              <div
                className={`visual-wrap ${format.id === 'reel' ? 'tall' : ''}`}
                dangerouslySetInnerHTML={{ __html: output.svg }}
              />
              <div className="btn-row">
                <button className="btn btn-sm" onClick={() => downloadPng(output.svg, format.id)}>
                  Download PNG
                </button>
                <span className="meter">
                  {format.id === 'reel' ? '1080 × 1920 cover' : '1080 × 1080 graphic'} · text rendered from the fact ledger
                </span>
                {output.backgroundSource && (
                  <span
                    className="chip"
                    title="The backdrop is generated atmosphere, not documentary imagery. All text over it is drawn from the fact ledger."
                  >
                    AI backdrop · {output.backgroundSource}
                  </span>
                )}
              </div>
            </div>
          )}

          {showsCopy && (
            <FormatPreview
              format={format}
              output={output}
              flag={flag}
              language={language}
              story={story}
            />
          )}

          {output.visual?.kind === 'infographic' && (
            <div className="visual-meta">
              <div className="eyebrow" style={{ marginBottom: 4 }}>Structured data behind the graphic</div>
              <div><b>Title:</b> {output.visual.title}</div>
              <div>
                <b>Visual type:</b>{' '}
                {output.visual.chart?.type === 'none'
                  ? `${(output.visual.stats || []).length} stat tiles`
                  : `${(output.visual.stats || []).length} stat tiles + ${output.visual.chart?.type} chart`}
                {output.visual.chart?.type !== 'none' && output.visual.chart?.series
                  ? ` (${output.visual.chart.series.map((x) => `${x.label} ${x.value}`).join(', ')})`
                  : ''}
              </div>
              {(output.visual.stats || []).map((s, i) => (
                <div key={i}><b>{s.label}:</b> {s.value}{s.note ? ` — ${s.note}` : ''}</div>
              ))}
              {output.visual.source && <div><b>Source:</b> {output.visual.source}</div>}
            </div>
          )}
        </>
      )}

      {!!(output.warnings || []).length && (
        <div className="warn">
          {output.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
