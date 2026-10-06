// Branded HTML for Pet Care Card outreach, follow-ups and auto-replies.
// Sent through Resend from the verified domain; display name is Pet Care Card.

export const PETCARE_FROM = "Bill at Pet Care Card <outreach@techfaculty.ng>";
export const PETCARE_REPLY_TO = "thetechfaculty@gmail.com";
export const PETCARE_URL = "https://petcarecards.app";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function petcareLink(leadId?: string, campaign = "outreach") {
  const p = new URLSearchParams({ utm_source: "email", utm_medium: "partner", utm_campaign: campaign });
  if (leadId) p.set("ref", leadId.slice(0, 8));
  return `${PETCARE_URL}/?${p.toString()}`;
}

/** Plain-text body -> branded HTML email with a "Record a care card" button. */
export function renderPetCareHtml(text: string, opts: { leadId?: string; campaign?: string; cta?: string } = {}) {
  const link = petcareLink(opts.leadId, opts.campaign);
  // Drop bare petcarecards.app lines — the button replaces them.
  const cleaned = text.replace(/^\s*https?:\/\/(www\.)?petcarecards\.app\S*\s*$/gim, "").trim();
  const paras = esc(cleaned).split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6;font-size:15px;color:#2b2b2b">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const cta = esc(opts.cta ?? "🎙️ Record a free care card");
  return `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 0 16px;font-size:18px;font-weight:bold;color:#e0703a">🐾 Pet Care Card</td></tr>
<tr><td>${paras}</td></tr>
<tr><td style="padding:8px 0 6px">
<a href="${link}" style="display:inline-block;background:#e0703a;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 22px;border-radius:10px">${cta}</a>
</td></tr>
<tr><td style="padding:4px 0 20px;font-size:13px;color:#666">Just tap record and talk about the pet. No typing, and it's free.</td></tr>
<tr><td style="border-top:1px solid #eee;padding-top:12px;font-size:12px;color:#999">Pet Care Card · <a href="${PETCARE_URL}" style="color:#999">petcarecards.app</a><br/>Not a fit? Reply "stop" and I won't email again.</td></tr>
</table></td></tr></table></body></html>`;
}

export function petcareText(text: string, leadId?: string, campaign?: string) {
  const t = text.replace(/https?:\/\/(www\.)?petcarecards\.app\S*/gi, "").trim();
  return `${t}\n\nTry it free: ${petcareLink(leadId, campaign)}\n\nNot a fit? Reply "stop" and I won't email again.`;
}
