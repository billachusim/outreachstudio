// Scans ad-signal sources (Meta Ads Library, Google Ads Transparency, Google Maps)
// via Apify actors. For each advertiser found, creates a lead with `ad_context`
// so draft-pitch can personalize off the actual ad.
//
// Triggered: manually from UI ("Scan ads now") or by cron.
// Input (optional): { userId?, keyword?, country?, platforms?: ('meta'|'google_ads'|'google_maps')[] }
// When userId is omitted, runs for every active user with at least one ad_signal intel_source.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { runApifyActor, rootDomain, isAdBlockedHost } from "../_shared/apify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Platform = "meta" | "google_ads" | "google_maps";

interface ScanInput {
  userId?: string;
  keyword?: string;
  country?: string;
  platforms?: Platform[];
  limit?: number;
}

interface AdvertiserHit {
  business_name: string;
  website: string;
  ad_context: {
    platform: Platform;
    ad_copy?: string | null;
    landing_page?: string | null;
    cta?: string | null;
    started_at?: string | null;
    country?: string | null;
    page_name?: string | null;
    ad_url?: string | null;
  };
}

const KIND_TO_PLATFORM: Record<string, Platform> = {
  ad_signal_meta: "meta",
  ad_signal_google: "google_ads",
  google_maps: "google_maps",
};

