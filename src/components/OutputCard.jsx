import { useState, useMemo } from 'react';
import DiffView from './DiffView.jsx';

/* Format-aware line styling — a ticker line must not look like anchor copy. */
function lineClass(formatId, blockLabel, idx) {
  const b = String(blockLabel).toLowerCase();
  if (formatId === 'tv_script') {
    if (b.includes('breaking') || b.includes('highlight')) return 'caps';
    if (b.includes('ticker')) return 'mono';
  }
  if (formatId === 'photostory' && idx === 0) return 'direction';
  if (formatId === 'insta_story') return 'caps';
  if (formatId === 'insta_carousel' && idx === 0) return 'caps';
  return '';
}

/* Blocks <-> plain text, so inline editing works for every format. */
const toText = (blocks) => blocks.map((b) => `## ${b.label}\n${b.lines.join('\n')}`).join('\n\n');

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

export default function OutputCard({
  index, format, output, state, stale, patches, visualBefore,
  changedLabels, onSave, onApprove, onRegenerate, busy, error,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const staleKeys = useMemo(
    () => new Map((stale?.staleLines || []).map((l) => [l.key, l.changeLabels])),
    [stale]
  );
  const changedSet = useMemo(() => new Set(changedLabels || []), [changedLabels]);

  if (!output) {
    return (
      <article className="card">
        <div className="card-head">
          <div className="card-head-top">
            <span className="card-idx">{String(index).padStart(2, '0')}</span>
            <h3 className="card-title">{format.label}</h3>
          </div>
          <p className="card-blurb">{format.blurb}</p>
        </div>
        <div className="empty">{error ? `Failed: ${error}` : 'Not generated.'}</div>
      </article>
    );
  }

  const isStale = !!stale?.stale;
  const meta = output.meta || {};
  // The infographic's text blocks are the graphic's own data, shown in the
  // structured-data panel instead — so it has no highlighted lines to point at.
  const showsLines = format.id !== 'infographic';

  return (
    <article className={`card ${isStale ? 'stale' : ''} ${state === 'published' && !isStale ? 'published' : ''}`}>
      <div className="card-head">
        <div className="card-head-top">
          <span className="card-idx">{String(index).padStart(2, '0')}</span>
          <h3 className="card-title">{format.label}</h3>
          <span className="chip" style={{ marginLeft: 'auto' }}>
            {format.kind === 'text' ? 'text' : format.kind === 'text+image' ? 'text + image' : 'image + data'}
          </span>
        </div>
        <p className="card-blurb">{format.blurb}</p>

        <div className="chip-row">
          <span className="label">Facts used</span>
          {(output.factUsage || []).length === 0 && <span className="fact-chip">none matched</span>}
          {(output.factUsage || []).map((u) => (
            <span
              key={u.id}
              className={`fact-chip ${changedSet.has(u.label) ? 'changed' : u.verified ? 'verified' : 'claimed'}`}
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
        </div>
      </div>

      <div className="card-body">
        {isStale && (
          <div className="banner" style={{ marginBottom: 13 }}>
            <span className="banner-mark">⚠</span>
            <div>
              <h3>Stale — contains outdated fact</h3>
              <p>
                {stale.changeLabels?.length
                  ? `Affected: ${stale.changeLabels.join(', ')}.`
                  : 'The source changed under this output.'}{' '}
                {stale.staleVisual && 'The graphic carries the outdated value and needs re-rendering. '}
                {/* The infographic renders as an image, so there is no visible line to point at. */}
                {showsLines && stale.staleLines?.length
                  ? `${stale.staleLines.length} line${stale.staleLines.length > 1 ? 's' : ''} highlighted below.`
                  : ''}
                {stale.method === 'model-located' && ' Located in translated copy.'}
              </p>
              <div className="btn-row">
                <button className="btn btn-sm btn-primary" style={{ padding: '6px 13px', fontSize: 13 }} disabled={busy} onClick={onRegenerate}>
                  {busy ? <><span className="spinner" /> Patching…</> : 'Regenerate this one'}
                </button>
              </div>
            </div>
          </div>
        )}

        <DiffView patches={patches} visualBefore={visualBefore} />

        {editing ? (
          <textarea
            className="textarea card-edit"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        ) : (
          <>
            {output.svg && (
              <div style={{ marginBottom: output.blocks?.length ? 14 : 0 }}>
                <div className={`visual-wrap ${format.id === 'reel' ? 'tall' : ''}`}
                     dangerouslySetInnerHTML={{ __html: output.svg }} />
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={() => downloadPng(output.svg, format.id)}>
                    Download PNG
                  </button>
                  <span className="meter">
                    {format.id === 'reel' ? '1080 × 1920 cover' : '1080 × 1080 graphic'} · rendered from the fact ledger
                  </span>
                </div>
              </div>
            )}

            {(showsLines ? output.blocks || [] : []).map((b, bi) => (
              <div className="block" key={bi}>
                <div className="block-label">{b.label}</div>
                {(b.lines || []).map((l, li) => {
                  const key = `b${bi}l${li}`;
                  const flagged = staleKeys.has(key);
                  return (
                    <p
                      key={li}
                      className={`line ${lineClass(format.id, b.label, li)} ${flagged ? 'stale-line' : ''}`}
                      title={flagged ? `Outdated: ${staleKeys.get(key).join(', ')}` : undefined}
                    >
                      {l}
                    </p>
                  );
                })}
              </div>
            ))}

            {output.visual?.kind === 'infographic' && (
              <div className="visual-meta">
                <div className="eyebrow" style={{ marginBottom: 2 }}>Structured data behind the graphic</div>
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

      <div className="card-foot">
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
            <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button
              className="btn btn-sm"
              onClick={() => {
                setDraft(toText(output.blocks || []));
                setEditing(true);
              }}
            >
              Edit
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

        <span className="spacer" />

        {format.id === 'twitter' && meta.chars != null && (
          <span className={`meter ${meta.chars > meta.limit ? 'over' : ''}`}>
            <b>{meta.chars}</b>/{meta.limit} + {meta.total - meta.chars} link
          </span>
        )}
        {format.id === 'push' && meta.titleChars != null && (
          <span className={`meter ${meta.titleChars > 40 || meta.bodyChars > 120 ? 'over' : ''}`}>
            title <b>{meta.titleChars}</b>/40 · body <b>{meta.bodyChars}</b>/120
          </span>
        )}
        {format.id === 'video_script' && meta.runtimeSeconds && (
          <span className="meter">~<b>{meta.runtimeSeconds}</b>s read</span>
        )}
        {format.id === 'reel' && meta.words && (
          <span className="meter"><b>{meta.words}</b> words · ~{Math.round((meta.words / 140) * 60)}s</span>
        )}
        {state !== 'published' && !editing && <span className="state-line"><span className="state-dot" />In review</span>}
      </div>
    </article>
  );
}
