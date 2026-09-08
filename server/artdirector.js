/**
 * Art direction for the Instagram formats.
 *
 * The old approach asked one generic abstract backdrop and shared it across
 * every slide, which is why the cards read as static wallpaper: the picture had
 * nothing to do with the words on top of it.
 *
 * Here a model acts as creative director — it reads the story and the actual
 * slide copy, then writes one cinematic prompt per slide, so each image is
 * about that slide and the set still hangs together as a set.
 *
 * Two guards that are not negotiable, and are enforced in code rather than left
 * to the model to remember:
 *
 *  - No text in the frame. The headline is composited afterwards from the fact
 *    ledger, and a diffusion model cannot spell a figure reliably. Letting it
 *    try is how "5 dead" becomes "B dead" on a published card.
 *  - No depiction of casualties or the aftermath of a real event. A photoreal
 *    picture of something nobody photographed is synthetic documentary imagery,
 *    and this app exists to be trustworthy about facts. The same reason drives
 *    the AI-GENERATED mark burned into every card.
 */
import { completeJson } from './llm.js';

const RATIO = {
  '1:1': 'Square 1:1 composition, framed for an Instagram feed post.',
  '9:16': 'Vertical 9:16 composition, framed for an Instagram story.',
  '4:3': 'Landscape 4:3 composition, framed as a press photograph in a photo essay.',
};

const SYSTEM = `You are a creative director specializing in Instagram visuals for news and trending topics.
You write image-generation prompts only. You never write captions, headlines or copy.`;

function directorPrompt({ story, slideTexts, aspect }) {
  const n = slideTexts.length;
  return `Given an article summary and ${n} slide caption${n > 1 ? 's' : ''}, extract the core visual story and generate exactly ${n} distinct, cinematic image generation prompt${n > 1 ? 's' : ''} — one per slide.

Each prompt must:
- Be a rich, detailed visual description (scene composition, lighting, mood, color palette, style)
- Directly reflect that slide's headline and message
- Read as a real photograph taken by a professional photojournalist — shot on a real camera with a real lens (natural depth of field, realistic skin texture and imperfections, true-to-life crowd/hand/body anatomy, authentic environmental detail like weather, dust, or uneven lighting)
- Explicitly avoid anything that reads as AI-generated or CGI: no glossy/plastic skin, no unnaturally perfect symmetry, no oversaturated neon glow, no floating cartoon doodles/emoji/icons overlaid on the scene, no surreal or impossible geometry
- Maintain consistent visual identity (same color grading, time of day, film stock feel) across all ${n} slide${n > 1 ? 's' : ''}
- This is Indian news for an Indian audience: unless the topic is explicitly international, people shown must look Indian (Indian skin tones, facial features, hairstyles) wearing everyday Indian clothing appropriate to the setting (e.g. kurta, saree, salwar suit, or plain Western-style clothes as commonly worn in Indian cities — pick what fits the scene, not a costume cliché), and the setting should read as a real Indian location (Indian street signage/architecture, auto-rickshaws, local shop signage, crowd density typical of Indian cities, etc.) so the audience sees themselves in it, not a generic Western stock photo
- Do not depict real, identifiable named public figures (politicians, celebrities, etc.) with a realistic likeness — represent them symbolically instead (silhouette, podium, microphone, flag, crowd, documents, or other metaphorical props), rendered with the same photojournalistic realism as the rest of the scene
- Do NOT render any text, letters, or words in the image — the headline/subtext will be added afterward as a separate layer. Instead, leave the bottom portion of the frame visually calmer (less busy, slightly darker or more open) so a text caption can be legibly placed there later
- ${RATIO[aspect] || RATIO['1:1']}

HARD LIMIT — this is a real news story about real people:
- Never depict casualties, injuries, bodies, blood, or the immediate aftermath of harm to a person.
- Never depict the specific damaged object or scene of a real incident as though photographed at the time. Show context, place, response, or the human situation around it instead.

ARTICLE SUMMARY
Headline: ${story.headline}

${story.body}

SLIDE CAPTIONS
${slideTexts.map((t, i) => `Slide ${i + 1}: ${t}`).join('\n')}

Return JSON of exactly this shape:
{ "prompts": [${slideTexts.map((_, i) => `"prompt for slide ${i + 1}"`).join(', ')}] }`;
}

/** Belt and braces: the two hard rules are appended to whatever the model wrote. */
const GUARDRAIL =
  'ABSOLUTELY NO text, letters, numbers, logos, watermarks or captions anywhere in the image. ' +
  'No depiction of casualties, injuries, bodies or blood. ' +
  'Keep the lower third of the frame calm and uncluttered for a text overlay.';

/**
 * Returns one prompt per slide. Falls back to a per-slide prompt built from the
 * slide's own text if the director call fails — a plainer picture that is still
 * about the right slide beats one shared backdrop about nothing.
 */
export async function directSlides({ story, slideTexts, aspect = '1:1' }) {
  const fallback = slideTexts.map((t) =>
    [
      'Editorial photojournalism, real photograph, natural light, documentary style.',
      `Scene in India relating to: ${t || story.headline}.`,
      'Everyday Indian people and setting, authentic Indian street detail.',
      RATIO[aspect] || RATIO['1:1'],
      GUARDRAIL,
    ].join(' ')
  );

  try {
    const out = await completeJson({
      system: SYSTEM,
      user: directorPrompt({ story, slideTexts, aspect }),
      maxTokens: 2500,
      effort: 'medium',
    });
    const prompts = Array.isArray(out?.prompts) ? out.prompts : [];
    return slideTexts.map((_, i) => {
      const p = String(prompts[i] ?? '').trim();
      return p ? `${p} ${GUARDRAIL}` : fallback[i];
    });
  } catch (e) {
    console.error('[lss] art direction failed, using per-slide fallback:', e.message);
    return fallback;
  }
}
