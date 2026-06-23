// Daily 18:00 WAT agent. For each active user with today's briefing:
//   1) Use AI to classify the briefing's "next actions" into a fixed action vocab.
//   2) Insert each into briefing_actions (idempotent per user+date).
//   3) Execute pending actions immediately.
// v1: only `send_followups` actually runs. Other types are queued as `skipped`
// so the surface stays stable when we turn them on.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { filterActiveUsers } from "../_shared/active-user.ts";

const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { "Content-Type": "application/json" } });

const SUPPORTED_TYPES = [
  "send_followups",
  "draft_pitch_for_warm_leads",
  "launch_campaign_from_intel",
  "apply_to_top_jobs",
] as const;
type ActionType = typeof SUPPORTED_TYPES[number];

const AUTO_RUN: Record<ActionType, boolean> = {
  send_followups: true,
  draft_pitch_for_warm_leads: false,
  launch_campaign_from_intel: false,
  apply_to_top_jobs: false,
};

async function extractActions(LOVABLE_API_KEY: string, body: string, metrics: any): Promise<{ action_type: ActionType; reason: string }[]> {
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: `You extract concrete next-actions from a morning briefing and map them to a fixed vocabulary. Only return actions explicitly suggested or strongly implied. Do not invent actions. Vocabulary: ${SUPPORTED_TYPES.join(", ")}. Use "send_followups" when the briefing mentions following up, nudging, or chasing replies on cold emails / sequences. Use "draft_pitch_for_warm_leads" for drafting new pitches to high-score leads. Use "launch_campaign_from_intel" for acting on fresh news triggers. Use "apply_to_top_jobs" for job-application actions. Drop anything else.` },
          { role: "user", content: `BRIEFING:\n${body}\n\nMETRICS:\n${JSON.stringify(metrics)}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_actions",
            parameters: {
              type: "object",
              properties: {
                actions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      action_type: { type: "string", enum: SUPPORTED_TYPES as unknown as string[] },
                      reason: { type: "string", description: "1-sentence quote/paraphrase from the briefing" },
                    },
                    required: ["action_type", "reason"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["actions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_actions" } },
      }),
    });
    if (!res.ok) return [];
    const j = await res.json();
    const argsStr = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return [];
    const parsed = JSON.parse(argsStr);
    const out: { action_type: ActionType; reason: string }[] = [];
    const seen = new Set<string>();
    for (const a of parsed.actions ?? []) {
      if (!SUPPORTED_TYPES.includes(a.action_type)) continue;
      if (seen.has(a.action_type)) continue;
      seen.add(a.action_type);
      out.push({ action_type: a.action_type, reason: String(a.reason ?? "").slice(0, 280) });
    }
    return out;
  } catch (e) {
    console.error("extractActions failed", e);
    return [];
  }
}

async function runAction(supabase: any, SUPABASE_URL: string, SERVICE_KEY: string, row: any): Promise<{ status: "done" | "failed" | "skipped"; result: any }> {
  if (!AUTO_RUN[row.action_type as ActionType]) {
    return { status: "skipped", result: { reason: "action type not auto-run in v1" } };
  }
  if (row.action_type === "send_followups") {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/follow-up-tick`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { status: "failed", result: { http: res.status, body } };
      return { status: "done", result: body };
    } catch (e) {
      return { status: "failed", result: { error: e instanceof Error ? e.message : String(e) } };
    }
  }
  return { status: "skipped", result: { reason: "no handler" } };
}

async function runJob(supabase: any, SUPABASE_URL: string, SERVICE_KEY: string, LOVABLE_API_KEY: string, force: boolean) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: briefings } = await supabase
      .from("daily_briefings")
      .select("id, user_id, body, metrics, briefing_date")
      .eq("briefing_date", today);
    if (!briefings || briefings.length === 0) {
      console.log("execute-briefing-actions: no briefings for", today);
      return;
    }

    const allIds = Array.from(new Set(briefings.map((b: any) => b.user_id))) as string[];
    const activeIds = force ? allIds : await filterActiveUsers(supabase, allIds, 14);
    const activeSet = new Set(activeIds);

    let queued = 0, ran = 0;
    for (const b of briefings) {
      if (!activeSet.has(b.user_id)) continue;

      // Idempotent per (user, date)
      const { data: existing } = await supabase
        .from("briefing_actions").select("id")
        .eq("user_id", b.user_id).eq("briefing_date", today).limit(1);
      if (existing && existing.length > 0 && !force) continue;

      const actions = await extractActions(LOVABLE_API_KEY, b.body ?? "", b.metrics ?? {});
      if (actions.length === 0) continue;

      const rows = actions.map((a) => ({
        user_id: b.user_id,
        briefing_id: b.id,
        briefing_date: today,
        action_type: a.action_type,
        payload: { reason: a.reason },
        status: "pending",
        scheduled_for: new Date().toISOString(),
      }));
      const { data: inserted, error: insErr } = await supabase
        .from("briefing_actions").insert(rows).select("*");
      if (insErr) { console.error("insert briefing_actions failed", insErr); continue; }
      queued += inserted?.length ?? 0;

      for (const row of inserted ?? []) {
        await supabase.from("briefing_actions")
          .update({ status: "running", started_at: new Date().toISOString() })
          .eq("id", row.id);
        const { status, result } = await runAction(supabase, SUPABASE_URL, SERVICE_KEY, row);
        await supabase.from("briefing_actions")
          .update({ status, result, finished_at: new Date().toISOString() })
          .eq("id", row.id);
        ran++;
      }
    }
    console.log(`execute-briefing-actions: queued=${queued} ran=${ran}`);
  } catch (e) {
    console.error("execute-briefing-actions job error", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null);
  let force = false;
  try { const b = await req.json(); force = !!b?.force; } catch { /* no body */ }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // @ts-ignore EdgeRuntime is provided by Supabase
  EdgeRuntime.waitUntil(runJob(supabase, SUPABASE_URL, SERVICE_KEY, LOVABLE_API_KEY, force));
  return json(202, { ok: true, status: "briefing actions started in background" });
});
