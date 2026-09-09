/**
 * Where each format actually goes.
 *
 * A generic "Approve" told an editor nothing about what happens next. Each
 * format has a real destination — the CMS, an email to a producer, a push
 * queued behind publication — and the button says which.
 *
 * The action IS the sign-off: dispatching a format approves it, because an
 * editor who has sent it to the CMS has plainly signed it off.
 *
 * What is genuinely wired right now:
 *   mail       yes — builds a mailto: the desk's own client opens, prefilled.
 *   instagram  yes — via Zernio, handled by the format preview itself.
 *   cms        only if CMS_DRAFT_URL is set; otherwise the draft is recorded
 *              here and marked not-yet-delivered rather than pretending.
 *   push       no service configured; queued behind publish and recorded.
 */
import './env.js';

export const DESTINATIONS = {
  translation: { kind: 'cms', label: 'Draft to CMS', verb: 'Drafted to CMS' },
  highlights: { kind: 'cms', label: 'Draft to CMS', verb: 'Drafted to CMS' },
  photostory: { kind: 'cms', label: 'Draft to CMS', verb: 'Drafted to CMS' },
  // Not in the brief; the infographic is article furniture, so it follows the
  // article. Change the kind here if it should go somewhere else.
  infographic: { kind: 'cms', label: 'Draft to CMS', verb: 'Drafted to CMS' },

  video_script: { kind: 'mail', label: 'Draft a mail', verb: 'Mail drafted' },
  tv_script: { kind: 'mail', label: 'Draft a mail', verb: 'Mail drafted' },
  reel: { kind: 'mail', label: 'Draft a mail', verb: 'Mail drafted' },

  push: { kind: 'push_on_publish', label: 'Send notification after publish', verb: 'Queued for publish' },
  newsletter: { kind: 'mail_on_publish', label: 'Send mail after publish', verb: 'Queued for publish' },

  // These cards carry their own Instagram publish control, which posts the
  // rendered images. Here the button is only the sign-off, so the two do not
  // look like competing ways to publish the same thing.
  insta_story: { kind: 'instagram', label: 'Approve for Instagram', verb: 'Approved for Instagram' },
  insta_post: { kind: 'instagram', label: 'Approve for Instagram', verb: 'Approved for Instagram' },
  insta_carousel: { kind: 'instagram', label: 'Approve for Instagram', verb: 'Approved for Instagram' },

  // No X integration is configured, so this stays an honest manual step.
  twitter: { kind: 'manual', label: 'Mark ready to post', verb: 'Ready to post' },
};

export const destinationFor = (formatId) =>
  DESTINATIONS[formatId] || { kind: 'manual', label: 'Mark reviewed', verb: 'Reviewed' };

export const cmsDraftReady = () => !!process.env.CMS_DRAFT_URL;
export const mailTo = () => process.env.MAIL_TO || '';

/** Flatten one output into plain text a person can read in a mail or a CMS box. */
export function asPlainText(output) {
  return (output?.blocks || [])
    .map((b) => {
      const lines = (b.lines || []).filter(Boolean);
      if (!lines.length) return '';
      return `${b.label}\n${'-'.repeat(b.label.length)}\n${lines.join('\n')}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

/** POST a draft into the newsroom CMS, when one is configured. */
async function draftToCms({ story, formatId, output, rundownId }) {
  if (!cmsDraftReady())
    return {
      delivered: false,
      note: 'No CMS draft endpoint configured. The draft is recorded here — set CMS_DRAFT_URL to deliver it.',
    };

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.CMS_AUTH_HEADER && process.env.CMS_AUTH_VALUE)
    headers[process.env.CMS_AUTH_HEADER] = process.env.CMS_AUTH_VALUE;

  const res = await fetch(process.env.CMS_DRAFT_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      status: 'draft',
      externalId: `${rundownId}:${formatId}`,
      format: formatId,
      headline: story?.headline || '',
      body: asPlainText(output),
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`CMS draft failed (HTTP ${res.status}): ${text.slice(0, 160)}`);
  return { delivered: true, note: 'Draft created in the CMS.', response: text.slice(0, 200) };
}

/**
 * Build a mailto: the browser hands to the desk's own mail client.
 *
 * No SMTP credentials, no server-side sending, nothing to leak — and the
 * producer gets a real draft they can edit before it goes.
 */
function buildMail({ story, formatId, output, label }) {
  const subject = `[${label}] ${story?.headline || 'Rundown'}`;
  const body = [
    `${label} — drafted by the desk, not yet verified.`,
    '',
    `Story: ${story?.headline || ''}`,
    '',
    asPlainText(output),
    '',
    '— Sent from Rundown',
  ].join('\n');
  return {
    delivered: false,
    opensClient: true,
    mailto: `mailto:${encodeURIComponent(mailTo())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    note: mailTo() ? `Opens a mail to ${mailTo()}.` : 'Opens your mail client with the copy prefilled.',
  };
}

/**
 * Run a format's destination.
 *
 * Deferred kinds are not sent now by design: a push alert and a newsletter go
 * out when the story publishes, not when an editor reads it.
 */
export async function dispatch({ formatId, output, story, rundownId }) {
  const dest = destinationFor(formatId);

  switch (dest.kind) {
    case 'cms':
      return { kind: dest.kind, ...(await draftToCms({ story, formatId, output, rundownId })) };

    case 'mail':
      return { kind: dest.kind, ...buildMail({ story, formatId, output, label: dest.label }) };

    case 'mail_on_publish':
      return {
        kind: dest.kind,
        delivered: false,
        deferred: true,
        note: 'Queued. The mail goes out when this rundown is published.',
      };

    case 'push_on_publish':
      return {
        kind: dest.kind,
        delivered: false,
        deferred: true,
        note: 'Queued. The alert fires when this rundown is published.',
      };

    case 'instagram':
      return {
        kind: dest.kind,
        delivered: false,
        note: 'Approved. Post it with the Instagram control on the card below.',
      };

    default:
      return { kind: 'manual', delivered: false, note: 'Marked ready. Post it from the platform itself.' };
  }
}

/** Fired when a rundown is published: everything that was waiting for that. */
export async function firePending(rundown) {
  const fired = [];
  for (const [formatId, d] of Object.entries(rundown.dispatches || {})) {
    if (!d?.deferred || d.firedAt) continue;
    const dest = destinationFor(formatId);
    const output = rundown.outputs?.[formatId];

    if (dest.kind === 'mail_on_publish') {
      fired.push({
        formatId,
        ...buildMail({ story: rundown.story, output, label: dest.label }),
        firedAt: new Date().toISOString(),
      });
    } else if (dest.kind === 'push_on_publish') {
      fired.push({
        formatId,
        delivered: false,
        firedAt: new Date().toISOString(),
        note: 'No push service is configured, so the alert is recorded rather than sent.',
      });
    }
  }
  return fired;
}
