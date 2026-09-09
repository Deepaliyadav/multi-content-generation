# Rundown — demo script

**One story in. Thirteen formats out. Every one of them watched for the moment
the story changes underneath it.**

Roughly 4 minutes. Each beat says what to click, what to say, and the one line
that makes the point.

---

## The shape of it

```
  INTAKE                 LEDGER              GENERATION            REVIEW              OUT
  ────────               ──────              ──────────            ──────              ───
  Desk board  ─┐                          ┌─ 13 formats  ─┐    rail + pane      Instagram
  (autopilot)  ├──▶  facts extracted  ────┤   in parallel  ├──▶ edit in place ──▶ CMS draft
  Find a story ┤     BEFORE any writing   └─ art direction ┘    versions          Mail
  Write it     ┘                                                hear the read
                            ▲                                        │
                            └──── re-extract · diff · patch ─────────┘
                                  (when the story moves)
```

---

## 1 · The desk runs itself (40s)

**Open on the Desk board.**

> This is a working newsroom desk. The autopilot sweeps competitor wires every
> five minutes, picks what's worth filing, and produces a full rundown for each
> one. Three stories a cycle, capped at twelve an hour so it can't run away with
> your spend.

**Point at a card mid-flight — `Processing…` with the pulsing edge.**

> And it shows its work.

**Point at the step log.**

> Reading NDTV Hindi — 100 headlines. News18 Hindi — 200. Clustering 45 items
> into 11 distinct stories. Checking them against our own CMS so we don't file
> what we've already published. Ranking. Then writing.

*The point: this is not a prompt box. It's a pipeline you can watch.*

---

## 2 · Where a story comes from (30s)

**New story → Find me a story.**

> Two ways in. The desk finds one for you — wires plus a trending-search agent,
> deduped against what we've already filed — or you paste your own copy.

**Click *Use this story*.**

> It drafts a starter brief, and it's honest about what that is: unverified,
> attributed to the outlet, with a list of what still needs checking.

*The point: the desk never pretends a wire pickup is reporting.*

---

## 3 · Facts before words (30s)

**Generate. Land on the fact ledger.**

> Before a single word is written, the story is broken into atomic facts.
> Deaths: 5. Location: Sector 62, Noida. Collapse time: 6.15 am.

> Every one of the thirteen formats is then written **against that ledger** —
> and a figure that never appeared in the source is rejected in code, not just
> discouraged in the prompt. Cross-script, so a Hindi card writing आठ is checked
> the same way as an English one writing eight.

*The point: this is the trust mechanic. Everything else rests on it.*

---

## 4 · Thirteen formats, in parallel (45s)

**Show the progress list, then the rail.**

> Thirteen formats, thirteen concurrent calls, each with its own contract —
> character ceilings, slide counts, part structures — checked in code and
> repaired once if the model breaks them.

**Click through three that look nothing alike:**

- **TV script** — cue and copy, as a running order reads on paper
- **Insta carousel** — the real 1080 card, with a per-slide photograph
- **Infographic** — code-rendered, because a diffusion model cannot spell "5"

> The pictures are art-directed: a model reads each slide's own copy and writes
> a photojournalistic brief for it — Indian streets, Indian faces, one grade
> across the set. Never the aftermath of a real incident, and never any text in
> frame; the words are composited on top from the ledger.

*The point: each format is a different craft, not one blob reformatted.*

---

## 5 · The desk's own tools (40s)

Pick two, not all:

- **Hear the anchor script** — the words highlight as they're read, so you can
  tell a mouthful before the anchor does
- **Language** — 37 of them, and the script, font and direction follow: Tamil
  in Tamil, Urdu right-to-left
- **Versions** — a rewrite never destroys what it replaced; `Source | Hindi |
  Tamil`, one click apart
- **Click any line to edit it** in place

*The point: it's an instrument, not a slot machine.*

---

## 6 · The story moves — the payoff (45s)

**Edit source story → apply a developing update.**

> Here's what none of this is worth without. The toll changes.

**Watch it:**

> The ledger is re-extracted and diffed — 5 → 8, marked as a correction. Every
> published format is re-scanned against what moved. Nine of thirteen come back
> stale.

**Patch.**

> And only the lines carrying the outdated value are rewritten. The other
> forty-one are left byte-for-byte. Before and after, side by side.

*The point: this is the difference between a generator and a desk.*

---

## 7 · Out the door (20s)

> Then it leaves. Instagram posts for real — the card is composited at 1080,
> uploaded, and published through Zernio. A story goes out as consecutive
> stories, because Instagram has no such thing as a multi-image story. Articles
> draft to the CMS; scripts draft a mail.

---

## The close

> Thirteen formats from one story in about eighty seconds. Every figure traceable
> to the source. And when the story moves — which it always does — the desk knows
> which of the thirteen just became wrong, and fixes only those lines.

---

## Under it

| | |
|---|---|
| Writing | Anthropic · claude-opus-5, fan-out 13 |
| Images | Gemini · art-directed per slide |
| Voice | ElevenLabs · character-level timing for the read-along |
| Publishing | Zernio → Instagram, media hosted on Supabase |
| Discovery | RSS wires + trending-search agent, deduped against the CMS |

## If something misbehaves

- **A format shows a warning** — that's the validator catching a broken contract,
  not a crash. Say so; it's the feature working.
- **An image is missing** — the provider rate-limits under load. The copy is
  unaffected; regenerate that format.
- **The autopilot is quiet** — check the hourly ceiling line. It's the spend
  guard, not a fault.