async function scanMetaAds(keyword: string, country: string, limit: number): Promise<AdvertiserHit[]> {
  // apify/facebook-ads-scraper — searches Meta Ads Library
  const items = await runApifyActor<any>({
    actor: "apify/facebook-ads-scraper",
    input: {
      urls: [
        {
          url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${encodeURIComponent(country || "ALL")}&q=${encodeURIComponent(keyword)}&search_type=keyword_unordered`,
        },
      ],
      count: limit,
    },
    maxItems: limit,
    timeoutSecs: 180,
  });
  const out: AdvertiserHit[] = [];
  for (const it of items) {
    const landing = it?.snapshot?.link_url ?? it?.snapshot?.linkUrl ?? it?.link_url ?? it?.landing_page ?? null;
    const host = rootDomain(landing ?? "");
    if (!host || isAdBlockedHost(host)) continue;
    const page = it?.page_name ?? it?.snapshot?.page_name ?? it?.advertiser_name ?? host;
    out.push({
      business_name: String(page).slice(0, 120),
      website: `https://${host}`,
      ad_context: {
        platform: "meta",
        ad_copy: (it?.snapshot?.body?.text ?? it?.ad_creative_body ?? it?.body ?? null)?.toString().slice(0, 800) ?? null,
        landing_page: landing,
        cta: it?.snapshot?.cta_text ?? it?.cta ?? null,
        started_at: it?.start_date ?? it?.startDate ?? null,
        country: country || null,
        page_name: page,
        ad_url: it?.url ?? null,
      },
    });
  }
  return dedupeByHost(out);
}

async function scanGoogleAds(keyword: string, country: string, limit: number): Promise<AdvertiserHit[]> {
  // apify/google-ads-transparency-scraper
  const items = await runApifyActor<any>({
    actor: "apify/google-ads-transparency-scraper",
    input: {
      searchQuery: keyword,
      region: country || "anywhere",
      maxItems: limit,
    },
    maxItems: limit,
    timeoutSecs: 180,
  });
  const out: AdvertiserHit[] = [];
  for (const it of items) {
    const landing = it?.landing_page ?? it?.destinationUrl ?? it?.adUrl ?? null;
    const host = rootDomain(landing ?? "");
    if (!host || isAdBlockedHost(host)) continue;
    const name = it?.advertiser_name ?? it?.advertiserName ?? host;
    out.push({
      business_name: String(name).slice(0, 120),
      website: `https://${host}`,
      ad_context: {
        platform: "google_ads",
        ad_copy: (it?.text ?? it?.headline ?? it?.description ?? null)?.toString().slice(0, 800) ?? null,
        landing_page: landing,
        cta: null,
        started_at: it?.first_shown ?? it?.firstShown ?? null,
        country: country || null,
        page_name: name,
        ad_url: it?.ad_url ?? it?.adUrl ?? null,
      },
    });
  }
  return dedupeByHost(out);
}

async function scanGoogleMaps(keyword: string, country: string, limit: number): Promise<AdvertiserHit[]> {
  // compass/crawler-google-places
  const items = await runApifyActor<any>({
    actor: "compass/crawler-google-places",
    input: {
      searchStringsArray: [keyword],
      maxCrawledPlacesPerSearch: limit,
      language: "en",
      countryCode: (country || "").toLowerCase(),
    },
    maxItems: limit,
    timeoutSecs: 180,
  });
  const out: AdvertiserHit[] = [];
  for (const it of items) {
    const site = it?.website ?? null;
    const host = rootDomain(site ?? "");
    if (!host || isAdBlockedHost(host)) continue;
    out.push({
      business_name: String(it?.title ?? host).slice(0, 120),
      website: `https://${host}`,
      ad_context: {
        platform: "google_maps",
        ad_copy: null,
        landing_page: site,
        cta: null,
        started_at: null,
        country: country || null,
        page_name: it?.title ?? null,
        ad_url: it?.url ?? null,
      },
    });
  }
  return dedupeByHost(out);
}

function dedupeByHost(hits: AdvertiserHit[]): AdvertiserHit[] {
  const seen = new Set<string>();
  const out: AdvertiserHit[] = [];
  for (const h of hits) {
    const host = rootDomain(h.website);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push(h);
  }
  return out;
}

async function runForUser(
  supabase: any,
  userId: string,
  overrideKeyword: string | undefined,
  overrideCountry: string | undefined,
  platforms: Platform[],
  limit: number,
) {
  // Pull user's ad-signal sources (each row supplies a keyword/region)
  const { data: srcs } = await supabase
    .from("intel_sources")
    .select("id, name, url, kind")
    .eq("user_id", userId)
    .eq("enabled", true)
    .in("kind", ["ad_signal_meta", "ad_signal_google", "google_maps"]);

  // Fall back to user offerings for keyword if none provided & no sources configured
  let keywords: { keyword: string; platform: Platform; sourceId: string | null }[] = [];
  for (const s of srcs ?? []) {
    const platform = KIND_TO_PLATFORM[s.kind];
    if (!platform || !platforms.includes(platform)) continue;
    // intel_sources reuses `url` to carry the search keyword for ad sources, or store as "keyword:foo"
    const kw = (overrideKeyword?.trim() || s.name || s.url || "").replace(/^https?:\/\//, "");
    if (kw) keywords.push({ keyword: kw, platform, sourceId: s.id });
  }

  if (keywords.length === 0 && overrideKeyword) {
    for (const p of platforms) keywords.push({ keyword: overrideKeyword, platform: p, sourceId: null });
  }

  if (keywords.length === 0) {
    // Derive from offerings.trigger_keywords
    const { data: offs } = await supabase
      .from("offerings")
      .select("trigger_keywords, target_audience")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(3);
    const derived: string[] = [];
    for (const o of offs ?? []) {
      const kws = (o.trigger_keywords ?? []).filter(Boolean);
      derived.push(...kws.slice(0, 2));
      if (o.target_audience) derived.push(String(o.target_audience).split(",")[0].trim());
    }
    for (const kw of Array.from(new Set(derived)).slice(0, 3)) {
      for (const p of platforms) keywords.push({ keyword: kw, platform: p, sourceId: null });
    }
  }

  const country = overrideCountry || (await fetchUserCountry(supabase, userId));

  // Existing lead hosts for dedup
  const { data: existingLeads } = await supabase
    .from("leads").select("website").eq("user_id", userId).not("website", "is", null);
  const existingHosts = new Set(
    (existingLeads ?? [])
      .map((l: any) => rootDomain(l.website))
      .filter(Boolean) as string[],
  );

  let inserted = 0;
  const errors: string[] = [];

  for (const { keyword, platform, sourceId } of keywords) {
    try {
      let hits: AdvertiserHit[] = [];
      if (platform === "meta") hits = await scanMetaAds(keyword, country, limit);
      else if (platform === "google_ads") hits = await scanGoogleAds(keyword, country, limit);
      else hits = await scanGoogleMaps(keyword, country, limit);

      for (const h of hits) {
        const host = rootDomain(h.website);
        if (!host || existingHosts.has(host)) continue;
        existingHosts.add(host);
        const { error } = await supabase.from("leads").insert({
          user_id: userId,
          business_name: h.business_name,
          website: h.website,
          notes: h.ad_context.ad_copy
            ? `Active ${platform} advertiser. Ad copy: "${h.ad_context.ad_copy.slice(0, 240)}"`
            : `Found via ${platform} (${keyword})`,
          status: "new",
          ad_context: h.ad_context,
        });
        if (!error) inserted++;
        else console.error("scan-ads insert lead", error.message);
      }

      if (sourceId) {
        await supabase.from("intel_sources").update({ last_scanned_at: new Date().toISOString() }).eq("id", sourceId).then(() => {}, () => {});
      }
    } catch (e) {
      errors.push(`${platform}/${keyword}: ${(e as Error).message}`);
      console.error("scan-ads error", platform, keyword, e);
    }
  }

  return { userId, inserted, errors, keywords: keywords.length };
}

async function fetchUserCountry(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("outreach_region, country").eq("user_id", userId).maybeSingle();
  return (data?.country || data?.outreach_region || "US").toString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = (await req.json().catch(() => ({}))) as ScanInput;
    const platforms: Platform[] = body.platforms?.length ? body.platforms : ["meta", "google_ads", "google_maps"];
    const limit = Math.min(Math.max(body.limit ?? 15, 1), 30);

    // Authenticate the caller — if a user JWT is sent, scope to that user.
    let userId = body.userId;
    if (!userId) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data } = await anon.auth.getUser();
        if (data?.user) userId = data.user.id;
      }
    }

    if (userId) {
      const result = await runForUser(supabase, userId, body.keyword, body.country, platforms, limit);
      return json(200, { ok: true, result });
    }

    // Cron path: every active user with at least one ad source
    const { data: users } = await supabase
      .from("intel_sources")
      .select("user_id")
      .in("kind", ["ad_signal_meta", "ad_signal_google", "google_maps"])
      .eq("enabled", true);
    const ids = Array.from(new Set((users ?? []).map((u: any) => u.user_id)));
    const { filterActiveUsers } = await import("../_shared/active-user.ts");
    const active = await filterActiveUsers(supabase, ids, 14);

    const results: any[] = [];
    for (const uid of active) {
      try { results.push(await runForUser(supabase, uid, undefined, undefined, platforms, limit)); }
      catch (e) { results.push({ userId: uid, error: (e as Error).message }); }
    }
    return json(200, { ok: true, users: results.length, results });
  } catch (e) {
    console.error("scan-ads error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
