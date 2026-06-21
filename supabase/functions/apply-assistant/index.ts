// Apply Assistant: scrapes the job/apply page, then asks Gemini to produce a
// structured "Application Kit" — every question the form asks, with suggested
// values drawn from the candidate's profile + base CV. Flags anything missing
// so the user can backfill their profile.
//
// Input: { job_post_id: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization" });

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "Unauthorized" });

    const { job_post_id } = await req.json();
    if (!job_post_id) return json(400, { error: "job_post_id required" });

    const { data: job } = await supabase.from("job_posts")
      .select("*").eq("id", job_post_id).eq("user_id", user.id).maybeSingle();
    if (!job) return json(404, { error: "Job post not found" });

    // 1) Scrape the apply page (prefer apply_url, fall back to listing url)
    const targetUrl = job.apply_url || job.url;
    let pageMd = job.description ?? "";
    let pageLinks: string[] = [];
    if (FIRECRAWL_API_KEY && targetUrl) {
      try {
        const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: targetUrl, formats: ["markdown", "links"], onlyMainContent: true }),
        });
        if (r.ok) {
          const d = await r.json();
          const md = d?.data?.markdown ?? d?.markdown ?? "";
          if (md) pageMd = md.slice(0, 8000);
          const links = d?.data?.links ?? d?.links ?? [];
          if (Array.isArray(links)) pageLinks = links.slice(0, 30);
        }
      } catch (e) { console.error("apply-assistant: scrape", e); }
    }

    // 2) Load candidate profile + job-application profile + base CV
    const { data: mems } = await supabase.from("agent_memories")
      .select("slug, content").eq("user_id", user.id)
      .in("slug", ["freelance-senior-engineer", "job-application-profile"]);
    const profile = mems?.find(m => m.slug === "freelance-senior-engineer")?.content || "";
    const jobProfile = mems?.find(m => m.slug === "job-application-profile")?.content || "";
    const { data: prof } = await supabase.from("profiles")
      .select("base_cv_md, display_name").eq("user_id", user.id).maybeSingle();
    const baseCv = prof?.base_cv_md || "";


    // 3) Detect apply method heuristically
    const lowerUrl = (targetUrl || "").toLowerCase();
    let detectedMethod: "form" | "email" | "external_ats" = "form";
    if (job.apply_email) detectedMethod = "email";
    else if (/workday|myworkdayjobs|taleo|icims|smartrecruiters|successfactors/.test(lowerUrl)) detectedMethod = "external_ats";

    // 4) Ask Gemini for the structured kit
    const ai = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: "You are an application-prep assistant for a senior software engineer. Read a scraped job application page and produce a STRUCTURED application kit: every question/field the application asks for, with the candidate's best answer drawn from their profile/CV. Be honest — never fabricate facts. If you don't know, mark needs_user:true with a short hint of what to ask the user. Essay-style answers default to ~150 words, plain prose, no AI cliches ('passionate', 'leverage', 'excited to'). Return STRICT JSON only." },
          { role: "user", content:
`CANDIDATE PROFILE (memory):
${profile.slice(0, 3500)}

JOB-APPLICATION PROFILE (saved answers from prior applications — PREFER these for matching fields):
${jobProfile.slice(0, 3000)}

BASE CV (markdown):
${baseCv.slice(0, 4000)}


CANDIDATE NAME (fallback): ${prof?.display_name ?? ""}

JOB POSTING:
Title: ${job.title}
Company: ${job.company ?? ""}
Location: ${job.location ?? ""}
Salary: ${job.salary_text ?? ""}
URL: ${job.url}
Apply URL: ${job.apply_url ?? ""}
Apply Email: ${job.apply_email ?? ""}
Detected method: ${detectedMethod}

SCRAPED APPLY PAGE (markdown, may include the actual form labels):
${pageMd.slice(0, 7000)}

Output JSON shape:
{
  "apply_method": "form" | "email" | "external_ats",
  "summary": "1-2 sentence plain-English summary of what this application asks for",
  "detected_questions": [
    {
      "label": "human-readable question/field name as it appears (or would appear) on the form",
      "value": "best answer for the candidate, or empty string if unknown",
      "source": "profile" | "cv" | "generated" | "missing",
      "needs_user": false,
      "hint": "if needs_user:true, one short sentence the UI can show to ask the user for this info"
    }
  ],
  "attachments_needed": ["e.g. 'CV (PDF)', 'Cover letter', 'Portfolio link'"],
  "cover_letter": "<=150 word plain-prose cover letter tailored to THIS role, sign with first name only",
  "missing_info": [
    { "field": "short label like 'Desired salary' or 'Work authorization (UK)'",
      "why": "why this job/form needs it",
      "profile_question": "exact question to ask the user to add to their profile so we don't ask next time" }
  ],
  "notes": "operator notes: e.g. 'Workday SSO — manual submit required', 'Greenhouse form detected', or empty"
}

Common fields to always consider when present in the form: Full name, Email, Phone, Location, LinkedIn URL, Portfolio/GitHub, Years of experience (overall + per key skill from JD), Current role/company, Notice period, Work authorization / visa, Salary expectation, Why this company, Why this role, Earliest start date, Pronouns (only if asked).` },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!ai.ok) {
      const t = await ai.text();
      return json(ai.status, { error: `AI: ${t.slice(0, 300)}` });
    }
    const aj = await ai.json();
    let kit: any = {};
    try { kit = JSON.parse(aj?.choices?.[0]?.message?.content ?? "{}"); }
    catch { return json(500, { error: "AI returned non-JSON" }); }

    kit.apply_method = kit.apply_method || detectedMethod;
    kit.apply_url = job.apply_url || job.url;
    kit.apply_email = job.apply_email;
    kit.scraped_links = pageLinks;

    // 5) Persist + mark drafted
    await supabase.from("job_posts").update({
      application_kit: kit,
      application_kit_updated_at: new Date().toISOString(),
      status: "drafted",
    }).eq("id", job_post_id);

    return json(200, { ok: true, kit });
  } catch (e) {
    console.error("apply-assistant error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown" });
  }
});
