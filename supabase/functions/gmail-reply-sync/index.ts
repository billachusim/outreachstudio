// Polls Gmail via the Lovable connector gateway for inbound replies and
// matches them to leads. When matched:
//   - inserts an inbound channel_messages row (deduped by gmail message id)
//   - calls classify-reply to set lead.reply_intent + status
//   - cancels any scheduled pitch_sequences for that lead so no campaign
//     keeps emailing a lead that already replied
//
// Designed to be invoked by pg_cron every ~10 minutes. verify_jwt = false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

function gmailHeaders() {
  const lovKey = Deno.env.get("LOVABLE_API_KEY");
  const gmKey = Deno.env.get("GOOGLE_MAIL_API_KEY");
  if (!lovKey || !gmKey) throw new Error("Missing LOVABLE_API_KEY or GOOGLE_MAIL_API_KEY");
  return {
    Authorization: `Bearer ${lovKey}`,
    "X-Connection-Api-Key": gmKey,
    "Content-Type": "application/json",
  };
}

function decodeB64Url(s: string): string {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    return new TextDecoder().decode(Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0)));
  } catch { return ""; }
}

function extractEmail(from: string): string | null {
  if (!from) return null;
  const m = from.match(/<([^>]+)>/);
  const addr = (m ? m[1] : from).trim().toLowerCase();
  return /.+@.+\..+/.test(addr) ? addr : null;
}

function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeB64Url(payload.body.data);
  const parts: any[] = payload.parts ?? [];
  // Prefer text/plain
  for (const p of parts) {
    if (p.mimeType === "text/plain" && p.body?.data) return decodeB64Url(p.body.data);
  }
  for (const p of parts) {
    if (p.mimeType === "text/html" && p.body?.data) {
      return decodeB64Url(p.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  }
  // Recurse
  for (const p of parts) {
    const v = extractBody(p);
    if (v) return v;
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Query Gmail for recent inbox messages (last 2 days, excluding self)
    const q = encodeURIComponent("newer_than:2d in:inbox -from:me -category:promotions -category:social");
    const listRes = await fetch(`${GATEWAY}/users/me/messages?maxResults=50&q=${q}`, { headers: gmailHeaders() });
    if (!listRes.ok) {
      const txt = await listRes.text();
      return json(502, { error: `gmail list ${listRes.status}`, body: txt.slice(0, 500) });
    }
    const listJson = await listRes.json();
    const ids: string[] = (listJson.messages ?? []).map((m: any) => m.id);

    let matched = 0, skipped = 0, errors = 0;

    for (const id of ids) {
      try {
        // Dedupe early
        const { data: existing } = await supabase
          .from("channel_messages").select("id").eq("provider_message_id", id).maybeSingle();
        if (existing) { skipped++; continue; }

        const mRes = await fetch(`${GATEWAY}/users/me/messages/${id}?format=full`, { headers: gmailHeaders() });
        if (!mRes.ok) { errors++; continue; }
        const m = await mRes.json();
        const headers: any[] = m.payload?.headers ?? [];
        const h = (k: string) => headers.find((x) => x.name?.toLowerCase() === k.toLowerCase())?.value ?? "";
        const fromAddr = extractEmail(h("From"));
        const subject = h("Subject");
        const toAddr = h("To");
        const body = extractBody(m.payload).slice(0, 20000);
        if (!fromAddr) { skipped++; continue; }

        // Match a lead by contact_email
        const { data: lead } = await supabase
          .from("leads")
          .select("id, user_id, campaign_id")
          .ilike("contact_email", fromAddr)
          .limit(1).maybeSingle();
        if (!lead) { skipped++; continue; }

        // Insert inbound message
        const { data: inserted } = await supabase.from("channel_messages").insert({
          user_id: lead.user_id,
          lead_id: lead.id,
          campaign_id: lead.campaign_id,
          channel: "email",
          direction: "inbound",
          from_address: fromAddr,
          to_address: toAddr,
          subject,
          body,
          provider_message_id: id,
          status: "received",
          payload: { source: "gmail-reply-sync", snippet: m.snippet ?? "" },
        }).select("id").maybeSingle();

        // Cancel any remaining scheduled follow-ups for this lead
        await supabase.from("pitch_sequences")
          .update({ status: "cancelled", reason: "lead replied via email" })
          .eq("lead_id", lead.id).eq("status", "scheduled");

        // Mark replied + classify
        await supabase.from("leads")
          .update({ status: "replied", last_activity_at: new Date().toISOString() })
          .eq("id", lead.id);

        await supabase.from("pitch_events").insert({
          user_id: lead.user_id, lead_id: lead.id,
          event_type: "replied", channel: "email", provider: "gmail",
          provider_message_id: id, recipient: toAddr,
          payload: { from: fromAddr, subject },
        });

        // Best-effort intent classification
        if (inserted?.id) {
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/classify-reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ messageId: inserted.id, text: body, leadId: lead.id }),
          }).catch(() => {});
        }

        matched++;
      } catch (e) {
        console.error("gmail-reply-sync item error", e);
        errors++;
      }
    }

    return json(200, { ok: true, scanned: ids.length, matched, skipped, errors });
  } catch (e) {
    console.error("gmail-reply-sync error", e);
    return json(500, { error: e instanceof Error ? e.message : "error" });
  }
});
