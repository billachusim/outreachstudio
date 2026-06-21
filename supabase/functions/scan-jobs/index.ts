// Scans remote-job boards (defaults + user's intel_sources where kind='job_board')
// via Firecrawl, extracts postings, scores each against the user's freelance
// profile, dedupes into `job_posts`, and creates `leads` rows under the
// user's `job_hunt` campaign for posts scoring >= 60.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DEFAULT_JOB_BOARDS = [
  { name: "Remote OK", url: "https://remoteok.com/remote-dev-jobs" },
  { name: "We Work Remotely", url: "https://weworkremotely.com/categories/remote-programming-jobs" },
];

type JobItem = {
  title: string;
  company?: string;
  url: string;
  location?: string;
  salary?: string;
  apply_email?: string;
  apply_url?: string;
  posted_at?: string;
  description_snippet?: string;
};

async function firecrawlScrapeJobs(url: string, apiKey: string): Promise<JobItem[]> {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: [{
        type: "json",
        prompt:
          "Extract the latest job postings from this page. Return an array under key `jobs` with fields per posting: title (string), company (string), url (absolute), location (string, may be 'Remote'), salary (string if visible), apply_email (extract any mailto: email if visible, else \"\"), apply_url (the URL where one applies), posted_at (ISO date if shown), description_snippet (1-2 sentences). Limit 20 newest items.",
      }],
      onlyMainContent: true,
    }),
  });
  if (!res.ok) {
    console.error(`firecrawl ${url} → ${res.status}`);
    return [];
  }
  const data = await res.json();
  const items: any[] = data?.data?.json?.jobs ?? data?.json?.jobs ?? [];
  const base = new URL(url);
  const out: JobItem[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it?.title || !it?.url) continue;
    let abs: string;
    try { abs = new URL(it.url, base).toString(); } catch { continue; }
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({
      title: String(it.title).trim().slice(0, 240),
      company: it.company ? String(it.company).slice(0, 160) : undefined,
      url: abs,
      location: it.location || undefined,
      salary: it.salary || undefined,
      apply_email: it.apply_email && /@/.test(it.apply_email) ? String(it.apply_email).trim() : undefined,
      apply_url: it.apply_url ? String(it.apply_url) : abs,
      posted_at: (() => {
        const v = it.posted_at;
        if (!v || typeof v !== "string") return undefined;
        const d = new Date(v);
        return isNaN(d.getTime()) ? undefined : d.toISOString();
      })(),
      description_snippet: it.description_snippet ? String(it.description_snippet).slice(0, 600) : undefined,
    });
  }
  return out;
}

