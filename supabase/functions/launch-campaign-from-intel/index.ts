// Auto-launch a full outreach campaign from an intel story.
// Flow: load intel + offerings → AI matches/invents an offering and derives campaign params
// → create offering (if new) → create campaign + queued run → mark intel acted → kick campaign-tick.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
  const { data: offerings } = await supabase
    .from("offerings")
    .select("id, title, tagline, ideal_customer")
    .eq("user_id", userId)
    .eq("status", "active");

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return { ok: false, status: 500, error: "LOVABLE_API_KEY missing" };

  const sys = `You are a B2B outreach strategist. Given a news/intel story and a list of the user's existing offerings, decide:
1. Whether the story matches an existing offering (return its id) OR a brand-new offering should be created.
2. Derive concrete campaign parameters to find leads who would care about this story.

Be concrete. Pick city/category only if clearly implied. Keywords should be 2-5 short search terms (comma-separated).
discovery_source: use "google_places" if the campaign targets local brick-and-mortar businesses (restaurants, salons, clinics, shops in a specific city). Use "firecrawl" otherwise (online businesses, B2B SaaS, agencies).
channel: "email" by default, "whatsapp" only if the lead profile is small local business in an emerging market.`;

  const usr = `INTEL STORY:
Title: ${intel.title}
Source: ${intel.source}
Summary: ${intel.summary ?? "(none)"}
Tags: ${(intel.tags ?? []).join(", ")}

EXISTING OFFERINGS:
${(offerings ?? []).length === 0
  ? "(none)"
  : (offerings ?? []).map((o) => `- ${o.id}: "${o.title}" — ${o.tagline ?? ""} (ICP: ${o.ideal_customer ?? "n/a"})`).join("\n")}

Propose the launch.`;

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
      email_cap: 20,
    })
    .select("id")
    .single();
  if (campErr) return { ok: false, status: 500, error: `Campaign insert failed: ${campErr.message}` };

  const { data: run, error: runErr } = await supabase
    .from("campaign_runs")
    .insert({
      user_id: userId,
      campaign_id: campaign.id,
      target_lead_count: 20,
      daily_send_cap: 20,
      state: "queued",
    })
    .select("id")
    .single();
  if (runErr) return { ok: false, status: 500, error: `Run insert failed: ${runErr.message}` };

  // Mark intel acted + link to spawned campaign
  await supabase
    .from("intel_items")
    .update({ acted_on: true, spawned_campaign_id: campaign.id })
    .eq("id", intelItemId);

  // Log event
  await supabase.from("run_events").insert({
    user_id: userId,
    run_id: run.id,
    campaign_id: campaign.id,
    kind: opts.autoFromIntel ? "auto_launched_from_intel" : "launched_from_intel",
    level: "info",
    message: `${opts.autoFromIntel ? "Auto-spawned" : "Spawned"} from intel: ${intelTitle.slice(0, 100)}`,
  });

  // Fire-and-forget tick
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json(401, { error: "Missing Authorization" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return json(401, { error: "Unauthorized" });
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { intelItemId, dryRun = false, proposal: clientProposal } = body as {
      intelItemId?: string;
      dryRun?: boolean;
      proposal?: Proposal;
    };

    if (!intelItemId) return json(400, { error: "intelItemId required" });

    // Load intel
    const { data: intel, error: intelErr } = await supabase
      .from("intel_items")
      .select("id, title, summary, tags, source, url, matched_offerings")
      .eq("id", intelItemId)
      .maybeSingle();
    if (intelErr || !intel) return json(404, { error: "Intel not found" });

    let proposal: Proposal;

    if (clientProposal && !dryRun) {
      proposal = clientProposal;
    } else {
      const built = await buildProposal(supabase, userId, intel);
      if (!built.ok) return json(built.status, { error: built.error });
      proposal = built.proposal;
    }

    if (dryRun) {
      return json(200, { proposal });
    }

    const result = await runLaunch(supabase, userId, intelItemId, proposal, intel.title);
    if (!result.ok) return json(result.status, { error: result.error });

    return json(200, {
      campaignId: result.campaignId,
      runId: result.runId,
      offeringId: result.offeringId,
      offeringCreated: result.offeringCreated,
    });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
