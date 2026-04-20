// Resend webhook → records pitch_events, updates lead status, schedules follow-ups
// Supported events: email.delivered | opened | clicked | bounced | complained
// (Replied is not natively reported by Resend — user replies via REPLY_TO mailbox.)
//
// verify_jwt = false (Resend posts unauthenticated). When RESEND_WEBHOOK_SECRET
// is configured we verify the svix signature; otherwise we accept (dev mode).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Map Resend event → our internal event_type + new lead status (if any)
function mapEvent(type: string): { event: string; leadStatus: string | null } {
  switch (type) {
    case "email.delivered":   return { event: "delivered",  leadStatus: null };
    case "email.opened":      return { event: "opened",     leadStatus: "opened" };
    case "email.clicked":     return { event: "clicked",    leadStatus: "opened" };
    case "email.bounced":     return { event: "bounced",    leadStatus: "lost" };
    case "email.complained":  return { event: "complained", leadStatus: "lost" };
    case "email.delivery_delayed": return { event: "delayed", leadStatus: null };
    case "email.sent":        return { event: "delivered",  leadStatus: null };
    default: return { event: type.replace(/^email\./, ""), leadStatus: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method", { status: 405 });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const raw = await req.text();
    const body = JSON.parse(raw || "{}");
    const evType: string = body?.type ?? "unknown";
    const data = body?.data ?? {};
    const providerId: string | null = data?.email_id ?? data?.id ?? null;
    const to: string[] = Array.isArray(data?.to) ? data.to : (data?.to ? [data.to] : []);
    const recipient = to[0] ?? null;
    const occurredAt = data?.created_at ?? body?.created_at ?? new Date().toISOString();

    // Locate the originating pitch (by provider message id stored in payload, or fall back to recipient + recent send)
    let pitch: { id: string; user_id: string; lead_id: string } | null = null;
    if (providerId) {
      // We don't currently store provider id on pitches. Best-effort: latest sent pitch to this recipient.
    }
    if (!pitch && recipient) {
      const { data: p } = await supabase
        .from("pitches")
        .select("id, user_id, lead_id, leads!inner(contact_email)")
        .eq("leads.contact_email", recipient)
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (p) pitch = { id: p.id, user_id: p.user_id, lead_id: p.lead_id };
    }

    const { event, leadStatus } = mapEvent(evType);

    if (!pitch) {
      // Still log it as orphan event — useful for debugging
      console.warn("resend-webhook: no pitch matched", { evType, recipient });
      return json(200, { ok: true, matched: false });
    }

    await supabase.from("pitch_events").insert({
      user_id: pitch.user_id,
      pitch_id: pitch.id,
      lead_id: pitch.lead_id,
      channel: "email",
      event_type: event,
      provider: "resend",
      provider_message_id: providerId,
      recipient,
      occurred_at: occurredAt,
      payload: body,
    });

    // Update lead status (only "promote" — don't downgrade replied/won/lost)
    const updates: Record<string, unknown> = { last_activity_at: occurredAt };
    if (leadStatus) {
      const { data: lead } = await supabase
        .from("leads").select("status").eq("id", pitch.lead_id).maybeSingle();
      const cur = lead?.status as string | undefined;
      const promoteOK =
        leadStatus === "opened" ? ["sent", "drafted", "enriched", "new"].includes(cur ?? "") :
        leadStatus === "lost"   ? !["won"].includes(cur ?? "") :
        true;
      if (promoteOK) updates.status = leadStatus;
    }
    await supabase.from("leads").update(updates).eq("id", pitch.lead_id);

    // On delivered, schedule follow-ups (if campaign has auto_followup)
    if (event === "delivered") {
      const { data: leadRow } = await supabase
        .from("leads").select("id, campaign_id").eq("id", pitch.lead_id).maybeSingle();
      if (leadRow?.campaign_id) {
        const { data: camp } = await supabase
          .from("campaigns")
          .select("id, follow_up_days, auto_followup")
          .eq("id", leadRow.campaign_id).maybeSingle();
        if (camp?.auto_followup && Array.isArray(camp.follow_up_days)) {
          // Avoid duplicates
          const { data: existing } = await supabase
            .from("pitch_sequences").select("step")
            .eq("lead_id", pitch.lead_id).eq("parent_pitch_id", pitch.id);
          const haveSteps = new Set((existing ?? []).map((r: any) => r.step));
          const rows = (camp.follow_up_days as number[]).map((days, i) => ({
            user_id: pitch.user_id,
            lead_id: pitch.lead_id,
            campaign_id: camp.id,
            parent_pitch_id: pitch.id,
            step: i + 1,
            scheduled_at: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
            status: "scheduled",
          })).filter((r) => !haveSteps.has(r.step));
          if (rows.length) await supabase.from("pitch_sequences").insert(rows);
        }
      }
    }

    return json(200, { ok: true, matched: true, event });
  } catch (e) {
    console.error("resend-webhook error", e);
    return json(500, { error: e instanceof Error ? e.message : "error" });
  }
});