async function runScan(supabase: any, FIRECRAWL_API_KEY: string, LOVABLE_API_KEY: string) {
  // Find users who have a freelance campaign (job_hunt mode)
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, user_id, offering_id")
    .eq("mode", "job_hunt")
    .eq("status", "active");

  if (!campaigns?.length) {
    console.log("scan-jobs: no job_hunt campaigns");
    return;
  }

  let totalJobs = 0, totalLeads = 0;

  for (const camp of campaigns) {
    const userId = camp.user_id;

    // Per-user job_board sources + defaults
    const { data: customSrcs } = await supabase
      .from("intel_sources")
      .select("name, url")
      .eq("user_id", userId)
      .eq("kind", "job_board")
      .eq("enabled", true);

    const sources = [
      ...DEFAULT_JOB_BOARDS,
      ...((customSrcs ?? []).map((s: any) => ({ name: s.name, url: s.url }))),
    ];

    // Scrape all boards
    const settled = await Promise.allSettled(
      sources.map((s) => firecrawlScrapeJobs(s.url, FIRECRAWL_API_KEY).then((jobs) => ({ s, jobs }))),
    );
    const allJobs: Array<JobItem & { source: string }> = [];
    for (const r of settled) {
      if (r.status === "fulfilled") {
        for (const j of r.value.jobs) allJobs.push({ ...j, source: r.value.s.name });
      }
    }
    if (allJobs.length === 0) continue;

    // Dedupe vs existing
    const urls = allJobs.map((j) => j.url);
    const { data: existing } = await supabase
      .from("job_posts").select("url").eq("user_id", userId).in("url", urls);
    const existingSet = new Set((existing ?? []).map((e: any) => e.url));
    const fresh = allJobs.filter((j) => !existingSet.has(j.url));
    if (fresh.length === 0) continue;

    // Pull profile memory + offering
    const [memRes, offRes] = await Promise.all([
      supabase.from("agent_memories").select("content").eq("user_id", userId).eq("slug", "freelance-senior-engineer").maybeSingle(),
      camp.offering_id
        ? supabase.from("offerings").select("title, tagline, problem_solved, trigger_keywords, target_audience").eq("id", camp.offering_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const memory = memRes.data?.content || "";
    const off = offRes.data;
    const offSummary = off
      ? `Title: ${off.title}\nTagline: ${off.tagline ?? ""}\nValue: ${off.problem_solved ?? ""}\nTrigger keywords: ${(off.trigger_keywords ?? []).join(", ")}`
      : "";

    // Score in chunks of 15
    const scores: Array<{ i: number; score: number; reason: string; tags: string[] }> = [];
    const CHUNK = 15;
    for (let start = 0; start < fresh.length; start += CHUNK) {
      const slice = fresh.slice(start, start + CHUNK);
      const ai = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: "You score remote software-engineering job posts for fit against a candidate's freelance profile. Return STRICT JSON only." },
            { role: "user", content:
              `CANDIDATE OFFERING:\n${offSummary}\n\nCANDIDATE PROFILE (CV-derived):\n${memory.slice(0, 3000)}\n\nJOB POSTS (index. title @ company | location | salary | snippet):\n` +
              slice.map((j, i) =>
                `${start + i}. ${j.title} @ ${j.company ?? "?"} | ${j.location ?? "?"} | ${j.salary ?? "?"} | ${j.description_snippet ?? ""}`
              ).join("\n") +
              `\n\nReturn JSON: {"scores":[{"i":0,"score":0-100,"reason":"why","tags":["backend","fintech"]}]}.\nScoring: skills/stack overlap, seniority match, remote eligibility, rate alignment.`,
            },
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
        } catch (e) { console.error("scan-jobs: parse", e); }
      } else {
        console.error("scan-jobs: AI", ai.status);
      }
    }

    // Insert job_posts
    const rows = scores.map((s) => {
      const j = fresh[s.i];
      if (!j) return null;
      const score = Math.max(0, Math.min(100, Number(s.score) || 0));
      return {
        user_id: userId,
        source: j.source,
        title: j.title,
        company: j.company ?? null,
        url: j.url,
        apply_email: j.apply_email ?? null,
        apply_url: j.apply_url ?? null,
        location: j.location ?? null,
        salary_text: j.salary ?? null,
        posted_at: j.posted_at ?? null,
        description: (j.description_snippet ?? "") + (s.reason ? `\n\n[Fit] ${s.reason}` : ""),
        score,
        matched_offering_id: camp.offering_id ?? null,
        status: "new",
        tags: Array.isArray(s.tags) ? s.tags.slice(0, 6) : null,
      };
    }).filter(Boolean);

    if (rows.length === 0) continue;

    const { data: inserted, error } = await supabase
      .from("job_posts")
      .insert(rows as any)
      .select("id, score, title, company, apply_email, apply_url, url");
    if (error) { console.error("scan-jobs insert:", error); continue; }
    totalJobs += inserted?.length ?? 0;

    // Auto-create leads for score >= 60 — but reuse an existing lead for the
    // same company (by root_domain or business_name) so we don't email Stripe
    // twice in a month. If reused, just attach the job_post_id.
    for (const jp of inserted ?? []) {
      if ((jp.score ?? 0) < 60) continue;
      let host: string | null = null;
      try { host = new URL(jp.url).hostname.replace(/^www\./, ""); } catch { /* */ }
      const applyHost = jp.apply_email
        ? jp.apply_email.split("@").pop()?.toLowerCase() ?? null
        : null;
      const candidateDomains = [host, applyHost].filter(Boolean) as string[];

      // Try to find an existing lead for this company (within this user)
      let existingLead: any = null;
      if (candidateDomains.length > 0) {
        const { data: byDomain } = await supabase
          .from("leads").select("id, job_post_id, status")
          .eq("user_id", userId)
          .in("root_domain", candidateDomains)
          .limit(1);
        existingLead = byDomain?.[0] ?? null;
      }
      if (!existingLead && jp.company) {
        const { data: byName } = await supabase
          .from("leads").select("id, job_post_id, status")
          .eq("user_id", userId)
          .ilike("business_name", jp.company)
          .limit(1);
        existingLead = byName?.[0] ?? null;
      }

      if (existingLead) {
        // Attach this job post to the existing lead only if it has none yet.
        if (!existingLead.job_post_id) {
          await supabase.from("leads")
            .update({
              job_post_id: jp.id,
              notes: `Job: ${jp.title}${jp.company ? ` @ ${jp.company}` : ""} (existing company)`,
              last_activity_at: new Date().toISOString(),
            })
            .eq("id", existingLead.id);
        }
        await supabase.from("job_posts").update({ status: "dedup_existing" }).eq("id", jp.id);
        continue;
      }

      const { error: lerr } = await supabase.from("leads").insert({
        user_id: userId,
        campaign_id: camp.id,
        business_name: jp.company || jp.title,
        website: jp.apply_url || jp.url,
        contact_email: jp.apply_email ?? null,
        notes: `Job: ${jp.title}${jp.company ? ` @ ${jp.company}` : ""}`,
        status: jp.apply_email ? "enriched" : "new",
        job_post_id: jp.id,
      });
      if (lerr) console.error("scan-jobs lead insert error", lerr);
      else totalLeads++;
    }
  }

  console.log(`scan-jobs done: ${totalJobs} new posts, ${totalLeads} new leads`);
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  if (!FIRECRAWL_API_KEY) return json(500, { error: "FIRECRAWL_API_KEY missing" });
  // @ts-ignore
  EdgeRuntime.waitUntil(runScan(supabase, FIRECRAWL_API_KEY, LOVABLE_API_KEY));
  return json(202, { ok: true, status: "scan-jobs started" });
});
