/**
 * Live provider smoke test.
 *
 * Makes ONE tiny real call per configured provider and reports exactly what came
 * back. Run this the moment you add a key — it turns a mid-demo failure into a
 * two-second check.
 *
 *   npm run test:providers            # text providers only
 *   npm run test:providers -- --images  # also spend one image generation
 */
import '../server/env.js';
import { TEXT_PROVIDERS } from '../server/providers.js';
import { backend, backendLabel, backendReady, backendHint, MODEL } from '../server/llm.js';
import { IMAGE_PROVIDERS, imageProviderId, imageProviderLabel } from '../server/images.js';

const withImages = process.argv.includes('--images');
let failed = 0;

console.log(`\nActive backend : ${backendLabel}${backendReady ? '' : '  ✗ NOT READY'}`);
if (!backendReady) console.log(`                 ${backendHint}`);
console.log(`Images         : ${imageProviderLabel}\n`);

const PROMPT = 'Reply with exactly this JSON and nothing else: {"ok":true}';

for (const [id, p] of Object.entries(TEXT_PROVIDERS)) {
  if (!p.ready()) {
    console.log(`skip  ${id.padEnd(10)} ${p.envKey} not set`);
    continue;
  }
  const model = id === backend ? MODEL : p.defaultModel;
  const t = Date.now();
  try {
    const out = await p.complete({
      system: 'You are a JSON API.',
      user: PROMPT,
      maxTokens: 64,
      effort: 'low',
      model,
      json: true,
    });
    const ok = /"ok"\s*:\s*true/.test(out);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(10)} ${model} · ${Date.now() - t}ms · ${JSON.stringify(out).slice(0, 80)}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${id.padEnd(10)} ${model} · ${e.message.slice(0, 220)}`);
  }
}

// The local CLI backend has no key to detect, so test it whenever it is active.
if (backend === 'claude-cli') {
  const { complete } = await import('../server/llm.js');
  const t = Date.now();
  try {
    const out = await complete({ system: 'You are a JSON API.', user: PROMPT, maxTokens: 64 });
    const ok = /"ok"\s*:\s*true/.test(out);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  claude-cli ${MODEL} · ${Date.now() - t}ms · ${JSON.stringify(out).slice(0, 80)}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  claude-cli ${e.message.slice(0, 220)}`);
  }
}

if (withImages && imageProviderId) {
  const p = IMAGE_PROVIDERS[imageProviderId];
  const t = Date.now();
  try {
    const uri = await p.generate({ prompt: 'A plain dark grey abstract background. No text.', aspect: '1:1' });
    const ok = typeof uri === 'string' && uri.startsWith('data:image/');
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  images     ${imageProviderId} · ${Date.now() - t}ms · ${Math.round((uri?.length || 0) / 1024)}KB`);
  } catch (e) {
    failed++;
    console.log(`FAIL  images     ${imageProviderId} · ${e.message.slice(0, 220)}`);
  }
} else if (withImages) {
  console.log('skip  images     no image provider configured');
}

console.log(`\n${failed ? `${failed} provider check(s) failed` : 'all configured providers responded'}`);
process.exit(failed ? 1 : 0);
