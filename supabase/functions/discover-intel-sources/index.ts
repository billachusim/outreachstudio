// Suggests new intel sources (news sites, blogs, directories) for the current user
// based on their region, offerings, memories, and active campaigns.
// Uses Lovable AI (gemini-2.5-flash) to brainstorm candidates, then validates each
// with a small Firecrawl /v2/map call before returning.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";
const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

const DEFAULT_SOURCE_HOSTS = ["techcabal.com", "techpoint.africa", "businessday.ng"];

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function rootDomain(urlStr: string): string | null {
  try { return new URL(urlStr).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

type SuggestionType = "news" | "blog" | "directory" | "listicle" | "ad_signal_meta" | "ad_signal_google" | "google_maps";
type Suggestion = {
  name: string;
  url: string;
  why_relevant: string;
  type: SuggestionType;
};

const TYPE_TO_KIND: Record<SuggestionType, string> = {
  news: "news",
  blog: "news",
  directory: "news",
  listicle: "news",
  ad_signal_meta: "ad_signal_meta",
  ad_signal_google: "ad_signal_google",
  google_maps: "google_maps",
};


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing auth" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!firecrawlKey) return json(500, { error: "FIRECRAWL_API_KEY not configured" });
    if (!lovableKey) return json(500, { error: "LOVABLE_API_KEY not configured" });

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json(401, { error: "Invalid auth" });

    // 1. Gather context
    const [profileRes, offRes, memRes, campRes, srcRes] = await Promise.all([
      supabase.from("profiles").select("outreach_region,outreach_country_code").eq("user_id", user.id).maybeSingle(),
      supabase.from("offerings").select("title,tagline,target_audience,trigger_keywords").eq("user_id", user.id).limit(20),
      supabase.from("agent_memories").select("title,content").eq("user_id", user.id).limit(15),
      supabase.from("campaigns").select("name,category,city,keywords").eq("user_id", user.id).eq("status", "active").limit(20),
      supabase.from("intel_sources").select("url,name,kind").eq("user_id", user.id),
    ]);


    const region = profileRes.data?.outreach_region ?? "Global";
    const countryCode = profileRes.data?.outreach_country_code ?? "";
    const offerings = offRes.data ?? [];
    const memories = memRes.data ?? [];
    const campaigns = campRes.data ?? [];

    const existingHosts = new Set<string>(DEFAULT_SOURCE_HOSTS);
    const existingAdKeywords = new Set<string>(); // `${kind}::${lower(name)}`
    for (const s of (srcRes.data ?? []) as any[]) {
      const h = rootDomain(s.url);
      if (h) existingHosts.add(h);
      if (s.kind && ["ad_signal_meta", "ad_signal_google", "google_maps"].includes(s.kind)) {
        existingAdKeywords.add(`${s.kind}::${(s.name || "").toLowerCase().trim()}`);
      }
    }

    // 2. AI suggestion call (structured tool output)
    const sysPrompt = `You are an outreach intel researcher. Suggest 8-12 high-signal intel sources for this user across TWO categories:

A) Editorial sources (news sites, blogs, listicle publishers, business directories) that publish trigger events (funding, launches, expansion) and lists of businesses. type = "news" | "blog" | "directory" | "listicle". Provide a real https URL.

B) Ad-signal / map keyword sources that surface businesses actively spending on ads or running local services. These do NOT have URLs — instead the "name" field is a SEARCH KEYWORD (e.g. "dental clinic Lagos", "personal injury lawyer Houston", "SaaS HR Africa"). Provide an empty string for url. Choose at least 2-4 of these total across the three types:
  - type = "ad_signal_meta"   → Meta Ads Library keyword for the user's target audience
  - type = "ad_signal_google" → Google Ads Transparency keyword for the user's target audience
  - type = "google_maps"      → Google Maps business category + city for local prospecting

User region: ${region}${countryCode ? ` (${countryCode.toUpperCase()})` : ""}

Offerings (what they sell):
${offerings.map((o: any) => `- ${o.title}${o.tagline ? ` — ${o.tagline}` : ""}${o.target_audience ? ` (audience: ${o.target_audience})` : ""}${o.trigger_keywords ? ` (triggers: ${o.trigger_keywords})` : ""}`).join("\n") || "(none)"}

Active campaigns:
${campaigns.map((c: any) => `- ${c.name}${c.category ? ` [${c.category}]` : ""}${c.city ? ` in ${c.city}` : ""}${c.keywords ? ` — ${c.keywords}` : ""}`).join("\n") || "(none)"}

Memory:
${memories.map((m: any) => `- ${m.title}: ${(m.content || "").slice(0, 200)}`).join("\n") || "(none)"}

Already-known editorial domains to skip: ${[...existingHosts].join(", ") || "(none)"}
Already-known ad/maps keywords to skip: ${[...existingAdKeywords].map((k) => k.split("::")[1]).join(", ") || "(none)"}

Rules:
- For editorial sources: prefer publishers in the user's region; avoid social networks, search engines, marketplaces, government, education sites; return a real working https URL.
- For ad/maps keyword sources: tailor keywords to the user's target audience and region (include city/country when local intent matters). Keep keywords short (2-6 words).`;

    const aiRes = await fetch(LOVABLE_AI, {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: "Suggest 6-8 candidate intel sources now." },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_sources",
            description: "Return a list of intel source candidates.",
            parameters: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      url: { type: "string" },
                      why_relevant: { type: "string" },
                      type: { type: "string", enum: ["news", "blog", "directory", "listicle"] },
                    },
                    required: ["name", "url", "why_relevant", "type"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["suggestions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_sources" } },
      }),
    });

    if (aiRes.status === 429) return json(429, { error: "Rate limit — try again shortly." });
    if (aiRes.status === 402) return json(402, { error: "AI credits exhausted — top up to continue." });
    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("AI gateway error", aiRes.status, t);
      return json(500, { error: "AI suggestion failed" });
    }

    const aiJson = await aiRes.json();
    const tcalls = aiJson.choices?.[0]?.message?.tool_calls;
    let raw: Suggestion[] = [];
    if (tcalls?.[0]?.function?.arguments) {
      try {
        const parsed = JSON.parse(tcalls[0].function.arguments);
        raw = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      } catch (e) {
        console.error("Failed to parse AI suggestions", e);
      }
    }

    // 3. Filter dupes / blocked, then validate with Firecrawl /v2/map (parallel, capped)
    const HARD_BLOCK = ["facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "youtube.com", "tiktok.com", "google.com", "bing.com", "wikipedia.org", "amazon.com", "ebay.com"];

    const candidates: Suggestion[] = [];
    const seen = new Set<string>();
    for (const s of raw) {
      if (!s?.url || !s?.name) continue;
      let url = s.url.trim();
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      const host = rootDomain(url);
      if (!host) continue;
      if (existingHosts.has(host)) continue;
      if (HARD_BLOCK.some((b) => host === b || host.endsWith(`.${b}`))) continue;
      if (seen.has(host)) continue;
      seen.add(host);
      candidates.push({ ...s, url, name: s.name.trim() });
      if (candidates.length >= 8) break;
    }

    const validateOne = async (c: Suggestion): Promise<Suggestion | null> => {
      try {
        const r = await fetch(`${FIRECRAWL_V2}/map`, {
          method: "POST",
          headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: c.url, limit: 5 }),
        });
        if (!r.ok) return null;
        const j = await r.json();
        const links = j?.links ?? j?.data?.links ?? [];
        if (!Array.isArray(links) || links.length === 0) return null;
        return c;
      } catch (_e) {
        return null;
      }
    };

    const validated = (await Promise.all(candidates.map(validateOne))).filter(Boolean) as Suggestion[];

    return json(200, { suggestions: validated });
  } catch (e) {
    console.error("discover-intel-sources error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
