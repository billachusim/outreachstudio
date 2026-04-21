// Discovers leads for a campaign using Firecrawl search.
// Inserts up to `limit` new leads (deduped by website) into the leads table.
// Region-anchored: biases search toward the user's outreach_region/country.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildRegionalQuery,
  fetchUserRegion,
  firecrawlLocationParam,
} from "../_shared/enrichment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

interface Body {
  campaignId: string;
  limit?: number;
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Aggressive list of platform/aggregator hosts to skip — we want real businesses.
const HOST_BLOCKLIST = [
  "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com",
  "youtube.com", "tiktok.com", "pinterest.com", "reddit.com", "quora.com",
  "wikipedia.org", "yelp.com", "tripadvisor.com", "yellowpages.com",
  "maps.google.com", "google.com", "bing.com", "duckduckgo.com",
  "amazon.com", "ebay.com", "etsy.com", "medium.com", "substack.com",
];

function rootDomain(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedHost(host: string): boolean {
  return HOST_BLOCKLIST.some((b) => host === b || host.endsWith(`.${b}`));
}

function deriveBusinessName(title: string, host: string): string {
  // Strip common separators after the brand
  const clean = title
    .split(/[|·•\-–—:]/)[0]
    .trim();
  if (clean.length > 2 && clean.length < 80) return clean;
  // Fall back to host
  return host.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) return json(500, { error: "FIRECRAWL_API_KEY not configured" });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: uerr } = await supabase.auth.getUser();
    if (uerr || !user) return json(401, { error: "Unauthorized" });

    const { campaignId, limit = 10 } = (await req.json()) as Body;
    if (!campaignId) return json(400, { error: "campaignId required" });

    const { data: campaign, error: cerr } = await supabase
      .from("campaigns")
      .select("id, name, city, category, keywords")
      .eq("id", campaignId)
      .maybeSingle();
    if (cerr) return json(500, { error: cerr.message });
    if (!campaign) return json(404, { error: "Campaign not found" });

    // Build search query from campaign metadata, biased to user's region.
    const region = await fetchUserRegion(supabase, user.id);
    const parts: string[] = [];
    if (campaign.category) parts.push(campaign.category);
    if (campaign.keywords) parts.push(campaign.keywords);
    if (campaign.city) parts.push(`in ${campaign.city}`);
    else parts.push(`in ${region.region}`);
    if (parts.length === 0) parts.push(campaign.name);
    const baseQuery = parts.join(" ");
    const query = buildRegionalQuery(baseQuery, region);

    const searchRes = await fetch(`${FIRECRAWL_V2}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit: Math.min(Math.max(limit, 1), 20),
        location: firecrawlLocationParam(region),
      }),
    });
    const searchJson = await searchRes.json();
    if (!searchRes.ok) {
      return json(searchRes.status, {
        error: `Firecrawl search error: ${searchJson?.error ?? searchRes.statusText}`,
      });
    }

    // v2 response shape: { data: { web: [{url,title,description}] } } or { data: [...] }
    const raw = searchJson.data;
    const items: Array<{ url: string; title?: string; description?: string }> = Array.isArray(raw)
      ? raw
      : (raw?.web ?? []);

    // Dedupe by domain against existing leads in this campaign
    const { data: existing } = await supabase
      .from("leads")
      .select("website")
      .eq("campaign_id", campaignId);
    const existingHosts = new Set(
      (existing ?? [])
        .map((l) => l.website ? rootDomain(l.website) : null)
        .filter(Boolean) as string[],
    );

    const inserted: Array<{ business_name: string; website: string }> = [];
    const skipped: string[] = [];
    const seenInBatch = new Set<string>();

    for (const item of items) {
      if (!item.url) continue;
      const host = rootDomain(item.url);
      if (!host) { skipped.push(item.url); continue; }
      if (isBlockedHost(host)) { skipped.push(host); continue; }
      if (existingHosts.has(host) || seenInBatch.has(host)) { skipped.push(host); continue; }
      seenInBatch.add(host);

      const business_name = deriveBusinessName(item.title ?? host, host);
      const website = `https://${host}`;
      const notes = item.description ? `Discovery snippet: ${item.description}` : null;

      const { error: insErr } = await supabase.from("leads").insert({
        user_id: user.id,
        campaign_id: campaignId,
        business_name,
        website,
        notes,
        status: "new",
      });
      if (insErr) {
        console.error("Insert lead failed", insErr.message);
        continue;
      }
      inserted.push({ business_name, website });
    }

    return json(200, {
      query,
      found: items.length,
      inserted: inserted.length,
      insertedLeads: inserted,
      skipped: skipped.length,
    });
  } catch (e) {
    console.error("discover-leads error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
