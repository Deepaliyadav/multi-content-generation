import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Full-size preview for anything the app renders as a picture.
 *
 * Cards are shown at a legible size in the pane, which is right for scanning a
 * set but too small to judge one: whether the headline clears the busy part of
 * the backdrop, whether the wash is carrying the type. So a click opens the
 * real thing.
 *
 * A preview is opened over a SET, not a single picture — a carousel and a photo
 * essay are read in sequence, and having to close the modal to reach the next
 * frame makes comparing two of them impossible. Callers pass a count and a
 * `resolve(i)`, so the artwork for a frame is only composited when it is
 * actually looked at rather than all of it up front.
 *
 * For an Instagram card `resolve` returns the same 1080px artwork that would be
 * posted — not the raw backdrop — so what you inspect is what goes out.
 */
const PreviewContext = createContext(() => {});

export const usePreview = () => useContext(PreviewContext);

export function PreviewProvider({ children }) {
  const [set, setSet] = useState(null); // { count, resolve }
  const [index, setIndex] = useState(0);
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(false);

  const open = useCallback((arg) => {
    if (!arg) return setSet(null);
    // A lone picture is just a set of one, so there is only one code path.
    const next = arg.resolve
      ? arg
      : { count: 1, start: 0, resolve: async () => arg };
    setSet({ count: next.count ?? 1, resolve: next.resolve });
    setIndex(next.start ?? 0);
  }, []);

  const close = useCallback(() => {
    setSet(null);
    setItem(null);
  }, []);

  useEffect(() => {
    if (!set) return undefined;
    let live = true;
    setLoading(true);
    Promise.resolve(set.resolve(index))
      .then((r) => live && setItem(r))
      .catch(() => live && setItem(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [set, index]);

  const step = useCallback(
    (d) => setIndex((i) => (set ? (i + d + set.count) % set.count : i)),
    [set]
  );

  useEffect(() => {
    if (!set) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [set, step, close]);

  const many = (set?.count ?? 1) > 1;

  return (
    <PreviewContext.Provider value={open}>
      {children}
      {set && (
        <div className="preview-backdrop" onClick={close}>
          <div className="preview-box" onClick={(e) => e.stopPropagation()}>
            <div className="preview-head">
              <span className="pane-label">
                {item?.label || 'Preview'}
                {many && <span className="preview-count"> · {index + 1} of {set.count}</span>}
              </span>
              <div className="toolbar-actions">
                {item?.src && (
                  <a className="btn btn-sm" href={item.src} download={`${item.file || 'image'}.png`}>
                    ↓ Download PNG
                  </a>
                )}
                <button className="btn btn-sm" onClick={close}>
                  ✕ Close
                </button>
              </div>
            </div>

            <div className="preview-body">
              {many && (
                <button className="preview-nav prev" aria-label="Previous" onClick={() => step(-1)}>
                  ‹
                </button>
              )}

              {loading && !item ? (
                <div className="meter"><span className="spinner" /> Rendering…</div>
              ) : item?.src ? (
                <img src={item.src} alt={item.label || ''} />
              ) : item?.svg ? (
                <div className="preview-svg" dangerouslySetInnerHTML={{ __html: item.svg }} />
              ) : (
                <div className="meter">Nothing to show.</div>
              )}

              {many && (
                <button className="preview-nav next" aria-label="Next" onClick={() => step(1)}>
                  ›
                </button>
              )}
            </div>

            {many && (
              <div className="preview-foot">
                <div className="ig-dots">
                  {Array.from({ length: set.count }, (_, i) => (
                    <button
                      key={i}
                      className={`ig-dot ${i === index ? 'on' : ''}`}
                      aria-label={`Go to ${i + 1}`}
                      onClick={() => setIndex(i)}
                    />
                  ))}
                </div>
                <span className="meter">← → to move between frames · Esc to close</span>
              </div>
            )}
          </div>
        </div>
      )}
    </PreviewContext.Provider>
  );
}
