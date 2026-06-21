// Polls Gmail via the Lovable connector gateway for inbound replies and
// matches them to leads. When matched:
//   - inserts an inbound channel_messages row (deduped by gmail message id)
//   - calls classify-reply to set lead.reply_intent + status
//   - cancels any scheduled pitch_sequences for that lead so no campaign
//     keeps emailing a lead that already replied
//
// Designed to be invoked by pg_cron every ~10 minutes. verify_jwt = false.
//
// Lead matching, in order:
//   1. In-Reply-To / References header → pitches.message_id_header → lead_id
//   2. lower(trim(from)) === lower(trim(leads.contact_email))
//
// Accepts ?days=N (default 2) so a one-time backfill can be run via:
//   POST /functions/v1/gmail-reply-sync?days=90

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
  for (const p of parts) {
    if (p.mimeType === "text/plain" && p.body?.data) return decodeB64Url(p.body.data);
  }
  for (const p of parts) {
    if (p.mimeType === "text/html" && p.body?.data) {
      return decodeB64Url(p.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  }
  for (const p of parts) {
    const v = extractBody(p);
    if (v) return v;
  }
  return "";
}

// Extract every <message-id@host> token from In-Reply-To + References.
function extractMessageIdRefs(headerValues: string[]): string[] {
  const out: string[] = [];
  for (const v of headerValues) {
    if (!v) continue;
    const matches = v.match(/<[^<>\s]+>/g);
    if (matches) for (const m of matches) out.push(m);
  }
  return Array.from(new Set(out));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Parse days from URL or body
    let days = 2;
    let maxResults = 50;
    try {
      const url = new URL(req.url);
      const d = parseInt(url.searchParams.get("days") ?? "");
      if (d > 0 && d <= 365) days = d;
      const m = parseInt(url.searchParams.get("maxResults") ?? "");
      if (m > 0 && m <= 500) maxResults = m;
    } catch {}
    if (req.method === "POST") {
      try {
        const b = await req.json();
        if (b?.days && b.days > 0 && b.days <= 365) days = b.days;
        if (b?.maxResults && b.maxResults > 0 && b.maxResults <= 500) maxResults = b.maxResults;
      } catch {}
    }

    // Page through results when backfilling.
    const q = encodeURIComponent(`newer_than:${days}d in:inbox -from:me -category:promotions -category:social`);
    const ids: string[] = [];
    let pageToken: string | undefined;
    const hardCap = days > 7 ? 1000 : 100;
    do {
      const url = `${GATEWAY}/users/me/messages?maxResults=${maxResults}&q=${q}${pageToken ? `&pageToken=${pageToken}` : ""}`;
      const listRes = await fetch(url, { headers: gmailHeaders() });
      if (!listRes.ok) {
        const txt = await listRes.text();
        await logRun(supabase, "error", `gmail list ${listRes.status}: ${txt.slice(0, 300)}`);
        return json(502, { error: `gmail list ${listRes.status}`, body: txt.slice(0, 500) });
      }
      const listJson = await listRes.json();
      for (const m of (listJson.messages ?? [])) ids.push(m.id);
      pageToken = listJson.nextPageToken;
      if (ids.length >= hardCap) break;
    } while (pageToken);

    let matched = 0, skipped = 0, errors = 0, matchedByHeader = 0, matchedByEmail = 0;

    for (const id of ids) {
      try {
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
        const inReplyTo = h("In-Reply-To");
        const references = h("References");
        const body = extractBody(m.payload).slice(0, 20000);
        if (!fromAddr) { skipped++; continue; }

        // Try header-based threading first
        let lead: { id: string; user_id: string; campaign_id: string | null } | null = null;
        const refs = extractMessageIdRefs([inReplyTo, references]);
        if (refs.length) {
          const { data: pitchMatch } = await supabase
            .from("pitches")
            .select("lead_id, user_id, leads:lead_id(id, user_id, campaign_id)")
            .in("message_id_header", refs)
            .limit(1).maybeSingle();
          const l = (pitchMatch as any)?.leads;
          if (l) {
            lead = { id: l.id, user_id: l.user_id, campaign_id: l.campaign_id };
            matchedByHeader++;
          }
        }

        // Fallback 1: exact from-address match against leads.contact_email
        if (!lead) {
          const cleanFrom = fromAddr.trim().toLowerCase();
          const { data: leadRow } = await supabase
            .from("leads")
            .select("id, user_id, campaign_id")
            .ilike("contact_email", cleanFrom)
            .limit(1).maybeSingle();
          if (leadRow) {
            lead = leadRow as any;
            matchedByEmail++;
          }
        }

        // Fallback 2: same-domain auto-reply
        // (e.g. noreply@covenantuniversity.edu.ng ↔ registrar@covenantuniversity.edu.ng)
        // Pick the most recently-pitched lead whose contact_email ends with the same domain.
        if (!lead) {
          const fromDomain = fromAddr.split("@")[1]?.toLowerCase() ?? "";
          if (fromDomain && fromDomain.includes(".")) {
            const { data: domainLead } = await supabase
              .from("leads")
              .select("id, user_id, campaign_id, last_activity_at")
              .ilike("contact_email", `%@${fromDomain}`)
              .order("last_activity_at", { ascending: false, nullsFirst: false })
              .limit(1).maybeSingle();
            if (domainLead) {
              lead = { id: domainLead.id, user_id: domainLead.user_id, campaign_id: domainLead.campaign_id };
              matchedByEmail++;
            }
          }
        }

        // Fallback 3: subject match against a recent pitch
        // ("Re: <original subject>" survives most auto-replies even when
        // threading headers are stripped).
        if (!lead && subject) {
          const cleanSubject = subject.replace(/^\s*(re|fwd|fw):\s*/i, "").trim();
          if (cleanSubject.length > 5) {
            const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
            const { data: subjMatch } = await supabase
              .from("pitches")
              .select("lead_id, user_id, leads:lead_id(id, user_id, campaign_id)")
              .ilike("subject", cleanSubject)
              .gte("sent_at", cutoff)
              .order("sent_at", { ascending: false })
              .limit(1).maybeSingle();
            const l = (subjMatch as any)?.leads;
            if (l) {
              lead = { id: l.id, user_id: l.user_id, campaign_id: l.campaign_id };
              matchedByEmail++;
            }
          }
        }


        if (!lead) { skipped++; continue; }

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
          payload: { source: "gmail-reply-sync", snippet: m.snippet ?? "", in_reply_to: inReplyTo, references },
        }).select("id").maybeSingle();

        await supabase.from("pitch_sequences")
          .update({ status: "cancelled", reason: "lead replied via email" })
          .eq("lead_id", lead.id).eq("status", "scheduled");

        await supabase.from("leads")
          .update({ status: "replied", last_activity_at: new Date().toISOString() })
          .eq("id", lead.id);

        await supabase.from("pitch_events").insert({
          user_id: lead.user_id, lead_id: lead.id,
          event_type: "replied", channel: "email", provider: "gmail",
          provider_message_id: id, recipient: toAddr,
          payload: { from: fromAddr, subject, matched_via: refs.length ? "header" : "email" },
        });

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

    const result = { ok: true, days, scanned: ids.length, matched, matchedByHeader, matchedByEmail, skipped, errors, durationMs: Date.now() - startedAt };
    await logRun(
      supabase,
      errors > 0 ? "warn" : "info",
      `gmail-reply-sync: scanned ${ids.length}, matched ${matched} (${matchedByHeader} hdr / ${matchedByEmail} email), skipped ${skipped}, errors ${errors} (${days}d)`,
    );
    return json(200, result);
  } catch (e) {
    console.error("gmail-reply-sync error", e);
    return json(500, { error: e instanceof Error ? e.message : "error" });
  }
});

// Log a row per tick so the Dashboard can show health.
async function logRun(supabase: any, level: "info" | "warn" | "error", message: string) {
  try {
    // We need a user_id; pick the workspace owner (first user with leads).
    const { data: anyLead } = await supabase
      .from("leads").select("user_id").not("user_id", "is", null).limit(1).maybeSingle();
    if (!anyLead?.user_id) return;
    await supabase.from("run_events").insert({
      user_id: anyLead.user_id,
      kind: "gmail-reply-sync",
      level,
      message,
    });
  } catch (e) {
    console.warn("logRun failed", e);
  }
}
