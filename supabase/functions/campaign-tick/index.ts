// Background orchestrator — advances every active campaign_run by ONE small step,
// then exits. Designed to be invoked by pg_cron every minute (and manually from UI).
//
// State machine:
//   queued      -> discovering   (mark started)
//   discovering -> enriching     (after discovery batch)
//   enriching   -> drafting      (when nothing left to enrich)
//   drafting    -> sending       (when nothing left to draft)
//   sending     -> done          (when nothing left to send OR daily cap hit)
//   paused/done/failed -> ignored
//
// Uses SERVICE ROLE so it can run without a per-user JWT (cron has none).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";
const RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend";
// Verified domain: techfaculty.ng (Resend)
const FROM = "Tech Faculty NG <outreach@techfaculty.ng>";
const REPLY_TO = "outreach@techfaculty.ng"; // TODO: swap to Gmail when provided

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const HOST_BLOCKLIST = [
  "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com",
  "youtube.com", "tiktok.com", "pinterest.com", "reddit.com", "quora.com",
  "wikipedia.org", "yelp.com", "tripadvisor.com", "yellowpages.com",
  "maps.google.com", "google.com", "bing.com", "duckduckgo.com",
  "amazon.com", "ebay.com", "etsy.com", "medium.com", "substack.com",
];

