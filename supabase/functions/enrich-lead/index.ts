// Firecrawl-powered lead enrichment: scrapes the lead's website,
// extracts contact email + phone + socials + a 1-2 sentence summary,
// optionally infers the contact person via a cheap AI call,
// and updates the lead record. Returns what was found.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildEnrichmentUpdates } from "../_shared/enrichment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

interface Body {
  leadId: string;
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) return json(500, { error: "FIRECRAWL_API_KEY not configured" });
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: uerr } = await supabase.auth.getUser();
    if (uerr || !user) return json(401, { error: "Unauthorized" });

    const { leadId } = (await req.json()) as Body;
    if (!leadId) return json(400, { error: "leadId required" });

    const { data: lead, error: lerr } = await supabase
      .from("leads")
      .select("id, business_name, website, contact_email, phone, contact_name, notes, status")
      .eq("id", leadId)
      .maybeSingle();
    if (lerr) return json(500, { error: lerr.message });
    if (!lead) return json(404, { error: "Lead not found" });
    if (!lead.website) return json(400, { error: "Lead has no website to enrich" });

    let url = lead.website.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    // Scrape: markdown for parsing emails/phones + AI summary + links for socials
    const scrapeRes = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "summary", "links"],
        onlyMainContent: false,
      }),
    });

    const scrapeJson = await scrapeRes.json();
    if (!scrapeRes.ok) {
      return json(scrapeRes.status, {
        error: `Firecrawl error: ${scrapeJson?.error ?? scrapeRes.statusText}`,
      });
    }

    const payload = scrapeJson.data ?? scrapeJson;
    const updates = await buildEnrichmentUpdates(LOVABLE_API_KEY, lead as any, {
      markdown: payload.markdown ?? "",
      summary: payload.summary ?? "",
      links: payload.links ?? [],
    });

    // Bump status from "new" to "enriched" if appropriate
    const finalUpdates: Record<string, unknown> = { ...updates };
    if (lead.status === "new") finalUpdates.status = "enriched";

    if (Object.keys(finalUpdates).length > 0) {
      const { error: upErr } = await supabase.from("leads").update(finalUpdates).eq("id", leadId);
      if (upErr) return json(500, { error: upErr.message });
    }

    return json(200, {
      leadId,
      email: updates.contact_email ?? lead.contact_email ?? null,
      phone: updates.phone ?? lead.phone ?? null,
      contact_name: updates.contact_name ?? lead.contact_name ?? null,
      summary: updates.enrichment_summary ?? null,
      socials: {
        linkedin: updates.linkedin_url ?? null,
        instagram: updates.instagram_url ?? null,
        facebook: updates.facebook_url ?? null,
        x: updates.x_url ?? null,
      },
      updated: Object.keys(finalUpdates),
    });
  } catch (e) {
    console.error("enrich-lead error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
