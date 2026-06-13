// Sends a saved pitch via Resend (through Lovable connector gateway).
// Stamps pitches.sent_at, sets lead.status = 'sent'.
// Captures Resend provider id + RFC822 Message-ID header so Gmail replies
// can later be threaded back to the exact pitch.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const DEFAULT_DAILY_CAP = 120;
// Verified domain: techfaculty.ng (Resend)
const FROM = "Tech Faculty NG <outreach@techfaculty.ng>";
const REPLY_TO = "thetechfaculty@gmail.com";
const SENDING_DOMAIN = "techfaculty.ng";

interface Body {
  pitchId: string;
  dailyCap?: number;
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function bodyToHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.5">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

// Build a deterministic Message-ID header so replies (which echo it in
// In-Reply-To / References) can be matched back to this exact pitch.
function buildMessageId(pitchId: string): string {
  return `<pitch-${pitchId}@${SENDING_DOMAIN}>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY not configured" });
    if (!RESEND_API_KEY) return json(500, { error: "RESEND_API_KEY not configured" });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: uerr } = await supabase.auth.getUser();
    if (uerr || !user) return json(401, { error: "Unauthorized" });

    const { pitchId, dailyCap = DEFAULT_DAILY_CAP } = (await req.json()) as Body;
    if (!pitchId) return json(400, { error: "pitchId required" });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count: sentToday } = await supabase
      .from("pitches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("sent_at", startOfDay.toISOString());

    if ((sentToday ?? 0) >= dailyCap) {
      return json(429, {
        error: `Daily send cap reached (${sentToday}/${dailyCap}). Try again tomorrow or raise the cap.`,
        sentToday,
        dailyCap,
      });
    }

    const { data: pitch, error: perr } = await supabase
      .from("pitches")
      .select("id, subject, body, sent_at, lead_id")
      .eq("id", pitchId)
      .maybeSingle();
    if (perr) return json(500, { error: perr.message });
    if (!pitch) return json(404, { error: "Pitch not found" });
    if (pitch.sent_at) return json(409, { error: "Pitch already sent" });
    if (!pitch.subject || !pitch.body) return json(400, { error: "Pitch missing subject or body" });

    const { data: lead, error: lerr } = await supabase
      .from("leads")
      .select("id, business_name, contact_email, contact_name, status")
      .eq("id", pitch.lead_id)
      .maybeSingle();
    if (lerr) return json(500, { error: lerr.message });
    if (!lead) return json(404, { error: "Lead not found" });
    if (!lead.contact_email) {
      return json(400, { error: `${lead.business_name} has no contact email` });
    }

    const messageIdHeader = buildMessageId(pitch.id);
    const sendRes = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: FROM,
        to: [lead.contact_email],
        reply_to: REPLY_TO,
        subject: pitch.subject,
        html: bodyToHtml(pitch.body),
        text: pitch.body,
        headers: { "Message-ID": messageIdHeader },
      }),
    });

    const sendJson = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok) {
      console.error("Resend error", sendRes.status, sendJson);
      return json(sendRes.status, {
        error: sendJson?.message || sendJson?.error || `Resend error ${sendRes.status}`,
      });
    }

    const sentAt = new Date().toISOString();
    const providerId = sendJson?.id ?? null;
    await supabase.from("pitches").update({
      sent_at: sentAt,
      provider_message_id: providerId,
      message_id_header: messageIdHeader,
    } as never).eq("id", pitch.id);
    await supabase.from("leads").update({ status: "sent" }).eq("id", lead.id);

    return json(200, {
      ok: true,
      pitchId: pitch.id,
      to: lead.contact_email,
      sentAt,
      providerId,
    });
  } catch (e) {
    console.error("send-pitch error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
