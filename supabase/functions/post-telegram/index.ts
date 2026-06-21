// Posts a message to Telegram via the Lovable connector gateway.
// channel_accounts.credentials = { chat_id: "@channel_or_-100..." }
// The Telegram bot must be an admin of that channel/group, or the chat_id
// must be a user that has /start'd the bot.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

interface Body {
  text: string;
  channelAccountId?: string;
  chatId?: string;
  draftId?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY missing" });
    if (!TELEGRAM_API_KEY) return json(500, { error: "Telegram connector not linked" });

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "Unauthorized" });

    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.text || typeof body.text !== "string") return json(400, { error: "text required" });

    let chatId = body.chatId;
    if (!chatId) {
      const q = supabase.from("channel_accounts").select("id, credentials")
        .eq("user_id", user.id).eq("channel", "telegram").eq("status", "active");
      const { data: rows } = body.channelAccountId
        ? await q.eq("id", body.channelAccountId).limit(1)
        : await q.limit(1);
      const cred = (rows?.[0] as any)?.credentials ?? {};
      chatId = cred.chat_id;
    }
    if (!chatId) return json(400, { error: "No Telegram chat_id configured. Set it in Channels." });

    const tgRes = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TELEGRAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: body.text,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });
    const tgData = await tgRes.json().catch(() => ({}));
    if (!tgRes.ok || !tgData?.ok) {
      console.error("telegram error", tgRes.status, tgData);
      return json(502, { error: tgData?.description || `Telegram ${tgRes.status}` });
    }

    const messageId = tgData?.result?.message_id;
    if (body.draftId) {
      await supabase.from("social_drafts").update({
        status: "posted",
        posted_at: new Date().toISOString(),
        provider_post_id: messageId ? String(messageId) : null,
      }).eq("id", body.draftId);
    }

    return json(200, { ok: true, message_id: messageId });
  } catch (e) {
    console.error("post-telegram error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
