// Studio Agent — chat endpoint with tool calling.
// Tools: list_campaigns, start_outreach, pause_run, resume_run, get_run_status,
//        list_recent_leads, list_recent_events, send_pitch_now.
//
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
You have tools to start campaigns, check status, list leads/events, pause/resume runs, send a single pitch, and read/write your own persistent memory files.
Be concise and direct. Use markdown. When the user asks about progress, call get_run_status or list_recent_events first.
Never invent leads, counts, or campaign names — always call a tool. If a tool returns nothing useful, say so plainly.
When the user shares a preference, a new fact about a product, or asks you to remember something, call write_memory to persist it. When unsure who Bill is or what a product does, call read_memory or list_memories before guessing.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_campaigns",
      description: "List the user's campaigns with id, name, city, category, and offering.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "start_outreach",
      description: "Queue a new background outreach run for a campaign. Will discover leads, enrich, draft, and send.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "The campaign UUID to run" },
          target_lead_count: { type: "number", description: "How many leads to target. Default 20.", default: 20 },
          daily_send_cap: { type: "number", description: "Max emails per day. Default 5 during warm-up.", default: 5 },
        },
        required: ["campaign_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pause_run",
      description: "Pause an active run.",
      parameters: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "resume_run",
      description: "Resume a paused run.",
      parameters: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_run_status",
      description: "Get the current status of all active runs (or a specific run if run_id given).",
      parameters: {
        type: "object",
        properties: { run_id: { type: "string", description: "Optional run UUID" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_leads",
      description: "List the most recently created leads, optionally for a campaign.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string" },
          limit: { type: "number", default: 10 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_events",
      description: "List the most recent activity events from the engine (sends, drafts, discoveries, errors).",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", default: 15 } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_memories",
      description: "List all persistent memory files (slug, title, kind). Use this to discover what context you already have.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_memory",
      description: "Read the full markdown content of one memory file by slug.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_memory",
      description: "Create or update a persistent memory file. Use kind=note for new learnings; identity/personality/portfolio/playbook only when explicitly updating those.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Unique slug (lowercase, hyphens). Reusing an existing slug overwrites it." },
          title: { type: "string" },
          kind: { type: "string", enum: ["identity", "personality", "portfolio", "playbook", "note"] },
          content: { type: "string", description: "Full markdown content." },
        },
        required: ["slug", "title", "kind", "content"],
        additionalProperties: false,
      },
    },
  },
];

