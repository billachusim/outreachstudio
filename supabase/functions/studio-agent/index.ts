// Studio Agent — chat endpoint with tool calling.
// Conversation history lives in chat_messages; this function loads it,
// appends the new user turn, runs Lovable AI with tools (looping for tool_calls),
// then persists the assistant turn(s).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BASE_SYSTEM_PROMPT = `You are the Studio Agent for Outreach Studio — Bill Achusim's command center for his portfolio of African tech, social, and PR products.

You are a full operator across the entire system. You can read AND tweak almost anything: offerings, campaigns, leads, pitches, channels, intel sources, intel items, social drafts & posts, templates, and your own persistent memory.

## How to behave
- Be concise, direct, and actionable. Use markdown (short headings, tight bullets, tables when useful).
- Always call a tool to fetch real data — never invent leads, counts, campaign names, IDs, intel headlines, or offering details.
- When the user asks "what's going on" / "give me a check-up" / "any suggestions" — proactively call multiple read tools (e.g. get_run_status + summarize_today + list_recent_events + list_recent_intel) and then suggest 1–3 concrete tweaks.
- When the user asks to change something, perform the smallest reversible action and report back what changed. For destructive actions (delete_*, bulk_update_lead_status, send_pitch_now, post_*), briefly confirm in the same turn before acting unless the user was explicit.
- Prefer suggesting + executing over just describing. If a fix is obviously safe (e.g. enable a stalled intel source, pause a failing run, score an un-scored lead, draft a missing pitch) — do it and say what you did.
- If a tool returns nothing useful, say so plainly and suggest the next step.

## Surfaces you can operate
- **Offerings**: list_offerings, get_offering, create_offering, update_offering
- **Campaigns**: list_campaigns, create_campaign, update_campaign, start_outreach, pause_run, resume_run, get_run_status
- **Leads**: list_recent_leads, get_lead, find_similar_leads, enrich_lead_now, score_lead, bulk_update_lead_status
- **Pitches**: draft_pitch_for_lead, send_pitch_now
- **Channels (connected accounts)**: list_channels
- **Intel sources**: list_intel_sources, add_intel_source, toggle_intel_source, delete_intel_source
- **Intel items (news triggers)**: list_recent_intel, draft_pitch_from_intel
- **Social**: list_social_drafts, create_social_draft, post_to_x, post_to_facebook, post_to_instagram
- **Templates (email)**: list_templates, upsert_template, delete_template
- **Messaging**: send_whatsapp
- **Engine**: list_recent_events, summarize_today
- **Memory**: list_memories, search_memories, read_memory, write_memory, append_memory, rename_memory, delete_memory

## Learning loop
You own your memory and must keep it useful over time:
- When you spot a recurring failure, a winning subject line, a new product detail Bill mentions, or an objection pattern → call **append_memory** to add a dated bullet to the relevant playbook.
- For a brand-new topic with no existing file, call **write_memory** with a kebab-case slug like \`objections-retailos\`, \`winning-subjects\`, \`lessons-learned\`, \`tone-feedback\`. Use kind \`playbook\` for SOPs, \`note\` for everything else.
- If a memory file is stale or wrong, call **delete_memory** or **rename_memory**.
- Before dumping all memories into context, prefer **search_memories** with a focused query.
- Always read \`journal-rollup\` (rolling 7-day recap) before suggesting strategy.`;

