// Tailors the user's base CV to a specific job description.
// Input: { jd_text?: string, job_post_id?: string, save_to_job?: boolean }
// Output: { ok, markdown, summary_of_changes, keyword_match_score }
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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "Unauthorized" });

    const body = await req.json().catch(() => ({}));
    const jdTextIn: string | undefined = body?.jd_text?.toString().trim();
    const jobPostId: string | undefined = body?.job_post_id;
    const saveToJob: boolean = !!body?.save_to_job;

    let jdText = jdTextIn || "";
    let jobMeta: { title?: string; company?: string; location?: string } = {};
    if (jobPostId) {
      const { data: jp } = await supabase
        .from("job_posts")
        .select("title, company, location, description")
        .eq("id", jobPostId).eq("user_id", user.id).maybeSingle();
      if (jp) {
        jobMeta = { title: jp.title, company: jp.company ?? undefined, location: jp.location ?? undefined };
        if (!jdText) jdText = jp.description ?? "";
      }
    }
    if (!jdText || jdText.length < 40) return json(400, { error: "Provide jd_text or a job_post_id with a description (min 40 chars)." });

    // Load base CV: prefer profiles.base_cv_md, fall back to freelance-senior-engineer agent memory
    let baseCv = "";
    const { data: prof } = await supabase
      .from("profiles").select("base_cv_md").eq("user_id", user.id).maybeSingle();
    baseCv = (prof as any)?.base_cv_md || "";
    if (!baseCv) {
      const { data: mem } = await supabase
        .from("agent_memories").select("content")
        .eq("user_id", user.id).eq("slug", "freelance-senior-engineer").maybeSingle();
      baseCv = mem?.content || "";
    }
    if (!baseCv) return json(400, { error: "No base CV on file. Upload your CV first in Jobs → CV & Tailor." });

    const sys = `You are an ATS-savvy resume tailor. You rewrite the candidate's CV to match a specific job description.
Rules:
- Preserve all factual content: dates, employers, education, links. Never fabricate experience, titles, or metrics.
- Reorder and rephrase bullets to surface the most relevant achievements first.
- Mirror exact keywords/phrases from the JD where they truthfully apply.
- Use clean Markdown with sections: # Name, ## Summary, ## Skills, ## Experience, ## Education, ## Projects/Highlights, ## Links.
- Skills section should be a comma-separated list grouped by category if natural.
- Keep it concise: aim for 1-2 pages of plain text when rendered.
Return STRICT JSON: { "markdown": string, "summary_of_changes": string, "keyword_match_score": number (0-100), "matched_keywords": string[] }`;

    const userPrompt = `JOB DESCRIPTION:
${jobMeta.title ? `Title: ${jobMeta.title}\n` : ""}${jobMeta.company ? `Company: ${jobMeta.company}\n` : ""}${jobMeta.location ? `Location: ${jobMeta.location}\n` : ""}
${jdText.slice(0, 8000)}

---

BASE CV / PROFILE:
${baseCv.slice(0, 12000)}

Tailor the CV. Return JSON only.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      if (aiRes.status === 429) return json(429, { error: "Rate limited — try again in a minute." });
      if (aiRes.status === 402) return json(402, { error: "Workspace credits exhausted. Add credits in Settings → Plans & credits." });
      return json(aiRes.status, { error: `AI failed: ${t.slice(0, 300)}` });
    }
    const aiJson = await aiRes.json();
    let out: any = {};
    try { out = JSON.parse(aiJson?.choices?.[0]?.message?.content ?? "{}"); }
    catch { return json(500, { error: "AI returned non-JSON" }); }

    if (!out.markdown) return json(500, { error: "AI returned no markdown" });

    if (saveToJob && jobPostId) {
      await admin.from("job_posts").update({
        tailored_cv_md: out.markdown,
        tailored_cv_updated_at: new Date().toISOString(),
      }).eq("id", jobPostId).eq("user_id", user.id);
    }

    return json(200, {
      ok: true,
      markdown: out.markdown,
      summary_of_changes: out.summary_of_changes ?? "",
      keyword_match_score: typeof out.keyword_match_score === "number" ? out.keyword_match_score : null,
      matched_keywords: Array.isArray(out.matched_keywords) ? out.matched_keywords : [],
    });
  } catch (e) {
    console.error("tailor-cv error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown" });
  }
});
