// Scrapes the intel article via Firecrawl, extracts company + website + contact,
// inserts a lead under the matched offering's first active campaign,
// optionally enriches it, and links the lead back to the intel item.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Body { intelItemId: string; }

function rootDomain(url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!FIRECRAWL_API_KEY) return json(500, { error: "FIRECRAWL_API_KEY missing" });
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY missing" });

    const authHeader = req.headers.get("Authorization") ?? "";
    const isService = authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___");

    const { intelItemId, userIdOverride } = (await req.json()) as Body & { userIdOverride?: string };
    if (!intelItemId) return json(400, { error: "intelItemId required" });

    let userId: string | null = null;
    let supabase: any;
    if (isService && userIdOverride) {
      userId = userIdOverride;
      supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    } else {
      supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return json(401, { error: "Unauthorized" });
      userId = user.id;
    }

    const { data: intel } = await supabase
      .from("intel_items").select("*").eq("id", intelItemId).eq("user_id", userId).maybeSingle();
    if (!intel) return json(404, { error: "Intel not found" });
    if (!intel.url) return json(400, { error: "Intel has no URL to scrape" });

    // 1) Scrape article
    const scrapeRes = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: intel.url,
        formats: ["markdown", "links", {
          type: "json",
          prompt: "Extract the primary company/organization being reported on. Return: company (string), website (absolute URL if mentioned, else null), contact_name (a named person quoted or featured, else null), one_line (1-sentence what they do).",
        }],
        onlyMainContent: true,
      }),
    });
    const scrapeJson = await scrapeRes.json();
    if (!scrapeRes.ok) return json(500, { error: `Firecrawl: ${scrapeJson?.error ?? scrapeRes.statusText}` });

    const extracted = scrapeJson?.data?.json ?? scrapeJson?.json ?? {};
    const company: string | null = extracted.company ?? null;
    let website: string | null = extracted.website ?? null;
    const contactName: string | null = extracted.contact_name ?? null;
    const oneLine: string | null = extracted.one_line ?? null;

    if (!company) return json(400, { error: "Could not extract a company from this article" });

    // 2) Pick a campaign — prefer matched offering's active campaign
    let campaignId: string | null = null;
    const matchedOff: string | null = (intel.matched_offerings ?? [])[0] ?? null;
    if (matchedOff) {
      const { data: camp } = await supabase
        .from("campaigns").select("id")
        .eq("user_id", userId).eq("offering_id", matchedOff).eq("status", "active")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      campaignId = camp?.id ?? null;
    }
    if (!campaignId) {
      const { data: anyCamp } = await supabase
        .from("campaigns").select("id")
        .eq("user_id", userId).eq("status", "active")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      campaignId = anyCamp?.id ?? null;
    }

    const domain = website ? rootDomain(website) : null;

    // Dedupe: skip if a lead with same business_name or root_domain already exists
    let existingLead: any = null;
    if (domain) {
      const { data } = await supabase
        .from("leads").select("id, business_name").eq("user_id", userId).eq("root_domain", domain).limit(1).maybeSingle();
      existingLead = data;
    }
    if (!existingLead) {
      const { data } = await supabase
        .from("leads").select("id, business_name").eq("user_id", userId).ilike("business_name", company).limit(1).maybeSingle();
      existingLead = data;
    }

    let leadId: string;
    if (existingLead) {
      leadId = existingLead.id;
    } else {
      const { data: newLead, error: insErr } = await supabase
        .from("leads").insert({
          user_id: userId,
          campaign_id: campaignId,
          business_name: company,
          website: website,
          root_domain: domain,
          contact_name: contactName,
          notes: `From intel: ${intel.title}\n${intel.url}\n\n${oneLine ?? ""}`.trim(),
          status: "new",
        }).select("id").single();
      if (insErr) return json(500, { error: insErr.message });
      leadId = newLead.id;
    }

    await supabase.from("intel_items")
      .update({ linked_lead_id: leadId, acted_on: true })
      .eq("id", intelItemId);

    // Best-effort enrich (non-blocking)
    if (website && !existingLead) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/enrich-lead`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: isService
              ? `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
              : authHeader,
          },
          body: JSON.stringify({ leadId }),
        });
      } catch (e) { console.error("enrich after intel-to-lead failed", e); }
    }

    return json(200, { leadId, campaignId, company, website, contactName, reused: !!existingLead });
  } catch (e) {
    console.error("intel-to-lead error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
