// Shared helpers for launching outreach campaigns from intel stories.
// Used by both `launch-campaign-from-intel` (HTTP entrypoint) and `auto-launch-top-triggers` (daily cron).

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type Proposal = {
  matchedOfferingId: string | null;
  newOffering: {
    title: string;
    tagline: string;
    problem_solved: string;
    ideal_customer: string;
    target_audience: string;
    trigger_keywords: string[];
  } | null;
  campaign: {
    name: string;
    city: string | null;
    category: string | null;
    keywords: string;
    discovery_source: "google_places" | "firecrawl";
    channel: "email" | "whatsapp";
  };
  reasoning: string;
};

export async function buildProposal(
  supabase: SupabaseClient,
  userId: string,
  intel: { id: string; title: string; summary: string | null; tags: string[] | null; source: string },
): Promise<{ ok: true; proposal: Proposal } | { ok: false; status: number; error: string }> {
  const [{ data: offerings }, { data: profile }] = await Promise.all([
    supabase
      .from("offerings")
      .select("id, title, tagline, ideal_customer")
      .eq("user_id", userId)
      .eq("status", "active"),
    supabase
      .from("profiles")
      .select("outreach_region, outreach_country_code")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const region = (profile as any)?.outreach_region || "Nigeria";
  const countryCode = (profile as any)?.outreach_country_code || "ng";

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return { ok: false, status: 500, error: "LOVABLE_API_KEY missing" };

  const sys = `You are a B2B outreach strategist. Given a news/intel story and a list of the user's existing offerings, decide:
1. Whether the story matches an existing offering (return its id) OR a brand-new offering should be created.
2. Derive concrete campaign parameters to find leads who would care about this story IN THE USER'S REGION.

CRITICAL GEOGRAPHIC RULES:
- The user operates in ${region} (country code: ${countryCode}). All campaigns must target leads in ${region} unless the intel story is exclusively about another region.
- ALWAYS set "city" — pick a major city in ${region} (e.g. for Nigeria: Lagos, Abuja, Port Harcourt, Ibadan, Kano) if the story doesn't imply a specific one. Never leave city null.
- ALWAYS bias "keywords" toward the region — e.g. "Lagos restaurants", "Abuja fintech startups", NOT just "restaurants" or "fintech".
- ALWAYS set "category" to the business vertical the story implies (use a sensible default if needed, never null).

discovery_source: STRONGLY PREFER "google_places" for any local brick-and-mortar ICP (restaurants, salons, clinics, shops, lounges, schools) — it returns real ${region} businesses with phone + address out of the gate. Use "firecrawl" only for online-native businesses, B2B SaaS, agencies, or media.
channel: "email" by default, "whatsapp" only if the lead profile is small local business with strong WhatsApp culture (very common in ${region}).`;

  const usr = `INTEL STORY:
Title: ${intel.title}
Source: ${intel.source}
Summary: ${intel.summary ?? "(none)"}
Tags: ${(intel.tags ?? []).join(", ")}

USER REGION: ${region} (${countryCode.toUpperCase()})

EXISTING OFFERINGS:
${(offerings ?? []).length === 0
  ? "(none)"
  : (offerings ?? []).map((o) => `- ${o.id}: "${o.title}" — ${o.tagline ?? ""} (ICP: ${o.ideal_customer ?? "n/a"})`).join("\n")}

Propose the launch (remember: city + category required, keywords region-biased).`;

  const tool = {
    type: "function",
    function: {
      name: "propose_launch",
      description: "Propose offering choice + campaign params",
      parameters: {
        type: "object",
        properties: {
          matchedOfferingId: { type: ["string", "null"] },
          newOffering: {
            type: ["object", "null"],
            properties: {
              title: { type: "string" },
              tagline: { type: "string" },
              problem_solved: { type: "string" },
              ideal_customer: { type: "string" },
              target_audience: { type: "string" },
              trigger_keywords: { type: "array", items: { type: "string" } },
            },
            required: ["title", "tagline", "problem_solved", "ideal_customer", "target_audience", "trigger_keywords"],
            additionalProperties: false,
          },
          campaign: {
            type: "object",
            properties: {
              name: { type: "string" },
              city: { type: ["string", "null"] },
              category: { type: ["string", "null"] },
              keywords: { type: "string" },
              discovery_source: { type: "string", enum: ["google_places", "firecrawl"] },
              channel: { type: "string", enum: ["email", "whatsapp"] },
            },
            required: ["name", "city", "category", "keywords", "discovery_source", "channel"],
            additionalProperties: false,
          },
          reasoning: { type: "string" },
        },
        required: ["matchedOfferingId", "newOffering", "campaign", "reasoning"],
        additionalProperties: false,
      },
    },
  };

  const aiResp = await fetch(LOVABLE_AI, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "propose_launch" } },
    }),
  });

  if (aiResp.status === 429) return { ok: false, status: 429, error: "AI rate limit — try again in a moment" };
  if (aiResp.status === 402) return { ok: false, status: 402, error: "AI credits exhausted — top up in workspace settings" };
  if (!aiResp.ok) {
    const txt = await aiResp.text();
    return { ok: false, status: 500, error: `AI error: ${txt.slice(0, 200)}` };
  }

  const aiData = await aiResp.json();
  const call = aiData.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return { ok: false, status: 422, error: "AI returned no proposal" };

  let proposal: Proposal;
  try {
    proposal = JSON.parse(call.function.arguments);
  } catch {
    return { ok: false, status: 500, error: "Failed to parse AI proposal" };
  }

  if (!proposal.matchedOfferingId && !proposal.newOffering) {
    return { ok: false, status: 422, error: "AI could not match or invent a sensible offering for this story." };
  }

  return { ok: true, proposal };
}

