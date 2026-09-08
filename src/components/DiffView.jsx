import { wordDiff } from '../lib/diff.js';

/** The payoff moment: struck-through old text against the patched new text. */
export default function DiffView({ patches, visualBefore }) {
  if (!patches?.length && !visualBefore) return null;
  return (
    <div className="diff">
      <div className="diff-head">
        <span className="eyebrow">Patched · before / after</span>
        <span className="chip">
          {patches?.length ? `${patches.length} line${patches.length > 1 ? 's' : ''} rewritten` : 'image re-rendered'}
        </span>
      </div>

      {(patches || []).map((p) => (
        <div key={p.key} style={{ marginBottom: 10 }}>
          <div className="eyebrow" style={{ marginBottom: 3 }}>{p.blockLabel}</div>
          <p className="diff-row">
            <span className="diff-tag">was</span>
            <span style={{ color: 'var(--ink-3)', textDecoration: 'line-through' }}>{p.before}</span>
          </p>
          <p className="diff-row">
            <span className="diff-tag">now</span>
            {wordDiff(p.before, p.after).map((tok, i) =>
              tok.type === 'del' ? (
                <del className="d" key={i}>{tok.text}</del>
              ) : tok.type === 'ins' ? (
                <ins className="d" key={i}>{tok.text}</ins>
              ) : (
                <span key={i}>{tok.text}</span>
              )
            )}
          </p>
        </div>
      ))}

      {visualBefore && (
        <p className="diff-row" style={{ fontFamily: 'var(--sans)', fontSize: 12.5, color: 'var(--ink-2)' }}>
          The graphic was re-rendered from the corrected figures — the old version is no longer shown.
        </p>
      )}
    </div>
  );
}
