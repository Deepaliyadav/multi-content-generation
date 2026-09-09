import { useEffect, useState } from 'react';
import PublishToInstagram from './PublishToInstagram.jsx';
import AnchorRead from './AnchorRead.jsx';
import { usePreview } from './ImagePreview.jsx';
import { renderInstaCard } from '../lib/igcard.js';

/* ── helpers ──────────────────────────────────────────────────────────── */

const byLabel = (blocks, needle) =>
  (blocks || []).find((b) => String(b.label).toLowerCase().includes(needle.toLowerCase()));

const indexOfBlock = (blocks, block) => (blocks || []).indexOf(block);

/**
 * Which writing system a translation target uses.
 *
 * A language without a face renders as fallback glyphs or empty boxes, so every
 * script offered gets a font loaded for it, and the Perso-Arabic ones also get
 * their direction flipped — Urdu set left-to-right is not merely ugly, it is
 * unreadable.
 */
const SCRIPTS = [
  ['deva', /^(hindi|marathi|nepali|sanskrit|bhojpuri|maithili|konkani|dogri)$/i],
  ['beng', /^(bangla|bengali|assamese)$/i],
  ['guru', /^punjabi$/i],
  ['gujr', /^gujarati$/i],
  ['orya', /^(odia|oriya)$/i],
  ['taml', /^tamil$/i],
  ['telu', /^telugu$/i],
  ['knda', /^kannada$/i],
  ['mlym', /^malayalam$/i],
  ['arab', /^(urdu|kashmiri|sindhi|arabic|persian|farsi|pashto)$/i],
];

const RTL = /^(urdu|kashmiri|sindhi|arabic|persian|farsi|pashto)$/i;

function scriptOf(language) {
  const l = String(language || '').trim();
  return SCRIPTS.find(([, re]) => re.test(l))?.[0] || null;
}

/**
 * One editable unit of copy. Every renderer goes through this, so click-to-edit
 * and line-level staleness highlighting behave identically in all of them.
 * The text is only committed on blur — React never re-renders mid-keystroke,
 * so the caret cannot jump.
 */
/**
 * Split a line into words that keep their original offsets, so a character
 * position from the voice alignment can be resolved to the exact word.
 */
function wordsWithOffsets(text) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

