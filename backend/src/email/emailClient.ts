/**
 * Scaffold only -- not wired into any outreach flow yet. Every existing
 * outreach surface in this codebase (Prospecting, Partnerships) is
 * deliberately "draft + copy & open," never auto-send (see
 * ExternalWriteFirewall and this project's docs/ARCHITECTURE.md) --
 * whether an email channel gets the same manual-approval treatment or a
 * real one-click send is a decision for the owner to make explicitly, not
 * something to fold in silently alongside this scaffold. This file exists
 * so that decision, whenever it's made, doesn't also require writing the
 * Resend integration from scratch.
 *
 * Uses Resend because it's the org's existing email vendor -- fillbookhq/
 * frontend already sends trial-ending reminders through it (RESEND_API_KEY,
 * see that repo's .env.example). Growth OS should get its OWN Resend API
 * key under a distinct sending identity (e.g. growth@fillbookhq.com), not
 * share the main app's transactional key -- a bulk cold-outreach send's
 * deliverability/spam-complaint history must never be able to affect
 * whether the main app's password-reset or receipt emails land in the
 * inbox. Verify that sending identity's domain in Resend before use.
 */
export interface OutreachEmail {
  to: string;
  subject: string;
  /** Plain text only for now -- outreach copy shouldn't need HTML templating, and plain text emails from a real-looking sender outperform templated HTML for cold outreach anyway. */
  body: string;
  replyTo?: string;
}

export interface EmailSendResult {
  sent: boolean;
  /** Set when sent is false -- e.g. not configured yet. Never thrown for this case, matching how every other not-yet-configured integration in this codebase (X, Search Console) behaves: a missing credential is a normal, reportable state, not a crash. */
  skippedReason?: string;
  providerId?: string;
}

export async function sendOutreachEmail(email: OutreachEmail): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.OUTREACH_FROM_EMAIL;
  if (!apiKey || !fromAddress) {
    return { sent: false, skippedReason: "RESEND_API_KEY/OUTREACH_FROM_EMAIL not configured" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromAddress,
      to: [email.to],
      subject: email.subject,
      text: email.body,
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { id?: string };
  return { sent: true, providerId: data.id };
}
