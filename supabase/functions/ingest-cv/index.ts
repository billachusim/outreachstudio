// Parses an uploaded CV (PDF/DOCX/TXT) from the `resumes` bucket, then:
//  - upserts a freelance Offering ("Senior Software Engineer — Freelance")
//  - writes structured agent_memories (skills, stack, rate, availability, links)
//  - auto-creates a "Freelance Jobs" campaign in mode='job_hunt' if missing
//
// Input: { storagePath: string }  // e.g. "<uid>/resume.pdf"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const FREELANCE_OFFERING_SLUG = "freelance-senior-engineer";
const FREELANCE_CAMPAIGN_NAME = "Freelance Jobs";

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

    const { storagePath } = await req.json();
    if (!storagePath || typeof storagePath !== "string") return json(400, { error: "storagePath required" });
    if (!storagePath.startsWith(`${user.id}/`)) return json(403, { error: "Not your file" });

    // Download the file
    const { data: file, error: dlErr } = await admin.storage.from("resumes").download(storagePath);
    if (dlErr || !file) return json(404, { error: dlErr?.message ?? "File not found" });

    // Convert to base64 for Gemini
    const buf = new Uint8Array(await file.arrayBuffer());
    let base64 = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      base64 += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    base64 = btoa(base64);

    const mime = storagePath.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : storagePath.toLowerCase().endsWith(".docx")
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : storagePath.toLowerCase().endsWith(".doc")
      ? "application/msword"
      : "text/plain";

    // Ask Gemini to extract structured profile
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "You extract a structured freelance engineer profile from a CV/resume. Return STRICT JSON only with no commentary.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `Read this CV and return JSON with these keys:
{
  "full_name": string,
  "headline": string,                        // one-line professional headline
  "summary": string,                         // 2-3 sentence value prop
  "years_experience": number,
  "primary_stack": string[],                 // 4-8 key technologies
  "all_skills": string[],                    // 8-20 skills
  "preferred_roles": string[],               // e.g. ["Senior Backend Engineer", "Tech Lead"]
  "industries": string[],                    // domains they have shipped in
  "ideal_customer": string,                  // who hires them best (1 sentence)
  "trigger_keywords": string[],              // 6-12 short job-post phrases that signal a great fit (e.g. "remote", "typescript", "fintech", "senior engineer")
  "availability": string,                    // "Full-time", "Part-time", "Contract", "20h/week", etc.
  "rate": string,                            // "$X/hr" or "" if not in CV
  "timezone": string,                        // best guess from location
  "location": string,
  "links": { "github": string, "linkedin": string, "portfolio": string, "email": string },
  "highlights": string[]                     // 3-6 standout resume bullets, role-adaptable
}
If a field is unknown, return "" or [].`,
              },
              { type: "file", file: { filename: storagePath.split("/").pop(), file_data: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      return json(aiRes.status, { error: `AI parse failed: ${t.slice(0, 300)}` });
    }
    const aiJson = await aiRes.json();
    let profile: any = {};
    try {
      profile = JSON.parse(aiJson?.choices?.[0]?.message?.content ?? "{}");
    } catch (_) {
      return json(500, { error: "AI returned non-JSON" });
    }

    // 1. Upsert offering
    const offeringPayload = {
      user_id: user.id,
      title: profile.headline || "Senior Software Engineer — Freelance",
      tagline: profile.summary || "Available for remote contract engineering work.",
      problem_solved: profile.summary || "",
      ideal_customer: profile.ideal_customer || "Startups hiring senior engineers for remote contract work.",
      target_audience: (profile.industries || []).join(", "),
      trigger_keywords: profile.trigger_keywords || [],
      auto_lead_from_intel: false,
      status: "active",
    };

    const { data: existingOff } = await supabase
      .from("offerings")
      .select("id")
      .eq("user_id", user.id)
      .ilike("title", "%freelance%")
      .maybeSingle();

    let offeringId: string;
    if (existingOff?.id) {
      const { error } = await supabase.from("offerings").update(offeringPayload).eq("id", existingOff.id);
      if (error) return json(500, { error: `offering update: ${error.message}` });
      offeringId = existingOff.id;
    } else {
      const { data, error } = await supabase.from("offerings").insert(offeringPayload).select("id").single();
      if (error) return json(500, { error: `offering insert: ${error.message}` });
      offeringId = data.id;
    }

    // 2. Write a single consolidated agent_memory file
    const links = profile.links || {};
    const memoryContent = `# Freelance profile

**Name:** ${profile.full_name || ""}
**Headline:** ${profile.headline || ""}
**Years experience:** ${profile.years_experience ?? "—"}
**Location / TZ:** ${profile.location || ""} / ${profile.timezone || ""}
**Availability:** ${profile.availability || ""}
**Rate:** ${profile.rate || ""}

## Summary
${profile.summary || ""}

## Primary stack
${(profile.primary_stack || []).join(", ")}

## All skills
${(profile.all_skills || []).join(", ")}

## Preferred roles
${(profile.preferred_roles || []).map((r: string) => `- ${r}`).join("\n")}

## Industries
${(profile.industries || []).join(", ")}

## Trigger keywords (matched against job posts)
${(profile.trigger_keywords || []).join(", ")}

## Highlights
${(profile.highlights || []).map((h: string) => `- ${h}`).join("\n")}

## Links
- GitHub: ${links.github || ""}
- LinkedIn: ${links.linkedin || ""}
- Portfolio: ${links.portfolio || ""}
- Email: ${links.email || ""}
`;

    await supabase.from("agent_memories").upsert({
      user_id: user.id,
      slug: FREELANCE_OFFERING_SLUG,
      title: "Freelance profile (from CV)",
      kind: "identity",
      content: memoryContent,
    }, { onConflict: "user_id,slug" });

    // 2b. Cache parsed CV text on the profile for fast tailoring later
    await admin.from("profiles").update({ base_cv_md: memoryContent }).eq("user_id", user.id);

    // 3. Create the Freelance Jobs campaign if missing
    const { data: existingCamp } = await supabase
      .from("campaigns")
      .select("id")
      .eq("user_id", user.id)
      .eq("mode", "job_hunt")
      .maybeSingle();

    let campaignId: string;
    if (existingCamp?.id) {
      await supabase.from("campaigns").update({
        offering_id: offeringId,
        keywords: (profile.trigger_keywords || []).slice(0, 6).join(", "),
      }).eq("id", existingCamp.id);
      campaignId = existingCamp.id;
    } else {
      const { data, error } = await supabase.from("campaigns").insert({
        user_id: user.id,
        name: FREELANCE_CAMPAIGN_NAME,
        offering_id: offeringId,
        keywords: (profile.trigger_keywords || []).slice(0, 6).join(", "),
        category: "Remote Engineering",
        channel: "email",
        discovery_source: "firecrawl",
        auto_followup: false,
        status: "active",
        mode: "job_hunt",
      }).select("id").single();
      if (error) return json(500, { error: `campaign insert: ${error.message}` });
      campaignId = data.id;
    }

    return json(200, { ok: true, offeringId, campaignId, profile });
  } catch (e) {
    console.error("ingest-cv error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown" });
  }
});
