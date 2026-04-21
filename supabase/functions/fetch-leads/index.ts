// Manual "Fetch leads" sweep — context-aware, region-biased global discovery.
// Reads memory, offerings, intel, campaigns, region → AI plans queries → Firecrawl
// search loop → insert raw leads → light enrichment burst on top candidates.
//
// Returns immediately after creating the run row; uses EdgeRuntime.waitUntil
// to keep the work going in background. Updates `lead_fetch_runs` for live progress.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildAfricanRegionalQuery,
  buildEnrichmentUpdates,
  fetchUserRegion,
  firecrawlScrapeLocation,
  firecrawlSearchLocation,
  type RegionContext,
} from "../_shared/enrichment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";
const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

const DEFAULT_HARD_CEILING = 200;
const DEFAULT_MAX_RETRIES = 4; // fallback variants per query
const QUERY_RESULTS = 20;
const MAX_CONCURRENT = 4;
const ENRICH_TOP_N = 25;
const SEARCH_CREDIT_PER_CALL = 1;
const SCRAPE_CREDIT_PER_CALL = 1;

// Aggregator explosion budget (mining listicles for individual businesses).
const MAX_AGGREGATORS_PER_RUN = 8;
const MAX_BUSINESSES_PER_AGGREGATOR = 15;
const AGGREGATOR_SCRAPE_CONCURRENCY = 3;
const AGGREGATOR_CEILING_GUARD = 20; // skip explosion when within N of hard ceiling

// Hosts we never insert as leads AND never try to mine (social, search, marketplaces).
const HOST_BLOCKLIST = [
  "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com",
  "youtube.com", "tiktok.com", "pinterest.com", "reddit.com", "quora.com",
  "wikipedia.org", "yelp.com", "tripadvisor.com", "yellowpages.com",
  "maps.google.com", "google.com", "bing.com", "duckduckgo.com",
  "amazon.com", "ebay.com", "etsy.com",
  "github.com", "indeed.com", "glassdoor.com", "crunchbase.com",
];

// Hosts that publish listicles/blogs/directories. We DO NOT insert them as leads,
// but we DO scrape them and extract the businesses they mention.
const LISTICLE_HOSTS = [
  "techcabal.com", "techpoint.africa", "businessday.ng", "guardian.ng",
  "premiumtimesng.com", "punchng.com", "thecable.ng", "nairametrics.com",
  "ventureburn.com", "disrupt-africa.com", "disruptafrica.com",
  "medium.com", "substack.com",
  "forbes.com", "inc.com", "entrepreneur.com", "fastcompany.com", "techcrunch.com",
  "clutch.co", "goodfirms.co", "g2.com", "capterra.com", "trustpilot.com",
  "producthunt.com", "owler.com",
];

const LISTICLE_TITLE_RE = /^(top|best|leading|\d+\s+best|\d+\s+top|\d+\s+leading)\b/i;
const LISTICLE_KEYWORD_RE = /(list of|directory|companies in|startups in|agencies in|firms in|businesses in)/i;
const LISTICLE_PATH_RE = /\/(blog|article|articles|news|posts|post|list|directory|guides?|insights?)\//i;

const isListicleHost = (h: string) => LISTICLE_HOSTS.some((b) => h === b || h.endsWith(`.${b}`));

