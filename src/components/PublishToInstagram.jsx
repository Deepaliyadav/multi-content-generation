import { useState } from 'react';
import { renderInstaCard } from '../lib/igcard.js';
import * as api from '../lib/api.js';

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
          <b>Posted to Instagram{isStory ? ' Stories' : ''}.</b>{' '}
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
            This posts {n} {noun} to the live Instagram account
            {isStory ? ' as a Story' : ''} now. It cannot be undone from here.
          </div>
          <pre className="publish-preview">{[caption, (hashtags || []).join(' ')].filter(Boolean).join('\n\n')}</pre>
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
            className="btn btn-sm"
            disabled={!ready || stage === 'sending'}
            title={publish?.hint || undefined}
            onClick={() => setStage('confirm')}
          >
            {stage === 'sending' ? (
              <><span className="spinner" /> Posting…</>
            ) : (
              `${isStory ? 'Post to Instagram Stories' : 'Post to Instagram'}${n > 1 ? ` · ${n}` : ''}`
            )}
          </button>
          <span className="meter">
            {ready
              ? `Renders ${n === 1 ? 'the card' : 'each card'}, uploads to ${publish?.host || 'storage'}, then posts through Zernio.`
              : publish?.hint || 'Publishing is not configured.'}
          </span>
        </div>
      )}
    </div>
  );
}
