import { useEffect, useState } from 'react';

/* ── helpers ──────────────────────────────────────────────────────────── */

const byLabel = (blocks, needle) =>
  (blocks || []).find((b) => String(b.label).toLowerCase().includes(needle.toLowerCase()));

const indexOfBlock = (blocks, block) => (blocks || []).indexOf(block);

/** Scripts that read as Devanagari get the Devanagari face and looser leading. */
const DEVANAGARI = /^(hindi|marathi|nepali|sanskrit|bhojpuri)$/i;

/**
 * One editable unit of copy. Every renderer goes through this, so click-to-edit
 * and line-level staleness highlighting behave identically in all of them.
 * The text is only committed on blur — React never re-renders mid-keystroke,
 * so the caret cannot jump.
 */
function Ed({ as: Tag = 'p', bi, li, text, flag, edit, className = '', style }) {
  const f = flag(bi, li);
  const editable = typeof edit === 'function' && bi >= 0 && li >= 0;
  return (
    <Tag
      className={`${className} ${f ? 'stale-line' : ''}`.trim()}
      style={style}
      title={f || undefined}
      contentEditable={editable || undefined}
      suppressContentEditableWarning={editable || undefined}
      onBlur={
        editable
          ? (e) => {
              const next = e.currentTarget.textContent.trim();
              if (next && next !== text) edit(bi, li, next);
            }
          : undefined
      }
    >
      {text}
    </Tag>
  );
}

function Lines({ lines, bi, flag, edit, className = 'line' }) {
  return (lines || []).map((l, li) => (
    <Ed key={li} bi={bi} li={li} text={l} flag={flag} edit={edit} className={className} />
  ));
}

/* ── article & translation ────────────────────────────────────────────── */

function ArticlePreview({ output, flag, edit, language }) {
  const blocks = output.blocks || [];
  const head = byLabel(blocks, 'Headline');
  const body = byLabel(blocks, 'Body');
  const hi = DEVANAGARI.test(String(language || ''));

  return (
    <div className={`article ${hi ? 'hindi' : ''}`}>
      <div className="kicker">{language ? `${language} edition` : 'Web article'}</div>
      {head && (
        <Ed
          as="h2"
          bi={indexOfBlock(blocks, head)}
          li={0}
          text={head.lines[0]}
          flag={flag}
          edit={edit}
        />
      )}
      <div className="body">
        <Lines lines={body?.lines} bi={indexOfBlock(blocks, body)} flag={flag} edit={edit} />
      </div>
    </div>
  );
}

/* ── article highlights ───────────────────────────────────────────────── */

function PointsPreview({ output, flag, edit }) {
  const blocks = output.blocks || [];
  const block = byLabel(blocks, 'Key points') || blocks[0];
  const bi = indexOfBlock(blocks, block);
  return (
    <div className="points">
      {(block?.lines || []).map((l, li) => (
        <div key={li} className="point">
          <span className="dnum">{String(li + 1).padStart(2, '0')}</span>
          <Ed as="span" bi={bi} li={li} text={l} flag={flag} edit={edit} />
        </div>
      ))}
    </div>
  );
}

/* ── X / Twitter ──────────────────────────────────────────────────────── */

function TweetPreview({ output, flag, edit }) {
  const blocks = output.blocks || [];
  const post = byLabel(blocks, 'Post') || blocks[0];
  const bi = indexOfBlock(blocks, post);
  const meta = output.meta || {};
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
        <Ed
          as="div"
          bi={bi}
          li={0}
          text={(post?.lines || []).join('\n')}
          flag={flag}
          edit={edit}
          className="tweet-text"
        />
        <div className="tweet-icons">
          <span>↺ 0</span>
          <span>♡ 0</span>
          <span>↗</span>
        </div>
      </div>
      {meta.chars != null && (
        <div className="charcount" style={meta.chars > meta.limit ? { color: 'var(--red)' } : undefined}>
          {meta.chars}/{meta.limit} characters · +{(meta.total ?? meta.chars) - meta.chars} for the link
        </div>
      )}
    </>
  );
}

/* ── push notification ────────────────────────────────────────────────── */