function looksLikeAggregator(hit: { url: string; title?: string }, host: string): boolean {
  if (isListicleHost(host)) return true;
  const t = (hit.title ?? "").trim();
  if (t && (LISTICLE_TITLE_RE.test(t) || LISTICLE_KEYWORD_RE.test(t))) return true;
  try {
    const path = new URL(hit.url).pathname;
    if (LISTICLE_PATH_RE.test(path)) return true;
  } catch { /* ignore */ }
  return false;
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function rootDomain(urlStr: string): string | null {
  try { return new URL(urlStr).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}
const isBlockedHost = (h: string) => HOST_BLOCKLIST.some((b) => h === b || h.endsWith(`.${b}`));
const isExcludedTld = (h: string) => h.endsWith(".edu") || h.endsWith(".gov") || h.endsWith(".mil");

function deriveBusinessName(title: string, host: string): string {
  const clean = (title ?? "").split(/[|·•\-–—:]/)[0].trim();
  if (clean.length > 2 && clean.length < 80) return clean;
  return host.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type PlannedQuery = { query: string; icp: string };

// Broad, evergreen fallback queries used when AI-planned queries return too few leads.
// These are deliberately generic so search engines return SOMETHING.
function buildFallbackQueries(
  region: RegionContext,
  offerings: { title: string; target_audience?: string | null; trigger_keywords?: string[] }[],
): PlannedQuery[] {
  const r = region.region || "Nigeria";
  const out: PlannedQuery[] = [];

  // From offerings — use target_audience or trigger keywords directly
  for (const o of offerings.slice(0, 4)) {
    if (o.target_audience) {
      out.push({ query: `${o.target_audience} ${r}`, icp: `${o.target_audience} (${r})` });
    }
    if (o.trigger_keywords && o.trigger_keywords.length > 0) {
      const kw = o.trigger_keywords[0];
      out.push({ query: `${kw} business ${r}`, icp: `${kw} (${r})` });
    }
  }

  // Universal evergreen fallbacks
  const universal = [
    { query: `small businesses ${r}`, icp: `SMBs in ${r}` },
    { query: `startups ${r}`, icp: `Startups in ${r}` },
    { query: `agencies ${r}`, icp: `Agencies in ${r}` },
    { query: `restaurants ${r}`, icp: `Restaurants in ${r}` },
    { query: `hotels ${r}`, icp: `Hotels in ${r}` },
    { query: `consulting firms ${r}`, icp: `Consulting in ${r}` },
  ];
  out.push(...universal);

  // Dedupe by query string
  const seen = new Set<string>();
  return out.filter((q) => {
    const k = q.query.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function planQueries(apiKey: string, ctx: {
  region: string;
  memories: { title: string; content: string }[];
  offerings: { title: string; target_audience?: string | null; problem_solved?: string | null; ideal_customer?: string | null; trigger_keywords: string[] }[];
  intel: { title: string; tags: string[] }[];
  campaigns: { name: string; category?: string | null; keywords?: string | null; city?: string | null }[];
}): Promise<PlannedQuery[]> {
  const sys = `You are a B2B lead discovery strategist. Given a business's offerings, memory, recent intel, and campaigns, produce 6-10 web search queries that will surface high-quality prospect websites.

Rules:
- Each query targets ONE specific industry/niche (e.g. "boutique hotels Lagos", "fintech startups Nigeria").
- For region "${ctx.region}", aim for: 60% queries explicitly targeting ${ctx.region}, 30% other African countries (Ghana, Kenya, South Africa, Egypt), 10% diaspora-relevant.
- Queries should find real businesses (use words like "official site", or industry+city, or "company directory").
- Avoid generic terms like "list of" — favour specific-niche + location.

Return strict JSON via the tool call.`;

  const offeringText = ctx.offerings.slice(0, 8).map((o) =>
    `- ${o.title}${o.target_audience ? ` | audience: ${o.target_audience}` : ""}${o.ideal_customer ? ` | ICP: ${o.ideal_customer}` : ""}${o.problem_solved ? ` | solves: ${o.problem_solved.slice(0, 200)}` : ""}${o.trigger_keywords?.length ? ` | keywords: ${o.trigger_keywords.slice(0, 8).join(", ")}` : ""}`,
  ).join("\n");
  const memoryText = ctx.memories.slice(0, 10).map((m) => `- ${m.title}: ${m.content.slice(0, 200)}`).join("\n");
  const intelText = ctx.intel.slice(0, 12).map((i) => `- ${i.title}${i.tags?.length ? ` [${i.tags.slice(0, 4).join(", ")}]` : ""}`).join("\n");
  const campaignText = ctx.campaigns.slice(0, 10).map((c) =>
    `- ${c.name}${c.category ? ` (${c.category})` : ""}${c.city ? ` in ${c.city}` : ""}${c.keywords ? ` — ${c.keywords}` : ""}`,
  ).join("\n");

  const user = `REGION: ${ctx.region}

OFFERINGS:
${offeringText || "(none)"}

MEMORY (about my business):
${memoryText || "(none)"}

RECENT INTEL (relevant trends/news):
${intelText || "(none)"}

EXISTING CAMPAIGNS (ICP signals):
${campaignText || "(none)"}

Plan 6-10 search queries to find real prospect websites for my offerings.`;

  const res = await fetch(LOVABLE_AI, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      tools: [{
        type: "function",
        function: {
          name: "plan_queries",
          description: "Return planned search queries.",
          parameters: {
            type: "object",
            properties: {
              queries: {
                type: "array",
                minItems: 6,
                maxItems: 10,
                items: {
                  type: "object",
                  properties: {
                    query: { type: "string", description: "Web search query string" },
                    icp: { type: "string", description: "Short ICP label (e.g. 'boutique hotels Lagos')" },
                  },
                  required: ["query", "icp"],
                  additionalProperties: false,
                },
              },
            },
            required: ["queries"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "plan_queries" } },
    }),
  });
  if (!res.ok) throw new Error(`Plan failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("Plan returned no tool call");
  const parsed = JSON.parse(args);
  return (parsed.queries ?? []).slice(0, 10);
}

type FirecrawlHit = { url: string; title?: string; description?: string };

async function firecrawlSearch(
  apiKey: string,
  query: string,
  location: string | null,
): Promise<{ results: FirecrawlHit[]; outOfCredits: boolean; status: number }> {
  const body: Record<string, unknown> = { query, limit: QUERY_RESULTS };
  if (location) body.location = location;
  const res = await fetch(`${FIRECRAWL_V2}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 402) return { results: [], outOfCredits: true, status: 402 };
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`Firecrawl search failed: ${res.status}`, txt);
    return { results: [], outOfCredits: false, status: res.status };
  }
  const data = await res.json();
  const web = data?.data?.web ?? data?.data ?? data?.web ?? [];
  const hits = (Array.isArray(web) ? web : [])
    .map((r: any) => ({ url: r.url, title: r.title, description: r.description }))
    .filter((h: FirecrawlHit) => h.url);
  return { results: hits, outOfCredits: false, status: 200 };
}

// Robust search: tries regional → without location → bare query.
// `maxAttempts` caps retries (1 = primary only, 4 = full fallback chain).
async function robustSearch(
  apiKey: string,
  baseQuery: string,
  region: RegionContext,
  location: string,
  maxAttempts: number,
): Promise<{ results: FirecrawlHit[]; outOfCredits: boolean; attempts: number; lastError?: string }> {
  const regional = buildAfricanRegionalQuery(baseQuery, region);
  const variants: Array<{ q: string; loc: string | null }> = [
    { q: regional, loc: location },
    { q: regional, loc: null },
    { q: baseQuery, loc: location },
    { q: baseQuery, loc: null },
  ].slice(0, Math.max(1, Math.min(maxAttempts, 4)));
  let attempts = 0;
  let lastResults: FirecrawlHit[] = [];
  let lastError: string | undefined;
  for (const v of variants) {
    attempts += 1;
    const r = await firecrawlSearch(apiKey, v.q, v.loc);
    if (r.outOfCredits) return { results: [], outOfCredits: true, attempts, lastError: "Firecrawl 402" };
    if (r.status >= 400) lastError = `Firecrawl ${r.status}`;
    if (r.results.length > 0) return { results: r.results, outOfCredits: false, attempts };
    lastResults = r.results;
  }
  return { results: lastResults, outOfCredits: false, attempts, lastError };
}

async function firecrawlScrape(apiKey: string, url: string, location: ReturnType<typeof firecrawlScrapeLocation>) {
  const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: ["markdown", "links", "summary"],
      onlyMainContent: true,
      location,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    markdown: data?.data?.markdown ?? data?.markdown ?? "",
    summary: data?.data?.summary ?? data?.summary ?? "",
    links: data?.data?.links ?? data?.links ?? [],
  };
}

// Lightweight scrape for aggregator pages — markdown + links only (no AI summary).
async function firecrawlScrapeAggregator(apiKey: string, url: string): Promise<{ markdown: string; links: string[] } | null> {
  try {
    const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown", "links"], onlyMainContent: true }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const markdown: string = data?.data?.markdown ?? data?.markdown ?? "";
    const links: string[] = data?.data?.links ?? data?.links ?? [];
    if (!markdown && (!links || links.length === 0)) return null;
    return { markdown, links: Array.isArray(links) ? links : [] };
  } catch (e) {
    console.error(`Aggregator scrape failed for ${url}`, e);
    return null;
  }
}

type ExtractedBusiness = { name: string; website?: string | null; snippet?: string | null };

// AI extracts businesses mentioned in a listicle/blog page.
async function extractBusinessesFromPage(
  apiKey: string,
  ctx: { url: string; title: string; markdown: string; links: string[] },
): Promise<{ businesses: ExtractedBusiness[]; is_listicle: boolean; list_topic: string }> {
  const trimmedMd = (ctx.markdown ?? "").slice(0, 12000);
  const trimmedLinks = (ctx.links ?? []).slice(0, 80);
  const sys = `You extract individual businesses/organisations mentioned in articles, listicles, blog posts, or directory pages. Only return real businesses with their own websites — skip the publisher's own site, social media handles, generic categories, and aggregators.`;
  const user = `PAGE URL: ${ctx.url}
PAGE TITLE: ${ctx.title}

OUTBOUND LINKS ON PAGE (use to resolve mentioned business names to websites):
${trimmedLinks.map((l) => `- ${l}`).join("\n") || "(none)"}

PAGE CONTENT (markdown):
${trimmedMd}

Extract every distinct business/organisation mentioned. For each:
- name: official business name (cleaned)
- website: homepage URL (resolve from outbound links if not inline; null if not findable)
- snippet: 1-line description of why they were mentioned

Cap at ${MAX_BUSINESSES_PER_AGGREGATOR}. Skip the publisher itself and any aggregator/directory hosts.`;

  try {
    const res = await fetch(LOVABLE_AI, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_businesses",
            description: "Return businesses mentioned in the page.",
            parameters: {
              type: "object",
              properties: {
                is_listicle: { type: "boolean" },
                list_topic: { type: "string", description: "Short topic of the list/article" },
                businesses: {
                  type: "array",
                  maxItems: MAX_BUSINESSES_PER_AGGREGATOR,
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      website: { type: ["string", "null"] },
                      snippet: { type: ["string", "null"] },
                    },
                    required: ["name"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["is_listicle", "list_topic", "businesses"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "extract_businesses" } },
      }),
    });
    if (!res.ok) {
      console.error(`extract_businesses failed: ${res.status}`);
      return { businesses: [], is_listicle: false, list_topic: "" };
    }
    const data = await res.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { businesses: [], is_listicle: false, list_topic: "" };
    const parsed = JSON.parse(args);
    return {
      businesses: Array.isArray(parsed.businesses) ? parsed.businesses.slice(0, MAX_BUSINESSES_PER_AGGREGATOR) : [],
      is_listicle: !!parsed.is_listicle,
      list_topic: typeof parsed.list_topic === "string" ? parsed.list_topic : "",
    };
  } catch (e) {
    console.error("extract_businesses error", e);
    return { businesses: [], is_listicle: false, list_topic: "" };
  }
}

async function runFetch(
  supabase: any,
  runId: string,
  userId: string,
  firecrawlKey: string,
  lovableKey: string,
  hardCeiling: number,
  maxRetries: number,
) {
  const log = (msg: string, level: "info" | "warn" | "error" = "info") => {
    console.log(`[fetch-leads ${runId}] ${msg}`);
    supabase.from("run_events").insert({
      user_id: userId,
      kind: "fetch_leads",
      level,
      message: msg,
    }).then(() => {}, () => {});
  };

  const update = async (patch: Record<string, unknown>) => {
    await supabase.from("lead_fetch_runs").update(patch).eq("id", runId);
  };

  const checkStopped = async (): Promise<boolean> => {
    const { data } = await supabase.from("lead_fetch_runs").select("state").eq("id", runId).maybeSingle();
    return data?.state === "stopped";
  };

  try {
    // 1. Gather context
    const region = await fetchUserRegion(supabase, userId);
    const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [memRes, offRes, intelRes, campRes] = await Promise.all([
      supabase.from("agent_memories").select("title,slug,content").eq("user_id", userId).limit(20),
      supabase.from("offerings").select("title,target_audience,problem_solved,ideal_customer,trigger_keywords").eq("user_id", userId).eq("status", "active"),
      supabase.from("intel_items").select("title,tags").eq("user_id", userId).gte("created_at", sinceIso).gte("relevance_score", 40).order("relevance_score", { ascending: false }).limit(20),
      supabase.from("campaigns").select("name,category,keywords,city").eq("user_id", userId),
    ]);

    log(`Planning queries — region ${region.region}, ${offRes.data?.length ?? 0} offerings, ${memRes.data?.length ?? 0} memories, ${intelRes.data?.length ?? 0} intel`);

    // 2. AI plan
    const planned = await planQueries(lovableKey, {
      region: region.region,
      memories: (memRes.data ?? []) as any,
      offerings: (offRes.data ?? []) as any,
      intel: (intelRes.data ?? []) as any,
      campaigns: (campRes.data ?? []) as any,
    });
    if (planned.length === 0) throw new Error("AI returned no queries");

    log(`Planned ${planned.length} queries: ${planned.map((p) => p.icp).join(" · ")}`);

    await update({
      state: "searching",
      queries_planned: planned.length,
    });

    // 3. Pre-load existing root domains to dedupe
    const { data: existing } = await supabase.from("leads").select("root_domain,website").eq("user_id", userId);
    const existingDomains = new Set<string>();
    (existing ?? []).forEach((l: any) => {
      if (l.root_domain) existingDomains.add(l.root_domain.toLowerCase());
      if (l.website) {
        const d = rootDomain(l.website);
        if (d) existingDomains.add(d);
      }
    });

    const searchLocation = firecrawlSearchLocation(region);
    const scrapeLocation = firecrawlScrapeLocation(region);
    let totalSeen = 0;
    let totalInserted = 0;
    let creditsEstimate = 0;
    let totalQueriesRun = 0;
    const candidatesForEnrichment: { id: string; signal: number }[] = [];

    const MIN_TARGET = 30;
    const FALLBACK_QUERY_BUDGET = 6;
    let totalAttempts = 0;
    let totalRetries = 0;
    let lastSearchError: string | undefined;
    let aggregatorsExploded = 0;
    let extractedBusinesses = 0;

    type AggregatorHit = { hit: FirecrawlHit; host: string; icp: string };
    const aggregatorQueue: AggregatorHit[] = [];
    const seenAggregatorUrls = new Set<string>();

    const processBatch = async (batch: PlannedQuery[]): Promise<{ outOfCredits: boolean; batchInserted: number }> => {
      await update({ current_query: batch[0].icp });

      const results = await Promise.all(
        batch.map(async (q) => {
          const r = await robustSearch(firecrawlKey, q.query, region, searchLocation, maxRetries);
          return { q, ...r };
        }),
      );

      const batchAttempts = results.reduce((s, r) => s + r.attempts, 0);
      const batchRetries = results.reduce((s, r) => s + Math.max(0, r.attempts - 1), 0);
      totalAttempts += batchAttempts;
      totalRetries += batchRetries;
      creditsEstimate += batchAttempts * SEARCH_CREDIT_PER_CALL;
      totalQueriesRun += batch.length;
      const lastErr = results.find((r) => r.lastError)?.lastError;
      if (lastErr) lastSearchError = lastErr;

      let outOfCredits = false;
      const newLeads: any[] = [];

      for (const { q, results: hits, outOfCredits: oc } of results) {
        if (oc) { outOfCredits = true; continue; }
        totalSeen += hits.length;

        for (const hit of hits) {
          if (totalInserted + newLeads.length >= hardCeiling) break;
          const host = rootDomain(hit.url);
          if (!host) continue;
          if (isBlockedHost(host)) continue;

          // Aggregator/listicle? → queue for explosion, do NOT insert as a lead.
          if (looksLikeAggregator(hit, host)) {
            if (!seenAggregatorUrls.has(hit.url) && aggregatorQueue.length < MAX_AGGREGATORS_PER_RUN * 3) {
              seenAggregatorUrls.add(hit.url);
              aggregatorQueue.push({ hit, host, icp: q.icp });
            }
            continue;
          }

          if (isExcludedTld(host) && totalInserted + newLeads.length > 80) continue;
          if (existingDomains.has(host)) continue;
          existingDomains.add(host);

          const businessName = deriveBusinessName(hit.title ?? "", host);
          const desc = (hit.description ?? "").slice(0, 600);
          const note = `Source: AI fetch (${q.icp})\n${desc}`;

          const signal =
            (desc.length > 200 ? 2 : 0) +
            (businessName.length > 3 && businessName.length < 50 ? 2 : 0) +
            (host.endsWith(`.${region.countryCode}`) ? 3 : 0);

          newLeads.push({
            user_id: userId,
            business_name: businessName,
            website: hit.url,
            notes: note,
            status: "new",
            campaign_id: null,
            __signal: signal,
          });
        }
      }

      let batchInserted = 0;
      if (newLeads.length > 0) {
        const insertRows = newLeads.map(({ __signal, ...rest }) => rest);
        const { data: inserted, error: insErr } = await supabase
          .from("leads")
          .insert(insertRows)
          .select("id,score");
        if (insErr) {
          log(`Insert error: ${insErr.message}`, "error");
        } else {
          batchInserted = inserted?.length ?? 0;
          totalInserted += batchInserted;
          (inserted ?? []).forEach((row: any, idx: number) => {
            candidatesForEnrichment.push({ id: row.id, signal: newLeads[idx].__signal });
          });
          const hq = (inserted ?? []).filter((r: any) => (r.score ?? 0) >= 50).length;
          const { data: cur } = await supabase.from("lead_fetch_runs").select("high_quality_count").eq("id", runId).maybeSingle();
          await update({
            queries_run: totalQueriesRun,
            query_attempts: totalAttempts,
            retries_used: totalRetries,
            candidates_seen: totalSeen,
            inserted_count: totalInserted,
            high_quality_count: (cur?.high_quality_count ?? 0) + hq,
            credits_estimate: creditsEstimate,
          });
        }
      } else {
        await update({
          queries_run: totalQueriesRun,
          query_attempts: totalAttempts,
          retries_used: totalRetries,
          candidates_seen: totalSeen,
          credits_estimate: creditsEstimate,
        });
      }

      return { outOfCredits, batchInserted };
    };

    // Explode queued aggregator/listicle pages into individual business leads.
    const explodeAggregators = async (): Promise<void> => {
      if (aggregatorQueue.length === 0) return;
      if (totalInserted >= hardCeiling - AGGREGATOR_CEILING_GUARD) {
        log(`Skipping aggregator explosion — within ${AGGREGATOR_CEILING_GUARD} of ceiling`);
        return;
      }
      const regionLc = (region.region || "").toLowerCase();
      const ranked = [...aggregatorQueue].sort((a, b) => {
        const ar = (a.hit.title ?? "").toLowerCase().includes(regionLc) ? 1 : 0;
        const br = (b.hit.title ?? "").toLowerCase().includes(regionLc) ? 1 : 0;
        return br - ar;
      }).slice(0, MAX_AGGREGATORS_PER_RUN);

      log(`Exploding ${ranked.length} aggregator page(s) to mine individual businesses`);

      for (let i = 0; i < ranked.length; i += AGGREGATOR_SCRAPE_CONCURRENCY) {
        if (await checkStopped()) return;
        if (totalInserted >= hardCeiling) return;
        const slice = ranked.slice(i, i + AGGREGATOR_SCRAPE_CONCURRENCY);

        await Promise.all(slice.map(async (agg) => {
          if (totalInserted >= hardCeiling) return;
          const scraped = await firecrawlScrapeAggregator(firecrawlKey, agg.hit.url);
          creditsEstimate += SCRAPE_CREDIT_PER_CALL;
          if (!scraped) {
            log(`Aggregator scrape failed: ${agg.hit.url}`, "warn");
            return;
          }
          aggregatorsExploded += 1;

          const extracted = await extractBusinessesFromPage(lovableKey, {
            url: agg.hit.url,
            title: agg.hit.title ?? "",
            markdown: scraped.markdown,
            links: scraped.links,
          });

          const aggHost = agg.host;
          const topic = extracted.list_topic || (agg.hit.title ?? "list");
          const childRows: any[] = [];

          for (const biz of extracted.businesses) {
            if (totalInserted + childRows.length >= hardCeiling) break;
            if (!biz.name || biz.name.trim().length < 2) continue;
            if (!biz.website) continue;
            const childHost = rootDomain(biz.website);
            if (!childHost) continue;
            if (childHost === aggHost) continue;
            if (isBlockedHost(childHost)) continue;
            if (isListicleHost(childHost)) continue;
            if (isExcludedTld(childHost) && totalInserted + childRows.length > 80) continue;
            if (existingDomains.has(childHost)) continue;
            existingDomains.add(childHost);
            extractedBusinesses += 1;

            const snippet = (biz.snippet ?? "").slice(0, 400);
            const note = `Source: AI fetch — extracted from list "${topic}" on ${aggHost}\n${snippet}`;
            const signal =
              (snippet.length > 80 ? 2 : 0) +
              (childHost.endsWith(`.${region.countryCode}`) ? 3 : 0) + 2;

            childRows.push({
              user_id: userId,
              business_name: biz.name.trim().slice(0, 200),
              website: biz.website,
              notes: note,
              status: "new",
              campaign_id: null,
              __signal: signal,
            });
          }

          if (childRows.length > 0) {
            const insertRows = childRows.map(({ __signal, ...rest }) => rest);
            const { data: inserted, error: insErr } = await supabase
              .from("leads")
              .insert(insertRows)
              .select("id,score");
            if (insErr) {
              log(`Aggregator insert error: ${insErr.message}`, "error");
            } else {
              const inc = inserted?.length ?? 0;
              totalInserted += inc;
              (inserted ?? []).forEach((row: any, idx: number) => {
                candidatesForEnrichment.push({ id: row.id, signal: childRows[idx].__signal });
              });
              const hq = (inserted ?? []).filter((r: any) => (r.score ?? 0) >= 50).length;
              const { data: cur } = await supabase.from("lead_fetch_runs").select("high_quality_count").eq("id", runId).maybeSingle();
              await update({
                inserted_count: totalInserted,
                high_quality_count: (cur?.high_quality_count ?? 0) + hq,
                aggregators_exploded: aggregatorsExploded,
                extracted_businesses: extractedBusinesses,
                credits_estimate: creditsEstimate,
              });
              log(`+${inc} leads from list "${topic}" on ${aggHost}`);
            }
          } else {
            await update({
              aggregators_exploded: aggregatorsExploded,
              extracted_businesses: extractedBusinesses,
              credits_estimate: creditsEstimate,
            });
          }
        }));
      }
    };

    // 4. Run searches in batches of MAX_CONCURRENT
    for (let i = 0; i < planned.length; i += MAX_CONCURRENT) {
      if (await checkStopped()) {
        log("Stopped by user", "warn");
        await update({ state: "stopped" });
        return;
      }
      if (totalInserted >= hardCeiling) {
        log(`Hit hard ceiling of ${hardCeiling} leads — stopping searches`);
        break;
      }

      const batch = planned.slice(i, i + MAX_CONCURRENT);
      const { outOfCredits } = await processBatch(batch);

      if (outOfCredits) {
        log("Firecrawl credits exhausted", "error");
        await update({ state: "failed", error: "Firecrawl credits exhausted — top up to continue", failure_reason: "Firecrawl credits exhausted — top up to continue" });
        return;
      }
    }

    log(`Initial pass — ${totalInserted} inserted from ${totalSeen} candidates`);

    // 4b. Persistence: if we ended up with too few leads, run broader fallback queries.
    if (totalInserted < MIN_TARGET && !(await checkStopped()) && totalInserted < hardCeiling) {
      log(`Below target (${totalInserted}/${MIN_TARGET}) — running ${FALLBACK_QUERY_BUDGET} fallback queries`);
      const fallback = buildFallbackQueries(region, (offRes.data ?? []) as any).slice(0, FALLBACK_QUERY_BUDGET);
      await update({ queries_planned: planned.length + fallback.length });

      for (let i = 0; i < fallback.length; i += MAX_CONCURRENT) {
        if (await checkStopped()) break;
        if (totalInserted >= hardCeiling) break;
        const batch = fallback.slice(i, i + MAX_CONCURRENT);
        const { outOfCredits } = await processBatch(batch);
        if (outOfCredits) {
          await update({ state: "failed", error: "Firecrawl credits exhausted — top up to continue", failure_reason: "Firecrawl credits exhausted" });
          return;
        }
      }
      log(`After fallback — ${totalInserted} inserted from ${totalSeen} candidates`);
    }

    // 4c. Explode aggregator/listicle pages → mine individual businesses.
    if (!(await checkStopped())) {
      try {
        await explodeAggregators();
      } catch (e) {
        log(`Aggregator explosion failed: ${e instanceof Error ? e.message : String(e)}`, "warn");
      }
      log(`After aggregator explosion — ${totalInserted} inserted (exploded ${aggregatorsExploded} pages → ${extractedBusinesses} businesses)`);
    }

    log(`Search done — ${totalInserted} inserted from ${totalSeen} candidates`);

    // 5. Enrichment burst on top candidates
    if (totalInserted > 0 && !(await checkStopped())) {
      await update({ state: "enriching", current_query: null });
      const top = candidatesForEnrichment.sort((a, b) => b.signal - a.signal).slice(0, ENRICH_TOP_N);
      log(`Enriching top ${top.length} candidates`);

      let enriched = 0;
      let highQuality = 0;
      for (let i = 0; i < top.length; i += 3) {
        if (await checkStopped()) break;
        const slice = top.slice(i, i + 3);
        await Promise.all(slice.map(async ({ id }) => {
          try {
            const { data: lead } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
            if (!lead || !lead.website) return;
            const scrape = await firecrawlScrape(firecrawlKey, lead.website, scrapeLocation);
            creditsEstimate += SCRAPE_CREDIT_PER_CALL;
            if (!scrape) return;
            const updates = await buildEnrichmentUpdates(lovableKey, lead as any, scrape);
            const newStatus = updates.contact_email || updates.phone ? "enriched" : lead.status;
            await supabase.from("leads").update({ ...updates, status: newStatus }).eq("id", id);
            enriched += 1;
            const { data: scored } = await supabase.from("leads").select("score").eq("id", id).maybeSingle();
            if ((scored?.score ?? 0) >= 50) highQuality += 1;
          } catch (e) {
            console.error(`Enrich ${id} failed`, e);
          }
        }));
        await update({ enriched_count: enriched, credits_estimate: creditsEstimate });
      }

      if (highQuality > 0) {
        const { data: cur } = await supabase.from("lead_fetch_runs").select("high_quality_count").eq("id", runId).maybeSingle();
        await update({ high_quality_count: (cur?.high_quality_count ?? 0) + highQuality });
      }
    }

    if (await checkStopped()) {
      log("Stopped during enrichment");
      await update({ state: "stopped" });
      return;
    }

    // Compose failure_reason if zero leads inserted
    let failureReason: string | null = null;
    if (totalInserted === 0) {
      const parts: string[] = [];
      if (totalSeen === 0) parts.push("No search results returned by Firecrawl across all queries and fallback variants.");
      else parts.push(`${totalSeen} candidates returned but all were filtered (blocklisted hosts, excluded TLDs, or duplicates of existing leads).`);
      if (lastSearchError) parts.push(`Last search error: ${lastSearchError}.`);
      parts.push(`Try widening offerings/keywords, raising max retries (current: ${maxRetries}), or checking Firecrawl quota.`);
      failureReason = parts.join(" ");
    }

    await update({ state: "done", failure_reason: failureReason });
    log(`✓ Done — ${totalInserted} leads inserted, ~${creditsEstimate} credits used`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`fetch-leads ${runId} failed`, e);
    await supabase.from("lead_fetch_runs").update({ state: "failed", error: msg.slice(0, 500), failure_reason: msg.slice(0, 500) }).eq("id", runId);
    supabase.from("run_events").insert({
      user_id: userId,
      kind: "fetch_leads",
      level: "error",
      message: `Fetch leads failed: ${msg}`,
    }).then(() => {}, () => {});
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) return json(500, { error: "FIRECRAWL_API_KEY not configured" });

    // Auth — get caller user
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json(401, { error: "Unauthorized" });
    const userId = userData.user.id;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // One in-flight run per user
    const { data: existing } = await supabase
      .from("lead_fetch_runs")
      .select("id,state")
      .eq("user_id", userId)
      .in("state", ["planning", "searching", "enriching"])
      .maybeSingle();
    if (existing) {
      return json(200, { runId: existing.id, alreadyRunning: true });
    }

    // Parse optional body params
    let bodyParams: { maxLeads?: number; maxRetries?: number } = {};
    try { bodyParams = await req.json(); } catch { /* allow empty body */ }
    const hardCeiling = Math.max(10, Math.min(Number(bodyParams.maxLeads) || DEFAULT_HARD_CEILING, 500));
    const maxRetries = Math.max(1, Math.min(Number(bodyParams.maxRetries) || DEFAULT_MAX_RETRIES, 4));

    // Create run row
    const { data: run, error: runErr } = await supabase
      .from("lead_fetch_runs")
      .insert({ user_id: userId, state: "planning", hard_ceiling: hardCeiling, max_leads: hardCeiling, max_retries: maxRetries })
      .select("id")
      .single();
    if (runErr || !run) return json(500, { error: runErr?.message ?? "Failed to create run" });

    // Kick off background work
    // @ts-ignore EdgeRuntime is provided by Supabase functions runtime
    EdgeRuntime.waitUntil(runFetch(supabase, run.id, userId, FIRECRAWL_API_KEY, LOVABLE_API_KEY, hardCeiling, maxRetries));

    return json(200, { runId: run.id, started: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("fetch-leads handler error", e);
    return json(500, { error: msg });
  }
});
