// Scans Nigerian tech news (defaults + per-user custom sources) via Firecrawl,
// scores each article against each user's offerings + memory + trigger keywords,
// links to existing leads by domain match, and optionally auto-creates leads
// for high-relevance items when the offering opts in.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DEFAULT_SOURCES = [
  { name: "techcabal",   url: "https://techcabal.com/",                 limit: 12 },
  { name: "techpoint",   url: "https://techpoint.africa/",              limit: 12 },
  { name: "businessday", url: "https://businessday.ng/category/technology/", limit: 12 },
];

type Article = { title: string; url: string; summary?: string; published_at?: string; source: string };

function rootDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

async function firecrawlScrape(url: string, apiKey: string) {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: [
        "links",
        {
          type: "json",
          prompt:
            "Extract the latest news/article items from this page. Return an array under key `articles` with fields: title (string), url (absolute), summary (1-2 sentences if available), published_at (ISO date if visible). Limit 15 items, newest first.",
        },
      ],
      onlyMainContent: true,
    }),
  });
  if (!res.ok) throw new Error(`firecrawl ${res.status}: ${await res.text()}`);
  return res.json();
}

function normalizeArticles(scrape: any, source: string, baseUrl: string): Article[] {
  const items: any[] =
    scrape?.data?.json?.articles ??
    scrape?.json?.articles ??
    scrape?.data?.extract?.articles ??
    [];
  const base = new URL(baseUrl);
  const out: Article[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it?.title || !it?.url) continue;
    let abs: string;
    try { abs = new URL(it.url, base).toString(); } catch { continue; }
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({
      title: String(it.title).trim().slice(0, 300),
      url: abs,
      summary: it.summary ? String(it.summary).slice(0, 600) : undefined,
      published_at: (() => {
        const v = it.published_at;
        if (!v || typeof v !== "string" || v.trim() === "") return undefined;
        const d = new Date(v);
        return isNaN(d.getTime()) ? undefined : d.toISOString();
      })(),
      source,
    });
  }
  return out;
}

async function scrapeMany(sources: { name: string; url: string; limit?: number }[], apiKey: string): Promise<Article[]> {
  const out: Article[] = [];
  const results = await Promise.allSettled(
    sources.map(async (s) => {
      const data = await firecrawlScrape(s.url, apiKey);
      const arts = normalizeArticles(data, s.name, s.url).slice(0, s.limit ?? 15);
      console.log(`scan-intel: ${s.name} → ${arts.length} articles`);
      return arts;
    }),
  );
  for (const r of results) {
    if (r.status === "fulfilled") out.push(...r.value);
    else console.error("scan-intel: source failed", r.reason);
  }
  return out;
}