const TOOLS = [
  { type: "function", function: { name: "list_campaigns", description: "List the user's campaigns.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "create_campaign", description: "Create a new campaign.", parameters: { type: "object", properties: { name: { type: "string" }, offering_id: { type: "string" }, city: { type: "string" }, category: { type: "string" }, keywords: { type: "string" }, channel: { type: "string", enum: ["email", "whatsapp", "x", "facebook", "instagram"] }, discovery_source: { type: "string", enum: ["firecrawl", "google_places"] }, auto_followup: { type: "boolean" } }, required: ["name"], additionalProperties: false } } },
  { type: "function", function: { name: "start_outreach", description: "Queue a new background outreach run for a campaign.", parameters: { type: "object", properties: { campaign_id: { type: "string" }, target_lead_count: { type: "number", default: 20 }, daily_send_cap: { type: "number", default: 5 } }, required: ["campaign_id"], additionalProperties: false } } },
  { type: "function", function: { name: "pause_run", description: "Pause an active run.", parameters: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"], additionalProperties: false } } },
  { type: "function", function: { name: "resume_run", description: "Resume a paused run.", parameters: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"], additionalProperties: false } } },
  { type: "function", function: { name: "get_run_status", description: "Get current status of active runs.", parameters: { type: "object", properties: { run_id: { type: "string" } }, additionalProperties: false } } },
  { type: "function", function: { name: "list_recent_leads", description: "List the most recently created leads.", parameters: { type: "object", properties: { campaign_id: { type: "string" }, limit: { type: "number", default: 10 }, status: { type: "string" }, min_score: { type: "number" } }, additionalProperties: false } } },
  { type: "function", function: { name: "list_recent_events", description: "List recent engine events.", parameters: { type: "object", properties: { limit: { type: "number", default: 15 } }, additionalProperties: false } } },
  { type: "function", function: { name: "draft_pitch_for_lead", description: "Draft (or revise) a cold email pitch for a lead. Saves it as a pitch row. Returns subject and body.", parameters: { type: "object", properties: { lead_id: { type: "string" }, tone: { type: "string" }, instructions: { type: "string" } }, required: ["lead_id"], additionalProperties: false } } },
  { type: "function", function: { name: "send_pitch_now", description: "Send a saved pitch now (Resend). Pitch must already be drafted.", parameters: { type: "object", properties: { pitch_id: { type: "string" } }, required: ["pitch_id"], additionalProperties: false } } },
  { type: "function", function: { name: "enrich_lead_now", description: "Force-enrich a lead via Firecrawl scrape. Updates contact email + notes.", parameters: { type: "object", properties: { lead_id: { type: "string" } }, required: ["lead_id"], additionalProperties: false } } },
  { type: "function", function: { name: "score_lead", description: "Recompute a lead's quality score.", parameters: { type: "object", properties: { lead_id: { type: "string" } }, required: ["lead_id"], additionalProperties: false } } },
  { type: "function", function: { name: "bulk_update_lead_status", description: "Update status on many leads at once.", parameters: { type: "object", properties: { lead_ids: { type: "array", items: { type: "string" } }, status: { type: "string", enum: ["new", "enriched", "drafted", "sent", "opened", "replied", "won", "lost"] } }, required: ["lead_ids", "status"], additionalProperties: false } } },
  { type: "function", function: { name: "send_whatsapp", description: "Send a WhatsApp message to a lead.", parameters: { type: "object", properties: { lead_id: { type: "string" }, body: { type: "string" } }, required: ["lead_id", "body"], additionalProperties: false } } },
  { type: "function", function: { name: "post_to_x", description: "Post to X (Twitter).", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } } },
  { type: "function", function: { name: "post_to_facebook", description: "Post to a Facebook page.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } } },
  { type: "function", function: { name: "post_to_instagram", description: "Post to Instagram (image_url required).", parameters: { type: "object", properties: { caption: { type: "string" }, image_url: { type: "string" } }, required: ["caption", "image_url"], additionalProperties: false } } },
  { type: "function", function: { name: "summarize_today", description: "Summarize today's pipeline activity (sends, opens, replies, top leads).", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "find_similar_leads", description: "Find leads with similar category/keywords to the given lead.", parameters: { type: "object", properties: { lead_id: { type: "string" }, limit: { type: "number", default: 10 } }, required: ["lead_id"], additionalProperties: false } } },
  { type: "function", function: { name: "list_memories", description: "List all persistent memory files.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "read_memory", description: "Read a memory file by slug.", parameters: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"], additionalProperties: false } } },
  { type: "function", function: { name: "write_memory", description: "Create or update a persistent memory file (full content replace).", parameters: { type: "object", properties: { slug: { type: "string" }, title: { type: "string" }, kind: { type: "string", enum: ["identity", "personality", "portfolio", "playbook", "note"] }, content: { type: "string" } }, required: ["slug", "title", "kind", "content"], additionalProperties: false } } },
  { type: "function", function: { name: "append_memory", description: "Append a dated bullet (or block) to an existing memory file. Cheaper + safer than rewriting. Auto-prefixes with today's date.", parameters: { type: "object", properties: { slug: { type: "string" }, content: { type: "string" } }, required: ["slug", "content"], additionalProperties: false } } },
  { type: "function", function: { name: "delete_memory", description: "Delete a memory file by slug. Use for stale or duplicate notes.", parameters: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"], additionalProperties: false } } },
  { type: "function", function: { name: "rename_memory", description: "Rename a memory's slug and/or title.", parameters: { type: "object", properties: { slug: { type: "string" }, new_slug: { type: "string" }, new_title: { type: "string" } }, required: ["slug"], additionalProperties: false } } },
  { type: "function", function: { name: "search_memories", description: "Search memory files by case-insensitive substring across title, slug, and content. Returns matching slugs + snippets.", parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", default: 8 } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "list_recent_intel", description: "List recent intel items (news triggers) for the user, newest first. Use to find the right intel item before drafting a pitch.", parameters: { type: "object", properties: { limit: { type: "number", default: 10 }, min_score: { type: "number" }, only_unactioned: { type: "boolean", default: true } }, additionalProperties: false } } },
  { type: "function", function: { name: "draft_pitch_from_intel", description: "Draft a PR/outreach pitch grounded in a specific intel item (news headline). Pass either intel_item_id, OR a headline_query to fuzzy-match the latest intel by title. Optionally pin to an offering and lead. If save=true, persists the pitch on the lead as a draft.", parameters: { type: "object", properties: { intel_item_id: { type: "string" }, headline_query: { type: "string" }, offering_id: { type: "string" }, lead_id: { type: "string" }, save: { type: "boolean", default: false } }, additionalProperties: false } } },

  // Offerings
  { type: "function", function: { name: "list_offerings", description: "List the user's offerings (products/services).", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "get_offering", description: "Get a single offering by id.", parameters: { type: "object", properties: { offering_id: { type: "string" } }, required: ["offering_id"], additionalProperties: false } } },
  { type: "function", function: { name: "create_offering", description: "Create a new offering.", parameters: { type: "object", properties: { title: { type: "string" }, tagline: { type: "string" }, problem_solved: { type: "string" }, ideal_customer: { type: "string" }, target_audience: { type: "string" }, pricing: { type: "string" }, demo_url: { type: "string" }, trigger_keywords: { type: "array", items: { type: "string" } }, auto_lead_from_intel: { type: "boolean" } }, required: ["title"], additionalProperties: false } } },
  { type: "function", function: { name: "update_offering", description: "Update fields on an offering. Only pass fields you want to change.", parameters: { type: "object", properties: { offering_id: { type: "string" }, title: { type: "string" }, tagline: { type: "string" }, problem_solved: { type: "string" }, ideal_customer: { type: "string" }, target_audience: { type: "string" }, pricing: { type: "string" }, demo_url: { type: "string" }, status: { type: "string" }, trigger_keywords: { type: "array", items: { type: "string" } }, auto_lead_from_intel: { type: "boolean" } }, required: ["offering_id"], additionalProperties: false } } },

  // Campaign update
  { type: "function", function: { name: "update_campaign", description: "Update a campaign (rename, change channel, toggle auto_followup, change status, update city/category/keywords).", parameters: { type: "object", properties: { campaign_id: { type: "string" }, name: { type: "string" }, city: { type: "string" }, category: { type: "string" }, keywords: { type: "string" }, channel: { type: "string", enum: ["email", "whatsapp", "x", "facebook", "instagram"] }, status: { type: "string", enum: ["active", "paused", "archived"] }, auto_followup: { type: "boolean" }, offering_id: { type: "string" } }, required: ["campaign_id"], additionalProperties: false } } },

  // Lead detail
  { type: "function", function: { name: "get_lead", description: "Get full detail for a single lead (contact, notes, pitches, latest events).", parameters: { type: "object", properties: { lead_id: { type: "string" } }, required: ["lead_id"], additionalProperties: false } } },

  // Channels
  { type: "function", function: { name: "list_channels", description: "List connected channel accounts (email, whatsapp, x, facebook, instagram, telegram, linkedin) with status. Does NOT return credentials.", parameters: { type: "object", properties: {}, additionalProperties: false } } },

  // Intel sources
  { type: "function", function: { name: "list_intel_sources", description: "List user's intel sources (feeds we scan for news triggers).", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "add_intel_source", description: "Add a new intel source URL.", parameters: { type: "object", properties: { name: { type: "string" }, url: { type: "string" }, enabled: { type: "boolean", default: true }, auto_promoted: { type: "boolean", default: false } }, required: ["name", "url"], additionalProperties: false } } },
  { type: "function", function: { name: "toggle_intel_source", description: "Enable or disable an intel source.", parameters: { type: "object", properties: { source_id: { type: "string" }, enabled: { type: "boolean" } }, required: ["source_id", "enabled"], additionalProperties: false } } },
  { type: "function", function: { name: "delete_intel_source", description: "Delete an intel source.", parameters: { type: "object", properties: { source_id: { type: "string" } }, required: ["source_id"], additionalProperties: false } } },

  // Social drafts
  { type: "function", function: { name: "list_social_drafts", description: "List recent social drafts (queued, draft, posted, failed).", parameters: { type: "object", properties: { status: { type: "string" }, platform: { type: "string" }, limit: { type: "number", default: 15 } }, additionalProperties: false } } },
  { type: "function", function: { name: "create_social_draft", description: "Create a social draft (does not post). Use platform: x, facebook, instagram, telegram, linkedin.", parameters: { type: "object", properties: { platform: { type: "string" }, body: { type: "string" }, intel_item_id: { type: "string" } }, required: ["platform", "body"], additionalProperties: false } } },

  // Templates
  { type: "function", function: { name: "list_templates", description: "List the user's email templates.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "upsert_template", description: "Create or update an email template. If template_id is omitted, creates a new one.", parameters: { type: "object", properties: { template_id: { type: "string" }, name: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["name"], additionalProperties: false } } },
  { type: "function", function: { name: "delete_template", description: "Delete an email template.", parameters: { type: "object", properties: { template_id: { type: "string" } }, required: ["template_id"], additionalProperties: false } } },
];

async function executeTool(name: string, args: any, ctx: { supabase: any; userId: string; tickUrl: string; serviceKey: string; supaUrl: string; authHeader: string }) {
  const { supabase, userId } = ctx;
  const invoke = async (fn: string, body: any) => {
    const r = await fetch(`${ctx.supaUrl}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ctx.authHeader },
      body: JSON.stringify(body),
    });
    return r.json().catch(() => ({}));
  };
  switch (name) {
    case "list_campaigns": {
      const { data } = await supabase.from("campaigns").select("id, name, city, category, channel, offering_id, auto_followup").eq("user_id", userId).order("created_at", { ascending: false });
      return data ?? [];
    }
    case "create_campaign": {
      const { data, error } = await supabase.from("campaigns").insert({
        user_id: userId, name: args.name, offering_id: args.offering_id ?? null,
        city: args.city ?? null, category: args.category ?? null, keywords: args.keywords ?? null,
        channel: args.channel ?? "email", discovery_source: args.discovery_source ?? "firecrawl",
        auto_followup: args.auto_followup ?? true, status: "active",
      }).select("id, name").single();
      return error ? { error: error.message } : data;
    }
    case "start_outreach": {
      const { campaign_id, target_lead_count = 20, daily_send_cap = 5 } = args;
      const { data: camp } = await supabase.from("campaigns").select("id, name").eq("id", campaign_id).eq("user_id", userId).maybeSingle();
      if (!camp) return { error: "Campaign not found" };
      const { data: run, error } = await supabase.from("campaign_runs")
        .insert({ user_id: userId, campaign_id, target_lead_count, daily_send_cap, state: "queued" })
        .select("id").single();
      if (error) return { error: error.message };
      fetch(ctx.tickUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.serviceKey}` }, body: JSON.stringify({ runId: run.id }) }).catch(() => {});
      return { run_id: run.id, campaign: camp.name, message: "Outreach queued. Engine ticks every minute." };
    }
    case "pause_run": {
      const { error } = await supabase.from("campaign_runs").update({ state: "paused" }).eq("id", args.run_id).eq("user_id", userId);
      return error ? { error: error.message } : { ok: true };
    }
    case "resume_run": {
      const { error } = await supabase.from("campaign_runs").update({ state: "queued", error: null }).eq("id", args.run_id).eq("user_id", userId);
      if (error) return { error: error.message };
      fetch(ctx.tickUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.serviceKey}` }, body: JSON.stringify({ runId: args.run_id }) }).catch(() => {});
      return { ok: true };
    }
    case "get_run_status": {
      let q = supabase.from("campaign_runs").select("*").eq("user_id", userId);
      if (args?.run_id) q = q.eq("id", args.run_id);
      else q = q.in("state", ["queued", "discovering", "enriching", "drafting", "sending", "paused"]);
      const { data } = await q.order("updated_at", { ascending: false });
      return data ?? [];
    }
    case "list_recent_leads": {
      let q = supabase.from("leads").select("id, business_name, contact_email, status, score, last_activity_at, website, campaign_id").eq("user_id", userId);
      if (args?.campaign_id) q = q.eq("campaign_id", args.campaign_id);
      if (args?.status) q = q.eq("status", args.status);
      if (typeof args?.min_score === "number") q = q.gte("score", args.min_score);
      const { data } = await q.order("score", { ascending: false }).order("created_at", { ascending: false }).limit(args?.limit ?? 10);
      return data ?? [];
    }
    case "list_recent_events": {
      const { data } = await supabase.from("run_events").select("kind, message, level, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(args?.limit ?? 15);
      return data ?? [];
    }
    case "draft_pitch_for_lead": {
      const r = await invoke("draft-pitch", { leadId: args.lead_id, tone: args.tone ?? null, save: true, instructions: args.instructions ?? null });
      return r;
    }
    case "send_pitch_now": {
      const r = await invoke("send-pitch", { pitchId: args.pitch_id });
      return r;
    }
    case "enrich_lead_now": {
      const r = await invoke("enrich-lead", { leadId: args.lead_id });
      return r;
    }
    case "score_lead": {
      const { data: s } = await supabase.rpc("compute_lead_score", { _lead_id: args.lead_id });
      if (typeof s === "number") {
        await supabase.from("leads").update({ score: s }).eq("id", args.lead_id).eq("user_id", userId);
        return { lead_id: args.lead_id, score: s };
      }
      return { error: "compute failed" };
    }
    case "bulk_update_lead_status": {
      const { error, count } = await supabase.from("leads").update({ status: args.status }).in("id", args.lead_ids).eq("user_id", userId).select("id", { count: "exact", head: true });
      return error ? { error: error.message } : { updated: count ?? args.lead_ids.length };
    }
    case "send_whatsapp": {
      const r = await invoke("send-whatsapp", { leadId: args.lead_id, body: args.body });
      return r;
    }
    case "post_to_x": {
      const r = await invoke("post-x", { text: args.text });
      return r;
    }
    case "post_to_facebook": {
      const r = await invoke("post-facebook", { text: args.text });
      return r;
    }
    case "post_to_instagram": {
      const r = await invoke("post-instagram", { caption: args.caption, image_url: args.image_url });
      return r;
    }
    case "summarize_today": {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const since = start.toISOString();
      const [pitchesRes, eventsRes, runsRes, topRes] = await Promise.all([
        supabase.from("pitches").select("id, sent_at").eq("user_id", userId).gte("sent_at", since),
        supabase.from("pitch_events").select("event_type").eq("user_id", userId).gte("occurred_at", since),
        supabase.from("campaign_runs").select("state").eq("user_id", userId).gte("updated_at", since),
        supabase.from("leads").select("id, business_name, score, status").eq("user_id", userId).gte("last_activity_at", since).order("score", { ascending: false }).limit(5),
      ]);
      const events = eventsRes.data ?? [];
      return {
        sent: pitchesRes.data?.length ?? 0,
        opens: events.filter((e: any) => e.event_type === "opened").length,
        replies: events.filter((e: any) => e.event_type === "replied").length,
        bounces: events.filter((e: any) => e.event_type === "bounced").length,
        active_runs: (runsRes.data ?? []).filter((r: any) => !["done", "failed"].includes(r.state)).length,
        warm_leads: topRes.data ?? [],
      };
    }
    case "find_similar_leads": {
      const { data: src } = await supabase.from("leads").select("campaign_id, business_name").eq("id", args.lead_id).eq("user_id", userId).maybeSingle();
      if (!src) return { error: "lead not found" };
      const { data } = await supabase.from("leads").select("id, business_name, contact_email, status, score").eq("user_id", userId).eq("campaign_id", src.campaign_id).neq("id", args.lead_id).order("score", { ascending: false }).limit(args.limit ?? 10);
      return data ?? [];
    }
    case "list_memories": {
      const { data } = await supabase.from("agent_memories").select("slug, title, kind, updated_at").eq("user_id", userId).order("kind").order("updated_at", { ascending: false });
      return data ?? [];
    }
    case "read_memory": {
      const { data } = await supabase.from("agent_memories").select("slug, title, kind, content, updated_at").eq("user_id", userId).eq("slug", args.slug).maybeSingle();
      return data ?? { error: `No memory with slug '${args.slug}'` };
    }
    case "write_memory": {
      const { slug, title, kind, content } = args;
      const { data: existing } = await supabase.from("agent_memories").select("id").eq("user_id", userId).eq("slug", slug).maybeSingle();
      if (existing) {
        const { error } = await supabase.from("agent_memories").update({ title, kind, content }).eq("id", existing.id);
        return error ? { error: error.message } : { ok: true, updated: slug };
      }
      const { error } = await supabase.from("agent_memories").insert({ user_id: userId, slug, title, kind, content });
      return error ? { error: error.message } : { ok: true, created: slug };
    }
    case "append_memory": {
      const { slug, content } = args;
      const { data: existing } = await supabase.from("agent_memories").select("id, content").eq("user_id", userId).eq("slug", slug).maybeSingle();
      const today = new Date().toISOString().slice(0, 10);
      const block = `\n\n_${today}_ — ${content}`;
      if (!existing) {
        const { error } = await supabase.from("agent_memories").insert({
          user_id: userId, slug, title: slug, kind: "note", content: `# ${slug}${block}`,
        });
        return error ? { error: error.message } : { ok: true, created: slug };
      }
      const newContent = (existing.content ?? "") + block;
      const { error } = await supabase.from("agent_memories").update({ content: newContent }).eq("id", existing.id);
      return error ? { error: error.message } : { ok: true, appended: slug, length: newContent.length };
    }
    case "delete_memory": {
      const { error } = await supabase.from("agent_memories").delete().eq("user_id", userId).eq("slug", args.slug);
      return error ? { error: error.message } : { ok: true, deleted: args.slug };
    }
    case "rename_memory": {
      const update: any = {};
      if (args.new_slug) update.slug = args.new_slug;
      if (args.new_title) update.title = args.new_title;
      if (!Object.keys(update).length) return { error: "Provide new_slug or new_title" };
      const { error } = await supabase.from("agent_memories").update(update).eq("user_id", userId).eq("slug", args.slug);
      return error ? { error: error.message } : { ok: true, renamed: args.slug, to: update };
    }
    case "search_memories": {
      const q = String(args.query ?? "").trim();
      if (!q) return [];
      const { data } = await supabase.from("agent_memories")
        .select("slug, title, kind, content, updated_at")
        .eq("user_id", userId)
        .or(`title.ilike.%${q}%,slug.ilike.%${q}%,content.ilike.%${q}%`)
        .limit(args.limit ?? 8);
      return (data ?? []).map((m: any) => {
        const idx = m.content.toLowerCase().indexOf(q.toLowerCase());
        const snippet = idx >= 0 ? m.content.slice(Math.max(0, idx - 60), idx + 200) : m.content.slice(0, 200);
        return { slug: m.slug, title: m.title, kind: m.kind, snippet, updated_at: m.updated_at };
      });
    }
    case "list_recent_intel": {
      let q = supabase.from("intel_items")
        .select("id, source, title, url, relevance_score, matched_offerings, linked_lead_id, acted_on, created_at")
        .eq("user_id", userId);
      if (args?.only_unactioned !== false) q = q.eq("acted_on", false);
      if (typeof args?.min_score === "number") q = q.gte("relevance_score", args.min_score);
      const { data } = await q.order("relevance_score", { ascending: false }).order("created_at", { ascending: false }).limit(args?.limit ?? 10);
      return data ?? [];
    }
    case "draft_pitch_from_intel": {
      let intelItemId: string | null = args.intel_item_id ?? null;
      if (!intelItemId && args.headline_query) {
        const { data: matches } = await supabase
          .from("intel_items").select("id, title").eq("user_id", userId)
          .ilike("title", `%${String(args.headline_query).slice(0, 80)}%`)
          .order("created_at", { ascending: false }).limit(1);
        intelItemId = matches?.[0]?.id ?? null;
      }
      if (!intelItemId) return { error: "Provide intel_item_id or a headline_query that matches a recent intel item. Use list_recent_intel to browse." };
      const r = await invoke("draft-pitch-from-intel", {
        intelItemId,
        offeringId: args.offering_id ?? null,
        leadId: args.lead_id ?? null,
        save: !!args.save,
      });
      return r;
    }

    // ---------- Offerings ----------
    case "list_offerings": {
      const { data } = await supabase.from("offerings")
        .select("id, title, tagline, status, trigger_keywords, auto_lead_from_intel, ideal_customer, pricing, updated_at")
        .eq("user_id", userId).order("updated_at", { ascending: false });
      return data ?? [];
    }
    case "get_offering": {
      const { data } = await supabase.from("offerings").select("*").eq("id", args.offering_id).eq("user_id", userId).maybeSingle();
      return data ?? { error: "Offering not found" };
    }
    case "create_offering": {
      const { data, error } = await supabase.from("offerings").insert({
        user_id: userId,
        title: args.title,
        tagline: args.tagline ?? null,
        problem_solved: args.problem_solved ?? null,
        ideal_customer: args.ideal_customer ?? null,
        target_audience: args.target_audience ?? null,
        pricing: args.pricing ?? null,
        demo_url: args.demo_url ?? null,
        trigger_keywords: args.trigger_keywords ?? [],
        auto_lead_from_intel: args.auto_lead_from_intel ?? false,
        status: "active",
      }).select("id, title").single();
      return error ? { error: error.message } : data;
    }
    case "update_offering": {
      const patch: any = {};
      for (const k of ["title","tagline","problem_solved","ideal_customer","target_audience","pricing","demo_url","status","trigger_keywords","auto_lead_from_intel"]) {
        if (args[k] !== undefined) patch[k] = args[k];
      }
      if (!Object.keys(patch).length) return { error: "No fields to update" };
      const { error } = await supabase.from("offerings").update(patch).eq("id", args.offering_id).eq("user_id", userId);
      return error ? { error: error.message } : { ok: true, updated: args.offering_id, fields: Object.keys(patch) };
    }

    // ---------- Campaign update ----------
    case "update_campaign": {
      const patch: any = {};
      for (const k of ["name","city","category","keywords","channel","status","auto_followup","offering_id"]) {
        if (args[k] !== undefined) patch[k] = args[k];
      }
      if (!Object.keys(patch).length) return { error: "No fields to update" };
      const { error } = await supabase.from("campaigns").update(patch).eq("id", args.campaign_id).eq("user_id", userId);
      return error ? { error: error.message } : { ok: true, updated: args.campaign_id, fields: Object.keys(patch) };
    }

    // ---------- Lead detail ----------
    case "get_lead": {
      const { data: lead } = await supabase.from("leads").select("*").eq("id", args.lead_id).eq("user_id", userId).maybeSingle();
      if (!lead) return { error: "Lead not found" };
      const { data: pitches } = await supabase.from("pitches").select("id, subject, body, status, sent_at, created_at").eq("lead_id", args.lead_id).order("created_at", { ascending: false }).limit(5);
      const { data: events } = await supabase.from("pitch_events").select("event_type, occurred_at").eq("user_id", userId).order("occurred_at", { ascending: false }).limit(10);
      return { lead, pitches: pitches ?? [], recent_pitch_events: events ?? [] };
    }

    // ---------- Channels ----------
    case "list_channels": {
      const { data } = await supabase.from("channel_accounts")
        .select("id, channel, display_name, status, external_id, updated_at")
        .eq("user_id", userId).order("channel");
      return data ?? [];
    }

    // ---------- Intel sources ----------
    case "list_intel_sources": {
      const { data } = await supabase.from("intel_sources")
        .select("id, name, url, enabled, auto_promoted, created_at")
        .eq("user_id", userId).order("created_at", { ascending: false });
      return data ?? [];
    }
    case "add_intel_source": {
      const { data, error } = await supabase.from("intel_sources").insert({
        user_id: userId, name: args.name, url: args.url,
        enabled: args.enabled ?? true, auto_promoted: args.auto_promoted ?? false,
      }).select("id, name, url").single();
      return error ? { error: error.message } : data;
    }
    case "toggle_intel_source": {
      const { error } = await supabase.from("intel_sources").update({ enabled: !!args.enabled }).eq("id", args.source_id).eq("user_id", userId);
      return error ? { error: error.message } : { ok: true, source_id: args.source_id, enabled: !!args.enabled };
    }
    case "delete_intel_source": {
      const { error } = await supabase.from("intel_sources").delete().eq("id", args.source_id).eq("user_id", userId);
      return error ? { error: error.message } : { ok: true, deleted: args.source_id };
    }

    // ---------- Social drafts ----------
    case "list_social_drafts": {
      let q = supabase.from("social_drafts")
        .select("id, platform, body, status, posted_at, provider_post_id, intel_item_id, created_at")
        .eq("user_id", userId);
      if (args?.status) q = q.eq("status", args.status);
      if (args?.platform) q = q.eq("platform", args.platform);
      const { data } = await q.order("created_at", { ascending: false }).limit(args?.limit ?? 15);
      return data ?? [];
    }
    case "create_social_draft": {
      const { data, error } = await supabase.from("social_drafts").insert({
        user_id: userId, platform: args.platform, body: args.body,
        intel_item_id: args.intel_item_id ?? null, status: "draft",
      }).select("id, platform, status").single();
      return error ? { error: error.message } : data;
    }

    // ---------- Templates ----------
    case "list_templates": {
      const { data } = await supabase.from("templates").select("id, name, subject, body, updated_at").eq("user_id", userId).order("updated_at", { ascending: false });
      return data ?? [];
    }
    case "upsert_template": {
      if (args.template_id) {
        const patch: any = {};
        if (args.name !== undefined) patch.name = args.name;
        if (args.subject !== undefined) patch.subject = args.subject;
        if (args.body !== undefined) patch.body = args.body;
        const { error } = await supabase.from("templates").update(patch).eq("id", args.template_id).eq("user_id", userId);
        return error ? { error: error.message } : { ok: true, updated: args.template_id };
      }
      const { data, error } = await supabase.from("templates").insert({
        user_id: userId, name: args.name, subject: args.subject ?? null, body: args.body ?? null,
      }).select("id, name").single();
      return error ? { error: error.message } : data;
    }
    case "delete_template": {
      const { error } = await supabase.from("templates").delete().eq("id", args.template_id).eq("user_id", userId);
      return error ? { error: error.message } : { ok: true, deleted: args.template_id };
    }

    default: return { error: `Unknown tool ${name}` };
  }
}

interface ReqBody { conversationId: string; userMessage: string; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY not configured" });
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { error: "Missing Authorization" });

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json(401, { error: "Unauthorized" });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { conversationId, userMessage } = (await req.json()) as ReqBody;
    if (!conversationId || !userMessage?.trim()) return json(400, { error: "conversationId and userMessage required" });

    const { data: convo } = await supabase.from("chat_conversations").select("id, user_id").eq("id", conversationId).maybeSingle();
    if (!convo || convo.user_id !== user.id) return json(403, { error: "Forbidden" });

    await supabase.from("chat_messages").insert({
      user_id: user.id, conversation_id: conversationId, role: "user", content: userMessage,
    });

    const { data: history } = await supabase
      .from("chat_messages").select("role, content, tool_calls, tool_name, tool_call_id")
      .eq("conversation_id", conversationId).order("created_at");

    const { data: memRows } = await supabase
      .from("agent_memories").select("slug, title, kind, content").eq("user_id", user.id).order("kind");
    let systemPrompt = BASE_SYSTEM_PROMPT;
    if (memRows?.length) {
      const memBlock = memRows.map((m: any) => `### ${m.title}\n_(slug: ${m.slug}, kind: ${m.kind})_\n\n${m.content}`).join("\n\n---\n\n");
      systemPrompt += `\n\n## Persistent memory\n\n${memBlock}`;
    }

    const messages: any[] = [{ role: "system", content: systemPrompt }];
    for (const m of history ?? []) {
      if (m.role === "tool") messages.push({ role: "tool", content: m.content, tool_call_id: m.tool_call_id, name: m.tool_name });
      else if (m.role === "assistant") {
        const msg: any = { role: "assistant", content: m.content };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        messages.push(msg);
      } else messages.push({ role: m.role, content: m.content });
    }

    const tickUrl = `${SUPABASE_URL}/functions/v1/campaign-tick`;
    const ctx = { supabase, userId: user.id, tickUrl, serviceKey: SERVICE_KEY, supaUrl: SUPABASE_URL, authHeader };

    let finalContent = "";
    for (let i = 0; i < 4; i++) {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-flash", messages, tools: TOOLS }),
      });

      if (!aiRes.ok) {
        if (aiRes.status === 429) return json(429, { error: "Rate limit. Try again in a moment." });
        if (aiRes.status === 402) return json(402, { error: "AI credits exhausted." });
        const t = await aiRes.text();
        console.error("AI error", aiRes.status, t);
        return json(500, { error: "AI gateway error" });
      }

      const aiJson = await aiRes.json();
      const choice = aiJson?.choices?.[0]?.message;
      if (!choice) return json(500, { error: "AI returned no message" });

      const toolCalls = choice.tool_calls ?? [];
      if (toolCalls.length === 0) {
        finalContent = choice.content ?? "";
        await supabase.from("chat_messages").insert({
          user_id: user.id, conversation_id: conversationId, role: "assistant", content: finalContent,
        });
        await supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
        break;
      }

      await supabase.from("chat_messages").insert({
        user_id: user.id, conversation_id: conversationId, role: "assistant", content: choice.content ?? "", tool_calls: toolCalls,
      });
      messages.push({ role: "assistant", content: choice.content ?? "", tool_calls: toolCalls });

      for (const tc of toolCalls) {
        const name = tc.function?.name;
        let args: any = {};
        try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch {}
        const result = await executeTool(name, args, ctx);
        const resultStr = JSON.stringify(result).slice(0, 6000);
        await supabase.from("chat_messages").insert({
          user_id: user.id, conversation_id: conversationId, role: "tool",
          content: resultStr, tool_name: name, tool_call_id: tc.id,
        });
        messages.push({ role: "tool", content: resultStr, tool_call_id: tc.id, name });
      }
    }

    return json(200, { ok: true, content: finalContent });
  } catch (e) {
    console.error("studio-agent error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
