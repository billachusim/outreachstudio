// Auto-replies to Pet Care Card partner leads after a reply is classified.
// interested/question -> AI-written reply with setup steps + button, sent in-thread.
// not_interested/unsubscribe -> opt out, no reply. auto_reply/out_of_office -> ignore.
// Internal only: requires the service-role key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PETCARE_FROM, PETCARE_REPLY_TO, renderPetCareHtml, petcareText } from "../_shared/petcare-email.ts";

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";
const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { "Content-Type": "application/json" } });

const SETUP = `How Pet Care Card works (use what's relevant):
- It's free for sitters and their clients while we test.
- Owner (or sitter) opens petcarecards.app, taps record, and just talks about the pet: feeding, routines, meds, vet, emergency contacts, quirks. It turns that into a tidy care card. Typing works too.
- The owner shares the card link with the sitter. The sitter sees everything in one place on their phone, no app install.
- Easiest way to start: the sitter sends the link to 1-2 upcoming clients and asks them to record a card before the visit. Or try it yourself first with your own pet.
- Bill (the founder) can personally help set them up or hop on a quick call.`;

Deno.serve(async (req) => {
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (req.headers.get("Authorization") !== `Bearer ${SERVICE_KEY}`) return json(401, { error: "unauthorized" });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const { messageId, intent } = await req.json();
    if (!messageId || !intent) return json(400, { error: "messageId and intent required" });

    const { data: msg } = await supabase.from("channel_messages")
      .select("id, user_id, lead_id, campaign_id, subject, body, from_address, payload").eq("id", messageId).maybeSingle();
    if (!msg?.lead_id) return json(404, { error: "message not found" });
    const { data: lead } = await supabase.from("leads")
      .select("id, business_name, contact_name, contact_email, opted_out, partner_stage, campaign_id, campaigns:campaign_id(mode)")
      .eq("id", msg.lead_id).maybeSingle();
    if (!lead || (lead as any).campaigns?.mode !== "partner_acquisition") return json(200, { skipped: "not partner lead" });

    const now = new Date().toISOString();
    const note = async (message: string, level = "info") =>
      supabase.from("run_events").insert({ user_id: msg.user_id, campaign_id: lead.campaign_id, lead_id: lead.id, kind: "auto-reply", level, message });

    if (intent === "not_interested" || intent === "unsubscribe") {
      await supabase.from("leads").update({ opted_out: true, partner_stage: "declined", partner_stage_at: now } as never).eq("id", lead.id);
      await note(`${lead.business_name} said no. Stopped contacting them.`);
      return json(200, { ok: true, action: "opted_out" });
    }
    if (intent === "auto_reply" || intent === "out_of_office") {
      await supabase.from("leads").update({ status: "sent" }).eq("id", lead.id);
      return json(200, { ok: true, action: "ignored_auto_reply" });
    }
    if (intent !== "interested" && intent !== "question") return json(200, { ok: true, action: "left_for_human" });
    if (lead.opted_out) return json(200, { skipped: "opted out" });

    // Safety: one auto-reply per inbound message, max 3 per lead.
    const { data: prior } = await supabase.from("channel_messages")
      .select("id, payload").eq("lead_id", lead.id).eq("direction", "outbound").eq("status", "sent");
    const autos = (prior ?? []).filter((p: any) => p.payload?.source === "petcare-auto-reply");
    if (autos.some((p: any) => p.payload?.in_reply_to_message === msg.id)) return json(200, { skipped: "already replied" });
    if (autos.length >= 3) { await note(`${lead.business_name} replied again. Over to you (3 auto-replies already sent).`, "warn"); return json(200, { skipped: "cap" }); }

    const ai = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: `You are Bill, founder of Pet Care Card, replying to a pet-sitting business that answered your outreach. Warm, short (60-130 words), plain text, no markdown, no links (a button is added). Answer any question they asked directly and honestly; if you don't know something (pricing beyond free trial, integrations), say you'll follow up personally. Then give 2-3 simple next steps to start. Highlight that clients can just talk instead of typing. Sign off "Bill". Never invent features.\n\n${SETUP}` },
          { role: "user", content: `Business: ${lead.business_name}${lead.contact_name ? ` (contact: ${lead.contact_name})` : ""}\nTheir reply:\n${(msg.body ?? "").split(/\nOn .+wrote:/)[0].slice(0, 3000)}` },
        ],
      }),
    });
    if (!ai.ok) { await note(`Couldn't write a reply to ${lead.business_name} (AI ${ai.status}).`, "error"); return json(200, { ok: false }); }
    const body = ((await ai.json())?.choices?.[0]?.message?.content ?? "").trim();
    if (!body || !RESEND_API_KEY || !lead.contact_email) return json(200, { ok: false, error: "nothing to send" });

    const to = msg.from_address || lead.contact_email;
    const subject = msg.subject?.match(/^\s*re:/i) ? msg.subject : `Re: ${msg.subject || "Pet Care Card"}`;
    const inReply = (msg.payload as any)?.message_id_header as string | undefined;
    const headers: Record<string, string> = {};
    if (inReply) { headers["In-Reply-To"] = inReply; headers["References"] = inReply; }

    const res = await fetch(`${RESEND_GATEWAY}/emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": RESEND_API_KEY },
      body: JSON.stringify({
        from: PETCARE_FROM, to: [to], reply_to: PETCARE_REPLY_TO, subject,
        html: renderPetCareHtml(body, { leadId: lead.id, campaign: "reply", cta: "🎙️ Start your first care card" }),
        text: petcareText(body, lead.id, "reply"), headers,
      }),
    });
    const rj = await res.json().catch(() => ({}));
    await supabase.from("channel_messages").insert({
      user_id: msg.user_id, lead_id: lead.id, campaign_id: lead.campaign_id, channel: "email", direction: "outbound",
      to_address: to, from_address: PETCARE_FROM, subject, body, provider_message_id: (rj as any)?.id ?? null,
      status: res.ok ? "sent" : "failed", error: res.ok ? null : ((rj as any)?.message ?? `HTTP ${res.status}`),
      payload: { source: "petcare-auto-reply", in_reply_to_message: msg.id, intent },
    });
    if (!res.ok) { await note(`Reply to ${lead.business_name} failed to send.`, "error"); return json(200, { ok: false }); }

    if (!["trial", "active"].includes(lead.partner_stage)) {
      await supabase.from("leads").update({ partner_stage: "interested", partner_stage_at: now, last_activity_at: now } as never).eq("id", lead.id);
    }
    await note(`Auto-replied to ${lead.business_name} with setup steps and the free link.`);
    return json(200, { ok: true, action: "replied" });
  } catch (e) {
    console.error("petcare-auto-reply", e);
    return json(500, { error: e instanceof Error ? e.message : "error" });
  }
});