function PushPreview({ output, flag, edit }) {
  const blocks = output.blocks || [];
  const title = byLabel(blocks, 'Title');
  const body = byLabel(blocks, 'Body');
  const meta = output.meta || {};
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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
          <Ed
            as="div"
            bi={indexOfBlock(blocks, title)}
            li={0}
            text={title?.lines[0]}
            flag={flag}
            edit={edit}
            className="notif-title"
          />
          <Ed
            as="div"
            bi={indexOfBlock(blocks, body)}
            li={0}
            text={body?.lines[0]}
            flag={flag}
            edit={edit}
            className="notif-body"
          />
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

function NewsletterPreview({ output, flag, edit }) {
  const blocks = output.blocks || [];
  const stand = byLabel(blocks, 'Standfirst');
  const blurb = byLabel(blocks, 'Blurb');
  const more = byLabel(blocks, 'Read more');

  return (
    <div className="mail">
      <div className="mail-head">
        <Ed
          as="div"
          bi={indexOfBlock(blocks, stand)}
          li={0}
          text={stand?.lines[0]}
          flag={flag}
          edit={edit}
          className="mail-subject"
        />
        <div className="mail-pre">Rundown Daily · to you</div>
      </div>
      <div className="mail-body">
        <Lines lines={blurb?.lines} bi={indexOfBlock(blocks, blurb)} flag={flag} edit={edit} className="" />
        {more?.lines[0] && <span className="mail-cta">{more.lines[0]} →</span>}
      </div>
    </div>
  );
}

/* ── instagram carousel / story ───────────────────────────────────────── */

function CarouselPreview({ output, flag, edit }) {
  const blocks = output.blocks || [];
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [output]);

  const n = blocks.length;
  if (!n) return null;
  const idx = Math.min(i, n - 1);
  const slide = blocks[idx];

  return (
    <div className="ig-wrap">
      <div className={`ig-slide ${flag(idx, 0) || flag(idx, 1) ? 'stale-slide' : ''}`}>
        <Ed bi={idx} li={0} text={slide.lines?.[0]} flag={flag} edit={edit} className="ig-head" />
        {slide.lines?.[1] && (
          <Ed bi={idx} li={1} text={slide.lines[1]} flag={flag} edit={edit} className="ig-sub" />
        )}
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

function InstaPostPreview({ output, flag, edit }) {
  const blocks = output.blocks || [];
  const hook = byLabel(blocks, 'Hook');
  const caption = byLabel(blocks, 'Caption');
  const tags = byLabel(blocks, 'Hashtags');

  return (
    <div className="ig-wrap">
      <div className={`ig-slide ${flag(indexOfBlock(blocks, hook), 0) ? 'stale-slide' : ''}`}>
        <Ed
          bi={indexOfBlock(blocks, hook)}
          li={0}
          text={hook?.lines[0]}
          flag={flag}
          edit={edit}
          className="ig-head"
        />
      </div>
      <div style={{ maxWidth: 380, minWidth: 240, flex: 1 }}>
        <div className="block-label">Caption</div>
        <Lines lines={caption?.lines} bi={indexOfBlock(blocks, caption)} flag={flag} edit={edit} />
        {tags?.lines[0] && (
          <Ed
            bi={indexOfBlock(blocks, tags)}
            li={0}
            text={tags.lines[0]}
            flag={flag}
            edit={edit}
            className="line mono"
            style={{ marginTop: 12 }}
          />
        )}
      </div>
    </div>
  );
}

/* ── scripts (video / tv / reel) ──────────────────────────────────────── */

function ScriptPreview({ output, flag, edit, cueHeader = 'Cue' }) {
  const blocks = output.blocks || [];
  return (
    <table className="script-table">
      <thead>
        <tr>
          <th style={{ width: 120 }}>{cueHeader}</th>
          <th>Copy</th>
        </tr>
      </thead>
      <tbody>
        {blocks.flatMap((b, bi) =>
          (b.lines || []).map((l, li) => (
            <tr key={`${bi}-${li}`} className={flag(bi, li) ? 'stale-row' : ''}>
              <td className="cue">{li === 0 ? b.label : ''}</td>
              <td>
                <Ed bi={bi} li={li} text={l} flag={flag} edit={edit} className="script-line" />
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

/* ── photostory ───────────────────────────────────────────────────────── */

function PhotostoryPreview({ output, flag, edit }) {
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
        {blocks.map((b, bi) => (
          <tr key={bi} className={flag(bi, 0) || flag(bi, 1) ? 'stale-row' : ''}>
            <td className="time">{String(bi + 1).padStart(2, '0')}</td>
            <td>
              <Ed
                bi={bi}
                li={0}
                text={b.lines?.[0]}
                flag={flag}
                edit={edit}
                className="line direction"
                style={{ marginBottom: 6 }}
              />
              {b.lines?.[1] && (
                <Ed
                  bi={bi}
                  li={1}
                  text={b.lines[1]}
                  flag={flag}
                  edit={edit}
                  className="line"
                  style={{ margin: 0 }}
                />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── generic fallback ─────────────────────────────────────────────────── */

function BlocksPreview({ output, flag, edit }) {
  return (output.blocks || []).map((b, bi) => (
    <div className="block" key={bi}>
      <div className="block-label">{b.label}</div>
      <Lines lines={b.lines} bi={bi} flag={flag} edit={edit} />
    </div>
  ));
}

/* ── router ───────────────────────────────────────────────────────────── */

export default function FormatPreview({ format, output, flag, edit, language }) {
  const p = { output, flag, edit };
  switch (format.id) {
    case 'translation':
      return <ArticlePreview {...p} language={language} />;
    case 'highlights':
      return <PointsPreview {...p} />;
    case 'twitter':
      return <TweetPreview {...p} />;
    case 'push':
      return <PushPreview {...p} />;
    case 'newsletter':
      return <NewsletterPreview {...p} />;
    case 'insta_carousel':
    case 'insta_story':
      return <CarouselPreview {...p} />;
    case 'insta_post':
      return <InstaPostPreview {...p} />;
    case 'video_script':
      return <ScriptPreview {...p} cueHeader="Segment" />;
    case 'tv_script':
      return <ScriptPreview {...p} cueHeader="Cue" />;
    case 'reel':
      return <ScriptPreview {...p} cueHeader="Beat" />;
    case 'photostory':
      return <PhotostoryPreview {...p} />;
    default:
      return <BlocksPreview {...p} />;
  }
}
