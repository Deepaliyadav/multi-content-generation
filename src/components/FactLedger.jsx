/**
 * The trust mechanic. Structured facts, always on screen, and after an edit the
 * changed slots are shown as an explicit old → new correction.
 */
export default function FactLedger({ facts, diff, extracting, onEditSource, canEdit }) {
  const changedByNewId = new Map((diff?.changed || []).map((c) => [c.newId, c]));
  const addedIds = new Set((diff?.added || []).map((a) => a.newId));
  const removed = diff?.removed || [];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Fact ledger</h2>
        <span className="count">
          {extracting ? 'extracting…' : `${facts.length} atomic facts`}
        </span>
      </div>

      {extracting && (
        <div className="panel-body">
          <p className="hint">
            <span className="spinner" /> &nbsp;Reading the copy for numbers, names, dates, places and
            attributions…
          </p>
        </div>
      )}

      {!extracting && !facts.length && (
        <div className="empty">
          The ledger is built from your story before anything is written.
          <br />
          Every output is then held to it.
        </div>
      )}

      {!!facts.length && (
        <div className="ledger">
          {facts.map((f) => {
            const chg = changedByNewId.get(f.id);
            const added = addedIds.has(f.id);
            return (
              <div key={f.id} className={`fact ${chg ? 'changed' : added ? 'added' : ''}`}>
                <div className="fact-id">{f.id}</div>
                <div>
                  <div className="fact-label">
                    {chg ? chg.label : f.label}
                    <span className="fact-type">{f.type}</span>
                    {chg && <span className="fact-flag">changed</span>}
                    {added && <span className="fact-flag neutral">new</span>}
                  </div>
                  <div className="fact-value">
                    {chg ? (
                      <>
                        <span className="fact-old">{chg.oldValue}</span>
                        <span className="fact-arrow">→</span>
                        <span className="fact-new">{chg.newValue}</span>
                      </>
                    ) : (
                      f.value
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {removed.map((r) => (
            <div key={`rm-${r.oldId}`} className="fact changed">
              <div className="fact-id">{r.oldId}</div>
              <div>
                <div className="fact-label">
                  {r.label}
                  <span className="fact-flag">dropped</span>
                </div>
                <div className="fact-value fact-old">{r.value}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="card-foot">
          <button className="btn btn-sm" onClick={onEditSource}>
            Edit source story
          </button>
          <span className="meter spacer">the story is still developing</span>
        </div>
      )}
    </section>
  );
}
