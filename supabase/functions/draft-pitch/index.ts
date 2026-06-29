import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface DraftBody {
  leadId: string;
  templateId?: string | null;
  tone?: string | null;
  save?: boolean;
  // Optional revision context: when present, the AI will revise this pitch
  // instead of writing one from scratch.
  basePitch?: { subject?: string | null; body?: string | null } | null;
  instructions?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("Supabase env not configured");
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as DraftBody;
    if (!body?.leadId) {
      return new Response(JSON.stringify({ error: "leadId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", body.leadId)
      .maybeSingle();
    if (leadErr || !lead) {
      return new Response(JSON.stringify({ error: "Lead not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let offering: any = null;
    if (lead.campaign_id) {
      const { data: camp } = await supabase
        .from("campaigns")
        .select("offering_id")
        .eq("id", lead.campaign_id)
        .maybeSingle();
      if (camp?.offering_id) {
        const { data: off } = await supabase
          .from("offerings")
          .select("*")
          .eq("id", camp.offering_id)
          .maybeSingle();
        offering = off;
      }
    }

    let template: any = null;
    if (body.templateId) {
      const { data: tpl } = await supabase
        .from("templates")
        .select("*")
        .eq("id", body.templateId)
        .maybeSingle();
      template = tpl;
    }

    const offeringBlock = offering
      ? `OFFERING
Title: ${offering.title}
Tagline: ${offering.tagline ?? ""}
Problem solved: ${offering.problem_solved ?? ""}
Target audience: ${offering.target_audience ?? ""}
Ideal customer: ${offering.ideal_customer ?? ""}
Pricing: ${offering.pricing ?? ""}
Demo URL: ${offering.demo_url ?? ""}
Testimonial: ${offering.testimonial ?? ""}`
      : "OFFERING: (none linked to this lead's campaign — write a generic but warm intro)";

    const ad = (lead as any).ad_context as
      | { platform?: string; ad_copy?: string | null; landing_page?: string | null; cta?: string | null; started_at?: string | null }
      | null
      | undefined;
    const adBlock = ad?.platform
      ? `
ACTIVE-ADVERTISER SIGNAL
This prospect is actively running ads on ${ad.platform}${ad.started_at ? ` since ${ad.started_at}` : ""}.
${ad.ad_copy ? `Recent ad copy: "${String(ad.ad_copy).slice(0, 400)}"` : ""}
${ad.landing_page ? `Landing page: ${ad.landing_page}` : ""}
${ad.cta ? `CTA: ${ad.cta}` : ""}
Open with a natural, one-line reference to what they're advertising — never say "I saw your ad" verbatim, weave it in.`
      : "";

    const leadBlock = `LEAD
Business: ${lead.business_name}
Contact name: ${lead.contact_name ?? "(unknown)"}
Website: ${lead.website ?? ""}
Address: ${lead.address ?? ""}
Notes (research): ${lead.notes ?? ""}${adBlock}`;

    const templateBlock = template
      ? `TEMPLATE STYLE REFERENCE (use as tone/structure guide, not verbatim)
Subject: ${template.subject ?? ""}
Body:\n${template.body ?? ""}`
      : "";

    const toneLine = body.tone ? `Tone: ${body.tone}` : "Tone: warm, concise, professional, no fluff";

    const isRevision = !!(body.basePitch && (body.basePitch.subject || body.basePitch.body));

    const systemPrompt = isRevision
      ? `You are an expert B2B cold-email copywriter. You will REVISE an existing cold email pitch based on the user's instructions. Preserve what works, change what they ask for. Keep it human, not templated. Avoid corporate jargon, avoid superlatives, no "I hope this email finds you well". Lead with relevance. Keep body under 130 words. End with one clear, low-friction call to action. Do NOT invent facts about the prospect — only use what's provided.`
      : `You are an expert B2B cold-email copywriter. Write a short, personalized cold email pitch that feels human, not templated. Avoid corporate jargon, avoid superlatives, no "I hope this email finds you well". Lead with relevance to the prospect's business. Keep body under 130 words. End with one clear, low-friction call to action (e.g. a 15-min call or a reply). Do NOT invent facts about the prospect — only use what's provided.`;

    const revisionBlock = isRevision
      ? `EXISTING PITCH TO REVISE
Subject: ${body.basePitch?.subject ?? ""}
Body:
${body.basePitch?.body ?? ""}

REVISION INSTRUCTIONS
${body.instructions?.trim() || "Improve clarity, tighten copy, keep tone."}`
      : "";

    const userPrompt = `${toneLine}

${offeringBlock}

${leadBlock}

${templateBlock}

${revisionBlock}

${isRevision ? "Return the revised cold email pitch now." : "Write the cold email pitch now."}`;

    const aiRes = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "return_pitch",
                description: "Return the drafted cold email pitch.",
                parameters: {
                  type: "object",
                  properties: {
                    subject: {
                      type: "string",
                      description: "Email subject line, under 60 chars, specific to the prospect.",
                    },
                    body: {
                      type: "string",
                      description: "Email body in plain text. Use line breaks. No signature placeholder.",
                    },
                  },
                  required: ["subject", "body"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "return_pitch" } },
        }),
      },
    );

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit hit. Try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiRes.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add credits in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errText = await aiRes.text();
      console.error("AI gateway error", aiRes.status, errText);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    const argsStr = toolCall?.function?.arguments;
    if (!argsStr) {
      console.error("No tool call returned", JSON.stringify(aiJson).slice(0, 500));
      return new Response(JSON.stringify({ error: "AI did not return a pitch" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const parsed = JSON.parse(argsStr) as { subject: string; body: string };

    if (body.save) {
      const { error: insErr } = await supabase.from("pitches").insert({
        user_id: userData.user.id,
        lead_id: lead.id,
        subject: parsed.subject,
        body: parsed.body,
      });
      if (insErr) {
        console.error("pitch insert failed", insErr);
        return new Response(JSON.stringify({ error: insErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (lead.status === "new") {
        await supabase.from("leads").update({ status: "drafted" }).eq("id", lead.id);
      }
    }

    return new Response(
      JSON.stringify({ subject: parsed.subject, body: parsed.body, saved: !!body.save }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("draft-pitch error", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
