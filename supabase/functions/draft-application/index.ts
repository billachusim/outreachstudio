// Drafts a tailored job application (cover letter + tailored bullets) for a
// given job_post. Stores the result as a pitch row tied to the lead that
// scan-jobs created for this post.
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

    const { data: job } = await supabase
      .from("job_posts").select("*").eq("id", job_post_id).eq("user_id", user.id).maybeSingle();
    if (!job) return json(404, { error: "Job post not found" });

    // Fetch lead for this post
    const { data: lead } = await supabase
      .from("leads").select("id, campaign_id").eq("job_post_id", job_post_id).eq("user_id", user.id).maybeSingle();

    // Optional: enrich description via Firecrawl if too short
    let fullDescription = job.description ?? "";
    if (FIRECRAWL_API_KEY && fullDescription.length < 400 && job.url) {
      try {
        const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: job.url, formats: ["markdown"], onlyMainContent: true }),
        });
        if (r.ok) {
          const d = await r.json();
          const md = d?.data?.markdown ?? d?.markdown ?? "";
          if (md) fullDescription = md.slice(0, 6000);
        }
      } catch (e) { console.error("draft-application: scrape", e); }
    }

    // Pull freelance profile memory
    const { data: mem } = await supabase
      .from("agent_memories").select("content").eq("user_id", user.id).eq("slug", "freelance-senior-engineer").maybeSingle();
    const profile = mem?.content || "";

    const ai = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You write concise, human-sounding job applications for a senior software engineer applying directly (not as a vendor). Sound like a person, not a sales pitch. No flattery, no 'I'm excited to', no generic AI phrases ('passionate about', 'cutting-edge', 'leverage', 'in today's fast-paced'), no marketing voice. Plain prose. Return STRICT JSON only." },
          { role: "user", content:
`CANDIDATE PROFILE:
${profile.slice(0, 3500)}

JOB POSTING:
Title: ${job.title}
Company: ${job.company ?? ""}
Location: ${job.location ?? ""}
Salary: ${job.salary_text ?? ""}
URL: ${job.url}
Description:
${fullDescription.slice(0, 4500)}

Write an application. Return JSON:
{
  "subject": "string — format exactly: 'Application: <Role Title> — <Candidate Name>'. Use the role from the job posting and the candidate's name from the profile. Plain. No emoji.",
  "cover_letter": "string (<= 200 words, 3-4 short paragraphs, plain prose. Para 1: one line on who I am + why this role. Para 2-3: address 2-3 specific requirements from THIS JD with concrete prior work. Final line: availability + ask (intro call). Sign with first name only.)",
  "tailored_bullets": ["3-5 resume bullets, each <= 22 words, framed to match THIS role. Numbers > adjectives. No 'spearheaded' / 'leveraged'."]
}` },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!ai.ok) {
      const t = await ai.text();
      return json(ai.status, { error: `AI: ${t.slice(0, 300)}` });
    }
    const aj = await ai.json();
    let out: any = {};
    try { out = JSON.parse(aj?.choices?.[0]?.message?.content ?? "{}"); }
    catch { return json(500, { error: "AI returned non-JSON" }); }

    const bullets = (out.tailored_bullets || []).map((b: string) => `• ${b}`).join("\n");
    const fullBody = `${out.cover_letter || ""}\n\n— Highlights —\n${bullets}`;

    // Save as a pitch on the lead, if we have one
    let pitchId: string | null = null;
    if (lead?.id) {
      const { data: pitch, error } = await supabase.from("pitches").insert({
        user_id: user.id,
        lead_id: lead.id,
        subject: out.subject || `Application: ${job.title}`,
        body: fullBody,
      }).select("id").single();
      if (!error && pitch) pitchId = pitch.id;
    }

    const draftPayload = {
      subject: out.subject || `Application: ${job.title}`,
      cover_letter: out.cover_letter ?? "",
      tailored_bullets: out.tailored_bullets ?? [],
      apply_email: job.apply_email,
      apply_url: job.apply_url,
      pitch_id: pitchId,
    };
    await supabase.from("job_posts").update({
      status: "drafted",
      draft: draftPayload,
      draft_updated_at: new Date().toISOString(),
    }).eq("id", job_post_id);

    return json(200, {
      ok: true,
      subject: out.subject,
      cover_letter: out.cover_letter,
      tailored_bullets: out.tailored_bullets,
      pitch_id: pitchId,
      apply_email: job.apply_email,
      apply_url: job.apply_url,
    });
  } catch (e) {
    console.error("draft-application error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown" });
  }
});