async function runScanJob(supabase: any, FIRECRAWL_API_KEY: string, LOVABLE_API_KEY: string, supaUrl: string, serviceKey: string) {
  try {
    // Scrape the global defaults once
    const defaultArticles = await scrapeMany(DEFAULT_SOURCES, FIRECRAWL_API_KEY);

    const { data: users } = await supabase.from("offerings").select("user_id");
    const allIds = Array.from(new Set((users ?? []).map((u: any) => u.user_id))) as string[];
    // Skip dormant users to avoid burning AI credits on inactive accounts.
    const { filterActiveUsers } = await import("../_shared/active-user.ts");
    const userIds = await filterActiveUsers(supabase, allIds, 14);

    let totalInserted = 0;
    let totalAutoLeads = 0;

    for (const userId of userIds) {
      // Fetch user's custom sources, offerings (with new fields), and memory
      const [srcRes, offRes, memRes] = await Promise.all([
        supabase.from("intel_sources").select("name, url").eq("user_id", userId).eq("enabled", true),
        supabase.from("offerings")
          .select("id, title, tagline, problem_solved, target_audience, trigger_keywords, auto_lead_from_intel")
          .eq("user_id", userId).eq("status", "active"),
        supabase.from("agent_memories").select("title, content").eq("user_id", userId).limit(8),
      ]);

      const offerings = offRes.data ?? [];
      if (offerings.length === 0) continue;
      // Skip AI scoring entirely if there's nothing to score against
      const scoreable = offerings.some((o: any) =>
        (o.problem_solved && String(o.problem_solved).trim().length > 0) ||
        (Array.isArray(o.trigger_keywords) && o.trigger_keywords.filter(Boolean).length > 0)
      );
      if (!scoreable) { console.log(`scan-intel: user ${userId} has no scoreable offerings, skipping`); continue; }

      // Custom sources for this user
      const userArticles = (srcRes.data?.length ?? 0) > 0
        ? await scrapeMany(srcRes.data.map((s: any) => ({ name: s.name, url: s.url, limit: 12 })), FIRECRAWL_API_KEY)
        : [];

      // Combine + dedupe by URL for this user
      const seenUrls = new Set<string>();
      const combined: Article[] = [];
      for (const a of [...defaultArticles, ...userArticles]) {
        if (seenUrls.has(a.url)) continue;
        seenUrls.add(a.url);
        combined.push(a);
      }
      if (combined.length === 0) continue;

      const offeringSummary = offerings
        .map((o: any) => {
          const kws = (o.trigger_keywords ?? []).filter(Boolean).join(", ");
          return `[${o.id}] ${o.title} — ${o.tagline ?? ""} | solves: ${o.problem_solved ?? ""} | for: ${o.target_audience ?? ""}${kws ? ` | trigger keywords (boost when matched): ${kws}` : ""}`;
        })
        .join("\n");
      const memorySummary = (memRes.data ?? []).map((m: any) => `${m.title}: ${String(m.content).slice(0, 400)}`).join("\n");

      // Skip already-stored URLs
      const urls = combined.map((a) => a.url);
      const { data: existing } = await supabase
        .from("intel_items").select("url").eq("user_id", userId).in("url", urls);
      const existingSet = new Set((existing ?? []).map((e: any) => e.url));
      const candidates = combined.filter((a) => !existingSet.has(a.url));
      if (candidates.length === 0) continue;

      // Chunk to keep prompts lean (max 20 articles per AI call). Trim summaries to 200 chars.
      const CHUNK = 20;
      const scores: any[] = [];
      for (let start = 0; start < candidates.length; start += CHUNK) {
        const slice = candidates.slice(start, start + CHUNK);
        const ai = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              { role: "system", content: "You are an outreach intel analyst. Given a creator's offerings (each with optional trigger keywords) + identity, and a list of news articles, score each article 0-100 for outreach value. Boost the score when an article headline/summary matches an offering's trigger keywords. Match relevant offering IDs. Return STRICT JSON only." },
              { role: "user", content:
                  `OFFERINGS:\n${offeringSummary}\n\nIDENTITY/MEMORY:\n${memorySummary}\n\nARTICLES (index → title | source):\n` +
                  slice.map((a, i) => `${start + i}. ${a.title} | ${a.source}${a.summary ? ` — ${String(a.summary).slice(0, 200)}` : ""}`).join("\n") +
                  `\n\nReturn JSON: {"scores":[{"i":0,"score":75,"matched_offering_ids":["uuid",...],"tags":["funding","fintech"],"reason":"why"}]}` },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (ai.ok) {
          try {
            const aj = await ai.json();
            const txt = aj?.choices?.[0]?.message?.content ?? "{}";
            const chunkScores = JSON.parse(txt)?.scores ?? [];
            scores.push(...chunkScores);
          } catch (e) { console.error("scan-intel: parse scores", e); }
        } else {
          console.error(`scan-intel: AI ${ai.status} on chunk ${start}`);
        }
      }

      // Pull leads once for domain matching
      const { data: userLeads } = await supabase
        .from("leads").select("id, root_domain").eq("user_id", userId).not("root_domain", "is", null);
      const domainToLead = new Map<string, string>();
      for (const l of userLeads ?? []) {
        if (l.root_domain) domainToLead.set(l.root_domain.toLowerCase(), l.id);
      }

      const offeringMap = new Map<string, any>();
      for (const o of offerings) offeringMap.set(o.id, o);

      const rows = scores
        .map((s: any) => {
          const art = candidates[s.i];
          if (!art) return null;
          const score = Math.max(0, Math.min(100, Number(s.score) || 0));
          if (score < 35) return null;
          const matched = (s.matched_offering_ids ?? []).filter((id: string) => offeringMap.has(id));
          const dom = rootDomain(art.url);
          const linked_lead_id = dom ? (domainToLead.get(dom) ?? null) : null;
          return {
            user_id: userId, source: art.source, title: art.title, url: art.url,
            summary: art.summary ?? s.reason ?? null, published_at: art.published_at ?? null,
            relevance_score: score,
            tags: Array.isArray(s.tags) ? s.tags.slice(0, 6) : null,
            matched_offerings: matched,
            linked_lead_id,
          };
        })
        .filter(Boolean);

      if (rows.length > 0) {
        const { data: inserted, error } = await supabase.from("intel_items").insert(rows as any).select("id, relevance_score, matched_offerings");
        if (error) {
          console.error("scan-intel: insert", error);
        } else {
          totalInserted += inserted?.length ?? 0;

          // Auto-lead creation: for items with score >= 80 where any matched offering has auto_lead_from_intel = true
          for (const item of inserted ?? []) {
            if ((item.relevance_score ?? 0) < 80) continue;
            const matchedIds: string[] = item.matched_offerings ?? [];
            const triggers = matchedIds.some((id) => offeringMap.get(id)?.auto_lead_from_intel === true);
            if (!triggers) continue;
            // Fire intel-to-lead in the background
            fetch(`${supaUrl}/functions/v1/intel-to-lead`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
              body: JSON.stringify({ intelItemId: item.id, userIdOverride: userId }),
            }).catch((e) => console.error("auto-lead fire failed", e));
            totalAutoLeads++;
          }
        }
      }
    }
    console.log(`scan-intel: done, inserted ${totalInserted}, fired ${totalAutoLeads} auto-leads`);
  } catch (e) {
    console.error("scan-intel job error", e);
  }
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  if (!FIRECRAWL_API_KEY) return json(500, { error: "FIRECRAWL_API_KEY missing" });

  // @ts-ignore EdgeRuntime is provided by Supabase
  EdgeRuntime.waitUntil(runScanJob(supabase, FIRECRAWL_API_KEY, LOVABLE_API_KEY, SUPABASE_URL, SERVICE_KEY));
  return json(202, { ok: true, status: "scan started in background" });
});
