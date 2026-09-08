import { useState } from 'react';
import { renderInstaCard } from '../lib/igcard.js';
import * as api from '../lib/api.js';

const InstagramMark = () => (
  <svg className="ig-mark" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
    <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="17.6" cy="6.4" r="1.4" fill="currentColor" />
  </svg>
);

/**
 * Publishing is the one irreversible thing this app does — everything else is a
 * draft on screen. So it is deliberately two steps: the button arms, and a
 * second, differently-worded click sends. The confirm state also shows exactly
 * what will go out, because "post" with no preview of the caption is how the
 * wrong draft ends up on a live account.
 */
export default function PublishToInstagram({ publish, cards, caption, hashtags, shape = 'square', contentType = 'post' }) {
  const [stage, setStage] = useState('idle'); // idle | confirm | sending | done
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const ready = publish?.ready;
  const n = cards.length;
  const isStory = contentType === 'story';
  const noun = isStory ? (n === 1 ? 'story frame' : 'story frames') : n === 1 ? 'image' : 'images';

  async function send() {
    setStage('sending');
    setError(null);
    try {
      const images = [];
      for (const c of cards) images.push(await renderInstaCard({ ...c, shape }));
      const backgrounds = cards.map((c) => c.background || null);
      const r = await api.publishInstagram({ images, caption, hashtags, contentType, backgrounds });
      setResult(r);
      setStage('done');
    } catch (e) {
      setError(String(e.message || e));
      setStage('idle');
    }
  }

  if (stage === 'done') {
    return (
      <div className="publish-box done">
        <span className="publish-mark">✓</span>
        <div>
          <b>
            Posted to Instagram{isStory ? ' Stories' : ''}
            {result?.frames > 1 ? ` — ${result.frames} separate stories` : ''}.
          </b>{' '}
          {result?.platformPostUrl ? (
            <a href={result.platformPostUrl} target="_blank" rel="noreferrer">
              View the post ↗
            </a>
          ) : (
            <span className="meter">Zernio id {result?.postId || '—'}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="publish-box">
      {error && <div className="publish-error">{error}</div>}

      {stage === 'confirm' ? (
        <>
          <div className="publish-warn">
            This posts {n} {noun} to the live Instagram account now.
            {isStory && n > 1
              ? ` Instagram has no multi-image story, so this goes out as ${n} consecutive stories.`
              : isStory
              ? ' It goes out as a Story.'
              : n > 1
              ? ' They go out as one carousel post.'
              : ''}{' '}
            It cannot be undone from here.
          </div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button className="btn btn-sm btn-primary" onClick={send}>
              Yes — post it now
            </button>
            <button className="btn btn-sm" onClick={() => setStage('idle')}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="btn-row" style={{ marginTop: 0 }}>
          <button
            className="btn-instagram"
            disabled={!ready || stage === 'sending'}
            title={publish?.hint || undefined}
            onClick={() => setStage('confirm')}
          >
            {stage === 'sending' ? (
              <><span className="spinner" /> Posting…</>
            ) : (
              <>
                <InstagramMark />
                {isStory ? 'Post to Instagram Stories' : 'Post to Instagram'}
                {n > 1 ? ` · ${n}` : ''}
              </>
            )}
          </button>
          {!ready && <span className="meter">{publish?.hint || 'Publishing is not configured.'}</span>}
        </div>
      )}
    </div>
  );
}
