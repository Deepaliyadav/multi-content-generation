import { useEffect, useMemo, useState } from 'react';
import DiffView from './DiffView.jsx';
import FormatPreview from './FormatPreview.jsx';
import { PreviewProvider, usePreview } from './ImagePreview.jsx';

/* Blocks -> plain text, for the clipboard and the compare view. */
const toText = (blocks) =>
  (blocks || []).map((b) => `## ${b.label}\n${b.lines.join('\n')}`).join('\n\n');

const PRESETS = ['Punchier', 'Shorter', 'More formal'];

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
 * way it will actually be seen, edited in place, and rewritten with a note to
 * the desk rather than a form.
 */
export default function ContentPane(props) {
  // The provider has to sit above everything that can open a preview.
  return (
    <PreviewProvider>
      <Pane {...props} />
    </PreviewProvider>
  );
}

function Pane({
  format, output, stale, patches, visualBefore,
  onSave, onRegenerate, busy, error, language, story, status, publish, voice,
}) {
  const preview = usePreview();
  const [steer, setSteer] = useState('');
  const [copied, setCopied] = useState(false);
  const [comparing, setComparing] = useState(false);

  // A different format in the pane is a different document — never carry a
  // half-typed note, a compare view or a "copied" flash across.
  useEffect(() => {
    setSteer('');
    setCopied(false);
    setComparing(false);
  }, [format?.id]);

  const staleKeys = useMemo(
    () => new Map((stale?.staleLines || []).map((l) => [l.key, l.changeLabels])),
    [stale]
  );

  /* Returns a tooltip string when the line is stale, else '' — so renderers
     can use it both as a truthiness test and as the title attribute. */
  const flag = (bi, li) => {
    const labels = staleKeys.get(`b${bi}l${li}`);
    return labels ? `Outdated: ${labels.join(', ')}` : '';
  };

  /** Commit one in-place edit back into the block structure. */
  const edit = (bi, li, text) => {
    const blocks = (output.blocks || []).map((b, i) =>
      i === bi ? { ...b, lines: b.lines.map((l, j) => (j === li ? text : l)) } : b
    );
    onSave(blocks);
  };

  if (!format) {
    return (
      <div className="content-pane">
        <div className="empty">Pick a format from the rail.</div>
      </div>
    );
  }

  if (!output) {
    return (
      <div className="content-pane">
        <div className="pane-toolbar">
          <div className="toolbar-row">
            <div className="pane-label">{format.label}</div>
          </div>
        </div>
        {error ? (
          <div className="error-box" style={{ marginTop: 0 }}>
            <b>This format failed.</b> {error}
            <div className="btn-row">
              <button className="btn btn-sm" disabled={busy} onClick={() => onRegenerate('')}>
                Try again
              </button>
            </div>
          </div>
        ) : status === 'running' ? (
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
  // Only the translation is a like-for-like rendering of the source, so only it
  // has something to compare against. Splitting the pane in two for a carousel
  // or a photo essay just squeezes a layout that is already side by side.
  const canCompare = format.id === 'translation';
  // The infographic's text blocks are the graphic's own data, shown in the
  // structured-data panel instead — so it has no copy to preview or edit.
  const showsCopy = format.id !== 'infographic';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toText(output.blocks));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the compare view still exposes the raw text */
    }
  };

  // Built once so either layout can place it: beside the structured data for
  // the infographic, or beside the script for the reel cover.
  const visualNode = output.svg ? (
    <div className="visual-col">
      <button
        className={`visual-wrap ${format.id === 'reel' ? 'tall' : ''}`}
        title="Click to preview full size"
        onClick={() => preview({ svg: output.svg, label: format.label })}
        dangerouslySetInnerHTML={{ __html: output.svg }}
      />
      <button className="btn-download" onClick={() => downloadPng(output.svg, format.id)}>
        ↓ Download PNG
      </button>
    </div>
  ) : null;

  return (
    <div className="content-pane">
      <div className="pane-toolbar">
        <div className="toolbar-row">
          <div className="pane-label">{format.label}</div>
          <div className="toolbar-actions">
            {canCompare && (
              <button
                className={`btn-copy ${comparing ? 'on' : ''}`}
                onClick={() => setComparing((v) => !v)}
              >
                {comparing ? 'Hide source' : 'Compare with source'}
              </button>
            )}
            <button className={`btn-copy ${copied ? 'copied' : ''}`} onClick={copy}>
              {copied ? '✓ copied' : 'Copy text'}
            </button>
          </div>
        </div>

        <input
          className="regen-input"
          value={steer}
          placeholder="e.g. punchier, shorter, more formal"
          onChange={(e) => setSteer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) onRegenerate(steer);
          }}
        />

        <div className="preset-row">
          {PRESETS.map((p) => (
            <button
              key={p}
              className={`preset-chip ${steer === p ? 'on' : ''}`}
              onClick={() => setSteer(p)}
            >
              {p}
            </button>
          ))}
          <button className="btn-regen" disabled={busy} onClick={() => onRegenerate(steer)}>
            {busy ? <><span className="spinner" /> Rewriting…</> : 'Regenerate'}
          </button>
          {showsCopy && (
            <span className="edit-hint spacer">Click any text below to edit it directly.</span>
          )}
        </div>
      </div>

      {isStale && (
        <div className="banner" style={{ marginTop: 0, marginBottom: 18 }}>
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
              <button
                className="btn btn-sm btn-primary"
                style={{ padding: '7px 14px', fontSize: 13 }}
                disabled={busy}
                onClick={() => onRegenerate('')}
              >
                {busy ? <><span className="spinner" /> Patching…</> : 'Patch this one'}
              </button>
            </div>
          </div>
        </div>
      )}

      <DiffView patches={patches} visualBefore={visualBefore} />

      <div className={comparing && canCompare ? 'compare-grid' : ''}>
        {comparing && canCompare && (
          <div className="compare-col">
            <div className="compare-label">Source story</div>
            <div className="compare-text">
              <b>{story?.headline}</b>
              {'\n\n'}
              {story?.body}
            </div>
          </div>
        )}

        <div className="compare-col">
          {comparing && canCompare && <div className="compare-label">{format.label}</div>}

          {/* The graphic and the words about it belong side by side — a full-width
              stack pushed the data a screen below the picture it describes. */}
          {output.visual?.kind === 'infographic' ? (
            <div className="visual-split">
              {visualNode}
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
            </div>
          ) : (
            showsCopy && (
              <FormatPreview
                format={format}
                output={output}
                flag={flag}
                edit={edit}
                language={language}
                publish={publish}
                voice={voice}
                visual={visualNode}
              />
            )
          )}
        </div>
      </div>

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
