// Classify an inbound channel_message (email/whatsapp) reply intent via Lovable AI.
// Updates lead.reply_intent + status + last_activity_at. Idempotent on message id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const INTENTS = ["interested", "question", "not_interested", "unsubscribe", "out_of_office", "auto_reply", "other"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { messageId, text, leadId } = await req.json();
    if (!text?.trim() && !messageId) return json(400, { error: "text or messageId required" });

    let body = text as string | undefined;
    let lid = leadId as string | undefined;
    if (messageId && !body) {
      const { data: m } = await supabase
        .from("channel_messages").select("body, lead_id").eq("id", messageId).maybeSingle();
      body = m?.body ?? "";
      lid = lid ?? m?.lead_id ?? undefined;
    }
    if (!body) return json(400, { error: "no body" });

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: `Classify the intent of this reply to a cold sales pitch. Choose ONE: ${INTENTS.join(", ")}. Also write a one-sentence summary.` },
          { role: "user", content: body.slice(0, 4000) },
        ],
        tools: [{
          type: "function",
          function: {
            name: "classify",
            description: "Return classification.",
            parameters: {
              type: "object",
              properties: {
                intent: { type: "string", enum: [...INTENTS] },
                summary: { type: "string" },
              },
              required: ["intent", "summary"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "classify" } },
      }),
    });
    if (!aiRes.ok) return json(500, { error: `AI ${aiRes.status}` });
    const aiJson = await aiRes.json();
    const argsStr = aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return json(500, { error: "no classification" });
    const { intent, summary } = JSON.parse(argsStr) as { intent: string; summary: string };

    if (lid) {
      const newStatus =
        intent === "interested" || intent === "question" ? "replied" :
        intent === "not_interested" || intent === "unsubscribe" ? "lost" : null;
      const updates: Record<string, unknown> = {
        reply_intent: intent,
        last_activity_at: new Date().toISOString(),
      };
      if (newStatus) updates.status = newStatus;
      await supabase.from("leads").update(updates).eq("id", lid);
      await supabase.from("pitch_events").insert({
        user_id: (await supabase.from("leads").select("user_id").eq("id", lid).maybeSingle()).data?.user_id,
        lead_id: lid,
        event_type: "replied",
        channel: "email",
        provider: "classifier",
        payload: { intent, summary },
      });
    }
    return json(200, { intent, summary });
  } catch (e) {
    console.error("classify-reply error", e);
    return json(500, { error: e instanceof Error ? e.message : "error" });
  }
});
