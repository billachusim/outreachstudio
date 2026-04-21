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

const HARD_CEILING = 200;
const QUERY_RESULTS = 20;
const MAX_CONCURRENT = 4;
const ENRICH_TOP_N = 25;

const HOST_BLOCKLIST = [
  "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com",
  "youtube.com", "tiktok.com", "pinterest.com", "reddit.com", "quora.com",
  "wikipedia.org", "yelp.com", "tripadvisor.com", "yellowpages.com",
  "maps.google.com", "google.com", "bing.com", "duckduckgo.com",
  "amazon.com", "ebay.com", "etsy.com", "medium.com", "substack.com",
  "github.com", "indeed.com", "glassdoor.com", "crunchbase.com",
];

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
// Returns the first non-empty result set (or last attempt's result).
async function robustSearch(
  apiKey: string,
  baseQuery: string,
  region: RegionContext,
  location: string,
): Promise<{ results: FirecrawlHit[]; outOfCredits: boolean; attempts: number }> {
  const regional = buildAfricanRegionalQuery(baseQuery, region);
  const variants: Array<{ q: string; loc: string | null }> = [
    { q: regional, loc: location },        // 1. AI-enhanced + region location
    { q: regional, loc: null },            // 2. AI-enhanced, no location
    { q: baseQuery, loc: location },       // 3. Bare query + region
    { q: baseQuery, loc: null },           // 4. Bare query, no location
  ];
  let attempts = 0;
  let lastResults: FirecrawlHit[] = [];
  for (const v of variants) {
    attempts += 1;
    const r = await firecrawlSearch(apiKey, v.q, v.loc);
    if (r.outOfCredits) return { results: [], outOfCredits: true, attempts };
    if (r.results.length > 0) return { results: r.results, outOfCredits: false, attempts };
    lastResults = r.results;
  }
  return { results: lastResults, outOfCredits: false, attempts };
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

async function runFetch(supabase: any, runId: string, userId: string, firecrawlKey: string, lovableKey: string) {
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

    const location = firecrawlLocationParam(region);
    let totalSeen = 0;
    let totalInserted = 0;
    let creditsEstimate = 0;
    const candidatesForEnrichment: { id: string; signal: number }[] = [];

    // 4. Run searches in batches of MAX_CONCURRENT
    for (let i = 0; i < planned.length; i += MAX_CONCURRENT) {
      if (await checkStopped()) {
        log("Stopped by user", "warn");
        await update({ state: "stopped" });
        return;
      }
      if (totalInserted >= HARD_CEILING) {
        log(`Hit hard ceiling of ${HARD_CEILING} leads — stopping searches`);
        break;
      }

      const batch = planned.slice(i, i + MAX_CONCURRENT);
      await update({ current_query: batch[0].icp });

      const results = await Promise.all(batch.map(async (q) => {
        const regionalQuery = buildAfricanRegionalQuery(q.query, region);
        const r = await firecrawlSearch(firecrawlKey, regionalQuery, location);
        return { q, ...r };
      }));

      creditsEstimate += batch.length;
      let outOfCredits = false;
      const newLeads: any[] = [];

      for (const { q, results: hits, outOfCredits: oc } of results) {
        if (oc) { outOfCredits = true; continue; }
        totalSeen += hits.length;

        for (const hit of hits) {
          if (totalInserted + newLeads.length >= HARD_CEILING) break;
          const host = rootDomain(hit.url);
          if (!host) continue;
          if (isBlockedHost(host)) continue;
          if (isExcludedTld(host) && totalInserted + newLeads.length > 80) continue;
          if (existingDomains.has(host)) continue;
          existingDomains.add(host); // dedupe within this run

          const businessName = deriveBusinessName(hit.title ?? "", host);
          const desc = (hit.description ?? "").slice(0, 600);
          const note = `Source: AI fetch (${q.icp})\n${desc}`;

          // signal score for picking enrichment candidates
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

      if (newLeads.length > 0) {
        const insertRows = newLeads.map(({ __signal, ...rest }) => rest);
        const { data: inserted, error: insErr } = await supabase
          .from("leads")
          .insert(insertRows)
          .select("id,score");
        if (insErr) {
          log(`Insert error: ${insErr.message}`, "error");
        } else {
          totalInserted += inserted?.length ?? 0;
          (inserted ?? []).forEach((row: any, idx: number) => {
            candidatesForEnrichment.push({ id: row.id, signal: newLeads[idx].__signal });
          });
          const hq = (inserted ?? []).filter((r: any) => (r.score ?? 0) >= 50).length;
          await update({
            queries_run: Math.min(i + batch.length, planned.length),
            candidates_seen: totalSeen,
            inserted_count: totalInserted,
            high_quality_count: ((await supabase.from("lead_fetch_runs").select("high_quality_count").eq("id", runId).maybeSingle()).data?.high_quality_count ?? 0) + hq,
            credits_estimate: creditsEstimate,
          });
        }
      } else {
        await update({
          queries_run: Math.min(i + batch.length, planned.length),
          candidates_seen: totalSeen,
          credits_estimate: creditsEstimate,
        });
      }

      if (outOfCredits) {
        log("Firecrawl credits exhausted", "error");
        await update({ state: "failed", error: "Firecrawl credits exhausted — top up to continue" });
        return;
      }
    }

    log(`Search done — ${totalInserted} inserted from ${totalSeen} candidates`);

    // 5. Enrichment burst on top candidates
    if (totalInserted > 0 && !(await checkStopped())) {
      await update({ state: "enriching", current_query: null });
      const top = candidatesForEnrichment.sort((a, b) => b.signal - a.signal).slice(0, ENRICH_TOP_N);
      log(`Enriching top ${top.length} candidates`);

      let enriched = 0;
      let highQuality = 0;
      // Run enrichments with light concurrency to avoid timeouts
      for (let i = 0; i < top.length; i += 3) {
        if (await checkStopped()) break;
        const slice = top.slice(i, i + 3);
        await Promise.all(slice.map(async ({ id }) => {
          try {
            const { data: lead } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
            if (!lead || !lead.website) return;
            const scrape = await firecrawlScrape(firecrawlKey, lead.website, location);
            creditsEstimate += 1;
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

    await update({ state: "done" });
    log(`✓ Done — ${totalInserted} leads inserted, ~${creditsEstimate} credits used`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`fetch-leads ${runId} failed`, e);
    await supabase.from("lead_fetch_runs").update({ state: "failed", error: msg.slice(0, 500) }).eq("id", runId);
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

    // Create run row
    const { data: run, error: runErr } = await supabase
      .from("lead_fetch_runs")
      .insert({ user_id: userId, state: "planning", hard_ceiling: HARD_CEILING })
      .select("id")
      .single();
    if (runErr || !run) return json(500, { error: runErr?.message ?? "Failed to create run" });

    // Kick off background work
    // @ts-ignore EdgeRuntime is provided by Supabase functions runtime
    EdgeRuntime.waitUntil(runFetch(supabase, run.id, userId, FIRECRAWL_API_KEY, LOVABLE_API_KEY));

    return json(200, { runId: run.id, started: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("fetch-leads handler error", e);
    return json(500, { error: msg });
  }
});
