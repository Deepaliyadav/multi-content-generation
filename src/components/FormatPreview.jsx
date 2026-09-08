import { useEffect, useState } from 'react';

/* ── helpers ──────────────────────────────────────────────────────────── */

const byLabel = (blocks, needle) =>
  (blocks || []).find((b) => String(b.label).toLowerCase().includes(needle.toLowerCase()));

const indexOfBlock = (blocks, block) => (blocks || []).indexOf(block);

/** Scripts that read as Devanagari get the Devanagari face and looser leading. */
const DEVANAGARI = /^(hindi|marathi|nepali|sanskrit|bhojpuri)$/i;

/* Every renderer takes the same `flag(bi, li)` so line-level staleness
   highlighting survives the move from plain blocks to styled previews. */

function Lines({ lines, bi, flag, className = 'line' }) {
  return (lines || []).map((l, li) => {
    const f = flag(bi, li);
    return (
      <p key={li} className={`${className} ${f ? 'stale-line' : ''}`} title={f || undefined}>
        {l}
      </p>
    );
  });
}

/* ── article & translation ────────────────────────────────────────────── */

function ArticlePreview({ output, flag, language }) {
  const blocks = output.blocks || [];
  const head = byLabel(blocks, 'Headline');
  const body = byLabel(blocks, 'Body');
  const hi = DEVANAGARI.test(String(language || ''));
  const hb = indexOfBlock(blocks, head);
  const bb = indexOfBlock(blocks, body);

  return (
    <div className={`article ${hi ? 'hindi' : ''}`}>
      <div className="kicker">{language ? `${language} edition` : 'Web article'}</div>
      {head && (
        <h2 className={flag(hb, 0) ? 'stale-line' : ''} title={flag(hb, 0) || undefined}>
          {head.lines[0]}
        </h2>
      )}
      <div className="body">
        <Lines lines={body?.lines} bi={bb} flag={flag} />
      </div>
    </div>
  );
}

/* ── article highlights ───────────────────────────────────────────────── */

