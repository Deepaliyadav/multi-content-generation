# Living Story Sync

One source story in. Thirteen publication formats out. And — the part every other
repackaging tool skips — **when the source story changes, the formats you already
published are re-checked against the corrected facts, and only the lines that
actually went wrong get rewritten.**

---

## Run it

```bash
npm install
npm run build && npm start      # single port: http://localhost:8787
```

For development with hot reload (two ports, Vite proxies `/api`):

```bash
npm run dev                     # http://localhost:5173
```

### Which model backend it uses

The app picks a backend automatically and prints it on boot; the UI shows it in
the masthead.

| Condition | Backend | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` is set | Anthropic Messages API (`@anthropic-ai/sdk`) | Preferred. Faster, cheaper, 13-way fan-out. |
| No key | Local Claude Code binary, headless | Zero setup — uses the machine's existing Claude Code login. |

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # optional but recommended for a live demo
```

Both paths run the same prompts through the same pipeline. Environment overrides:
`LSS_MODEL` (default `claude-opus-5`), `LSS_BACKEND` (`sdk` | `cli`),
`LSS_CONCURRENCY`, `PORT`.

### Verify it

The build ships with the harness used to develop it — worth re-running before a
live demo.

```bash
npm start &
npm run verify              # 24 end-to-end checks in a real browser
npm run audit:grounding     # traces every figure in all 13 outputs to the source
```

`npm run verify` drives the actual app against the actual model: ledger-before-
outputs, the generation timer, all 13 formats and their contracts, format
distinctness, inline editing, approval, the stale scan, line-precision, the
before/after diff, and responsive layout at three widths.

---

## The 90-second demo

1. **Load a sample** — "Noida stairwell collapse", pick a translation language, hit
   **Generate formats**.
2. **Watch the fact ledger build first.** Nothing is written until the atomic facts
   are extracted; every format is then written against that ledger and nothing
   outside it.
3. **Thirteen formats land** in ~45s, grouped into five tabs, with a visible timer.
4. **Approve a few** so they move to *Published*.
5. **Edit source story → "Small correction — wrong hospital named"** →
   *Update source & re-check formats*.
6. The ledger shows `Fortis Hospital, Noida → Kailash Hospital, Noida`, and
   **10 of 13 formats flag stale — Insta story, Twitter and Push stay clean**
   because they never named the hospital. 11 of 98 published lines are flagged.
7. **Regenerate this one** on any stale card → a word-level before/after diff.
   In the Hindi translation it changes exactly one word: फोर्टिस → कैलाश.

The other sample update ("Big update — toll rises to 8") changes a fact nearly
every format carries, so almost everything flags. Both paths run the same real
extraction and diff — nothing is hard-coded.

---

## How the differentiator actually works

The fact ledger is **structured data**, not prose, so "does this output reference
this fact" is a real operation rather than a guess.

**1 · Extract** — `POST /api/facts`. 5–12 atomic facts, each with `label`,
`value`, `type`, and a verbatim `evidence` span. Facts whose evidence appears
character-for-character in the copy are marked grounded.

**2 · Generate** — `POST /api/generate` streams NDJSON, one event per format, so
the UI can say *"Writing the TV script…"* rather than spin. Each format is
generated against its own contract and then **validated in code** — see
`server/formats.js`. Character ceilings, slide counts and part structures are
enforced, not merely requested: one repair round, then a hard trim.

**3 · Diff** — `POST /api/rediff` re-extracts the ledger from the edited story and
aligns it against the old one. Two independent extractions drift in wording, so a
**token-subset guard** (`server/pipeline.js`) drops rows where one value is merely
more specific than the other — `6.15 am` vs `6.15 am Tuesday` is not a
correction. Token-aware, so `5 → 50` still counts.

**4 · Scan** — `POST /api/scan`. For each published output, three layers, cheapest
first:

- literal match of the old value in a line;
- **cross-script numeral match** — `5`, `five`, `पांच`, `পাঁচ` and `५` are one
  fact, which is what lets the translated card be checked without an LLM;
- the model's own `factsUsed`, which triggers one narrow *locate* call for
  transliterated names, so a card is never condemned wholesale when a single line
  is at fault.

Outputs referencing only unchanged facts are left alone.

**5 · Patch** — `POST /api/patch` sends the model **only the flagged lines** and
splices the rewrites back in; every other line is carried over byte-for-byte.
`POST /api/patch-visual` does the same for an image: it corrects the visual spec
and re-renders, leaving the untouched stats and series exactly as they were.

---

## Format fidelity

The thirteen are deliberately not variations of one summary. Each carries hard
rules and a validator (`server/formats.js`):

| # | Format | Enforced |
|---|---|---|
| 1 | Translation | one line per paragraph, headline block |
| 2 | Article highlights | 5–7 bullets |
| 3 | Insta story | 1–3 cards, ≤10 words each |
| 4 | Insta post | hook + caption + 4–7 hashtags |
| 5 | Insta carousel | 5–7 slides, headline + caption each |
| 6 | Twitter / X | ≤257 chars text (280 − 23 for the link), no URL |
| 7 | Video script | intro / body (3–5) / outro, spoken pacing |
| 8 | TV script | four labelled parts: breaking strap · ticker (≤90 chars) · 3–4 highlights · 4–7 anchor sentences |
| 9 | Reel + cover | hook ≤3s, 4–6 script lines, generated cover image |
| 10 | Photostory | 5–8 sequential frames, `[photo direction]` + caption |
| 11 | Infographic | rendered graphic + 3–5 stats + chart spec |
| 12 | Push | title ≤40, body ≤120 |
| 13 | Newsletter | standfirst + 2–4 sentences + read-more |

## Images

The Reel cover (1080×1920) and the Infographic (1080×1080) are **real rendered
images**, downloadable as PNG. The model produces a structured, fact-grounded
visual spec; `server/visuals.js` renders it as SVG. Layout lives in code rather
than in model-authored markup, which keeps the typography sound and makes
regeneration deterministic — and because the spec is structured data, it is
checkable against the fact ledger like any text output. Colours are the validated
data-visualisation reference palette; single-series charts are directly labelled.

No external image API is required, and none is configured.

## Grounding

Every generation call carries the same grounding contract (`server/prompts.js`):
only ledger facts, no invented numbers, names, quotes or attributions, no
sharpened hedges, and graceful omission when a format would normally want a
detail the story does not have.

That contract is then **checked in code, not just requested**. After every
generation and every patch, each figure the output states is traced back to the
source story — cross-script and word-aware, so a Hindi card writing `आठ` and an
English one writing `twelve` both resolve against the original copy. An
ungrounded figure triggers a repair round, and anything still unresolved is
surfaced on the card as a visible warning rather than shipped quietly.

Nothing auto-publishes. Every output lands in review, is editable inline, and
becomes *Published* only when a human clicks Approve.

---

## Layout

```
scripts/
  acceptance.mjs      24-check browser run
  grounding-audit.mjs figure-tracing audit
server/
  index.js      Express API + NDJSON streaming
  llm.js        two interchangeable model backends
  formats.js    the 13 format contracts + validators
  prompts.js    grounding contract, generation, diff, patch
  pipeline.js   extract → generate → validate → diff → patch
  facts.js      fact-reference detection, cross-script matching, stale scan
  visuals.js    SVG renderers for the cover and the infographic
  samples.js    three sample stories, two developing updates
src/            React single-page app
```

## Known limits

- Session state lives in the browser; a refresh clears it.
- Cross-script numeral matching covers English, Hindi and Bangla; other languages
  fall back to the model-located path.
- "Published" is simulated locally — there are no outbound integrations.
