// Drafts a PR/outreach pitch grounded in an intel article + matched offering + memory.
// Returns { subject, body }. Optionally saves a `pitches` row when leadId is supplied.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Body {
  intelItemId: string;
  offeringId?: string | null;
  leadId?: string | null;
  save?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY missing" });

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { error: "Missing Authorization" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "Unauthorized" });

    const { intelItemId, offeringId, leadId, save } = (await req.json()) as Body;
    if (!intelItemId) return json(400, { error: "intelItemId required" });

    const { data: intel } = await supabase
      .from("intel_items").select("*").eq("id", intelItemId).maybeSingle();
    if (!intel) return json(404, { error: "Intel not found" });

    let chosenOfferingId = offeringId ?? intel.matched_offerings?.[0] ?? null;
    let offering: any = null;
    if (chosenOfferingId) {
      const { data } = await supabase.from("offerings").select("*").eq("id", chosenOfferingId).maybeSingle();
      offering = data;
    }

    let lead: any = null;
    if (leadId) {
      const { data } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
      lead = data;
    } else if (intel.linked_lead_id) {
      const { data } = await supabase.from("leads").select("*").eq("id", intel.linked_lead_id).maybeSingle();
      lead = data;
    }

    const { data: memRows } = await supabase
      .from("agent_memories").select("title, content").eq("user_id", user.id).limit(6);
    const memBlock = (memRows ?? []).map((m: any) => `### ${m.title}\n${String(m.content).slice(0, 500)}`).join("\n\n");

    const offeringBlock = offering
      ? `OFFERING TO PITCH\nTitle: ${offering.title}\nTagline: ${offering.tagline ?? ""}\nProblem solved: ${offering.problem_solved ?? ""}\nIdeal customer: ${offering.ideal_customer ?? ""}\nDemo: ${offering.demo_url ?? ""}\nTestimonial: ${offering.testimonial ?? ""}`
      : "OFFERING: (none — pitch the most relevant angle from the user's identity)";

    const leadBlock = lead
      ? `LEAD\nBusiness: ${lead.business_name}\nContact: ${lead.contact_name ?? "(unknown)"}\nNotes: ${lead.notes ?? ""}`
      : "LEAD: (no specific lead — write so it can be sent to the company/people in the article)";

    const intelBlock = `INTEL TRIGGER\nHeadline: ${intel.title}\nSource: ${intel.source}\nURL: ${intel.url ?? ""}\nSummary: ${intel.summary ?? ""}\nTags: ${(intel.tags ?? []).join(", ")}`;

    const userPrompt = `You're drafting a timely pitch off a fresh news story. Reference the article naturally in the opening line — the prospect just made news, congratulate or react authentically before pivoting to relevance. Keep it under 130 words. One clear CTA.

${intelBlock}

${offeringBlock}

${leadBlock}

${memBlock ? `WRITER IDENTITY / MEMORY\n${memBlock}` : ""}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an expert PR + cold-outreach copywriter. Lead with the news hook. No corporate jargon. No 'I hope this finds you well'. Be human." },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_pitch",
            description: "Return the drafted pitch.",
            parameters: {
              type: "object",
              properties: {
                subject: { type: "string", description: "Subject under 60 chars, references the news." },
                body: { type: "string", description: "Plain text body with line breaks. No signature placeholder." },
              },
              required: ["subject", "body"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_pitch" } },
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) return json(429, { error: "Rate limit." });
      if (aiRes.status === 402) return json(402, { error: "AI credits exhausted." });
      return json(500, { error: `AI error ${aiRes.status}` });
    }
    const aiJson = await aiRes.json();
    const argsStr = aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return json(500, { error: "AI returned no pitch" });
    const parsed = JSON.parse(argsStr) as { subject: string; body: string };

    let pitchId: string | null = null;
    if (save && lead) {
      const { data: pitchRow, error: insErr } = await supabase
        .from("pitches")
        .insert({ user_id: user.id, lead_id: lead.id, subject: parsed.subject, body: parsed.body })
        .select("id").single();
      if (insErr) return json(500, { error: insErr.message });
      pitchId = pitchRow.id;
      await supabase.from("intel_items").update({ linked_pitch_id: pitchId, acted_on: true }).eq("id", intelItemId);
      if (lead.status === "new" || lead.status === "enriched") {
        await supabase.from("leads").update({ status: "drafted" }).eq("id", lead.id);
      }
    }

    return json(200, { subject: parsed.subject, body: parsed.body, pitchId, saved: !!pitchId });
  } catch (e) {
    console.error("draft-pitch-from-intel error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
