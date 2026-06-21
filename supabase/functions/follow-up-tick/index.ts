// Process due pitch_sequences: skip if lead already replied; otherwise draft a follow-up
// (different angle per step) and send via Resend. Cron-driven (every 10 min).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";
const FROM = "Tech Faculty NG <outreach@techfaculty.ng>";

const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { "Content-Type": "application/json" } });

function bodyToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.5">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

const ANGLES: Record<number, string> = {
  1: "Soft bump. 2 sentences. Ask if it landed and offer one more relevant detail. No new asks.",
  2: "Different angle: lead with a tangible outcome or metric a similar customer got. Still under 90 words.",
  3: "Final, polite breakup. 3 sentences. Make it easy to say no. No CTA pressure.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null);
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Get up to 5 due sequences
    const { data: due } = await supabase
      .from("pitch_sequences")
      .select("*")
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at")
      .limit(5);

    if (!due || due.length === 0) return json(200, { ok: true, processed: 0 });

    // Global daily cap (Resend: 120/day per user)
    const GLOBAL_DAILY_CAP = 100;

    let sent = 0, skipped = 0, failed = 0;
    const touchedCampaigns = new Set<string>();

    for (const seq of due) {
      // Lead status check — skip if replied/won/lost
      const { data: lead } = await supabase
        .from("leads").select("id, business_name, contact_email, contact_name, website, notes, status, campaign_id")
        .eq("id", seq.lead_id).maybeSingle();
      if (!lead) {
        await supabase.from("pitch_sequences").update({ status: "cancelled", reason: "lead deleted" }).eq("id", seq.id);
        continue;
      }
      if (["replied", "won", "lost"].includes(lead.status)) {
        await supabase.from("pitch_sequences").update({ status: "skipped", reason: `lead.status=${lead.status}` }).eq("id", seq.id);
        skipped++;
        continue;
      }
      if (!lead.contact_email) {
        await supabase.from("pitch_sequences").update({ status: "skipped", reason: "no email" }).eq("id", seq.id);
        skipped++;
        continue;
      }
      if (lead.campaign_id) touchedCampaigns.add(lead.campaign_id);

      // Per-user daily cap (Resend 120/day)
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const { count: sentToday } = await supabase
        .from("pitches").select("id", { count: "exact", head: true })
        .eq("user_id", seq.user_id).gte("sent_at", startOfDay.toISOString());
      if ((sentToday ?? 0) >= GLOBAL_DAILY_CAP) {
        // Leave as scheduled — try again tomorrow
        break;
      }

      // Duplicate-recipient guard across campaigns (14-day window) — but
      // allow follow-ups to the same lead (same lead_id is fine).
      const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
      const { data: recent } = await supabase
        .from("pitches")
        .select("id, lead_id, leads!inner(contact_email)")
        .eq("user_id", seq.user_id)
        .eq("leads.contact_email", lead.contact_email)
        .neq("lead_id", lead.id)
        .gte("sent_at", cutoff)
        .limit(1);
      if (recent && recent.length > 0) {
        await supabase.from("pitch_sequences")
          .update({ status: "skipped", reason: "duplicate recipient in another campaign (14d)" })
          .eq("id", seq.id);
        skipped++;
        continue;
      }

      // Per-lead cooldown: never send to the same lead twice within 24h.
      const cooldownStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: recentToLead } = await supabase
        .from("pitches").select("id", { count: "exact", head: true })
        .eq("lead_id", lead.id)
        .gte("sent_at", cooldownStart);
      if ((recentToLead ?? 0) > 0) {
        await supabase.from("pitch_sequences")
          .update({ status: "skipped", reason: "lead cooldown (<24h since last send)" })
          .eq("id", seq.id);
        skipped++;
        continue;
      }

      // Hard cap: at most 3 follow-ups sent per lead per campaign, total.
      if (lead.campaign_id) {
        const { count: sentFollowups } = await supabase
          .from("pitch_sequences").select("id", { count: "exact", head: true })
          .eq("lead_id", lead.id)
          .eq("campaign_id", lead.campaign_id)
          .eq("status", "sent");
        if ((sentFollowups ?? 0) >= 3) {
          await supabase.from("pitch_sequences")
            .update({ status: "cancelled", reason: "max follow-ups (3) reached" })
            .eq("lead_id", lead.id).eq("campaign_id", lead.campaign_id).eq("status", "scheduled");
          skipped++;
          continue;
        }
      }


      // Load offering + parent pitch for context
      let offering: any = null;
      if (lead.campaign_id) {
        const { data: camp } = await supabase.from("campaigns").select("offering_id").eq("id", lead.campaign_id).maybeSingle();
        if (camp?.offering_id) {
          const { data: off } = await supabase.from("offerings").select("*").eq("id", camp.offering_id).maybeSingle();
          offering = off;
        }
      }
      const { data: parent } = await supabase
        .from("pitches").select("subject, body").eq("id", seq.parent_pitch_id).maybeSingle();

      const angle = ANGLES[seq.step] ?? ANGLES[3];
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: `You are writing follow-up #${seq.step} to a cold email pitch. Rules: ${angle} Plain text. No "just following up" cliché. Reference original subject naturally.` },
            { role: "user", content: `OFFERING: ${offering ? `${offering.title} — ${offering.tagline ?? ""}` : "(none)"}\n\nLEAD: ${lead.business_name} (${lead.contact_name ?? "no name"})\nNotes: ${lead.notes ?? ""}\n\nORIGINAL SUBJECT: ${parent?.subject ?? "(unknown)"}\nORIGINAL BODY:\n${parent?.body ?? "(unknown)"}\n\nWrite the follow-up.` },
          ],
          tools: [{ type: "function", function: { name: "return_pitch", parameters: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"], additionalProperties: false } } }],
          tool_choice: { type: "function", function: { name: "return_pitch" } },
        }),
      });
      if (!aiRes.ok) { failed++; continue; }
      const aj = await aiRes.json();
      const argsStr = aj?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!argsStr) { failed++; continue; }
      const { subject, body } = JSON.parse(argsStr);

      // Save draft as a pitch row with a deterministic Message-ID
      const { data: newPitch } = await supabase.from("pitches").insert({
        user_id: seq.user_id, lead_id: seq.lead_id, subject, body,
      }).select("id").single();
      const messageIdHeader = newPitch ? `<pitch-${newPitch.id}@techfaculty.ng>` : undefined;

      // Send
      const sendRes = await fetch(`${RESEND_GATEWAY}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": RESEND_API_KEY,
        },
        body: JSON.stringify({
          from: FROM, to: [lead.contact_email],
          subject: `Re: ${subject}`, html: bodyToHtml(body), text: body,
          ...(messageIdHeader ? { headers: { "Message-ID": messageIdHeader } } : {}),
        }),
      });
      if (!sendRes.ok) {
        await supabase.from("pitch_sequences").update({ status: "drafted", pitch_id: newPitch?.id, reason: `send failed ${sendRes.status}` }).eq("id", seq.id);
        failed++;
        continue;
      }
      const now = new Date().toISOString();
      const sendBody = await sendRes.json().catch(() => ({}));
      await supabase.from("pitches").update({
        sent_at: now,
        provider_message_id: (sendBody as any)?.id ?? null,
        message_id_header: messageIdHeader ?? null,
      } as never).eq("id", newPitch!.id);
      await supabase.from("pitch_sequences").update({ status: "sent", pitch_id: newPitch?.id, sent_at: now }).eq("id", seq.id);
      await supabase.from("leads").update({ last_activity_at: now }).eq("id", lead.id);
      sent++;
    }

    // Auto-archive campaigns whose full follow-up cycle has run out.
    let archived = 0;
    for (const campaignId of touchedCampaigns) {
      const { count: pending } = await supabase
        .from("pitch_sequences").select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId).eq("status", "scheduled");
      if ((pending ?? 0) === 0) {
        const { data: c } = await supabase.from("campaigns").select("status").eq("id", campaignId).maybeSingle();
        if (c && c.status !== "archived") {
          await supabase.from("campaigns").update({ status: "archived" } as never).eq("id", campaignId);
          archived++;
        }
      }
    }

    return json(200, { ok: true, processed: due.length, sent, skipped, failed, archived });
  } catch (e) {
    console.error("follow-up-tick", e);
    return json(500, { error: e instanceof Error ? e.message : "error" });
  }
});
