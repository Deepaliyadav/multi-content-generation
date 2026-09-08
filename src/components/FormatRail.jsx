const words = (s) => (String(s).trim() ? String(s).trim().split(/\s+/).length : 0);
const chars = (s) => [...String(s)].length;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What a desk actually wants to know at a glance is the size of the thing in
 * its own units — a script is cues, a push is characters, a carousel is slides.
 * A line count is a shape of our data, not a fact about the output.
 */
function sizeOf(format, out) {
  const blocks = out.blocks || [];
  const lines = blocks.flatMap((b) => b.lines || []);
  const meta = out.meta || {};
  const allWords = lines.reduce((n, l) => n + words(l), 0);

  switch (format.id) {
    case 'translation':
      return plural(allWords, 'word');
    case 'highlights':
      return plural(lines.length, 'point');
    case 'insta_story':
      return plural(blocks.length, 'card');
    case 'insta_carousel':
      return plural(blocks.length, 'slide');
    case 'insta_post':
      return plural(allWords, 'word');
    case 'twitter':
      return plural(meta.chars ?? chars(lines[0] || ''), 'char');
    case 'push':
      return plural((meta.titleChars ?? 0) + (meta.bodyChars ?? 0), 'char');
    case 'video_script':
      return plural(blocks.length, 'segment');
    case 'tv_script':
      return plural(blocks.length, 'cue');
    case 'reel':
      return plural(meta.words ?? allWords, 'word');
    case 'photostory':
      return plural(blocks.length, 'frame');
    case 'infographic':
      return plural(lines.length, 'data point');
    case 'newsletter':
      return plural(allWords, 'word');
    default:
      return plural(lines.length, 'line');
  }
}

export default function FormatRail({
  formats,
  active,
  onSelect,
  outputs,
  status,
  errors,
  staleReport,
}) {
  const dotClass = (f) => {
    if (errors[f.id]) return 'error';
    if (staleReport[f.id]?.stale) return 'stale';
    if (status[f.id] === 'running') return 'running';
    return '';
  };

  const metaLine = (f) => {
    if (errors[f.id]) return 'failed';
    if (staleReport[f.id]?.stale) return 'stale — needs patching';
    const out = outputs[f.id];
    if (!out) return status[f.id] === 'running' ? 'writing…' : 'queued';
    return sizeOf(f, out);
  };

  return (
    <nav className="format-rail">
      {formats.map((f, i) => {
        const dot = dotClass(f);
        return (
          <button
            key={f.id}
            className={`rail-item ${active === f.id ? 'active' : ''}`}
            onClick={() => onSelect(f.id)}
          >
            <span className="row1">
              <span className="rnum">{String(i + 1).padStart(2, '0')}</span>
              <span className="rlabel">{f.label}</span>
              {dot && <span className={`rdot ${dot}`} />}
            </span>
            <span className="rmeta">{metaLine(f)}</span>
          </button>
        );
      })}
    </nav>
  );
}
