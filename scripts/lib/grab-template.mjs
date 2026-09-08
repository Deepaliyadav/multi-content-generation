/**
 * Read a template literal out of source by locating a line inside it.
 *
 * Brace depth must count every `{` opened inside an interpolation, not just
 * `${` — otherwise an argument like `f.rules({ language })` closes the
 * interpolation early and the prompt is silently truncated mid-line.
 */
export function grabTemplate(src, anchor) {
  const at = src.indexOf(anchor);
  if (at === -1) throw new Error(`anchor not found: ${anchor.slice(0, 48)}`);
  let k = src.lastIndexOf('`', at) + 1;
  let depth = 0;
  let out = '';
  while (k < src.length) {
    const c = src[k];
    if (c === '\\') { out += src.slice(k, k + 2); k += 2; continue; }
    if (c === '$' && src[k + 1] === '{') { depth++; out += '${'; k += 2; continue; }
    if (depth > 0 && c === '{') { depth++; out += c; k++; continue; }
    if (c === '}' && depth > 0) { depth--; out += c; k++; continue; }
    if (c === '`' && depth === 0) break;
    out += c; k++;
  }
  return out.replace(/^\n+|\n+$/g, '');
}
