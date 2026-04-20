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
You help the user manage offerings, campaigns, leads, drafts, and sends.
You have tools to start campaigns, check status, list leads/events, pause/resume runs, send a single pitch, draft pitches, score leads, post to social channels, summarize the day, and read/write your own persistent memory files.
Be concise and direct. Use markdown. When the user asks about progress, call get_run_status, list_recent_events, or summarize_today first.
Never invent leads, counts, or campaign names — always call a tool. If a tool returns nothing useful, say so plainly.
When the user shares a preference, a new fact about a product, or asks you to remember something, call write_memory to persist it. When unsure who Bill is or what a product does, call read_memory or list_memories before guessing.`;

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
  { type: "function", function: { name: "write_memory", description: "Create or update a persistent memory file.", parameters: { type: "object", properties: { slug: { type: "string" }, title: { type: "string" }, kind: { type: "string", enum: ["identity", "personality", "portfolio", "playbook", "note"] }, content: { type: "string" } }, required: ["slug", "title", "kind", "content"], additionalProperties: false } } },
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
