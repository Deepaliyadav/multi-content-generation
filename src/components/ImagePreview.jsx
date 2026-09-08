import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Full-size preview for anything the app renders as a picture.
 *
 * Cards are shown at a legible size in the pane, which is right for scanning a
 * set but too small to judge one: whether the headline clears the busy part of
 * the backdrop, whether the wash is carrying the type. So a click opens the
 * real thing.
 *
 * For an Instagram card this composites the same 1080px artwork that would be
 * posted — not the raw backdrop — so what you inspect is what goes out.
 */
const PreviewContext = createContext(() => {});

export const usePreview = () => useContext(PreviewContext);

export function PreviewProvider({ children }) {
  const [item, setItem] = useState(null); // { src } | { svg } + label, download

  const open = useCallback((next) => setItem(next || null), []);

  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => e.key === 'Escape' && setItem(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [item]);

  return (
    <PreviewContext.Provider value={open}>
      {children}
      {item && (
        <div className="preview-backdrop" onClick={() => setItem(null)}>
          <div className="preview-box" onClick={(e) => e.stopPropagation()}>
            <div className="preview-head">
              <span className="pane-label">{item.label || 'Preview'}</span>
              <div className="toolbar-actions">
                {item.src && (
                  <a className="btn btn-sm" href={item.src} download={`${item.file || 'image'}.png`}>
                    ↓ Download PNG
                  </a>
                )}
                <button className="btn btn-sm" onClick={() => setItem(null)}>
                  ✕ Close
                </button>
              </div>
            </div>

            <div className="preview-body">
              {item.src ? (
                <img src={item.src} alt={item.label || ''} />
              ) : (
                <div className="preview-svg" dangerouslySetInnerHTML={{ __html: item.svg }} />
              )}
            </div>
          </div>
        </div>
      )}
    </PreviewContext.Provider>
  );
}