function rootDomain(urlStr: string): string | null {
  try { return new URL(urlStr).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}
const isBlockedHost = (h: string) => HOST_BLOCKLIST.some((b) => h === b || h.endsWith(`.${b}`));

function deriveBusinessName(title: string, host: string): string {
  const clean = title.split(/[|·•\-–—:]/)[0].trim();
  if (clean.length > 2 && clean.length < 80) return clean;
  return host.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractEmails(text: string): string[] {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const found = (text.match(re) ?? []).map((e) => e.toLowerCase());
  const blocked = ["example.com", "domain.com", "yourdomain.com", "email.com", "test.com", "sentry.io", "wixpress.com"];
  const unique = Array.from(new Set(found)).filter(
    (e) => !blocked.some((b) => e.endsWith(`@${b}`)) && !e.endsWith(".png") && !e.endsWith(".jpg"),
  );
  const priority = ["contact@", "hello@", "info@", "sales@", "support@", "team@"];
  unique.sort((a, b) => {
    const ap = priority.findIndex((p) => a.startsWith(p));
    const bp = priority.findIndex((p) => b.startsWith(p));
    return (ap === -1 ? 999 : ap) - (bp === -1 ? 999 : bp);
  });
  return unique;
}

function bodyToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.5">${p.replace(/\n/g, "<br/>")}</p>`).join("");
}

type Run = {
  id: string;
  user_id: string;
  campaign_id: string;
  state: string;
  daily_send_cap: number;
  target_lead_count: number;
  leads_found: number;
  leads_enriched: number;
  leads_drafted: number;
  leads_sent: number;
  leads_failed: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Optional: tick a specific run id (UI manual trigger), else tick the oldest active run.
    let body: { runId?: string } = {};
    try { body = await req.json(); } catch { /* cron sends nothing */ }

    let q = supabase
      .from("campaign_runs")
      .select("*")
      .in("state", ["queued", "discovering", "enriching", "drafting", "sending"])
      .order("last_step_at", { ascending: true, nullsFirst: true })
      .limit(1);

    if (body.runId) q = supabase.from("campaign_runs").select("*").eq("id", body.runId).limit(1);

    const { data: runs, error: rerr } = await q;
    if (rerr) return json(500, { error: rerr.message });
    if (!runs || runs.length === 0) return json(200, { ok: true, advanced: 0, message: "No active runs" });

    const run = runs[0] as Run;

    // Helpers
    const logEvent = async (kind: string, message: string, level = "info", lead_id?: string) => {
      await supabase.from("run_events").insert({
        user_id: run.user_id,
        run_id: run.id,
        campaign_id: run.campaign_id,
        lead_id: lead_id ?? null,
        kind,
        message,
        level,
      });
    };
    const updateRun = async (patch: Partial<Run> & { error?: string | null }) => {
      await supabase.from("campaign_runs").update({ ...patch, last_step_at: new Date().toISOString() }).eq("id", run.id);
    };
    const fail = async (msg: string) => {
      await logEvent("error", msg, "error");
      await updateRun({ state: "failed" as never, error: msg });
      return json(200, { ok: false, runId: run.id, error: msg });
    };

    // Load campaign
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, name, city, category, keywords, discovery_source")
      .eq("id", run.campaign_id)
      .maybeSingle();
    if (!campaign) return await fail("Campaign deleted");
    const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";

    // STATE: queued -> discovering (just transition + log)
    if (run.state === "queued") {
      await logEvent("started", `Outreach started for "${campaign.name}"`);
      await updateRun({ state: "discovering" as never, error: null });
      return json(200, { ok: true, runId: run.id, transition: "queued->discovering" });
    }

    // STATE: discovering — find leads via Firecrawl
    if (run.state === "discovering") {
      // Count existing leads in campaign
      const { count: existingCount } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id);
      const have = existingCount ?? 0;
      if (have >= run.target_lead_count) {
        await logEvent("info", `Have ${have} leads (target ${run.target_lead_count}). Moving to enrichment.`);
        await updateRun({ state: "enriching" as never, leads_found: have });
        return json(200, { ok: true, transition: "discovering->enriching" });
      }

      const source = (campaign as any).discovery_source ?? "firecrawl";

      // === Google Places branch ===
      if (source === "google_places") {
        if (!GOOGLE_PLACES_API_KEY) return await fail("Google Places API key not configured.");
        const wanted = Math.min(20, run.target_lead_count - have);
        const textParts: string[] = [];
        if (campaign.category) textParts.push(campaign.category);
        if (campaign.keywords) textParts.push(campaign.keywords);
        if (campaign.city) textParts.push(`in ${campaign.city}`);
        if (textParts.length === 0) textParts.push(campaign.name);
        const textQuery = textParts.join(" ");

        const pres = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask": "places.displayName,places.websiteUri,places.formattedAddress,places.internationalPhoneNumber,places.id",
          },
          body: JSON.stringify({ textQuery, pageSize: Math.min(20, Math.max(wanted, 5)) }),
        });
        const pjson = await pres.json();
        if (!pres.ok) {
          await logEvent("error", `Google Places: ${pjson?.error?.message ?? pres.statusText}`, "error");
          await updateRun({ state: "enriching" as never });
          return json(200, { ok: true, message: "Places search failed, moving on" });
        }
        const places: Array<any> = pjson.places ?? [];

        const { data: existingP } = await supabase
          .from("leads").select("website, business_name").eq("campaign_id", campaign.id);
        const existingHostsP = new Set((existingP ?? []).map((l) => l.website ? rootDomain(l.website) : null).filter(Boolean) as string[]);
        const existingNamesP = new Set((existingP ?? []).map((l) => (l.business_name ?? "").toLowerCase()));

        let insertedP = 0;
        for (const p of places) {
          if (insertedP >= wanted) break;
          const name = p?.displayName?.text ?? null;
          if (!name) continue;
          const website = p?.websiteUri ?? null;
          const host = website ? rootDomain(website) : null;
          if (host && existingHostsP.has(host)) continue;
          if (existingNamesP.has(name.toLowerCase())) continue;
          if (host) existingHostsP.add(host);
          existingNamesP.add(name.toLowerCase());

          const { error: insErr } = await supabase.from("leads").insert({
            user_id: run.user_id,
            campaign_id: campaign.id,
            business_name: name,
            website: website,
            address: p?.formattedAddress ?? null,
            phone: p?.internationalPhoneNumber ?? null,
            status: "new",
          });
          if (!insErr) insertedP++;
        }
        const newTotalP = have + insertedP;
        await logEvent("discovered", `Google Places: found ${insertedP} new lead${insertedP === 1 ? "" : "s"} (${newTotalP}/${run.target_lead_count}).`);
        const nextStateP = newTotalP >= run.target_lead_count || insertedP === 0 ? "enriching" : "discovering";
        await updateRun({ state: nextStateP as never, leads_found: newTotalP });
        return json(200, { ok: true, runId: run.id, source: "google_places", inserted: insertedP, total: newTotalP, nextState: nextStateP });
      }

      // === Firecrawl branch (default) ===
      if (!FIRECRAWL_API_KEY) {
        return await fail("Firecrawl not connected — cannot discover leads.");
      }

      const parts: string[] = [];
      if (campaign.category) parts.push(campaign.category);
      if (campaign.keywords) parts.push(campaign.keywords);
      if (campaign.city) parts.push(`in ${campaign.city}`);
      if (parts.length === 0) parts.push(campaign.name);
      const query = parts.join(" ");

      const wanted = Math.min(10, run.target_lead_count - have);
      const sres = await fetch(`${FIRECRAWL_V2}/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: Math.max(wanted * 2, 10) }),
      });
      const sjson = await sres.json();
      if (!sres.ok) {
        await logEvent("error", `Firecrawl: ${sjson?.error ?? sres.statusText}`, "error");
        await updateRun({ state: "enriching" as never });
        return json(200, { ok: true, message: "Search failed, moving on" });
      }
      const items: Array<{ url: string; title?: string; description?: string }> =
        Array.isArray(sjson.data) ? sjson.data : (sjson.data?.web ?? []);

      const { data: existing } = await supabase
        .from("leads").select("website").eq("campaign_id", campaign.id);
      const existingHosts = new Set((existing ?? []).map((l) => l.website ? rootDomain(l.website) : null).filter(Boolean) as string[]);

      let inserted = 0;
      const seen = new Set<string>();
      for (const item of items) {
        if (inserted >= wanted) break;
        if (!item.url) continue;
        const host = rootDomain(item.url);
        if (!host || isBlockedHost(host) || existingHosts.has(host) || seen.has(host)) continue;
        seen.add(host);

        const { error: insErr } = await supabase.from("leads").insert({
          user_id: run.user_id,
          campaign_id: campaign.id,
          business_name: deriveBusinessName(item.title ?? host, host),
          website: `https://${host}`,
          notes: item.description ? `Discovery: ${item.description}` : null,
          status: "new",
        });
        if (!insErr) inserted++;
      }

      const newTotal = have + inserted;
      await logEvent("discovered", `Found ${inserted} new lead${inserted === 1 ? "" : "s"} (${newTotal}/${run.target_lead_count}).`);
      const nextState = newTotal >= run.target_lead_count || inserted === 0 ? "enriching" : "discovering";
      await updateRun({ state: nextState as never, leads_found: newTotal });
      return json(200, { ok: true, runId: run.id, inserted, total: newTotal, nextState });
    }

    // STATE: enriching — pick ONE 'new' lead with a website, scrape it
    if (run.state === "enriching") {
      const { data: lead } = await supabase
        .from("leads")
        .select("id, business_name, website, contact_email, notes, status")
        .eq("campaign_id", campaign.id)
        .eq("status", "new")
        .not("website", "is", null)
        .limit(1)
        .maybeSingle();

      if (!lead) {
        // Skip leads without website — mark as enriched so we move on
        const { data: noWebLeads } = await supabase
          .from("leads").select("id").eq("campaign_id", campaign.id).eq("status", "new").is("website", null);
        if (noWebLeads && noWebLeads.length > 0) {
          await supabase.from("leads").update({ status: "enriched" }).in("id", noWebLeads.map((l) => l.id));
        }
        await logEvent("info", "Enrichment complete. Drafting pitches next.");
        await updateRun({ state: "drafting" as never });
        return json(200, { ok: true, transition: "enriching->drafting" });
      }

      if (!FIRECRAWL_API_KEY) {
        await supabase.from("leads").update({ status: "enriched" }).eq("id", lead.id);
        await logEvent("warn", `Skipped enrichment for ${lead.business_name} (Firecrawl not connected)`, "warn", lead.id);
        return json(200, { ok: true, skipped: true });
      }

      let url = (lead.website as string).trim();
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

      try {
        const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url, formats: ["markdown", "summary", "links"], onlyMainContent: false }),
        });
        const sjson = await res.json();
        const payload = sjson?.data ?? sjson;
        const markdown: string = payload?.markdown ?? "";
        const summary: string = payload?.summary ?? "";
        const links: string[] = payload?.links ?? [];

        const mailtoEmails = links
          .filter((l) => typeof l === "string" && l.toLowerCase().startsWith("mailto:"))
          .map((l) => l.replace(/^mailto:/i, "").split("?")[0].toLowerCase());
        const emails = Array.from(new Set([...mailtoEmails, ...extractEmails(markdown)]));
        const bestEmail = emails[0] ?? null;

        const updates: Record<string, unknown> = { status: "enriched" };
        if (!lead.contact_email && bestEmail) updates.contact_email = bestEmail;
        if (summary) {
          const block = `--- Enriched ${new Date().toISOString().slice(0, 10)} ---\n${summary}`;
          const existing = ((lead.notes as string) ?? "").trim();
          if (!existing.includes(summary.slice(0, 60))) {
            updates.notes = existing ? `${existing}\n\n${block}` : block;
          }
        }
        await supabase.from("leads").update(updates).eq("id", lead.id);
        await logEvent("enriched",
          bestEmail ? `Enriched ${lead.business_name} → ${bestEmail}` : `Enriched ${lead.business_name} (no email found)`,
          "info", lead.id);
        await updateRun({ leads_enriched: run.leads_enriched + 1 });
      } catch (e) {
        await supabase.from("leads").update({ status: "enriched" }).eq("id", lead.id);
        await logEvent("warn", `Enrichment failed for ${lead.business_name}: ${e instanceof Error ? e.message : "error"}`, "warn", lead.id);
        await updateRun({ leads_failed: run.leads_failed + 1 });
      }
      return json(200, { ok: true, runId: run.id });
    }

    // STATE: drafting — pick one 'enriched' lead with email, draft via AI gateway
    if (run.state === "drafting") {
      const { data: lead } = await supabase
        .from("leads")
        .select("id, business_name, website, contact_email, contact_name, notes, status, campaign_id")
        .eq("campaign_id", campaign.id)
        .eq("status", "enriched")
        .not("contact_email", "is", null)
        .limit(1)
        .maybeSingle();

      if (!lead) {
        await logEvent("info", "Drafting complete. Sending next.");
        await updateRun({ state: "sending" as never });
        return json(200, { ok: true, transition: "drafting->sending" });
      }

      // Load offering (via campaign)
      const { data: campRow } = await supabase
        .from("campaigns").select("offering_id").eq("id", campaign.id).maybeSingle();
      let offering: any = null;
      if (campRow?.offering_id) {
        const { data: off } = await supabase.from("offerings").select("*").eq("id", campRow.offering_id).maybeSingle();
        offering = off;
      }

      const offeringBlock = offering ? `OFFERING
Title: ${offering.title}
Tagline: ${offering.tagline ?? ""}
Problem solved: ${offering.problem_solved ?? ""}
Target audience: ${offering.target_audience ?? ""}
Ideal customer: ${offering.ideal_customer ?? ""}
Pricing: ${offering.pricing ?? ""}
Demo URL: ${offering.demo_url ?? ""}
Testimonial: ${offering.testimonial ?? ""}` : "OFFERING: (none — write a warm generic intro)";

      const leadBlock = `LEAD
Business: ${lead.business_name}
Contact name: ${lead.contact_name ?? "(unknown)"}
Website: ${lead.website ?? ""}
Notes: ${lead.notes ?? ""}`;

      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: `You are an expert B2B cold-email copywriter. Write a short, personalized cold email pitch that feels human, not templated. Avoid corporate jargon, no "I hope this email finds you well". Lead with relevance. Keep body under 130 words. End with one clear, low-friction CTA. Do NOT invent facts.` },
            { role: "user", content: `Tone: warm, concise, professional, no fluff\n\n${offeringBlock}\n\n${leadBlock}\n\nWrite the cold email pitch now.` },
          ],
          tools: [{
            type: "function",
            function: {
              name: "return_pitch",
              description: "Return the drafted cold email pitch.",
              parameters: {
                type: "object",
                properties: {
                  subject: { type: "string", description: "Subject line under 60 chars." },
                  body: { type: "string", description: "Plain text body." },
                },
                required: ["subject", "body"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "return_pitch" } },
        }),
      });

      if (!aiRes.ok) {
        if (aiRes.status === 429 || aiRes.status === 402) {
          await logEvent("warn", `AI ${aiRes.status} — pausing run`, "warn", lead.id);
          await updateRun({ state: "paused" as never, error: aiRes.status === 402 ? "AI credits exhausted" : "AI rate limit" });
          return json(200, { ok: false, paused: true });
        }
        await logEvent("warn", `Draft failed for ${lead.business_name} (HTTP ${aiRes.status})`, "warn", lead.id);
        await supabase.from("leads").update({ status: "drafted" }).eq("id", lead.id); // skip to unblock
        await updateRun({ leads_failed: run.leads_failed + 1 });
        return json(200, { ok: true });
      }

      const aiJson = await aiRes.json();
      const argsStr = aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!argsStr) {
        await logEvent("warn", `AI returned no pitch for ${lead.business_name}`, "warn", lead.id);
        await supabase.from("leads").update({ status: "drafted" }).eq("id", lead.id);
        await updateRun({ leads_failed: run.leads_failed + 1 });
        return json(200, { ok: true });
      }
      const parsed = JSON.parse(argsStr) as { subject: string; body: string };

      await supabase.from("pitches").insert({
        user_id: run.user_id, lead_id: lead.id, subject: parsed.subject, body: parsed.body,
      });
      await supabase.from("leads").update({ status: "drafted" }).eq("id", lead.id);
      await logEvent("drafted", `Drafted pitch for ${lead.business_name}`, "info", lead.id);
      await updateRun({ leads_drafted: run.leads_drafted + 1 });
      return json(200, { ok: true });
    }

    // STATE: sending — pick one 'drafted' lead with an unsent pitch, send via Resend
    if (run.state === "sending") {
      // Daily cap check (per user)
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const { count: sentToday } = await supabase
        .from("pitches").select("id", { count: "exact", head: true })
        .eq("user_id", run.user_id).gte("sent_at", startOfDay.toISOString());

      if ((sentToday ?? 0) >= run.daily_send_cap) {
        await logEvent("info", `Daily send cap reached (${sentToday}/${run.daily_send_cap}). Pausing for today.`);
        await updateRun({ state: "paused" as never, error: "Daily cap reached" });
        return json(200, { ok: true, paused: true });
      }

      // Find oldest drafted lead with a pitch + email
      const { data: lead } = await supabase
        .from("leads")
        .select("id, business_name, contact_email, status")
        .eq("campaign_id", campaign.id)
        .eq("status", "drafted")
        .not("contact_email", "is", null)
        .limit(1)
        .maybeSingle();

      if (!lead) {
        // Done!
        await logEvent("done", `Outreach complete for "${campaign.name}". Sent ${run.leads_sent}.`);
        await updateRun({ state: "done" as never });
        return json(200, { ok: true, transition: "sending->done" });
      }

      const { data: pitch } = await supabase
        .from("pitches")
        .select("id, subject, body, sent_at")
        .eq("lead_id", lead.id)
        .is("sent_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!pitch) {
        // No unsent pitch — push lead back to enriched so it gets a draft
        await supabase.from("leads").update({ status: "enriched" }).eq("id", lead.id);
        return json(200, { ok: true, requeued: true });
      }

      if (!RESEND_API_KEY) {
        await logEvent("error", "Resend not connected — cannot send", "error", lead.id);
        await updateRun({ state: "paused" as never, error: "Resend not connected" });
        return json(200, { ok: false });
      }

      const sendRes = await fetch(`${RESEND_GATEWAY}/emails`, {
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
          html: bodyToHtml(pitch.body ?? ""),
          text: pitch.body,
        }),
      });
      const sendJson = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok) {
        await logEvent("error", `Send failed for ${lead.business_name}: ${sendJson?.message || sendRes.status}`, "error", lead.id);
        await updateRun({ leads_failed: run.leads_failed + 1 });
        // Move lead to next state-ish so we don't loop on it
        await supabase.from("leads").update({ status: "drafted" }).eq("id", lead.id);
        return json(200, { ok: false });
      }

      const sentAt = new Date().toISOString();
      await supabase.from("pitches").update({ sent_at: sentAt }).eq("id", pitch.id);
      await supabase.from("leads").update({ status: "sent" }).eq("id", lead.id);
      await logEvent("sent", `Sent pitch to ${lead.business_name} (${lead.contact_email})`, "info", lead.id);
      await updateRun({ leads_sent: run.leads_sent + 1 });
      return json(200, { ok: true });
    }

    return json(200, { ok: true, message: `No-op for state ${run.state}` });
  } catch (e) {
    console.error("campaign-tick error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