export async function runLaunch(
  supabase: SupabaseClient,
  userId: string,
  intelItemId: string,
  proposal: Proposal,
  intelTitle: string,
  opts: { autoFromIntel?: boolean } = {},
): Promise<{ ok: true; campaignId: string; runId: string; offeringId: string; offeringCreated: boolean } | { ok: false; status: number; error: string }> {
  let offeringId = proposal.matchedOfferingId;
  let offeringCreated = false;

  if (!offeringId && proposal.newOffering) {
    const no = proposal.newOffering;
    const { data: newOff, error: offErr } = await supabase
      .from("offerings")
      .insert({
        user_id: userId,
        title: no.title,
        tagline: no.tagline,
        problem_solved: no.problem_solved,
        ideal_customer: no.ideal_customer,
        target_audience: no.target_audience,
        trigger_keywords: no.trigger_keywords ?? [],
        status: "draft",
      })
      .select("id")
      .single();
    if (offErr) return { ok: false, status: 500, error: `Offering insert failed: ${offErr.message}` };
    offeringId = newOff.id;
    offeringCreated = true;
  }

  const c = proposal.campaign;
  const campaignName = opts.autoFromIntel ? `Auto: ${c.name}` : c.name;

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .insert({
      user_id: userId,
      offering_id: offeringId,
      name: campaignName,
      city: c.city,
      category: c.category,
      keywords: c.keywords,
      discovery_source: c.discovery_source,
      channel: c.channel,
      status: "active",
      email_cap: 50,
    })
    .select("id")
    .single();
  if (campErr) return { ok: false, status: 500, error: `Campaign insert failed: ${campErr.message}` };

  const { data: run, error: runErr } = await supabase
    .from("campaign_runs")
    .insert({
      user_id: userId,
      campaign_id: campaign.id,
      target_lead_count: 50,
      daily_send_cap: 50,
      state: "queued",
    })
    .select("id")
    .single();
  if (runErr) return { ok: false, status: 500, error: `Run insert failed: ${runErr.message}` };

  await supabase
    .from("intel_items")
    .update({ acted_on: true, spawned_campaign_id: campaign.id })
    .eq("id", intelItemId);

  await supabase.from("run_events").insert({
    user_id: userId,
    run_id: run.id,
    campaign_id: campaign.id,
    kind: opts.autoFromIntel ? "auto_launched_from_intel" : "launched_from_intel",
    level: "info",
    message: `${opts.autoFromIntel ? "Auto-spawned" : "Spawned"} from intel: ${intelTitle.slice(0, 100)}`,
  });

  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/campaign-tick`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ runId: run.id }),
  }).catch(() => {});

  return { ok: true, campaignId: campaign.id, runId: run.id, offeringId: offeringId!, offeringCreated };
}