function PointsPreview({ output, flag }) {
  const blocks = output.blocks || [];
  const block = byLabel(blocks, 'Key points') || blocks[0];
  const bi = indexOfBlock(blocks, block);
  return (
    <div className="points">
      {(block?.lines || []).map((l, li) => {
        const f = flag(bi, li);
        return (
          <div key={li} className={`point ${f ? 'stale-line' : ''}`} title={f || undefined}>
            <span className="dnum">{String(li + 1).padStart(2, '0')}</span>
            <span>{l}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── X / Twitter ──────────────────────────────────────────────────────── */

function TweetPreview({ output, flag, story }) {
  const blocks = output.blocks || [];
  const post = byLabel(blocks, 'Post') || blocks[0];
  const bi = indexOfBlock(blocks, post);
  const meta = output.meta || {};
  const f = flag(bi, 0);
  return (
    <>
      <div className="tweet">
        <div className="tweet-head">
          <div className="avatar">RD</div>
          <div className="tweet-names">
            <div className="tweet-name">Rundown Desk</div>
            <div className="tweet-handle">@rundowndesk · now</div>
          </div>
        </div>
        <div className={`tweet-text ${f ? 'stale-line' : ''}`} title={f || undefined}>
          {(post?.lines || []).join('\n')}
        </div>
        <div className="tweet-icons">
          <span>↺ 0</span>
          <span>♡ 0</span>
          <span>↗</span>
        </div>
      </div>
      {meta.chars != null && (
        <div className={`charcount ${meta.chars > meta.limit ? 'over' : ''}`}>
          {meta.chars}/{meta.limit} characters · +{(meta.total ?? meta.chars) - meta.chars} for the link
        </div>
      )}
      {story?.headline && <div className="charcount">linking to: {story.headline}</div>}
    </>
  );
}

/* ── push notification ────────────────────────────────────────────────── */

function PushPreview({ output, flag }) {
  const blocks = output.blocks || [];
  const title = byLabel(blocks, 'Title');
  const body = byLabel(blocks, 'Body');
  const meta = output.meta || {};
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const ft = flag(indexOfBlock(blocks, title), 0);
  const fb = flag(indexOfBlock(blocks, body), 0);
  const over = meta.titleChars > 40 || meta.bodyChars > 120;

  return (
    <>
      <div className="phone">
        <div className="phone-time">{now}</div>
        <div className="notif">
          <div className="notif-app">
            <span className="notif-icon">R</span>
            <span className="notif-app-name">RUNDOWN</span>
            <span className="notif-app-time">now</span>
          </div>
          <div className={`notif-title ${ft ? 'stale-line' : ''}`} title={ft || undefined}>
            {title?.lines[0]}
          </div>
          <div className={`notif-body ${fb ? 'stale-line' : ''}`} title={fb || undefined}>
            {body?.lines[0]}
          </div>
        </div>
      </div>
      {meta.titleChars != null && (
        <div className="charcount" style={over ? { color: 'var(--red)' } : undefined}>
          title {meta.titleChars}/40 · body {meta.bodyChars}/120
        </div>
      )}
    </>
  );
}

/* ── newsletter ───────────────────────────────────────────────────────── */

function NewsletterPreview({ output, flag }) {
  const blocks = output.blocks || [];
  const stand = byLabel(blocks, 'Standfirst');
  const blurb = byLabel(blocks, 'Blurb');
  const more = byLabel(blocks, 'Read more');
  const fs = flag(indexOfBlock(blocks, stand), 0);

  return (
    <div className="mail">
      <div className="mail-head">
        <div className={`mail-subject ${fs ? 'stale-line' : ''}`} title={fs || undefined}>
          {stand?.lines[0]}
        </div>
        <div className="mail-pre">Rundown Daily · to you</div>
      </div>
      <div className="mail-body">
        <Lines lines={blurb?.lines} bi={indexOfBlock(blocks, blurb)} flag={flag} className="" />
        {more?.lines[0] && <span className="mail-cta">{more.lines[0]} →</span>}
      </div>
    </div>
  );
}

/* ── instagram carousel / story ───────────────────────────────────────── */

function CarouselPreview({ output, flag }) {
  const blocks = output.blocks || [];
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [output]);

  const n = blocks.length;
  if (!n) return null;
  const idx = Math.min(i, n - 1);
  const slide = blocks[idx];
  const fh = flag(idx, 0);
  const fc = flag(idx, 1);

  return (
    <div className="ig-wrap">
      <div className={`ig-slide ${fh || fc ? 'stale-slide' : ''}`}>
        <p className="ig-head">{slide.lines?.[0]}</p>
        {slide.lines?.[1] && <p className="ig-sub">{slide.lines[1]}</p>}
      </div>
      <div className="ig-controls">
        <div className="ig-counter">
          {slide.label} · {idx + 1} of {n}
        </div>
        <div className="ig-nav">
          <button onClick={() => setI((v) => (v - 1 + n) % n)} aria-label="Previous slide">
            ‹
          </button>
          <button onClick={() => setI((v) => (v + 1) % n)} aria-label="Next slide">
            ›
          </button>
        </div>
        <div className="ig-dots">
          {blocks.map((b, bi) => (
            <span key={bi} className={`ig-dot ${bi === idx ? 'on' : ''}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── instagram post ───────────────────────────────────────────────────── */

function InstaPostPreview({ output, flag }) {
  const blocks = output.blocks || [];
  const hook = byLabel(blocks, 'Hook');
  const caption = byLabel(blocks, 'Caption');
  const tags = byLabel(blocks, 'Hashtags');
  const fh = flag(indexOfBlock(blocks, hook), 0);

  return (
    <div className="ig-wrap">
      <div className={`ig-slide ${fh ? 'stale-slide' : ''}`}>
        <p className="ig-head">{hook?.lines[0]}</p>
      </div>
      <div style={{ maxWidth: 380, minWidth: 240, flex: 1 }}>
        <div className="block-label">Caption</div>
        <Lines lines={caption?.lines} bi={indexOfBlock(blocks, caption)} flag={flag} />
        {tags?.lines[0] && (
          <p className="line mono" style={{ marginTop: 12 }}>
            {tags.lines[0]}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── scripts (video / tv / reel) ──────────────────────────────────────── */

function ScriptPreview({ output, flag, cueHeader = 'Cue' }) {
  const blocks = output.blocks || [];
  return (
    <table className="script-table">
      <thead>
        <tr>
          <th style={{ width: 110 }}>{cueHeader}</th>
          <th>Copy</th>
        </tr>
      </thead>
      <tbody>
        {blocks.flatMap((b, bi) =>
          (b.lines || []).map((l, li) => {
            const f = flag(bi, li);
            return (
              <tr key={`${bi}-${li}`} className={f ? 'stale-row' : ''} title={f || undefined}>
                <td className="cue">{li === 0 ? b.label : ''}</td>
                <td>{l}</td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

/* ── photostory ───────────────────────────────────────────────────────── */

function PhotostoryPreview({ output, flag }) {
  const blocks = output.blocks || [];
  return (
    <table className="script-table">
      <thead>
        <tr>
          <th style={{ width: 74 }}>Frame</th>
          <th>Photo direction / caption</th>
        </tr>
      </thead>
      <tbody>
        {blocks.map((b, bi) => {
          const f0 = flag(bi, 0);
          const f1 = flag(bi, 1);
          return (
            <tr key={bi} className={f0 || f1 ? 'stale-row' : ''}>
              <td className="time">{String(bi + 1).padStart(2, '0')}</td>
              <td>
                <p className="line direction" style={{ marginBottom: 6 }} title={f0 || undefined}>
                  {b.lines?.[0]}
                </p>
                {b.lines?.[1] && (
                  <p className="line" style={{ margin: 0 }} title={f1 || undefined}>
                    {b.lines[1]}
                  </p>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── generic fallback ─────────────────────────────────────────────────── */

function BlocksPreview({ output, flag, lineClass }) {
  return (output.blocks || []).map((b, bi) => (
    <div className="block" key={bi}>
      <div className="block-label">{b.label}</div>
      {(b.lines || []).map((l, li) => {
        const f = flag(bi, li);
        return (
          <p
            key={li}
            className={`line ${lineClass ? lineClass(b.label, li) : ''} ${f ? 'stale-line' : ''}`}
            title={f || undefined}
          >
            {l}
          </p>
        );
      })}
    </div>
  ));
}

/* ── router ───────────────────────────────────────────────────────────── */

export default function FormatPreview({ format, output, flag, language, story }) {
  switch (format.id) {
    case 'translation':
      return <ArticlePreview output={output} flag={flag} language={language} />;
    case 'highlights':
      return <PointsPreview output={output} flag={flag} />;
    case 'twitter':
      return <TweetPreview output={output} flag={flag} story={story} />;
    case 'push':
      return <PushPreview output={output} flag={flag} />;
    case 'newsletter':
      return <NewsletterPreview output={output} flag={flag} />;
    case 'insta_carousel':
    case 'insta_story':
      return <CarouselPreview output={output} flag={flag} />;
    case 'insta_post':
      return <InstaPostPreview output={output} flag={flag} />;
    case 'video_script':
      return <ScriptPreview output={output} flag={flag} cueHeader="Segment" />;
    case 'tv_script':
      return <ScriptPreview output={output} flag={flag} cueHeader="Cue" />;
    case 'reel':
      return <ScriptPreview output={output} flag={flag} cueHeader="Beat" />;
    case 'photostory':
      return <PhotostoryPreview output={output} flag={flag} />;
    default:
      return <BlocksPreview output={output} flag={flag} />;
  }
}
