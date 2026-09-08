const json = async (url, body) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
};

export const getMeta = () => fetch('/api/meta').then((r) => r.json());
export const extractFacts = (story) => json('/api/facts', { story });
export const rediff = (story, oldFacts) => json('/api/rediff', { story, oldFacts });
export const scan = (outputs, changes) => json('/api/scan', { outputs, changes });
export const patch = (body) => json('/api/patch', body);
export const patchVisual = (body) => json('/api/patch-visual', body);
export const publishInstagram = (body) => json('/api/publish/instagram', body);

/** Streams newline-delimited JSON events from /api/generate. */
export async function generate(body, onEvent) {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`Generation failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      const s = line.trim();
      if (s) onEvent(JSON.parse(s));
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf.trim()));
}
