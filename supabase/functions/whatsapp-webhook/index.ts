// Webhook for incoming WhatsApp messages from Meta Cloud API.
// GET = verification challenge. POST = inbound message events.
// verify_jwt is set to false in config.toml so Meta can call it unauthenticated.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);

  // Meta verification handshake
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "lovable-verify";
    if (mode === "subscribe" && token === expected) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method", { status: 405 });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const entries = body?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        // Find the channel_account that owns this phone_number_id
        const { data: accts } = await supabase
          .from("channel_accounts")
          .select("id, user_id")
          .eq("channel", "whatsapp")
          .filter("credentials->>phone_number_id", "eq", phoneNumberId);
        const acct = accts?.[0];
        if (!acct) continue;

        for (const msg of value.messages ?? []) {
          const from = msg.from as string;
          const text = msg.text?.body ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? "[non-text message]";

          // Try to match an existing lead by phone (exact-ish)
          const { data: leads } = await supabase
            .from("leads").select("id")
            .eq("user_id", acct.user_id)
            .ilike("phone", `%${from.slice(-9)}%`).limit(1);
          const leadId = leads?.[0]?.id ?? null;

          await supabase.from("channel_messages").insert({
            user_id: acct.user_id,
            channel_account_id: acct.id,
            lead_id: leadId,
            channel: "whatsapp",
            direction: "inbound",
            from_address: from,
            body: text,
            provider_message_id: msg.id,
            status: "received",
            payload: msg,
          });

          if (leadId) {
            await supabase.from("leads").update({ status: "replied" }).eq("id", leadId);
          }
        }
      }
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("whatsapp-webhook error", e);
    return new Response("error", { status: 500 });
  }
});