async function executeTool(name: string, args: any, ctx: { supabase: any; userId: string; tickUrl: string; serviceKey: string }) {
  const { supabase, userId } = ctx;
  switch (name) {
    case "list_campaigns": {
      const { data } = await supabase
        .from("campaigns")
        .select("id, name, city, category, offering_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      return data ?? [];
    }
    case "start_outreach": {
      const { campaign_id, target_lead_count = 20, daily_send_cap = 5 } = args;
      const { data: camp } = await supabase
        .from("campaigns").select("id, name").eq("id", campaign_id).eq("user_id", userId).maybeSingle();
      if (!camp) return { error: "Campaign not found" };
      const { data: run, error } = await supabase
        .from("campaign_runs")
        .insert({ user_id: userId, campaign_id, target_lead_count, daily_send_cap, state: "queued" })
        .select("id")
        .single();
      if (error) return { error: error.message };
      // Kick off immediately
      fetch(ctx.tickUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.serviceKey}` },
        body: JSON.stringify({ runId: run.id }),
      }).catch(() => {});
      return { run_id: run.id, campaign: camp.name, message: "Outreach queued. The engine ticks every minute." };
    }
    case "pause_run": {
      const { error } = await supabase.from("campaign_runs")
        .update({ state: "paused" }).eq("id", args.run_id).eq("user_id", userId);
      return error ? { error: error.message } : { ok: true };
    }
    case "resume_run": {
      const { error } = await supabase.from("campaign_runs")
        .update({ state: "queued", error: null }).eq("id", args.run_id).eq("user_id", userId);
      if (error) return { error: error.message };
      fetch(ctx.tickUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.serviceKey}` },
        body: JSON.stringify({ runId: args.run_id }),
      }).catch(() => {});
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
      let q = supabase.from("leads")
        .select("id, business_name, contact_email, status, website, campaign_id")
        .eq("user_id", userId);
      if (args?.campaign_id) q = q.eq("campaign_id", args.campaign_id);
      const { data } = await q.order("created_at", { ascending: false }).limit(args?.limit ?? 10);
      return data ?? [];
    }
    case "list_recent_events": {
      const { data } = await supabase
        .from("run_events").select("kind, message, level, created_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(args?.limit ?? 15);
      return data ?? [];
    }
    case "list_memories": {
      const { data } = await supabase
        .from("agent_memories").select("slug, title, kind, updated_at")
        .eq("user_id", userId).order("kind").order("updated_at", { ascending: false });
      return data ?? [];
    }
    case "read_memory": {
      const { data } = await supabase
        .from("agent_memories").select("slug, title, kind, content, updated_at")
        .eq("user_id", userId).eq("slug", args.slug).maybeSingle();
      return data ?? { error: `No memory with slug '${args.slug}'` };
    }
    case "write_memory": {
      const { slug, title, kind, content } = args;
      const { data: existing } = await supabase
        .from("agent_memories").select("id").eq("user_id", userId).eq("slug", slug).maybeSingle();
      if (existing) {
        const { error } = await supabase.from("agent_memories")
          .update({ title, kind, content }).eq("id", existing.id);
        return error ? { error: error.message } : { ok: true, updated: slug };
      }
      const { error } = await supabase.from("agent_memories")
        .insert({ user_id: userId, slug, title, kind, content });
      return error ? { error: error.message } : { ok: true, created: slug };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

interface ReqBody {
  conversationId: string;
  userMessage: string;
}

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

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json(401, { error: "Unauthorized" });

    // Service client for tool execution (RLS still scoped manually by user_id checks)
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { conversationId, userMessage } = (await req.json()) as ReqBody;
    if (!conversationId || !userMessage?.trim()) return json(400, { error: "conversationId and userMessage required" });

    // Verify conversation ownership
    const { data: convo } = await supabase.from("chat_conversations").select("id, user_id").eq("id", conversationId).maybeSingle();
    if (!convo || convo.user_id !== user.id) return json(403, { error: "Forbidden" });

    // Persist user message
    await supabase.from("chat_messages").insert({
      user_id: user.id, conversation_id: conversationId, role: "user", content: userMessage,
    });

    // Load history
    const { data: history } = await supabase
      .from("chat_messages").select("role, content, tool_calls, tool_name, tool_call_id")
      .eq("conversation_id", conversationId).order("created_at");

    const messages: any[] = [{ role: "system", content: SYSTEM_PROMPT }];
    for (const m of history ?? []) {
      if (m.role === "tool") {
        messages.push({ role: "tool", content: m.content, tool_call_id: m.tool_call_id, name: m.tool_name });
      } else if (m.role === "assistant") {
        const msg: any = { role: "assistant", content: m.content };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        messages.push(msg);
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }

    const tickUrl = `${SUPABASE_URL}/functions/v1/campaign-tick`;
    const ctx = { supabase, userId: user.id, tickUrl, serviceKey: SERVICE_KEY };

    // Tool-calling loop (max 4 iterations to avoid runaway)
    let finalContent = "";
    for (let i = 0; i < 4; i++) {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          tools: TOOLS,
        }),
      });

      if (!aiRes.ok) {
        if (aiRes.status === 429) return json(429, { error: "Rate limit. Try again in a moment." });
        if (aiRes.status === 402) return json(402, { error: "AI credits exhausted. Add credits in Settings → Workspace → Usage." });
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
        // Persist assistant message
        await supabase.from("chat_messages").insert({
          user_id: user.id, conversation_id: conversationId, role: "assistant", content: finalContent,
        });
        // Bump convo updated_at
        await supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
        break;
      }

      // Persist assistant tool-call message
      await supabase.from("chat_messages").insert({
        user_id: user.id, conversation_id: conversationId, role: "assistant", content: choice.content ?? "",
        tool_calls: toolCalls,
      });
      messages.push({ role: "assistant", content: choice.content ?? "", tool_calls: toolCalls });

      // Execute every tool call, persist results
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
      // Loop again so the model can summarize tool results
    }

    return json(200, { ok: true, content: finalContent });
  } catch (e) {
    console.error("studio-agent error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