function Ed({ as: Tag = 'p', bi, li, text, flag, edit, className = '', style, readAt }) {
  const f = flag(bi, li);
  const reading = typeof readAt === 'number';
  // Editing is suspended while this line is being read: swapping the text for
  // per-word spans inside a contentEditable would fight the caret, and nobody
  // types into a line while listening to it.
  const editable = !reading && typeof edit === 'function' && bi >= 0 && li >= 0;

  return (
    <Tag
      className={`${className} ${f ? 'stale-line' : ''} ${reading ? 'reading' : ''}`.trim()}
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
      {reading
        ? wordsWithOffsets(text).map((w, i) => (
            <span
              key={i}
              className={
                readAt >= w.start && readAt < w.end ? 'word now' : readAt >= w.end ? 'word said' : 'word'
              }
            >
              {w.word}{' '}
            </span>
          ))
        : text}
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
  const script = scriptOf(language);
  const rtl = RTL.test(String(language || '').trim());

  return (
    <div
      className={`article ${script ? `indic script-${script}` : ''} ${rtl ? 'rtl' : ''}`}
      dir={rtl ? 'rtl' : undefined}
    >
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

function CarouselPreview({ output, flag, edit, tall = false, publish }) {
  const preview = usePreview();
  const blocks = output.blocks || [];
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [output]);

  // The carousel carries Caption and Hashtags blocks alongside its slides; the
  // story does not. Keeping each slide's ORIGINAL block index matters — that is
  // what line-level staleness is keyed on — while the pictures are indexed by
  // slide order, because copy blocks never got one.
  const isCopy = (b) => /^(caption|hashtags)$/i.test(String(b.label).trim());
  const slides = blocks.map((b, bi) => ({ b, bi })).filter(({ b }) => !isCopy(b));
  const captionBlock = blocks.find((b) => /^caption$/i.test(String(b.label).trim()));
  const tagsBlock = blocks.find((b) => /^hashtags$/i.test(String(b.label).trim()));

  const n = slides.length;
  if (!n) return null;
  const k = Math.min(i, n - 1);
  const { b: slide, bi } = slides[k];
  const bg = output.backgrounds?.[k] || output.background;

  const captionText = (captionBlock?.lines || []).join('\n\n');
  const hashtags = tagsBlock?.lines || [];

  const deck = (
    <div className="ig-col">
      <div
        className={`ig-slide ${tall ? 'tall' : ''} ${bg ? 'has-bg' : ''} ${flag(bi, 0) || flag(bi, 1) ? 'stale-slide' : ''}`}
        style={bg ? { backgroundImage: `url(${bg})` } : undefined}
      >
        <button
          className="preview-btn"
          title="Preview this card at full size"
          onClick={() =>
            preview({
              count: n,
              start: k,
              resolve: async (si) => {
                const { b: s2 } = slides[si];
                return {
                  src: await renderInstaCard({
                    background: output.backgrounds?.[si] || output.background,
                    headline: s2.lines?.[0],
                    caption: s2.lines?.[1],
                    shape: tall ? 'story' : 'square',
                  }),
                  label: `${s2.label} · ${tall ? '1080 × 1920' : '1080 × 1080'}`,
                  file: `slide_${si + 1}`,
                };
              },
            })
          }
        >
          ⤢
        </button>
        <div className="ig-copy">
          <Ed bi={bi} li={0} text={slide.lines?.[0]} flag={flag} edit={edit} className="ig-head" />
          {slide.lines?.[1] && (
            <Ed bi={bi} li={1} text={slide.lines[1]} flag={flag} edit={edit} className="ig-sub" />
          )}
        </div>
        {bg && <span className="ai-mark">AI-generated image</span>}
      </div>

      {/* Under the picture, where a carousel's controls belong — beside it they
          stranded a column of empty space next to a tall card. */}
      <div className="ig-controls-row">
        <div className="ig-nav">
          <button onClick={() => setI((v) => (v - 1 + n) % n)} aria-label="Previous slide">
            ‹
          </button>
          <button onClick={() => setI((v) => (v + 1) % n)} aria-label="Next slide">
            ›
          </button>
        </div>
        <div className="ig-dots">
          {slides.map((_, si) => (
            <span key={si} className={`ig-dot ${si === k ? 'on' : ''}`} />
          ))}
        </div>
        <span className="ig-counter">
          {slide.label} · {k + 1} of {n}
        </span>
      </div>
    </div>
  );

  return (
    <>
      {captionBlock ? (
        <div className="visual-split">
          {deck}
          <div className="ig-caption">
            <div className="block-label">Caption</div>
            <Lines lines={captionBlock.lines} bi={blocks.indexOf(captionBlock)} flag={flag} edit={edit} />
            {hashtags[0] && (
              <Ed
                bi={blocks.indexOf(tagsBlock)}
                li={0}
                text={hashtags[0]}
                flag={flag}
                edit={edit}
                className="line mono"
                style={{ marginTop: 10 }}
              />
            )}
          </div>
        </div>
      ) : (
        deck
      )}

      {publish && (
        <PublishToInstagram
          publish={publish}
          contentType={tall ? 'story' : 'post'}
          shape={tall ? 'story' : 'square'}
          cards={slides.slice(0, 10).map(({ b }, si) => ({
            background: output.backgrounds?.[si] || output.background,
            headline: b.lines?.[0],
            caption: b.lines?.[1],
          }))}
          caption={captionText || slides.map(({ b }) => (b.lines || []).join(' ')).join('\n\n')}
          hashtags={hashtags}
        />
      )}
    </>
  );
}

/* ── instagram post ───────────────────────────────────────────────────── */

function InstaPostPreview({ output, flag, edit, publish }) {
  const preview = usePreview();
  const blocks = output.blocks || [];
  const hook = byLabel(blocks, 'Hook');
  const caption = byLabel(blocks, 'Caption');
  const tags = byLabel(blocks, 'Hashtags');
  const bg = output.background;

  return (
    <div className="ig-wrap">
      <div
        className={`ig-slide ${bg ? 'has-bg' : ''} ${flag(indexOfBlock(blocks, hook), 0) ? 'stale-slide' : ''}`}
        style={bg ? { backgroundImage: `url(${bg})` } : undefined}
      >
        <button
          className="preview-btn"
          title="Preview this card at full size"
          onClick={async () => {
            const src = await renderInstaCard({ background: bg, headline: hook?.lines[0], shape: 'square' });
            preview({ src, label: 'Insta post · 1080 × 1080', file: 'insta_post' });
          }}
        >
          ⤢
        </button>
        <div className="ig-copy">
          <Ed
            bi={indexOfBlock(blocks, hook)}
            li={0}
            text={hook?.lines[0]}
            flag={flag}
            edit={edit}
            className="ig-head"
          />
        </div>
        {bg && <span className="ai-mark">AI-generated image</span>}
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
        <PublishToInstagram
          publish={publish}
          cards={[{ background: bg, headline: hook?.lines[0] }]}
          caption={(caption?.lines || []).join('\n\n')}
          hashtags={tags?.lines || []}
        />
      </div>
    </div>
  );
}

/* ── scripts (video / tv / reel) ──────────────────────────────────────── */

/**
 * `spoken` picks the blocks an anchor actually reads. A TV script's ticker and
 * on-screen highlights are graphics, not speech — voicing them would give a
 * runtime estimate for words nobody says.
 */
function ScriptPreview({ output, flag, edit, cueHeader = 'Cue', voice, spoken, readLabel, fileBase, visual }) {
  const blocks = output.blocks || [];
  const [readAt, setReadAt] = useState(null);

  // Build the spoken script and remember where each line sits inside it, so a
  // character offset from the voice can be resolved back to a specific line.
  const spokenBlocks = spoken
    ? blocks.filter((b) => spoken.some((k) => String(b.label).toLowerCase().includes(k)))
    : blocks;
  const spans = [];
  let offset = 0;
  for (const b of spokenBlocks) {
    const bi = blocks.indexOf(b);
    (b.lines || []).forEach((l, li) => {
      spans.push({ bi, li, start: offset, end: offset + l.length });
      offset += l.length + 1; // the joining space
    });
  }
  const spokenText = spokenBlocks.flatMap((b) => b.lines || []).join(' ');

  const active = readAt == null ? null : spans.find((s) => readAt >= s.start && readAt < s.end);

  return (
    <>
    {voice && (
      <AnchorRead
        voice={voice}
        text={spokenText}
        label={readLabel || 'read'}
        fileBase={fileBase || 'script'}
        onProgress={setReadAt}
      />
    )}
    <div className={visual ? 'visual-split' : ''}>
    {visual}
    <div className="script-col">
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
            <tr
              key={`${bi}-${li}`}
              className={`${flag(bi, li) ? 'stale-row' : ''} ${
                active && active.bi === bi && active.li === li ? 'reading-row' : ''
              }`.trim()}
            >
              <td className="cue">{li === 0 ? b.label : ''}</td>
              <td>
                <Ed
                  bi={bi}
                  li={li}
                  text={l}
                  flag={flag}
                  edit={edit}
                  className="script-line"
                  readAt={active && active.bi === bi && active.li === li ? readAt - active.start : undefined}
                />
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
    </div>
    </div>
    </>
  );
}

/* ── photostory ───────────────────────────────────────────────────────── */

function PhotostoryPreview({ output, flag, edit }) {
  const preview = usePreview();
  const blocks = output.blocks || [];

  return (
    <div className="essay">
      {blocks.map((b, bi) => {
        const shot = output.backgrounds?.[bi];
        const direction = b.lines?.[0];
        const caption = b.lines?.[1];
        return (
          <figure key={bi} className={`essay-frame ${flag(bi, 0) || flag(bi, 1) ? 'stale-frame' : ''}`}>
            <div className="essay-plate">
              {shot ? (
                <>
                  <img src={shot} alt="" />
                  <span className="ai-mark">AI-generated image</span>
                  <button
                    className="preview-btn"
                    title="Preview this frame at full size"
                    onClick={() =>
                      preview({
                        count: blocks.length,
                        start: bi,
                        resolve: (fi) => ({
                          src: output.backgrounds?.[fi],
                          label: `Frame ${fi + 1} · ${String(blocks[fi]?.lines?.[0] ?? '').replace(/^\[|\]$/g, '')}`,
                          file: `frame_${fi + 1}`,
                        }),
                      })
                    }
                  >
                    ⤢
                  </button>
                </>
              ) : (
                // No provider, or this one frame came back empty — the direction
                // is still the useful thing to hand a photographer.
                <span className="essay-empty">no photo</span>
              )}
              <span className="essay-num">{String(bi + 1).padStart(2, '0')}</span>
            </div>

            <figcaption className="essay-copy">
              <Ed
                bi={bi}
                li={0}
                text={direction}
                flag={flag}
                edit={edit}
                className="line direction"
                style={{ marginBottom: 8 }}
              />
              {caption && (
                <Ed bi={bi} li={1} text={caption} flag={flag} edit={edit} className="line" style={{ margin: 0 }} />
              )}
            </figcaption>
          </figure>
        );
      })}
    </div>
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

export default function FormatPreview({ format, output, flag, edit, language, publish, voice, visual }) {
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
      return <CarouselPreview {...p} publish={publish} />;
    case 'insta_story':
      return <CarouselPreview {...p} tall publish={publish} />;
    case 'insta_post':
      return <InstaPostPreview {...p} publish={publish} />;
    case 'video_script':
      return <ScriptPreview {...p} cueHeader="Segment" voice={voice} readLabel="voiceover" fileBase="video-script" />;
    case 'tv_script':
      return (
        <ScriptPreview
          {...p}
          cueHeader="Cue"
          voice={voice}
          spoken={['anchor']}
          readLabel="anchor script"
          fileBase="tv-anchor-script"
        />
      );
    case 'reel':
      return <ScriptPreview {...p} cueHeader="Beat" voice={voice} readLabel="voiceover" fileBase="reel-script" visual={visual} />;
    case 'photostory':
      return <PhotostoryPreview {...p} />;
    default:
      return <BlocksPreview {...p} />;
  }
}
